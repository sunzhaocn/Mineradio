"""Independently decode downloaded synthetic native outputs; never account data."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('diagnostic',ROOT/'iOS_ipa/src/mineradio/media_diagnostic.py')
diagnostic=importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)
directory=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'runtime/ios-qishui-probe-seventh/Mineradio-iOS-unsigned'
items={i['codec']:i for i in json.loads((ROOT/'iOS_ipa/src/mineradio/fixtures/media-fixtures.json').read_text())['fixtures']}
native=json.loads((directory/'simulator-qishui-diagnostic.json').read_text(encoding='utf-8'))['media']
report=dict(environment='Windows FFmpeg independent decode of synthetic iPadOS26.2 outputs',syntheticOnly=True,cases=[])
for case in native['cases']:
    codec=case['codec'];item=items[codec];extension='m4a' if codec=='aac' else 'flac'
    path=directory/('simulator-media-native-'+codec+'-output.'+extension)
    pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','s16le','-acodec','pcm_s16le','-'])
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
    stream=probe['streams'][0]
    evidence=dict(codec=codec,outputSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        independentPCMBytes=len(pcm),independentPCMSha256=hashlib.sha256(pcm).hexdigest(),
        matchesIndependentReference=len(pcm)==item['pcmBytes'] and hashlib.sha256(pcm).hexdigest()==item['pcmSha256'],
        stream={k:stream.get(k) for k in ('codec_name','sample_rate','channels','bits_per_raw_sample','duration_ts','time_base','start_pts','nb_frames')},
        streamMetadataMatches=stream['codec_name']==codec and int(stream['sample_rate'])==item['sampleRate']
            and stream['channels']==item['channels'] and (codec=='aac' or int(stream['bits_per_raw_sample'])==16),
        nativeFullPCMMatchesReference=case['pcmMatches'],nativeClearMatchesHost=case['clearMatchesHost'])
    if codec=='aac':
        reference_path=directory/'simulator-media-native-aac-reference.m4a'
        reference=subprocess.check_output(['ffmpeg','-v','error','-i',str(reference_path),'-f','s16le','-acodec','pcm_s16le','-'])
        source_duration=diagnostic._aac_container_frames(reference_path.read_bytes(),44100)
        output_duration=diagnostic._aac_container_frames(path.read_bytes(),44100)
        packets_match=diagnostic._sample_digest(reference_path.read_bytes())==diagnostic._sample_digest(path.read_bytes())
        apple_raw=(directory/'simulator-media-native-aac-output.s16le').read_bytes()
        apple=struct.unpack('<'+'h'*(len(apple_raw)//2),apple_raw)
        ffmpeg=struct.unpack('<'+'h'*(len(pcm)//2),pcm)
        acceptance=diagnostic._aac_acceptance(item,case['pcm'],case['originalPCM'],source_duration=source_duration,
            output_duration=output_duration,clear_matches=case['clearMatchesHost'],compressed_matches=packets_match,
            common_prefix_matches=case['commonPrefixPCMMatches'])
        evidence.update(hostBothContainersPCMIdentical=pcm==reference,sourceEffectiveDuration=source_duration,
            outputEffectiveDuration=output_duration,packetsAndAudioDescriptionMatch=packets_match,
            appleVsFFmpegMaxAbsoluteLSB=max(abs(a-b) for a,b in zip(apple,ffmpeg)),
            appleVsFFmpegDifferingSamples=sum(a!=b for a,b in zip(apple,ffmpeg)),acceptance=acceptance)
        evidence['passed']=evidence['matchesIndependentReference'] and evidence['streamMetadataMatches'] and pcm==reference and acceptance['passed']
    else:
        info=diagnostic._flac_stream_info(path.read_bytes())
        acceptance=diagnostic._flac_acceptance(item,case['pcm'],info,clear_matches=case['clearMatchesHost'])
        evidence.update(streamInfo=info,acceptance=acceptance)
        evidence['passed']=evidence['matchesIndependentReference'] and evidence['streamMetadataMatches'] and acceptance['passed']
    report['cases'].append(evidence)
report['passed']=all(case['passed'] for case in report['cases'])
target=ROOT/'runtime/ios-qishui-media/host-native-verification.json'
target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
if not report['passed']:
    raise SystemExit(1)
