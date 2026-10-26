"""Synthetic fixture identity and CoreMedia timing arithmetic, host only."""
import hashlib
import importlib.util
import json
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('media_diagnostic',ROOT/'iOS_ipa/src/mineradio/media_diagnostic.py')
diagnostic=importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class SyntheticEvidenceTests(unittest.TestCase):
    def test_coremedia_trim_time_conversion(self):
        self.assertEqual(diagnostic._time_frames(diagnostic.CMTime(128,48000,1,0),48000),128)
        self.assertEqual(diagnostic._time_frames(diagnostic.CMTime(1024,44100,1,0),44100),1024)
        self.assertIsNone(diagnostic._time_frames(diagnostic.CMTime(0,0,0,0),48000))

    def test_independent_host_aes_matches_clear_fixture_hash(self):
        from Crypto.Cipher import AES as ReferenceAES
        from music_app.providers.qishui.media import cenc
        directory=ROOT/'iOS_ipa/src/mineradio/fixtures'
        descriptor=json.loads((directory/'media-fixtures.json').read_text(encoding='utf-8'))
        self.assertIs(descriptor['synthetic'],True)
        with patch.object(cenc,'_AES',ReferenceAES):
            for item in descriptor['fixtures']:
                encrypted=(directory/item['file']).read_bytes()
                self.assertEqual(hashlib.sha256(encrypted).hexdigest(),item['encryptedSha256'])
                clear,codec=cenc.decrypt_mp4(encrypted,bytes.fromhex(item['syntheticKeyHex']))
                self.assertEqual(codec,item['codec'])
                self.assertEqual(hashlib.sha256(clear).hexdigest(),item['clearSha256'])


class NativeEvidenceAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory=ROOT/'runtime/ios-qishui-probe-seventh/Mineradio-iOS-unsigned'
        report=cls.directory/'simulator-qishui-diagnostic.json'
        if not report.is_file():
            raise unittest.SkipTest('Downloaded synthetic iPadOS evidence is not present')
        cls.cases={item['codec']:item for item in json.loads(report.read_text(encoding='utf-8'))['media']['cases']}
        cls.items={item['codec']:item for item in json.loads((ROOT/'iOS_ipa/src/mineradio/fixtures/media-fixtures.json').read_text())['fixtures']}

    def aac(self, **overrides):
        case=copy.deepcopy(self.cases['aac'])
        source=(self.directory/'simulator-media-native-aac-reference.m4a').read_bytes()
        output=(self.directory/'simulator-media-native-aac-output.m4a').read_bytes()
        arguments=dict(source_duration=diagnostic._aac_container_frames(source,44100),
            output_duration=diagnostic._aac_container_frames(output,44100),clear_matches=True,
            compressed_matches=diagnostic._sample_digest(source)==diagnostic._sample_digest(output),
            common_prefix_matches=case['commonPrefixPCMMatches'])
        arguments.update(overrides)
        return diagnostic._aac_acceptance(self.items['aac'],case['pcm'],case['originalPCM'],**arguments)

    def test_aac_uses_independent_packet_duration_and_pcm_evidence(self):
        result=self.aac()
        self.assertTrue(result['passed'])
        self.assertEqual(result['referenceMissingFrames'],614)
        self.assertFalse(self.cases['aac']['pcmMatches'],'Full raw mismatch is preserved')
        for change in (dict(clear_matches=False),dict(compressed_matches=False),dict(common_prefix_matches=False),
                       dict(output_duration={'frames':66149}),dict(source_duration={'frames':66151})):
            self.assertFalse(self.aac(**change)['passed'])

    def test_flac_checks_every_valid_sample_and_bounds_zero_padding(self):
        case=copy.deepcopy(self.cases['flac'])
        info=diagnostic._flac_stream_info((self.directory/'simulator-media-native-flac-output.flac').read_bytes())
        def assess(pcm,stream=info):
            return diagnostic._flac_acceptance(self.items['flac'],pcm,stream,clear_matches=True)['passed']
        self.assertTrue(assess(case['pcm']))
        self.assertFalse(case['pcmMatches'],'Full raw mismatch is preserved')
        for key,value in (('expectedPrefixSha256','0'*64),('extraNonZeroSamples',1),
                          ('extraMaxAbsoluteSample',1),('extraFrames',512),('bits',24)):
            changed=copy.deepcopy(case['pcm']);changed[key]=value
            self.assertFalse(assess(changed),key)
        changed=dict(info,frames=47999)
        self.assertFalse(assess(case['pcm'],changed))
        gap=copy.deepcopy(case['pcm']);gap['buffers'][-1]['ptsFrames']+=1
        self.assertFalse(assess(gap))


if __name__=='__main__':
    unittest.main()
