"""Use pure Python protocol crypto on iOS; keep the existing desktop backend."""
from music_app.platform_runtime import is_ios

if is_ios():
    from music_app.ios_crypto import AES, RSA, PKCS1_v1_5
else:
    from Crypto.Cipher import AES, PKCS1_v1_5
    from Crypto.PublicKey import RSA
