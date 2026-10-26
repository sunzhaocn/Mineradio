"""本机登录会话桥；授权凭据交给发起客户端保存，不读写服务端登录资料。"""
import re
import threading
import time

from music_app.auth import router as music_auth
from music_app.core import request_credentials
from . import auth_data as _web_auth_data
from . import auth_security as _web_auth_security


class LocalAuth:
    def __init__(self, root=None, site_root=None, auth=music_auth, changed=None):
        # root/site_root 仅兼容旧构造调用；登录桥不再访问这些目录。
        self.auth = auth
        self.lock = threading.RLock()
        self.owned = {}
        self.generations = {}

    def cookie(self, provider):
        return request_credentials.cookie(provider)

    def fingerprint(self, provider):
        return request_credentials.fingerprint(provider)

    def qishui_config(self):
        return request_credentials.session_config()

    def _summary(self, provider, cookie='', account=None):
        account = _web_auth_data.public_account(account, provider=provider)
        configured = bool(cookie)
        return dict(provider=provider, loggedIn=configured, configured=configured,
                    userId=account.get('id', ''), nickname=account.get('name', _web_auth_data.LABELS[provider]),
                    avatar=account.get('avatar', ''), avatarUrl=account.get('avatar', ''), account=account,
                    qqUin=account.get('qqUin', '') if provider == 'qq' else '',
                    searchReady=True, publicCatalog=True, membershipKnown=False, verified=False,
                    playbackKeyReady=configured, webSession=bool(provider == 'qishui' and configured),
                    storage='client')

    def status(self, provider=None):
        result = {p: self._summary(p, self.cookie(p)) for p in _web_auth_data.PROVIDERS}
        return result[provider] if provider else {'platforms': result}

    def _validate(self, operation, payload):
        if not isinstance(payload, dict):
            raise _web_auth_security._error()
        allowed = {'session': {'provider', 'method'}, 'sms': {'provider', 'key', 'phone', 'countrycode'},
                   'login': {'provider', 'key', 'phone', 'countrycode', 'password', 'captcha'},
                   'check': {'provider', 'key'}, 'logout': {'provider'}, 'show': {'provider', 'key'},
                   'verify': {'provider','key','input'}}[operation] | {'client_id'}
        if set(payload) - allowed or any(not isinstance(v, str) for v in payload.values()):
            raise _web_auth_security._error()
        provider = payload.get('provider')
        if provider not in _web_auth_data.PROVIDERS:
            raise _web_auth_security._error(400, 'login_provider_invalid', '请选择有效的音乐平台')
        if 'client_id' in payload and not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', payload['client_id']):
            raise _web_auth_security._error(400, 'login_client_invalid', '客户端登录标识无效，请重新打开登录页面')
        if operation in ('sms', 'login') and provider != 'netease':
            raise _web_auth_security._error()
        if operation in ('sms', 'login') and not payload.get('phone'):
            raise _web_auth_security._error(400, 'login_phone_required', '请输入手机号')
        if operation == 'login' and bool(payload.get('password')) == bool(payload.get('captcha')):
            raise _web_auth_security._error(400, 'login_method_invalid', '请选择密码或短信验证码中的一种登录方式')
        if operation == 'session':
            method = payload.get('method', '')
            from music_app.platform_runtime import is_ios
            official = is_ios() and method == 'official' and provider in ('netease','qq','kugou','qishui')
            if not official and (provider == 'qq' and method not in ('', 'qq', 'wechat', 'mobile') or
                    provider == 'netease' and method not in ('', 'phone', 'password', 'sms') or
                    provider not in ('qq', 'netease') and method):
                raise _web_auth_security._error()
        if operation in ('check', 'sms', 'login', 'show', 'verify') and not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', payload.get('key', '')):
            raise _web_auth_security._error(400, 'login_key_invalid', '登录会话无效，请重新开始')
        if operation == 'verify' and provider != 'qishui':raise _web_auth_security._error()
        if any(len(v) > (4096 if k == 'input' else 1024 if k == 'password' else 256) for k, v in payload.items()):
            raise _web_auth_security._error()
        return provider, payload.get('client_id', 'default')

    def _require_owned(self, provider, key, client_id):
        item = self.owned.get(key)
        if (not item or item['provider'] != provider or item['client_id'] != client_id or
                time.monotonic() > item['until'] or
                item['generation'] != self.generations.get((client_id, provider))):
            raise _web_auth_security._error(404, 'login_session_missing', '本次登录会话不存在或已结束，请重新开始')
        return item

    def _credentials(self, provider, result):
        cookie = result.get('cookie')
        if not _web_auth_data._valid_cookie(provider, cookie):
            raise _web_auth_security._error(502, 'login_credentials_incomplete', '平台未返回完整登录凭据，请重新登录')
        value = {'cookie': cookie}
        if provider == 'qishui':
            config = result.get('session_config')
            if (not isinstance(config, dict) or not isinstance(config.get('query'), dict) or
                    not isinstance(config.get('headers'), dict) or not config['query'].get('device_id') or
                    config['headers'].get('cookie') != cookie):
                raise _web_auth_security._error(502, 'login_credentials_incomplete', '平台未返回完整登录凭据，请重新登录')
            try:
                value = request_credentials.normalize({'qishui': {'cookie': cookie, 'session_config': config}})['qishui']
            except (ValueError, TypeError, KeyError):
                raise _web_auth_security._error(502, 'login_credentials_incomplete', '平台未返回完整登录凭据，请重新登录') from None
        return value

    def _public(self, provider, result, *, creation=False):
        allowed = ('status', 'authorized', 'message', 'shown', 'expires_in', 'expires_at', 'poll_interval', 'method',
                   'retry_after', 'sms_sent', 'upstream_code', 'verification_required', 'verification_type', 'manual_login', 'remote_verification')
        value = {name: result[name] for name in allowed if name in result}
        value['provider'] = provider
        if result.get('status') == 'authorized':
            credentials = self._credentials(provider, result)
            value.update(self._summary(provider, credentials['cookie'], result.get('account')),
                         **credentials, authorized=True, saved=False, verified=True)
        else:
            if 'key' in result:
                value['key'] = result['key']
            if creation:
                for name in ('qr_image', 'qr_url'):
                    if isinstance(result.get(name), str):
                        value[name] = result[name]
            if result.get('interactive_window'):
                value['interactive_window'] = True
        # 仅授权完成返回当前会话的 Cookie/汽水参数；不透传原始 credentials 或诊断。
        return value

    def handle(self, operation, payload):
        if operation not in ('session', 'sms', 'login', 'check', 'logout', 'show', 'verify'):
            raise _web_auth_security._error(404, 'login_route_missing', '登录接口不存在')
        provider, client_id = self._validate(operation, payload)
        scope = (client_id, provider)
        try:
            if operation == 'session':
                with self.lock:
                    generation = self.generations[scope] = self.generations.get(scope, 0) + 1
                result = (self.auth.create_phone() if provider == 'netease' and payload.get('method') != 'official' else
                          self.auth.create(_web_auth_data.PROVIDERS[provider], method=payload.get('method', '')))
                with self.lock:
                    if generation != self.generations.get(scope):
                        raise _web_auth_security._error(409, 'login_session_replaced', '已开始新的登录，请使用最新登录页面')
                    now = time.monotonic()
                    self.owned = {k: v for k, v in self.owned.items() if v['until'] > now}
                    self.owned[result['key']] = {'provider': provider, 'client_id': client_id, 'until': now + 1200,
                                                'delivered': False, 'generation': generation}
                return self._public(provider, result, creation=True)
            if operation == 'logout':
                with self.lock:
                    self.generations[scope] = self.generations.get(scope, 0) + 1
                    self.owned = {k: v for k, v in self.owned.items()
                                  if (v['client_id'], v['provider']) != scope}
                    return dict(self._summary(provider), status='logged_out', authorized=False, saved=False,
                                message='请清除当前客户端保存的该平台登录资料')
            key = payload['key']
            with self.lock:
                self._require_owned(provider, key, client_id)
            if operation == 'verify':
                return self.auth.verify(_web_auth_data.PROVIDERS[provider],key,payload.get('input',''))
            if operation == 'show':
                result = self.auth.show(_web_auth_data.PROVIDERS[provider], key)
            elif operation == 'check':
                result = self.auth.check(_web_auth_data.PROVIDERS[provider], key)
            else:
                fields = {k: v for k, v in payload.items() if k not in ('provider', 'key', 'client_id')}
                result = self.auth.phone_action('send_sms' if operation == 'sms' else 'login_phone', key, **fields)
            with self.lock:
                owned = self._require_owned(provider, key, client_id)
                response = self._public(provider, result)
                if result.get('status') == 'authorized' and not owned['delivered']:
                    owned['delivered'] = True
                return response
        except music_auth.AuthError as exc:
            raise _web_auth_security._error(exc.status, exc.code, str(exc)) from None
        except _web_auth_security.LocalAuthError:
            raise
        except (OSError, UnicodeError, ValueError, TypeError, KeyError):
            raise _web_auth_security._error(500, 'login_transfer_failed', '登录资料传送失败，请稍后重试') from None


AUTH = LocalAuth()
