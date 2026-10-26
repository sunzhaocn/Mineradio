"""Explicit-config facade for the separately linked first-party iOS signer.

Installing configuration never initializes MetaSec. Call enable only from the
user-authorized provider flow after validating the SDK/license combination.
"""
from urllib.parse import urlsplit


class SignerError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__('汽水 iOS 签名组件暂不可用（' + code + '）')


def _native():
    from rubicon.objc import ObjCClass
    try:
        return ObjCClass('MineradioQishuiSigner')
    except NameError:
        raise SignerError('signer_library_missing') from None


def _result(value):
    from rubicon.objc import py_from_ns
    result = py_from_ns(value)
    if not isinstance(result, dict):
        raise SignerError('signer_response_invalid')
    if not result.get('ok'):
        raise SignerError(str(result.get('error') or 'signer_unavailable'))
    return result


def install(config):
    """Save explicit app SDK settings in memory; do not read a desktop file."""
    if not isinstance(config, dict) or not all(isinstance(config.get(k), str) and config[k]
                                            for k in ('appId', 'license')):
        raise SignerError('signer_configuration_invalid')
    from rubicon.objc import ns_from_py
    return _result(_native().configure(ns_from_py(config)))


def enable():
    """Initialize once, respecting the native privacyAgreed/device-ID gate."""
    return _result(_native().enable())


def status():
    try:
        from rubicon.objc import py_from_ns
        value = py_from_ns(_native().status())
        if not isinstance(value, dict):
            raise SignerError('signer_response_invalid')
        return value
    except (SignerError, ImportError) as error:
        return dict(ok=False, libraryAvailable=False, initialized=False,
                    httpCallbackInstalled=False, error=getattr(error, 'code', 'signer_library_missing'))


def sign_headers(url, headers):
    target = urlsplit(url)
    if (target.scheme != 'https' or target.hostname != 'api.qishui.com'
            or not target.path.startswith('/luna/') or target.username or target.password
            or target.port not in (None, 443)):
        raise SignerError('signer_origin_rejected')
    if not isinstance(headers, dict) or not all(isinstance(k, str) and isinstance(v, str)
                                              and not any(c in k+v for c in '\r\n')
                                              for k, v in headers.items()):
        raise SignerError('signer_headers_invalid')
    from rubicon.objc import ns_from_py
    result = _result(_native().signURL(url, headers=ns_from_py(headers)))
    value = result.get('headers')
    if not isinstance(value, dict) or not value:
        raise SignerError('signer_headers_unavailable')
    return value


def diagnostic(config):
    """Run only when the cloud process explicitly enables the native probe."""
    from rubicon.objc import ns_from_py, py_from_ns
    result = py_from_ns(_native().diagnostic(ns_from_py(config)))
    if not isinstance(result, dict):
        raise SignerError('signer_response_invalid')
    # Native diagnostic returns header lengths only, never signature values.
    return result
