"""Optional Android facilities, imported without Java dependencies on desktop."""
import os


def is_android():
    return os.environ.get('MINERADIO_ANDROID') == '1'


def is_ios():
    return os.environ.get('MINERADIO_IOS') == '1'


def is_mobile():
    return is_android() or is_ios()


def sign_headers(url, headers):
    if is_ios():
        from mineradio.signer import sign_headers as sign_ios
        return sign_ios(url, headers)
    import json
    from java import jclass
    value = jclass('dev.mineradio.android.SdkClient').sign(url, json.dumps(headers))
    result = json.loads(str(value))
    if not result or not all(isinstance(k, str) and isinstance(v, str) for k, v in result.items()):
        raise ValueError('Native signer returned no headers')
    return result


def remux_audio(source, destination):
    if is_ios():
        from music_app.providers.qishui.media_ios import remux_audio as remux_ios
        return remux_ios(source, destination)
    from java import jclass
    return str(jclass('dev.mineradio.android.AudioRemuxer').remux(str(source), str(destination)))
