use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::io;
use std::os::windows::{ffi::OsStrExt, io::AsRawHandle};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
use tokio::time::{Duration, Instant, sleep, timeout, timeout_at};
use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_BROKEN_PIPE, ERROR_FILE_NOT_FOUND, ERROR_NO_DATA, ERROR_PIPE_BUSY,
    ERROR_PIPE_NOT_CONNECTED,
};
use windows_sys::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION;
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

const SHOW_WINDOW: u8 = 1;
const BACKGROUND_LAUNCH: u8 = 2;
const ACCEPTED: u8 = 3;

fn pipe_name(profile: &Path) -> Result<String> {
    let path = profile
        .canonicalize()
        .context("无法定位 Mineradio 资料目录")?;
    let mut hash = Sha256::new();
    for unit in path.as_os_str().encode_wide() {
        hash.update(unit.to_le_bytes());
    }
    Ok(format!(
        r"\\.\pipe\Mineradio.{}",
        hex::encode(hash.finalize())
    ))
}

fn disconnected(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::UnexpectedEof
        || matches!(
            error.raw_os_error().map(|code| code as u32),
            Some(ERROR_BROKEN_PIPE | ERROR_NO_DATA | ERROR_PIPE_NOT_CONNECTED)
        )
}

/// Own the instance for this profile, or hand the shortcut launch to its owner.
pub async fn claim(profile: &Path, show_window: bool) -> Result<Option<NamedPipeServer>> {
    let name = pipe_name(profile)?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match ServerOptions::new()
            .first_pipe_instance(true)
            .max_instances(1)
            .reject_remote_clients(true)
            .create(&name)
        {
            Ok(server) => return Ok(Some(server)),
            Err(error)
                if matches!(
                    error.raw_os_error().map(|code| code as u32),
                    Some(ERROR_ACCESS_DENIED | ERROR_PIPE_BUSY)
                ) => {}
            Err(error) => return Err(error).context("无法创建 Mineradio 启动通道"),
        }

        let result = timeout_at(deadline, forward(&name, show_window))
            .await
            .context("已打开的 Mineradio 暂未响应")?;
        match result {
            Ok(()) => return Ok(None),
            Err(error)
                if Instant::now() < deadline
                    && (disconnected(&error)
                        || matches!(
                            error.raw_os_error().map(|code| code as u32),
                            Some(ERROR_FILE_NOT_FOUND | ERROR_PIPE_BUSY)
                        )) =>
            {
                sleep(Duration::from_millis(25)).await;
            }
            Err(error) => return Err(error).context("无法联系已打开的 Mineradio"),
        }
    }
}

async fn forward(name: &str, show_window: bool) -> io::Result<()> {
    let mut client = ClientOptions::new()
        .security_qos_flags(SECURITY_IDENTIFICATION)
        .open(name)?;
    if show_window {
        let mut owner = 0;
        // A shortcut launched by Explorer can transfer foreground access to the owner.
        unsafe {
            if GetNamedPipeServerProcessId(client.as_raw_handle(), &mut owner) != 0 && owner != 0 {
                AllowSetForegroundWindow(owner);
            }
        }
    }
    client
        .write_u8(if show_window {
            SHOW_WINDOW
        } else {
            BACKGROUND_LAUNCH
        })
        .await?;
    if client.read_u8().await? != ACCEPTED {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Mineradio 启动响应无效",
        ));
    }
    Ok(())
}

pub async fn listen(mut server: NamedPipeServer, show: impl Fn() -> bool) -> io::Result<()> {
    loop {
        match server.connect().await {
            Ok(()) => {
                let _ = timeout(Duration::from_secs(2), async {
                    let accepted = match server.read_u8().await? {
                        SHOW_WINDOW => show(),
                        BACKGROUND_LAUNCH => true,
                        _ => false,
                    };
                    if accepted {
                        server.write_u8(ACCEPTED).await?;
                        // Keep the pipe connected until the launcher reads the acknowledgment.
                        let _ = server.read_u8().await;
                    }
                    Ok::<(), io::Error>(())
                })
                .await;
            }
            Err(error) if disconnected(&error) => {}
            Err(error) => return Err(error),
        }
        if let Err(error) = server.disconnect()
            && !disconnected(&error)
        {
            return Err(error);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reuses_the_running_profile_and_releases_it_on_exit() -> Result<()> {
        let profile = tempfile::tempdir()?;
        let path = profile.path();
        let server = claim(path, true)
            .await?
            .expect("first launch owns the pipe");
        let (sent, mut received) = tokio::sync::mpsc::unbounded_channel();
        let listener = tokio::spawn(listen(server, move || sent.send(()).is_ok()));

        let (shortcut, startup, repeat) =
            tokio::try_join!(claim(path, true), claim(path, false), claim(path, true))?;
        assert!(shortcut.is_none() && startup.is_none() && repeat.is_none());
        assert!(received.try_recv().is_ok());
        assert!(received.try_recv().is_ok());
        assert!(received.try_recv().is_err());

        listener.abort();
        assert!(listener.await.unwrap_err().is_cancelled());
        assert!(claim(path, true).await?.is_some());
        Ok(())
    }
}
