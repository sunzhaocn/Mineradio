"""Host tests for profile geometry and active-only scheduling, no UIKit claims."""
import asyncio
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('ios_layout',Path(__file__).parents[1]/'src/mineradio/layout.py')
layout=importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)


class GeometryTests(unittest.TestCase):
    def test_phone_landscape_never_enters_desktop(self):
        for width,height in ((390,844),(932,430),(1024,768)):
            value=layout.configuration(width,height,False)
            self.assertEqual(value['profile'],'phone')
            self.assertFalse(value['bootstrapVisuals'])
            self.assertLessEqual(value['viewportWidth'],880)
            self.assertAlmostEqual(value['scale'],round(width/value['viewportWidth'],6))

    def test_ipad_window_minor_dimension_controls_profile(self):
        for width,height,expected in ((1024,768,'tablet'),(768,1024,'tablet'),
                                      (375,1024,'phone'),(1024,375,'phone'),
                                      (600,800,'tablet'),(599,800,'phone')):
            value=layout.configuration(width,height,True)
            self.assertEqual(value['profile'],expected)
            self.assertTrue(value['bootstrapVisuals'])

    def test_content_width_does_not_override_window_profile(self):
        value=layout.configuration(1024,768,True,1000)
        self.assertEqual(value['profile'],'tablet')
        self.assertEqual(value['viewportWidth'],1100)
        self.assertEqual(value['scale'],round(1000/1100,6))

    def test_invalid_geometry(self):
        for width in (0,-1,float('nan'),float('inf'),10001):
            with self.assertRaises(ValueError):
                layout.configuration(width,768,True)


class SchedulingTests(unittest.IsolatedAsyncioTestCase):
    def monitor(self):
        # Exercise real scheduling without importing any native runtime.
        monitor=object.__new__(layout.LayoutMonitor)
        monitor.loop=asyncio.get_running_loop()
        monitor._task,monitor._last_key,monitor.closed=None,None,False
        monitor.app=type('App',(),{})()
        return monitor

    async def test_background_never_measures_or_evaluates(self):
        monitor=self.monitor()
        monitor.is_active=lambda:False
        monitor.measure=lambda:self.fail('Background layout measured')
        await monitor._monitor()
        self.assertIsNone(monitor._task)

    async def test_resume_is_single_task_and_pause_cancels(self):
        monitor=self.monitor()
        started=asyncio.Event()
        try:
            async def wait_until_paused():
                started.set()
                await asyncio.Future()
            monitor._monitor=wait_until_paused
            monitor._resume_on_ui()
            first=monitor._task
            monitor._resume_on_ui()
            self.assertIs(first,monitor._task)
            await started.wait()
            monitor._pause_on_ui()
            await asyncio.sleep(0)
            self.assertTrue(first.cancelled())
            self.assertIsNone(monitor._task)
        finally:
            monitor._pause_on_ui()


if __name__=='__main__':
    unittest.main()
