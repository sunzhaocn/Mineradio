use std::path::PathBuf;

pub fn resource(relative: &str) -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let dir = executable.parent()?;
    let installed = dir.join("resources").join(relative);
    if installed.exists() {
        return Some(installed);
    }
    dir.ancestors()
        .take(5)
        .map(|ancestor| ancestor.join("Windows_exe").join(relative))
        .find(|candidate| candidate.exists())
}

pub fn ffmpeg() -> Option<PathBuf> {
    resource("tools/ffmpeg.exe").or_else(|| resource("build/tools/ffmpeg.exe"))
}

pub fn hidden_command(executable: &std::path::Path) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(executable);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command.kill_on_drop(true);
    command
}
