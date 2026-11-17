use anyhow::{Context, Result, ensure};
use axum::body::Bytes;
use image::{ExtendedColorType, codecs::jpeg::JpegEncoder};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tokio::sync::watch;
use windows::Graphics::Capture::{
    Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat};
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
use windows::core::{Interface, factory};

#[derive(Clone)]
enum Frame {
    Waiting,
    Jpeg(u64, Bytes),
    Ended,
    Failed,
}

struct Feed {
    id: String,
    frames: watch::Sender<Frame>,
    stop: AtomicBool,
    visible: AtomicBool,
    bar_visible: AtomicBool,
    warm: AtomicBool,
}

#[derive(Default)]
pub struct GlassFrames(Mutex<Option<Arc<Feed>>>);

pub enum GlassReply {
    Missing,
    Waiting,
    Failed,
    Jpeg(u64, Bytes),
}

impl GlassFrames {
    pub async fn frame(&self, id: &str, after: u64) -> GlassReply {
        let feed = self
            .0
            .lock()
            .ok()
            .and_then(|active| active.as_ref().filter(|feed| feed.id == id).cloned());
        let Some(feed) = feed else {
            return GlassReply::Missing;
        };
        let mut frames = feed.frames.subscribe();
        tokio::time::timeout(Duration::from_millis(900), async {
            loop {
                let frame = frames.borrow_and_update().clone();
                match frame {
                    Frame::Jpeg(index, jpeg)
                        if index > after && feed.visible.load(Ordering::Acquire) =>
                    {
                        return GlassReply::Jpeg(index, jpeg);
                    }
                    Frame::Failed => return GlassReply::Failed,
                    Frame::Ended => return GlassReply::Missing,
                    _ => {}
                }
                if frames.changed().await.is_err() {
                    return GlassReply::Missing;
                }
            }
        })
        .await
        .unwrap_or(GlassReply::Waiting)
    }
}

pub struct GlassCapture {
    published: Arc<GlassFrames>,
    feed: Arc<Feed>,
    worker: thread::Thread,
}

impl GlassCapture {
    pub fn start(
        published: Arc<GlassFrames>,
        id: &str,
        window: usize,
        fps: u64,
        bar_visible: bool,
    ) -> Result<Self> {
        let feed = Arc::new(Feed {
            id: id.to_owned(),
            frames: watch::channel(Frame::Waiting).0,
            stop: AtomicBool::new(false),
            visible: AtomicBool::new(true),
            bar_visible: AtomicBool::new(bar_visible),
            warm: AtomicBool::new(true),
        });
        let mut active = published
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("WALLPAPER_GLASS_CAPTURE_UNAVAILABLE"))?;
        let output = Arc::clone(&feed);
        let interval = Duration::from_secs_f64(1.0 / fps.clamp(5, 30) as f64);
        let task = thread::Builder::new()
            .name("wallpaper-glass".into())
            .spawn(move || {
                if let Err(error) = capture(window, &output, interval) {
                    #[cfg(debug_assertions)]
                    eprintln!("Wallpaper glass capture: {error:#}");
                    let _ = error;
                    if !output.stop.load(Ordering::Acquire) {
                        output.frames.send_replace(Frame::Failed);
                    }
                }
            })?;
        *active = Some(Arc::clone(&feed));
        drop(active);
        Ok(Self {
            published,
            feed,
            worker: task.thread().clone(),
        })
    }

    pub fn failed(&self) -> bool {
        matches!(*self.feed.frames.borrow(), Frame::Failed)
    }

    pub fn warm(&self) {
        self.feed.warm.store(true, Ordering::Release);
        self.worker.unpark();
    }

    pub fn visibility(&self, host: bool, bar: bool) {
        let previous_host = self.feed.visible.swap(host, Ordering::AcqRel);
        let previous_bar = self.feed.bar_visible.swap(bar, Ordering::AcqRel);
        if host != previous_host || bar != previous_bar {
            if !host {
                self.feed.frames.send_if_modified(|frame| {
                    if matches!(frame, Frame::Jpeg(..)) {
                        *frame = Frame::Waiting;
                        true
                    } else {
                        false
                    }
                });
            }
            self.worker.unpark();
        }
    }
}

impl Drop for GlassCapture {
    fn drop(&mut self) {
        self.feed.stop.store(true, Ordering::Release);
        self.feed.visible.store(false, Ordering::Release);
        self.feed.frames.send_replace(Frame::Ended);
        if let Ok(mut active) = self.published.0.lock() {
            if active
                .as_ref()
                .is_some_and(|feed| Arc::ptr_eq(feed, &self.feed))
            {
                active.take();
            }
        }
        self.worker.unpark();
    }
}

struct Apartment;

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

