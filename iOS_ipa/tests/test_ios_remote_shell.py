import importlib.util
from pathlib import Path
import sys
import types
import unittest
import ast
import tempfile
from unittest.mock import Mock, patch


class RemoteShellTests(unittest.TestCase):
    def test_fullscreen_view_has_only_one_controller_owner(self):
        source=Path(__file__).resolve().parents[1]/'src/mineradio/remote_app.py'
        function=next(node for node in ast.parse(source.read_text()).body
                      if isinstance(node,ast.FunctionDef) and node.name=='configure_window')
        owners={}
        class Controller:
            @classmethod
            def alloc(cls):return cls()
            def init(self):return self
            @property
            def view(self):return self._view
            @view.setter
            def view(self,value):
                if id(value) in owners:raise RuntimeError('View already has a controller')
                owners[id(value)]=self;self._view=value
        class Container:
            def __init__(self,**kwargs):self.native=object()
        class RootContainer(Container):
            def __init__(self,**kwargs):
                super().__init__(**kwargs)
                self.controller=Controller();self.controller.view=self.native
        main=type('MainWindow',(),{})
        modules={'toga_iOS.container':types.SimpleNamespace(Container=Container,RootContainer=RootContainer),
                 'toga_iOS.window':types.SimpleNamespace(MainWindow=main),
                 'rubicon.objc':types.SimpleNamespace(ObjCClass=lambda name:Controller,objc_method=lambda f:f)}
        namespace={}
        with patch.dict(sys.modules,modules):
            exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
            namespace['configure_window']()
            window=main();window.content_refreshed=lambda *a:None
            window.create_container()
        self.assertEqual(len(owners),1)
        self.assertTrue(window.container.controller.prefersStatusBarHidden())
        self.assertEqual(window.container.top_offset,0)

    def test_keep_awake_is_released_when_app_resigns_active(self):
        source=Path(__file__).resolve().parents[1]/'src/mineradio/remote_app.py'
        function=next(node for node in ast.parse(source.read_text()).body
                      if isinstance(node,ast.FunctionDef) and node.name=='configure_keep_awake')
        class Observer:
            @classmethod
            def alloc(cls):return cls()
            def init(self):return self
        system=types.SimpleNamespace(idleTimerDisabled=False)
        center=Mock()
        def objc(name):
            return {'NSObject':Observer,'UIApplication':types.SimpleNamespace(sharedApplication=system),
                    'NSNotificationCenter':types.SimpleNamespace(defaultCenter=center)}[name]
        namespace={}
        with patch.dict(sys.modules,{'rubicon.objc':types.SimpleNamespace(ObjCClass=objc,SEL=lambda x:x,objc_method=lambda f:f)}):
            exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
            app=types.SimpleNamespace();namespace['configure_keep_awake'](app)
            self.assertTrue(system.idleTimerDisabled)
            app.awake_observer.deactivate_(None);self.assertFalse(system.idleTimerDisabled)
            app.awake_observer.activate_(None);self.assertTrue(system.idleTimerDisabled)
        self.assertEqual(center.addObserver.call_count,2)

    def test_audio_channel_rejects_other_frames_and_activates_only_on_state_changes(self):
        source=Path(__file__).resolve().parents[1]/'src/mineradio/remote_app.py'
        method=next(node for node in ast.walk(ast.parse(source.read_text()))
                    if isinstance(node,ast.FunctionDef) and node.name=='userContentController_didReceiveScriptMessage_')
        method.decorator_list=[]
        runtime=types.SimpleNamespace(send_message=lambda frame,*a,**k:frame.main)
        objc=types.SimpleNamespace(py_from_ns=lambda value:value)
        namespace={}
        exec(compile(ast.Module(body=[method],type_ignores=[]),str(source),'exec'),namespace)
        with tempfile.TemporaryDirectory() as folder,patch.dict(sys.modules,{'rubicon.objc':objc,'rubicon.objc.runtime':runtime}):
            app=types.SimpleNamespace(audio_session=Mock(),paths=types.SimpleNamespace(data=Path(folder)))
            receiver=types.SimpleNamespace(owner=app)
            origin=types.SimpleNamespace(protocol='https',host='music.hbsuzh.cn',port=443)
            frame=types.SimpleNamespace(main=False,securityOrigin=origin)
            message=types.SimpleNamespace(frameInfo=frame,body={'op':'audio','playing':True})
            receive=namespace[method.name]
            receive(receiver,None,message);app.audio_session.setActive.assert_not_called()
            frame.main=True;origin.host='untrusted.example'
            receive(receiver,None,message);app.audio_session.setActive.assert_not_called()
            origin.host='music.hbsuzh.cn'
            receive(receiver,None,message);receive(receiver,None,message)
            app.audio_session.setActive.assert_called_once_with(True,error=None)
            message.body={'op':'audio','playing':False}
            receive(receiver,None,message)
            self.assertEqual(app.audio_session.setActive.call_count,2)
            app.audio_session.setActive.assert_called_with(False,withOptions=1,error=None)

    def test_webview_receives_a_persistent_store_instance_in_both_modes(self):
        source=Path(__file__).resolve().parents[1]/'src/mineradio/native.py'
        function=next(node for node in ast.parse(source.read_text()).body
                      if isinstance(node,ast.FunctionDef) and node.name=='configure_factory')
        store=object()
        class Configuration:
            def __setattr__(self,name,value):
                if name=='websiteDataStore' and callable(value):
                    raise TypeError('A method is not a website data store')
                super().__setattr__(name,value)
        class Base:
            def add_constraints(self):pass
        factory=types.SimpleNamespace()
        module=types.ModuleType('toga_iOS.widgets.webview')
        module.WebView=Base
        view=types.SimpleNamespace()
        module.TogaWebView=types.SimpleNamespace(alloc=lambda:types.SimpleNamespace(initWithFrame=lambda *a,**k:view))
        persistent=types.SimpleNamespace(defaultDataStore=Mock(return_value=store))
        configs=[]
        def objc_class(name):
            if name=='WKWebsiteDataStore':return persistent
            config=Configuration();configs.append(config)
            return types.SimpleNamespace(alloc=lambda:types.SimpleNamespace(init=lambda:config))
        namespace={'ObjCClass':objc_class}
        modules={'toga_iOS':types.SimpleNamespace(factory=factory),'toga_iOS.widgets.webview':module}
        with patch.dict(sys.modules,modules):
            exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
            for bound in (False,True):
                namespace['configure_factory'](app_bound=bound)
                instance=factory.WebView();instance.interface=object();instance.create()
                self.assertIs(configs[-1].websiteDataStore,store)
                self.assertEqual(getattr(configs[-1],'limitsNavigationsToAppBoundDomains',False),bound)
        self.assertEqual(persistent.defaultDataStore.call_count,2)

    def test_system_webkit_connects_without_a_python_network_precheck(self):
        toga=types.ModuleType('toga')
        toga.App=object
        class WebView:
            def __init__(self,**kwargs):
                self._impl=types.SimpleNamespace(native=types.SimpleNamespace(scrollView=types.SimpleNamespace(),
                    configuration=types.SimpleNamespace(userContentController=Mock())))
        toga.WebView=WebView
        style=types.ModuleType('toga.style');style.Pack=lambda **kwargs:kwargs
        native=types.ModuleType('mineradio.native')
        native.configure_factory=Mock()
        native.configure_audio=Mock(return_value=True)
        package=types.ModuleType('mineradio');package.__path__=[]
        package.native=native
        rubicon=types.ModuleType('rubicon.objc')
        rubicon.ObjCClass=lambda name: types.SimpleNamespace(blackColor='black',alloc=lambda:types.SimpleNamespace(initWithSource=Mock()))
        modules={'toga':toga,'toga.style':style,'mineradio':package,'mineradio.native':native,'rubicon.objc':rubicon}
        entry=Path(__file__).resolve().parents[1]/'src/mineradio/remote_app.py'
        with patch.dict(sys.modules,modules),patch('urllib.request.urlopen',side_effect=AssertionError('The system WebKit owns HTTPS')):
            spec=importlib.util.spec_from_file_location('mineradio.remote_app',entry)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            app=object.__new__(module.MineradioRemote)
            app.main_window=types.SimpleNamespace(content=None)
            with patch.object(module,'navigation_delegate',return_value=object()):
                app.connect()
        self.assertEqual(app.web.url,'https://music.hbsuzh.cn/?app=ipad')
        self.assertIs(app.main_window.content,app.web)
        native.configure_factory.assert_called_once()
        native.configure_factory.assert_called_with(app_bound=True)


if __name__=='__main__':unittest.main()
