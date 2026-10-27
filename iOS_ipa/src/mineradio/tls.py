"""Private, verified HTTPS trust for the embedded Python runtime on iOS.

WebKit uses Apple's trust store; Python's OpenSSL needs a portable CA bundle.
This only selects the App's bundled Mozilla roots, never an unverified context
or a change to iPadOS certificate/security settings.
"""
import hashlib
import os
from pathlib import Path
import ssl
import urllib.error
import urllib.request

_installed = None
PUBLIC_PROBES = {
    'netease': 'https://music.163.com/',
    'qq': 'https://u.y.qq.com/',
    'kugou': 'https://gateway.kugou.com/',
    'qishui': 'https://api.qishui.com/passport/account/info/v2/?aid=386088&account_sdk_source=web&language=zh',
}


def install():
    global _installed
    if _installed is not None:
        return dict(_installed)
    import certifi
    try:
        previous = ssl.create_default_context().cert_store_stats()['x509_ca']
    except (OSError, ssl.SSLError):
        previous = None
    path = Path(certifi.where()).resolve(strict=True)
    context = ssl.create_default_context(cafile=str(path))
    count = context.cert_store_stats()['x509_ca']
    if count < 100 or not context.check_hostname or context.verify_mode != ssl.CERT_REQUIRED:
        raise RuntimeError('设备内安全连接的证书配置不完整')
    os.environ['SSL_CERT_FILE'] = str(path)
    os.environ['REQUESTS_CA_BUNDLE'] = str(path)
    # urllib's default HTTPSHandler constructs a verified context per request.
    # The environment is set before provider imports/opener initialization.
    active = ssl.create_default_context()
    if active.cert_store_stats()['x509_ca'] < 100 or not active.check_hostname or active.verify_mode != ssl.CERT_REQUIRED:
        raise RuntimeError('设备内安全连接尚未就绪')
    _installed = dict(ready=True, caCount=count, previousDefaultCACount=previous,
                      hostnameVerified=True, verificationRequired=True,
                      bundleSHA256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      version=certifi.__version__)
    return dict(_installed)


def diagnostic():
    """Anonymous HTTPS only. HTTP rejection still proves the TLS handshake."""
    result = dict(configuration=install(), accountAuthorized=False, requests={})
    for provider, url in PUBLIC_PROBES.items():
        request = urllib.request.Request(url, headers={'User-Agent': 'Mineradio-iOS/0.1.3',
                                                       'Accept': 'application/json,text/html'})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                response.read(1024)
                result['requests'][provider] = dict(tlsVerified=True, httpStatus=response.status)
        except urllib.error.HTTPError as error:
            result['requests'][provider] = dict(tlsVerified=True, httpStatus=error.code)
        except Exception as error:
            reason = getattr(error, 'reason', error)
            result['requests'][provider] = dict(tlsVerified=False, error=type(reason).__name__)
    result['ready'] = all(value['tlsVerified'] for value in result['requests'].values())
    return result
