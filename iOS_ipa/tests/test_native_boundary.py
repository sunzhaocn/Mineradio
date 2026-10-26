"""Exercise message permissions with Objective-C replaced by a small host double."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]


class NativeBase:
    def __init_subclass__(cls, **kwargs):
        pass


def load_native():
    objc = types.ModuleType('rubicon.objc')
    runtime = types.ModuleType('rubicon.objc.runtime')
    objc.ObjCClass = lambda name: NativeBase
    def missing_protocol(name):
        raise NameError(name)
    objc.ObjCProtocol = missing_protocol
    objc.ObjCBlock = lambda *args: None
    objc.objc_id = object
    objc.objc_method = lambda method: method
    objc.objc_property = lambda *args, **kwargs: None
    objc.py_from_ns = lambda value: value
    objc.ns_from_py = lambda value: value
    runtime.load_library = lambda name: None
    runtime.send_message = lambda frame, selector, **kwargs: frame.main
    spec = importlib.util.spec_from_file_location('mineradio_native_boundary', PROJECT / 'src/mineradio/native.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'rubicon': types.ModuleType('rubicon'), 'rubicon.objc': objc,
                                 'rubicon.objc.runtime': runtime}):
        spec.loader.exec_module(module)
    return module


class NativeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.native = load_native()
        self.temporary = tempfile.TemporaryDirectory()
        self.messages = []
        self.app = types.SimpleNamespace(port=18080,
            paths=types.SimpleNamespace(cache=Path(self.temporary.name)), handle_bridge=self.messages.append)

    def tearDown(self):
        self.temporary.cleanup()

    def message(self, *, main=True, host='127.0.0.1', port=18080, identifier=1.0):
        return types.SimpleNamespace(frameInfo=types.SimpleNamespace(main=main,
            securityOrigin=types.SimpleNamespace(protocol='http', host=host, port=port)),
            body={'id':identifier, 'op':'beginSave', 'args':{'size':3.0, 'offset':0.0}})

    def test_webkit_double_integers_reach_dispatch(self):
        self.native.receive_message(self.app, self.message())
        self.assertEqual(len(self.messages), 1)
        self.assertIs(type(self.messages[0]['id']), int)
        self.assertIs(type(self.messages[0]['args']['size']), int)
        self.assertIs(type(self.messages[0]['args']['offset']), int)

    def test_subframe_is_rejected(self):
        self.native.receive_message(self.app, self.message(main=False))
        self.assertEqual(self.messages, [])

    def test_other_origin_and_port_are_rejected(self):
        for message in (self.message(host='example.org'), self.message(port=18081)):
            self.native.receive_message(self.app, message)
        self.assertEqual(self.messages, [])

    def test_fractional_or_nonfinite_identifier_is_rejected(self):
        for identifier in (1.5, float('inf'), float('nan'), True):
            self.native.receive_message(self.app, self.message(identifier=identifier))
        self.assertEqual(self.messages, [])


if __name__ == '__main__':
    unittest.main()
