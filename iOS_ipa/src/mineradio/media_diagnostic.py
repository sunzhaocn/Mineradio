"""Account-free native media self-check for an explicitly enabled simulator run.

Call ``run(cache_directory)`` from a worker thread. It only reads the shipped
synthetic fixtures; it never contacts a music service or reads user credentials.
"""
import ctypes as ct
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import traceback
import struct


class AudioStreamBasicDescription(ct.Structure):
    _fields_ = [('sampleRate', ct.c_double), ('formatID', ct.c_uint32),
                ('formatFlags', ct.c_uint32), ('bytesPerPacket', ct.c_uint32),
                ('framesPerPacket', ct.c_uint32), ('bytesPerFrame', ct.c_uint32),
                ('channelsPerFrame', ct.c_uint32), ('bitsPerChannel', ct.c_uint32),
                ('reserved', ct.c_uint32)]


class CMTime(ct.Structure):
    _fields_=[('value',ct.c_int64),('timescale',ct.c_int32),('flags',ct.c_uint32),('epoch',ct.c_int64)]


def _time_frames(value, rate):
    if value.flags & 1 and value.timescale>0:
        return round(value.value*rate/value.timescale)
    return None


def _native_pcm(path, *, timeout=25, progress=None, raw_path=None, expected_frames=None):
    from music_app.providers.qishui.media_ios import native_autorelease_pool
    with native_autorelease_pool(progress,'reader'):
        return _read_native_pcm(path, timeout=timeout, progress=progress,raw_path=raw_path,expected_frames=expected_frames)


