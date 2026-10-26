"""In-process iOS media output. No FFmpeg, network, or account access.

AAC is exported through AVFoundation without transcoding. FLAC is demuxed
losslessly according to RFC 9639's ISO BMFF mapping (dfLa + FLAC frames).
The caller must have already decrypted its account-authorized media samples.
"""
from pathlib import Path
from contextlib import contextmanager
import ctypes as ct
import threading
import uuid

from .media.mp4 import _boxes, _one, _uint, _fullbox, _sample_sizes, _sample_ranges

_EXPORT_SLOTS = threading.BoundedSemaphore(2)
_NATIVE_RUNTIME = None


def prepare_native_runtime(progress=None):
    """Initialize framework/class metadata on UI before any media worker starts.

    Rubicon dynamically discovers Objective-C class and method metadata. Doing
    the first class initialization on a Python worker can interlock with the UI
    thread. No assets, music sessions, SDKs or credentials are accessed here.
    """
    global _NATIVE_RUNTIME
    if _NATIVE_RUNTIME is not None:
        return dict(ready=True, classes=len(_NATIVE_RUNTIME['classes']))
    if threading.current_thread() is not threading.main_thread():
        raise RuntimeError('Prepare native media runtime on the UI thread first')
    from rubicon.objc import ObjCClass, Block, ns_from_py, py_from_ns, objc_id
    from rubicon.objc.runtime import load_library, send_message
    if progress:
        progress('media.prepare.frameworks')
    libraries={name:load_library(name) for name in ('AVFoundation','CoreMedia','CoreFoundation')}
    # CDLL calls release the GIL. Do not wrap NSAutoreleasePool through Rubicon
    # on worker threads; the runtime's C pool operations need no class lookup.
    objc=ct.CDLL('/usr/lib/libobjc.A.dylib')
    push,pop=objc.objc_autoreleasePoolPush,objc.objc_autoreleasePoolPop
    push.argtypes,push.restype=[],ct.c_void_p
    pop.argtypes,pop.restype=[ct.c_void_p],None
    classes={}
    for name in ('NSURL','AVURLAsset','AVAssetExportSession','AVAssetReader','AVAssetReaderTrackOutput',
                 'NSString','NSDictionary','NSMutableDictionary','NSNumber','NSArray','NSMutableArray'):
        if progress:
            progress('media.prepare.class', name=name)
        cls=ObjCClass(name)
        # +self forces Apple's +initialize on UI, rather than deferring it to
        # the first worker message to this Objective-C class.
        send_message(cls,'self',restype=objc_id)
        classes[name]=cls
    # Warm the collection conversions used by export supported types and reader
    # output settings while we still own the UI's normal autorelease context.
    py_from_ns(ns_from_py({'AVFormatIDKey':0x6C70636D,'probe':False}))
    py_from_ns(ns_from_py([]))
    _NATIVE_RUNTIME=dict(classes=classes,libraries=libraries,objc=objc,push=push,pop=pop,
                         Block=Block,ns_from_py=ns_from_py,py_from_ns=py_from_ns,
                         objc_id=objc_id,send_message=send_message)
    if progress:
        progress('media.prepare.complete', classes=len(classes))
    return dict(ready=True,classes=len(classes))


def native_runtime():
    if _NATIVE_RUNTIME is None:
        raise RuntimeError('Call media_ios.prepare_native_runtime() on the UI thread before native media work')
    return _NATIVE_RUNTIME


@contextmanager
def native_autorelease_pool(progress=None, prefix='native'):
    runtime=native_runtime()
    if progress:
        progress(prefix+'.autoreleasePool')
    pool=runtime['push']()
    try:
        if progress:
            progress(prefix+'.autoreleasePool.ready')
        yield runtime
    finally:
        runtime['pop'](pool)


def inspect_clear_mp4(data):
    top = _boxes(data, 0, len(data))
    if any(box.kind == b'moof' for box in top):
        raise ValueError('Fragmented MP4 media is unsupported')
    movie = _boxes(data, _one(top, b'moov').payload, _one(top, b'moov').end)
    tracks = [box for box in movie if box.kind == b'trak']
    if len(tracks) != 1:
        raise ValueError('A single audio track is required')
    mdia = _one(_boxes(data, tracks[0].payload, tracks[0].end), b'mdia')
    media = _boxes(data, mdia.payload, mdia.end)
    handler = _one(media, b'hdlr')
    if data[handler.payload+8:handler.payload+12] != b'soun':
        raise ValueError('A single audio track is required')
    minf = _one(media, b'minf')
    stbl = _one(_boxes(data, minf.payload, minf.end), b'stbl')
    tables = _boxes(data, stbl.payload, stbl.end)
    stsd = _one(tables, b'stsd')
    if _fullbox(data, stsd) != (0, 0) or _uint(data, stsd.payload+4, 4, stsd.end) != 1:
        raise ValueError('A single audio description is required')
    entries = _boxes(data, stsd.payload+8, stsd.end)
    if len(entries) != 1 or entries[0].kind not in (b'mp4a', b'fLaC'):
        raise ValueError('An already-decrypted AAC/FLAC sample entry is required')
    entry = entries[0]
    version = _uint(data, entry.payload+8, 2, entry.end)
    extension = {0:0, 1:16, 2:36}.get(version)
    if extension is None:
        raise ValueError('Unsupported audio description version')
    children = _boxes(data, entry.payload+28+extension, entry.end)
    mdats = [box for box in top if box.kind == b'mdat']
    sizes = _sample_sizes(data, _one(tables, b'stsz'), sum(box.end-box.payload for box in mdats))
    ranges = _sample_ranges(data, tables, sizes, mdats)
    return top, movie, tables, entry, children, ranges