struct Capture {
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

fn device() -> Result<(ID3D11Device, ID3D11DeviceContext)> {
    for driver in [D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP] {
        let mut device = None;
        let mut context = None;
        let created = unsafe {
            D3D11CreateDevice(
                None,
                driver,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
        };
        if created.is_ok() {
            if let (Some(device), Some(context)) = (device, context) {
                return Ok((device, context));
            }
        }
    }
    anyhow::bail!("无法创建壁纸采样设备")
}

fn capture(window: usize, feed: &Feed, interval: Duration) -> Result<()> {
    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let _apartment = Apartment;
    ensure!(
        GraphicsCaptureSession::IsSupported()?,
        "Windows 图形捕获不可用"
    );
    let bridge = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    let item = unsafe { bridge.CreateForWindow::<GraphicsCaptureItem>(HWND(window as _))? };
    let (device, context) = device()?;
    let dxgi: IDXGIDevice = device.cast()?;
    let runtime: IDirect3DDevice =
        unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
    let format = DirectXPixelFormat::B8G8R8A8UIntNormalized;
    let mut size = item.Size()?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&runtime, format, 2, size)?;
    let session = pool.CreateCaptureSession(&item)?;
    let capture = Capture { pool, session };
    let _ = capture.session.SetIsCursorCaptureEnabled(false);
    let _ = capture.session.SetIsBorderRequired(false);
    let _ = capture
        .session
        .SetMinUpdateInterval(windows::Foundation::TimeSpan {
            Duration: (interval.as_nanos() / 100) as i64,
        });
    capture.session.StartCapture()?;
    let mut previous = None;
    let mut rgb = Vec::new();
    let mut sequence = 0u64;
    while !feed.stop.load(Ordering::Acquire) {
        if !feed.visible.load(Ordering::Acquire)
            || !(feed.warm.load(Ordering::Acquire) || feed.bar_visible.load(Ordering::Acquire))
        {
            thread::park_timeout(Duration::from_millis(150));
            continue;
        }
        if let Ok(frame) = capture.pool.TryGetNextFrame() {
            let current = frame.ContentSize()?;
            if current.Width > 0
                && current.Height > 0
                && (current.Width != size.Width || current.Height != size.Height)
            {
                frame.Close()?;
                capture.pool.Recreate(&runtime, format, 2, current)?;
                previous = None;
                size = current;
            } else if current.Width > 0 && current.Height > 0 {
                let value =
                    encode_frame(&device, &context, &frame, current, &mut previous, &mut rgb)?;
                frame.Close()?;
                if !feed.stop.load(Ordering::Acquire) && feed.visible.load(Ordering::Acquire) {
                    sequence += 1;
                    feed.frames
                        .send_replace(Frame::Jpeg(sequence, value.into()));
                    feed.warm.store(false, Ordering::Release);
                }
            }
        }
        thread::park_timeout(interval);
    }
    Ok(())
}

fn encode_frame(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    frame: &Direct3D11CaptureFrame,
    content: SizeInt32,
    staging: &mut Option<ID3D11Texture2D>,
    rgb: &mut Vec<u8>,
) -> Result<Vec<u8>> {
    let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
    let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    if staging.is_none() {
        let cpu = D3D11_TEXTURE2D_DESC {
            Usage: D3D11_USAGE_STAGING,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            BindFlags: 0,
            MiscFlags: 0,
            ..desc
        };
        unsafe { device.CreateTexture2D(&cpu, None, Some(staging))? };
    }
    let target = staging.as_ref().context("没有壁纸采样缓冲区")?;
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe {
        context.CopyResource(target, &texture);
        context.Map(target, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
    }
    let width = desc.Width.min(content.Width as u32) as usize;
    let height = desc.Height.min(content.Height as u32) as usize;
    let pitch = mapped.RowPitch as usize;
    let color = if width > 0 && height > 0 && !mapped.pData.is_null() && pitch >= width * 4 {
        let pixels = unsafe {
            std::slice::from_raw_parts(mapped.pData.cast::<u8>(), pitch * (height - 1) + width * 4)
        };
        let scale = (960.0 / width as f64).min(540.0 / height as f64).min(1.0);
        let output_width = ((width as f64 * scale) as usize).max(1);
        let output_height = ((height as f64 * scale) as usize).max(1);
        rgb.resize(output_width * output_height * 3, 0);
        for (y, row) in rgb.chunks_exact_mut(output_width * 3).enumerate() {
            let src = (y * height / output_height) * pitch;
            for (x, color) in row.chunks_exact_mut(3).enumerate() {
                let offset = src + (x * width / output_width) * 4;
                color.copy_from_slice(&[pixels[offset + 2], pixels[offset + 1], pixels[offset]]);
            }
        }
        Some((output_width as u32, output_height as u32))
    } else {
        None
    };
    unsafe { context.Unmap(target, 0) };
    let (width, height) = color.context("没有收到有效的壁纸像素")?;
    let mut jpeg = Vec::with_capacity(48 * 1024);
    JpegEncoder::new_with_quality(&mut jpeg, 76).encode(
        rgb,
        width,
        height,
        ExtendedColorType::Rgb8,
    )?;
    Ok(jpeg)
}
