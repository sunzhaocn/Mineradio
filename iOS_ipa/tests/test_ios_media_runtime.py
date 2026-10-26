"""Host validation of lifecycle/worker guards, not native runtime execution."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from music_app.providers.qishui import media_ios


class NativeRuntimeGuards(unittest.TestCase):
    def test_pool_pops_exact_token_when_body_raises(self):
        calls=[]
        token=object()
        runtime={'push':lambda:(calls.append('push') or token),
                 'pop':lambda value:calls.append(('pop',value))}
        stages=[]
        with patch.object(media_ios,'_NATIVE_RUNTIME',runtime):
            with self.assertRaisesRegex(ValueError,'probe'):
                with media_ios.native_autorelease_pool(lambda stage:stages.append(stage),'export') as actual:
                    self.assertIs(actual,runtime)
                    calls.append('body')
                    raise ValueError('probe')
        self.assertEqual(calls,['push','body',('pop',token)])
        self.assertEqual(stages,['export.autoreleasePool','export.autoreleasePool.ready'])

    def test_unprepared_worker_fails_before_rubicon_import(self):
        with patch.object(media_ios,'_NATIVE_RUNTIME',None):
            with ThreadPoolExecutor(max_workers=1) as pool:
                result=pool.submit(media_ios.prepare_native_runtime)
                with self.assertRaisesRegex(RuntimeError,'UI thread first'):
                    result.result(timeout=3)
            with self.assertRaisesRegex(RuntimeError,'prepare_native_runtime'):
                with media_ios.native_autorelease_pool():
                    self.fail('An unprepared pool cannot be used')

    def test_prepared_runtime_is_reused_without_class_lookup(self):
        runtime={'classes':{'NSURL':object()}}
        with patch.object(media_ios,'_NATIVE_RUNTIME',runtime):
            self.assertIs(media_ios.native_runtime(),runtime)
            self.assertEqual(media_ios.prepare_native_runtime(),{'ready':True,'classes':1})

    def test_export_is_never_allowed_on_ui_thread(self):
        with self.assertRaisesRegex(RuntimeError,'outside the UI thread'):
            media_ios._export_aac(Path('synthetic.m4a'),Path('output.m4a'),1)


if __name__=='__main__':
    unittest.main()