def clear_protection_metadata(data):
    """Make ignored/free boxes without moving any media sample or chunk offset."""
    top, movie, tables, entry, children, ranges = inspect_clear_mp4(data)
    output = bytearray(data)
    for boxes, kinds in ((top, {b'pssh'}), (movie, {b'pssh'}),
                          (tables, {b'senc', b'saio', b'saiz'}), (children, {b'sinf'})):
        for box in boxes:
            if box.kind in kinds:
                output[box.start+4:box.start+8] = b'free'
    return bytes(output)


def extract_clear_flac(data):
    _, _, _, entry, children, ranges = inspect_clear_mp4(data)
    if entry.kind != b'fLaC':
        raise ValueError('FLAC audio is required')
    dfla = _one(children, b'dfLa')
    if _fullbox(data, dfla) != (0, 0):
        raise ValueError('Unsupported FLAC metadata version')
    metadata = data[dfla.payload+4:dfla.end]
    position, count, terminal = 0, 0, False
    while position < len(metadata):
        if terminal or len(metadata)-position < 4:
            raise ValueError('Invalid FLAC metadata blocks')
        kind, size = metadata[position] & 127, int.from_bytes(metadata[position+1:position+4], 'big')
        if count == 0 and (kind != 0 or size != 34):
            raise ValueError('FLAC STREAMINFO is missing')
        if kind == 127 or position+4+size > len(metadata):
            raise ValueError('Invalid FLAC metadata block size')
        terminal = bool(metadata[position] & 128)
        position += 4+size
        count += 1
    if not terminal or not count:
        raise ValueError('FLAC metadata is incomplete')
    return b'fLaC' + metadata + b''.join(data[start:end] for start, end in ranges)


def _export_aac(source, destination, timeout, progress=None):
    if threading.current_thread() is threading.main_thread():
        raise RuntimeError('Native media export must run outside the UI thread')
    with native_autorelease_pool(progress,'export'):
        _perform_aac_export(source, destination, timeout, progress)


def _perform_aac_export(source, destination, timeout, progress=None):
    runtime=native_runtime()
    classes=runtime['classes']
    Block,py_from_ns=runtime['Block'],runtime['py_from_ns']
    objc_id,send_message=runtime['objc_id'],runtime['send_message']
    if progress:
        progress('export.loadFramework')
    url = classes['NSURL']
    if progress:
        progress('export.createAsset')
    asset = classes['AVURLAsset'].URLAssetWithURL(url.fileURLWithPath(str(source)), options=None)
    if progress:
        progress('export.createSession')
    exporter = classes['AVAssetExportSession'].alloc().initWithAsset(asset,
        presetName='AVAssetExportPresetPassthrough')
    if exporter is None:
        raise ValueError('Native AAC export is unavailable')
    if progress:
        progress('export.supportedFileTypes')
    # Explicit selectors avoid treating a readonly getter as ObjCBoundMethod
    # when Apple's runtime omits Objective-C property metadata.
    supported = [str(value) for value in py_from_ns(send_message(
        exporter, 'supportedFileTypes', restype=objc_id))]
    if progress:
        progress('export.supportedFileTypes.ready', count=len(supported))
    file_type = next((value for value in ('com.apple.m4a-audio', 'public.mpeg-4') if value in supported), None)
    if not file_type:
        raise ValueError('Native AAC passthrough container is unavailable')
    exporter.outputURL = url.fileURLWithPath(str(destination))
    exporter.outputFileType = file_type
    exporter.shouldOptimizeForNetworkUse = True
    completed = threading.Event()
    def finished() -> None:
        completed.set()
    callback = Block(finished, None)
    # Retain exporter, asset, callback and URL objects until completion/cancel.
    if progress:
        progress('export.start')
    exporter.exportAsynchronouslyWithCompletionHandler(callback)
    if not completed.wait(timeout):
        exporter.cancelExport()
        completed.wait(3)
        raise TimeoutError('Native AAC export timed out')
    status = int(send_message(exporter, 'status', restype=ct.c_long))
    if progress:
        progress('export.complete', status=status, bytes=destination.stat().st_size if destination.is_file() else 0)
    if status != 3 or not destination.is_file() or not destination.stat().st_size:
        raise ValueError('Native AAC passthrough failed')


def remux_audio(source, destination, *, timeout=40, progress=None):
    """Return 'm4a' or 'flac'; at most two native exports, bounded wait, no UI block."""
    source, destination = Path(source).resolve(strict=True), Path(destination).resolve()
    if not source.is_file() or source == destination or destination.exists():
        raise ValueError('Media source/destination is invalid')
    if not 0 < source.stat().st_size <= 128*1024*1024 or not 0 < timeout <= 90:
        raise ValueError('Media size or export timeout is invalid')
    destination.parent.mkdir(parents=True, exist_ok=True)
    data = source.read_bytes()
    if progress:
        progress('remux.inspect', bytes=len(data))
    _, _, _, entry, _, _ = inspect_clear_mp4(data)
    if entry.kind == b'fLaC':
        if progress:
            progress('remux.extractFLAC')
        destination.write_bytes(extract_clear_flac(data))
        return 'flac'
    if not _EXPORT_SLOTS.acquire(timeout=10):
        raise TimeoutError('Native media exporters are busy')
    normalized = destination.parent / (uuid.uuid4().hex+'.m4a')
    try:
        if progress:
            progress('remux.normalizeAAC')
        normalized.write_bytes(clear_protection_metadata(data))
        _export_aac(normalized, destination, timeout, progress)
        return 'm4a'
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        normalized.unlink(missing_ok=True)
        _EXPORT_SLOTS.release()