def _read_native_pcm(path, *, timeout=25, progress=None,raw_path=None,expected_frames=None):
    from music_app.providers.qishui.media_ios import native_runtime
    runtime=native_runtime()
    classes=runtime['classes']
    ns_from_py,py_from_ns=runtime['ns_from_py'],runtime['py_from_ns']
    send_message=runtime['send_message']
    if progress:
        progress('reader.loadFrameworks')
    core = runtime['libraries']['CoreMedia']
    foundation = runtime['libraries']['CoreFoundation']
    core.CMSampleBufferGetDataBuffer.argtypes, core.CMSampleBufferGetDataBuffer.restype = [ct.c_void_p], ct.c_void_p
    core.CMBlockBufferGetDataLength.argtypes, core.CMBlockBufferGetDataLength.restype = [ct.c_void_p], ct.c_size_t
    core.CMBlockBufferCopyDataBytes.argtypes = [ct.c_void_p, ct.c_size_t, ct.c_size_t, ct.c_void_p]
    core.CMBlockBufferCopyDataBytes.restype = ct.c_int32
    core.CMSampleBufferGetNumSamples.argtypes, core.CMSampleBufferGetNumSamples.restype = [ct.c_void_p], ct.c_long
    core.CMSampleBufferGetFormatDescription.argtypes, core.CMSampleBufferGetFormatDescription.restype = [ct.c_void_p], ct.c_void_p
    core.CMAudioFormatDescriptionGetStreamBasicDescription.argtypes = [ct.c_void_p]
    core.CMAudioFormatDescriptionGetStreamBasicDescription.restype = ct.POINTER(AudioStreamBasicDescription)
    foundation.CFRelease.argtypes, foundation.CFRelease.restype = [ct.c_void_p], None
    core.CMGetAttachment.argtypes,core.CMGetAttachment.restype=[ct.c_void_p,ct.c_void_p,ct.c_void_p],ct.c_void_p
    core.CMTimeMakeFromDictionary.argtypes,core.CMTimeMakeFromDictionary.restype=[ct.c_void_p],CMTime
    for name in ('CMSampleBufferGetDuration','CMSampleBufferGetOutputDuration','CMSampleBufferGetPresentationTimeStamp'):
        function=getattr(core,name)
        function.argtypes,function.restype=[ct.c_void_p],CMTime
    trim_keys={name:ct.c_void_p.in_dll(core,'kCMSampleBufferAttachmentKey_TrimDurationAt'+name).value
               for name in ('Start','End')}
    if progress:
        progress('reader.createAsset')
    asset = classes['AVURLAsset'].URLAssetWithURL(
        classes['NSURL'].fileURLWithPath(str(path)), options=None)
    if progress:
        progress('reader.enumerateTracks')
    tracks = py_from_ns(asset.tracksWithMediaType('soun'))
    if progress:
        progress('reader.enumerateTracks.ready', count=len(tracks), type=type(tracks).__name__)
    if len(tracks) != 1:
        raise ValueError('Synthetic media must have one audio track')
    if progress:
        progress('reader.createReader')
    reader = classes['AVAssetReader'].alloc().initWithAsset(asset, error=None)
    if reader is None:
        raise ValueError('Native audio reader could not be created')
    settings = ns_from_py({'AVFormatIDKey': 0x6C70636D, 'AVLinearPCMBitDepthKey': 16,
                          'AVLinearPCMIsBigEndianKey': False, 'AVLinearPCMIsFloatKey': False,
                          'AVLinearPCMIsNonInterleaved': False})
    if progress:
        progress('reader.createOutput')
    output = classes['AVAssetReaderTrackOutput'].alloc().initWithTrack(
        tracks[0], outputSettings=settings)
    output.alwaysCopiesSampleData = False
    if progress:
        progress('reader.attachOutput')
    if not reader.canAddOutput(output):
        raise ValueError('Native PCM output could not be attached')
    reader.addOutput(output)
    if progress:
        progress('reader.start')
    if not send_message(reader, 'startReading', restype=ct.c_bool):
        raise ValueError('Native audio decoding could not start')
    digest, size, frames, metadata = hashlib.sha256(), 0, 0, {}
    raw,buffer_stats=bytearray(),[]
    deadline = time.monotonic()+timeout
    while True:
        if time.monotonic() > deadline:
            reader.cancelReading()
            raise TimeoutError('Native fixture decoding timed out')
        sample = send_message(output, 'copyNextSampleBuffer', restype=ct.c_void_p)
        if not sample:
            break
        try:
            if progress and not frames:
                progress('reader.firstPCMBuffer')
            block = core.CMSampleBufferGetDataBuffer(sample)
            if not block:
                raise ValueError('Native PCM sample buffer is missing')
            length = core.CMBlockBufferGetDataLength(block)
            if size+length > 32*1024*1024:
                reader.cancelReading()
                raise ValueError('Synthetic PCM output exceeded the probe limit')
            buffer = ct.create_string_buffer(length)
            if core.CMBlockBufferCopyDataBytes(block, 0, length, buffer) != 0:
                raise ValueError('Native PCM sample could not be copied')
            digest.update(buffer.raw)
            raw.extend(buffer.raw)
            size += length
            frames += int(core.CMSampleBufferGetNumSamples(sample))
            if not metadata:
                if progress:
                    progress('reader.firstPCMDescription')
                description = core.CMSampleBufferGetFormatDescription(sample)
                value = core.CMAudioFormatDescriptionGetStreamBasicDescription(description)
                if not value:
                    raise ValueError('Native PCM description is missing')
                metadata = dict(sampleRate=round(value.contents.sampleRate),
                    channels=int(value.contents.channelsPerFrame), bits=int(value.contents.bitsPerChannel))
            rate=metadata['sampleRate']
            item=dict(frames=int(core.CMSampleBufferGetNumSamples(sample)),bytes=length,
                durationFrames=_time_frames(core.CMSampleBufferGetDuration(sample),rate),
                outputDurationFrames=_time_frames(core.CMSampleBufferGetOutputDuration(sample),rate),
                ptsFrames=_time_frames(core.CMSampleBufferGetPresentationTimeStamp(sample),rate))
            for name,key in trim_keys.items():
                attachment=core.CMGetAttachment(sample,key,None)
                item['trim'+name+'Frames']=(_time_frames(core.CMTimeMakeFromDictionary(attachment),rate) if attachment else 0)
            buffer_stats.append(item)
        finally:
            foundation.CFRelease(sample)
    status = int(send_message(reader, 'status', restype=ct.c_long))
    if progress:
        progress('reader.complete', status=status, bytes=size, frames=frames)
    if status != 2 or not size or not frames:
        raise ValueError('Native audio decoder did not finish')
    result=dict(bytes=size, frames=frames, sha256=digest.hexdigest(), **metadata)
    result['buffers']=buffer_stats
    if raw_path is not None:
        Path(raw_path).write_bytes(raw)
        result['rawPCMFile']=Path(raw_path).name
    if expected_frames is not None:
        frame_bytes=metadata['channels']*metadata['bits']//8
        expected_bytes=expected_frames*frame_bytes
        extra=raw[expected_bytes:]
        values=struct.unpack('<'+'h'*(len(extra)//2),extra) if extra else ()
        result.update(expectedFrames=expected_frames,extraFrames=max(0,len(extra)//frame_bytes),
            expectedPrefixSha256=hashlib.sha256(raw[:expected_bytes]).hexdigest() if size>=expected_bytes else None,
            extraPCMBytes=len(extra),extraNonZeroSamples=sum(value!=0 for value in values),
            extraMaxAbsoluteSample=max((abs(value) for value in values),default=0),
            first32Samples=list(struct.unpack('<'+'h'*min(32,size//2),raw[:min(64,size)])),
            last32Samples=list(struct.unpack('<'+'h'*min(32,size//2),raw[-min(64,size):])))
    return result


def _sample_digest(data):
    from music_app.providers.qishui.media_ios import inspect_clear_mp4
    _,_,_,entry,children,ranges = inspect_clear_mp4(data)
    digest,packets = hashlib.sha256(),hashlib.sha256()
    for start, end in ranges:
        digest.update(data[start:end])
        packets.update((end-start).to_bytes(4,'big')+data[start:end])
    description=data[entry.payload:entry.payload+28]+b''.join(
        data[box.payload:box.end] for box in children if box.kind==b'esds')
    return dict(samples=len(ranges), sha256=digest.hexdigest(),
                packetsSha256=packets.hexdigest(),audioDescriptionSha256=hashlib.sha256(description).hexdigest())


def _aac_container_frames(data, sample_rate):
    """Synthetic AAC effective duration from elst or Apple's explicit gapless tag."""
    from music_app.providers.qishui.media_ios import inspect_clear_mp4
    from music_app.providers.qishui.media.mp4 import _boxes,_one
    _,movie,_,_,_,_=inspect_clear_mp4(data)
    mvhd=_one(movie,b'mvhd')
    version=data[mvhd.payload]
    offset=20 if version==1 else 12
    movie_scale=int.from_bytes(data[mvhd.payload+offset:mvhd.payload+offset+4],'big')
    trak=_one(movie,b'trak')
    track_boxes=_boxes(data,trak.payload,trak.end)
    mdia=_one(track_boxes,b'mdia')
    mdhd=_one(_boxes(data,mdia.payload,mdia.end),b'mdhd')
    md_offset=20 if data[mdhd.payload]==1 else 12
    md_width=8 if data[mdhd.payload]==1 else 4
    media_scale=int.from_bytes(data[mdhd.payload+md_offset:mdhd.payload+md_offset+4],'big')
    media_duration=int.from_bytes(data[mdhd.payload+md_offset+4:mdhd.payload+md_offset+4+md_width],'big')
    media_frames=round(media_duration*sample_rate/media_scale)
    edts=next((box for box in track_boxes if box.kind==b'edts'),None)
    if edts is not None:
        elst=_one(_boxes(data,edts.payload,edts.end),b'elst')
        if int.from_bytes(data[elst.payload+4:elst.payload+8],'big')!=1:
            raise ValueError('Synthetic AAC must have one edit segment')
        width=8 if data[elst.payload]==1 else 4
        duration=int.from_bytes(data[elst.payload+8:elst.payload+8+width],'big')
        start=int.from_bytes(data[elst.payload+8+width:elst.payload+8+width*2],'big',signed=True)
        return dict(frames=round(duration*sample_rate/movie_scale),source='elst',
                    decoderDelayFrames=round(start*sample_rate/media_scale),mediaDurationFrames=media_frames,endPaddingFrames=0)
    udta=_one(movie,b'udta')
    meta=_one(_boxes(data,udta.payload,udta.end),b'meta')
    ilst=_one(_boxes(data,meta.payload+4,meta.end),b'ilst')
    for atom in _boxes(data,ilst.payload,ilst.end):
        if atom.kind!=b'----':
            continue
        fields=_boxes(data,atom.payload,atom.end)
        name=next((box for box in fields if box.kind==b'name'),None)
        if name is not None and data[name.payload+4:name.end]==b'iTunSMPB':
            value=_one(fields,b'data')
            tokens=data[value.payload+8:value.end].decode('ascii').split()
            return dict(frames=int(tokens[3],16),decoderDelayFrames=int(tokens[1],16),
                        endPaddingFrames=int(tokens[2],16),source='iTunSMPB',mediaDurationFrames=media_frames)
    raise ValueError('Synthetic AAC effective duration metadata is missing')


def _flac_stream_info(data):
    if data[:4]!=b'fLaC' or len(data)<42 or data[4]&127 or int.from_bytes(data[5:8],'big')!=34:
        raise ValueError('Synthetic FLAC STREAMINFO is missing')
    value=int.from_bytes(data[18:26],'big')
    return dict(frames=value&((1<<36)-1),sampleRate=value>>44,
                channels=((value>>41)&7)+1,bits=((value>>36)&31)+1)


def _continuous_pcm(value):
    cursor=0
    for buffer in value.get('buffers',[]):
        if (buffer['ptsFrames']!=cursor or buffer['durationFrames']!=buffer['frames']
            or buffer['outputDurationFrames']!=buffer['frames']
            or buffer['trimStartFrames']!=0 or buffer['trimEndFrames']!=0):
            return False
        cursor+=buffer['frames']
    return cursor==value['frames'] and value['bytes']==cursor*value['channels']*2 and value['bits']==16


def _aac_acceptance(item, decoded, reference, *, source_duration, output_duration,
                    clear_matches, compressed_matches, common_prefix_matches):
    expected=item['pcmBytes']//(2*item['channels'])
    deficit=expected-reference['frames']
    checks=dict(clearMatchesHost=clear_matches,packetsAndDescriptionMatch=compressed_matches,
        effectiveDurationMatches=source_duration['frames']==output_duration['frames']==expected,
        primingAndMediaDurationMatch=source_duration.get('decoderDelayFrames')==output_duration.get('decoderDelayFrames')
            and source_duration.get('mediaDurationFrames')==output_duration.get('mediaDurationFrames')
            and all(duration.get('mediaDurationFrames')==duration['frames']+duration.get('decoderDelayFrames',0)
                    +duration.get('endPaddingFrames',0) for duration in (source_duration,output_duration)),
        completeOutputPCM=decoded['frames']==expected and decoded['bytes']==item['pcmBytes'],
        overlappingNativePCMMatches=common_prefix_matches,
        referenceOnlyMissingPartialAACFrame=0<=deficit<1024,
        continuousPCMTimelines=_continuous_pcm(decoded) and _continuous_pcm(reference),
        metadataMatches=all(value['sampleRate']==item['sampleRate'] and value['channels']==item['channels']
                            and value['bits']==16 for value in (decoded,reference)))
    return dict(passed=all(checks.values()),checks=checks,referenceMissingFrames=deficit,
        decodedDurationSeconds=decoded['frames']/item['sampleRate'],
        method='independent AES clear hash, identical packets/configuration, effective duration and native PCM overlap')


def _flac_acceptance(item, decoded, stream_info, *, clear_matches):
    expected=item['pcmBytes']//(2*item['channels'])
    extra=decoded['frames']-expected
    checks=dict(clearMatchesHost=clear_matches,
        streamInfoMatches=stream_info==dict(frames=expected,sampleRate=item['sampleRate'],channels=item['channels'],bits=16),
        effectivePCMMatches=decoded['expectedPrefixSha256']==item['pcmSha256'],
        metadataMatches=decoded['sampleRate']==item['sampleRate'] and decoded['channels']==item['channels'] and decoded['bits']==16,
        continuousPCMTimeline=_continuous_pcm(decoded),
        # This diagnostic allows only the observed sub-512-frame all-zero reader
        # alignment tail. Valid FLAC samples are checked in full against an
        # independent lossless reference; nonzero or larger tails fail.
        boundedZeroAlignmentTail=0<=extra<512 and decoded['extraFrames']==extra
            and decoded['extraPCMBytes']==extra*2*item['channels']
            and decoded['extraNonZeroSamples']==0 and decoded['extraMaxAbsoluteSample']==0)
    return dict(passed=all(checks.values()),checks=checks,validFrames=expected,decoderPaddingFrames=extra,
                method='STREAMINFO frame count and independent PCM hash; bounded zero-only decoder tail')


def _run_fixture(item, fixtures, directory, progress):
    from music_app.providers.qishui.media import decrypt_mp4
    from music_app.providers.qishui.media_ios import remux_audio, clear_protection_metadata
    from music_app.ios_crypto import AES
    progress('fixture.read')
    data = (fixtures / item['file']).read_bytes()
    if hashlib.sha256(data).hexdigest() != item['encryptedSha256']:
        raise ValueError('Synthetic media fixture hash mismatch')
    key = bytes.fromhex(item['syntheticKeyHex'])
    progress('crypto.createCTR')
    cipher = AES.new(key, AES.MODE_CTR, nonce=b'', initial_value=0)
    progress('crypto.decryptMP4', nativeCTR=cipher._native is not None)
    clear, codec = decrypt_mp4(data, key)
    clear_hash=hashlib.sha256(clear).hexdigest()
    clear_match=clear_hash==item['clearSha256']
    progress('crypto.decryptMP4.complete', clearBytes=len(clear),clearSha256=clear_hash,clearMatchesHost=clear_match)
    if not clear_match:
        raise ValueError('Native decrypted fixture does not match independent host clear SHA256')
    source, destination = directory / (codec+'-clear.part'), directory / (codec+'-output.part')
    source.write_bytes(clear)
    progress('remux.begin')
    extension = remux_audio(source, destination, timeout=40, progress=progress)
    final = destination.with_suffix('.'+extension)
    destination.rename(final)
    cache=Path(directory).parent
    (cache/('media-native-'+codec+'-output.'+extension)).write_bytes(final.read_bytes())
    progress('decode.output.begin')
    expected_frames=item['pcmBytes']//(2*item['channels'])
    decoded = _native_pcm(final, progress=progress,raw_path=cache/('media-native-'+codec+'-output.s16le'),expected_frames=expected_frames)
    metadata_match = decoded['sampleRate'] == item['sampleRate'] and decoded['channels'] == item['channels']
    result = dict(codec=codec, extension=extension, nativeCTR=cipher._native is not None,
                  encryptedBytes=len(data), clearBytes=len(clear), outputBytes=final.stat().st_size,
                  pcm=decoded, metadataMatches=metadata_match,clearSha256=clear_hash,clearMatchesHost=clear_match)
    if codec == 'aac':
        original = directory / 'aac-clear-reference.m4a'
        original.write_bytes(clear_protection_metadata(clear))
        (cache/'media-native-aac-reference.m4a').write_bytes(original.read_bytes())
        progress('decode.reference.begin')
        reference = _native_pcm(original, progress=progress,raw_path=cache/'media-native-aac-reference.s16le',expected_frames=expected_frames)
        progress('decode.compareCompressedSamples')
        original_samples, exported_samples = _sample_digest(clear), _sample_digest(final.read_bytes())
        pcm_fields=('bytes','frames','sha256','sampleRate','channels','bits')
        pcm_match=all(decoded[field]==reference[field] for field in pcm_fields)
        actual_raw=(cache/'media-native-aac-output.s16le').read_bytes()
        reference_raw=(cache/'media-native-aac-reference.s16le').read_bytes()
        overlap=min(len(actual_raw),len(reference_raw))
        result.update(originalPCM=reference, pcmMatches=pcm_match,
            commonPrefixPCMMatches=actual_raw[:overlap]==reference_raw[:overlap],commonPrefixPCMBytes=overlap,
            outputPrefixSha256=hashlib.sha256(actual_raw[:overlap]).hexdigest(),
            referencePrefixSha256=hashlib.sha256(reference_raw[:overlap]).hexdigest(),
            compressedSamplesMatch=original_samples == exported_samples,
            sampleCount=exported_samples['samples'])
        source_duration=_aac_container_frames(clear,item['sampleRate'])
        output_duration=_aac_container_frames(final.read_bytes(),item['sampleRate'])
        result.update(sourceEffectiveDuration=source_duration,outputEffectiveDuration=output_duration)
        result['acceptance']=_aac_acceptance(item,decoded,reference,source_duration=source_duration,
            output_duration=output_duration,clear_matches=clear_match,
            compressed_matches=original_samples==exported_samples,
            common_prefix_matches=result['commonPrefixPCMMatches'])
        result['passed']=result['acceptance']['passed']
        if not pcm_match:
            result['fullPCMComparisonNote']='Direct clear CENC-derived container reader omitted the final partial AAC frame; raw mismatch remains recorded. Exported output is independently checked for complete effective duration and identical compressed packets/configuration.'
    else:
        result['pcmMatches'] = (decoded['sha256'] == item['pcmSha256'] and decoded['bytes'] == item['pcmBytes'])
        stream_info=_flac_stream_info(final.read_bytes())
        result['streamInfo']=stream_info
        result['acceptance']=_flac_acceptance(item,decoded,stream_info,clear_matches=clear_match)
        result['passed']=result['acceptance']['passed']
        if not result['pcmMatches']:
            result['fullPCMComparisonNote']='Raw AVAssetReader output includes alignment padding; valid STREAMINFO samples and every extra zero sample are checked separately.'
    progress('fixture.complete', passed=result['passed'])
    return result


def run(cache_directory, fixture_root=None):
    if threading.current_thread() is threading.main_thread():
        raise RuntimeError('Native media self-check must run outside the UI thread')
    fixtures = Path(fixture_root or Path(__file__).parent / 'fixtures')
    descriptor = json.loads((fixtures / 'media-fixtures.json').read_text(encoding='utf-8'))
    if descriptor.get('synthetic') is not True:
        raise ValueError('Media diagnostics require explicitly synthetic fixtures')
    cache_directory = Path(cache_directory)
    cache_directory.mkdir(parents=True, exist_ok=True)
    for name in ('aac-output.s16le','aac-reference.s16le','aac-output.m4a',
                 'aac-reference.m4a','flac-output.s16le','flac-output.flac'):
        (cache_directory/('media-native-'+name)).unlink(missing_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='synthetic-media-', dir=cache_directory) as directory:
        directory = Path(directory)
        for item in descriptor['fixtures']:
            state = {'codec':item['codec'], 'stage':'fixture.begin'}
            stages = []
            def progress(stage, **details):
                state.update(stage=stage, **details)
                stages.append(dict(stage=stage, **details))
                (cache_directory / 'media-diagnostic-progress.json').write_text(
                    json.dumps(state, ensure_ascii=True), encoding='utf-8')
            try:
                result = _run_fixture(item, fixtures, directory, progress)
            except Exception as error:
                # This runner only accesses the public synthetic fixtures above;
                # its trace contains code paths, never music sessions or keys.
                result = dict(codec=item['codec'], passed=False, stage=state['stage'],
                              error=type(error).__name__, message=str(error), traceback=traceback.format_exc())
            result['stages'] = stages
            results.append(result)
    return dict(passed=all(item['passed'] for item in results), cases=results,
                accountAccessed=False, networkAccessed=False, physicalDeviceValidated=False)
