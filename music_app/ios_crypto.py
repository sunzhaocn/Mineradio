"""Compatibility for existing AES-CBC/CTR and public RSA protocols.

Only public-key encryption is supported. No private-key implementation, native
extension, executable download, or subprocess is required on an iOS device.
"""
import pyaes
import rsa
import sys
import os


class _CommonCryptoCTR:
    """Apple's stream cipher API; a software fallback remains available off iOS."""
    def __init__(self, key, initial_block):
        import ctypes as ct
        self._ct = ct
        self._ref = ct.c_void_p()
        last = None
        for library in ('/usr/lib/system/libcommonCrypto.dylib', '/usr/lib/libSystem.B.dylib', None):
            try:
                lib = ct.CDLL(library)
                create = lib.CCCryptorCreateWithMode
                break
            except (OSError, AttributeError) as error:
                last = error
        else:
            raise OSError('CommonCrypto is unavailable') from last
        self._lib = lib
        create.argtypes = [ct.c_uint32, ct.c_uint32, ct.c_uint32, ct.c_uint32,
                           ct.c_void_p, ct.c_void_p, ct.c_size_t, ct.c_void_p,
                           ct.c_size_t, ct.c_int, ct.c_uint32, ct.POINTER(ct.c_void_p)]
        create.restype = ct.c_int
        self._update = lib.CCCryptorUpdate
        self._update.argtypes = [ct.c_void_p, ct.c_void_p, ct.c_size_t, ct.c_void_p,
                                ct.c_size_t, ct.POINTER(ct.c_size_t)]
        self._update.restype = ct.c_int
        self._release = lib.CCCryptorRelease
        self._release.argtypes, self._release.restype = [ct.c_void_p], ct.c_int
        # kCCEncrypt=0, kCCModeCTR=4, kCCAlgorithmAES=0, ccNoPadding=0,
        # kCCModeOptionCTR_BE=2; values are from Apple's CommonCryptor.h.
        status = create(0, 4, 0, 0, ct.c_char_p(initial_block), ct.c_char_p(key),
                        len(key), None, 0, 0, 2, ct.byref(self._ref))
        if status != 0 or not self._ref:
            raise ValueError('CommonCrypto CTR initialization failed')

    def transform(self, data):
        if not data:
            return b''
        ct = self._ct
        output, written = ct.create_string_buffer(len(data) + 16), ct.c_size_t()
        status = self._update(self._ref, ct.c_char_p(data), len(data), output,
                              len(output), ct.byref(written))
        if status != 0 or written.value != len(data):
            raise ValueError('CommonCrypto CTR operation failed')
        return output.raw[:written.value]

    def __del__(self):
        if getattr(self, '_ref', None):
            self._release(self._ref)
            self._ref = None


class _CTR:
    def __init__(self, key, nonce, initial_value):
        if not isinstance(nonce, bytes) or len(nonce) >= 16:
            raise ValueError('CTR nonce must contain fewer than sixteen bytes')
        width = 16-len(nonce)
        if isinstance(initial_value, bytes):
            if len(initial_value) != width:
                raise ValueError('CTR initial counter length is invalid')
            initial_value = int.from_bytes(initial_value, 'big')
        if type(initial_value) is not int or not 0 <= initial_value < (1 << (8*width)):
            raise ValueError('CTR initial counter is out of range')
        self._native = None
        block = nonce + initial_value.to_bytes(width, 'big')
        if not nonce and sys.platform == 'ios' and os.environ.get('MINERADIO_PURE_PYTHON_CRYPTO') != '1':
            try:
                self._native = _CommonCryptoCTR(key, block)
            except (OSError, AttributeError, ValueError):
                pass
        self._cipher = pyaes.AES(key)
        self._nonce, self._counter, self._width = nonce, initial_value, width
        self._limit, self._blocks, self._tail = 1 << (width*8), 0, b''
        self._bytes = 0
        self.direction = None

    def _run(self, data, direction):
        if self.direction and self.direction != direction:
            raise ValueError('Cannot reuse AES cipher in the other direction')
        self.direction = direction
        if not isinstance(data, bytes):
            data = bytes(data)
        if self._native is not None:
            if self._bytes + len(data) > self._limit*16:
                raise OverflowError('CTR counter has wrapped around')
            self._bytes += len(data)
            return self._native.transform(data)
        output = bytearray(len(data))
        offset = 0
        while offset < len(data):
            if not self._tail:
                if self._blocks >= self._limit:
                    raise OverflowError('CTR counter has wrapped around')
                block = self._nonce + self._counter.to_bytes(self._width, 'big')
                self._tail = bytes(self._cipher.encrypt(list(block)))
                self._counter = (self._counter + 1) % self._limit
                self._blocks += 1
            count = min(len(data)-offset, len(self._tail))
            output[offset:offset+count] = bytes(a ^ b for a, b in zip(data[offset:offset+count], self._tail[:count]))
            self._tail = self._tail[count:]
            offset += count
        return bytes(output)

    def encrypt(self, data):
        return self._run(data, 'encrypt')

    def decrypt(self, data):
        return self._run(data, 'decrypt')


class _AES:
    def __init__(self, key, mode, iv=None):
        if len(key) not in (16, 24, 32):
            raise ValueError('Invalid AES key length')
        if mode == 2:
            if iv is None or len(iv) != 16:
                raise ValueError('CBC requires a 16-byte IV')
            self.cipher = pyaes.AESModeOfOperationCBC(key, iv=iv)
        elif mode == 1:
            self.cipher = pyaes.AESModeOfOperationECB(key)
        else:
            raise ValueError('Unsupported AES mode')
        self.direction = None

    def _run(self, data, direction):
        if len(data) % 16:
            raise ValueError('AES input must be block aligned')
        if self.direction and self.direction != direction:
            raise ValueError('Cannot reuse AES cipher in the other direction')
        self.direction = direction
        transform = getattr(self.cipher, direction)
        return b''.join(transform(data[i:i+16]) for i in range(0, len(data), 16))

    def encrypt(self, data):
        return self._run(data, 'encrypt')

    def decrypt(self, data):
        return self._run(data, 'decrypt')


class AES:
    MODE_ECB, MODE_CBC, MODE_CTR = 1, 2, 6
    block_size = 16

    @staticmethod
    def new(key, mode, iv=None, *, nonce=b'', initial_value=0):
        if len(key) not in (16, 24, 32):
            raise ValueError('Invalid AES key length')
        if mode == AES.MODE_CTR:
            if iv is not None:
                raise ValueError('CTR uses nonce and initial_value, not IV')
            return _CTR(key, nonce, initial_value)
        return _AES(key, mode, iv)


class RSA:
    @staticmethod
    def import_key(value):
        if isinstance(value, str):
            value = value.encode('ascii')
        if b'BEGIN PUBLIC KEY' in value:
            return rsa.PublicKey.load_pkcs1_openssl_pem(value)
        return rsa.PublicKey.load_pkcs1(value)

    importKey = import_key


class PKCS1_v1_5:
    class _Cipher:
        def __init__(self, key):
            self.key = key

        def encrypt(self, data):
            return rsa.encrypt(data, self.key)

    new = _Cipher
