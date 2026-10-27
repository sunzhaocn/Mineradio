# Qishui phone login: official evidence and local verification bridge

Checked 2026-10-26. This is a static compatibility investigation of the installed
Soda Music 3.7.0 artifacts plus an anonymous read of official verification
configuration. No account, SMS, voice code, login submission, captcha solving,
or official application execution was used.

## Artifact identity and coverage

Installed resources directory:
`C:\Users\Administrator\AppData\Local\Programs\Soda Music\3.7.0\resources`.

| Artifact | SHA-256 |
| --- | --- |
| `main.asar` | `be11aad5d4230695ee7f297a403e49685879a287c47a16dc8577936780f67eec` |
| `app.asar` | `af3f3763148db43df750f721daeaa2e6927da6d7f220e06fb82d249cd9817aed` |
| `main.asar/assets/renderer-Cpp7FaSO.js` | `a47760303769422008ae9a74d4cadbccf0e8c4587affc7c2e39ce6e07f3eec4e` |
| `main.asar/assets/renderer-Cpp7FaSO.js.map` | `9dbc37e7e5c4a97ebbb09f9c2d61d99ccb20aeaa480d2716ebb84acdb8e158dc` |

REA retained application evidence:

- `main.asar`: `ev_dbb957ad45b077caca835d0ee621814f6233b4e75a5b290b3595f2e528b892d6`.
- `app.asar`: `ev_424e4855998a25a517443fd75f072a2326fc7a8ec59abc41d96b0a9c851d1a8c`.

REA's semantic graph was partial because large source analyses exhausted their
worker/result budgets. Focused reads below use the exact retained archive's
source maps, read as JSON without evaluating application code. Some unpacked
native `.node` files contradicted their ASAR integrity declarations; those
bytes were marked untrusted and were not executed. No native implementation
was imported or copied.

All source indexes below are zero-based `sources`/`sourcesContent` indexes;
line numbers refer to the original source content embedded in that map.

## The actual music client enables ordinary SMS login

In `renderer-Cpp7FaSO.js.map`, source 361 is
`src/services/renderer/renderer.ts`. Lines 148-158 initialize
`@byted/douyin-login-new@1.6.10` with `next=https://api.qishui.com` and enabled
methods `LOGIN_SCAN_CODE`, `LOGIN_MOBILE_CODE`. Lines 277-279 enable
`loginOnly.LOGIN_MOBILE_CODE=true`. The built JavaScript confirms literal
`aid:386088` in this same initializer.

Source 359, `src/renderer/constants/login.ts`, configures the music client with
host `https://api.qishui.com`, `scope=web`, `region=cn`, `ztsdk=false`,
`hcSwitch=false`, and the same per-device `did/iid/device_id/install_id` with
`device_platform=PC`, `version_code=3.7.0`.

The official app's enabled methods do not include password login. Its generic
SDK also contains a password endpoint, but inclusion in a shared SDK does not
establish music-service availability. The local UI therefore uses SMS only.

## Exact SMS protocol

Source 352 is `@byted/douyin-login-new/es/api/index.js`.

| Operation | Original source lines | Official request |
| --- | --- | --- |
| Send SMS | 179-188 | POST `/passport/web/send_code/`; `is6Digits=1`; encoded `mobile`; encoded `type=24` |
| Submit SMS | 199-208 | POST `/passport/web/sms_login/`; `service=https://api.qishui.com`; encoded `mobile/code`; `login_only=true` |

`is6Digits` appears in the send request, not the official SMS login request.
The optional `safe_mobile_register_to_login` is controlled by the SDK's
multi-account option. Source 66, `hooks/use-mobile-code-login.js`, lines 38-40
forms the phone as `+<country> <national number>`, lines 118-123 limit the code
to six digits, and lines 211-216 pass the app's login-only setting.

The shared encoding is verified in source 26,
`@byted/uc-request-util/es/encrypt.js`, lines 41-51 and 57-82: each UTF-8 byte
is XORed with 5, then lowercase hexadecimal without zero padding; both
`mix_mode` and `fixed_mix_mode` are 1 when those fields are present.

## Real official captcha SDK, including a pinned download

Source 208 is `@byted/sec_sdk_build@4.0.12/captcha/index.esm.js`.
Lines 2372-2375 define the configuration endpoint, and lines 4011-4018 show
POST configuration reads with `X-Setting-Flag: 1` and common-option query
parameters. This anonymous read returned HTTP 200 on the checked date:

`POST https://vcs.zijieapi.com/vc/setting?repoId=579047&aid=386088&did=0&iid=0`

The response's `verify.js_v2.cn` points to:

`https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/1.0.0.427/index.js`

Official backups have the same path on `lf-rc2.yhgfb-cn-static.com` and
`lf-cdn-tos.bytescm.com`. The primary returned HTTP 200, 63,939 bytes, SHA-256
`34ab7e29bc9f638008074bf615570cb940815ca67e28ff2a29e22af24d721be2`.
It was obtained through ordinary `urllib.request.urlopen` with TLS verification
enabled. Its bytes were saved temporarily as
`C:\Users\Administrator\AppData\Local\Temp\qishui-verifycenter-1.0.0.427.js`.
Fallback downloads must match that same hash before bundling.

The SDK sets `window.verifySDK` and exports `initVerifyOptions`, `autoRender`,
`getCaptchaWebId`, `closeCaptcha`, and other official rendering APIs.
`verifySDK.getFp` is not an export. `getCaptchaWebId()` returns a Promise with
the fingerprint. The official facade also reads `s_v_web_id` from the same
first-party Cookie/localStorage context.

Source 212, `@byted-sdk/account-api/es/utils/slider.js`, lines 87-91 initializes
the SDK with `commonOptions={repoId:579047,aid,did,iid}`; captcha options use
`sideSlide=disabled`, `lang=zh`, `showMode=mask`, `region=cn`, and the app name.
Source 208 lines 4232-4235 add `h5_check_version=4.0.12`.

Source 212 lines 133-144 render parsed server decision data. On the official
success callback, the original request is repeated with query
`isResend=true,fp=<fingerprint>,verifyFp=<fingerprint>`. Lines 162-172 handle
secondary callbacks with `scene=4` and preserve `sms_code_key` when required.
The local implementation returns these values to its caller; it does not
automatically resend SMS or login requests.

The fixed runtime supports decision codes 10000, 20000, 30000, and 40000.
Its `autoRender` chooses the appropriate actual official captcha, secondary,
identity, or other verification UI. Success is determined by its callbacks,
not by a resolved return value from rendering.

## Challenge selection and session limits

First-request CSRF initialization was checked separately. The official panel
lists QR first; source 69 `hooks/use-scan-code-login.js`, lines 337-354 starts
`getQrCode()` on that initial tab. An anonymous GET to the official
`/passport/web/get_qrcode/` returned HTTP 200 and set both
`passport_csrf_token` and `passport_csrf_token_default`. By comparison, an
anonymous `/passport/account/info/v2/` GET returned HTTP 200 with error 13 and
no Set-Cookie headers, so it cannot supply the bootstrap cookies. No SMS or
account login was performed by these reads; cookie values were not retained
in this report.

The iPad SMS adapter therefore acquires the server-issued cookies with that
same anonymous request only after an explicit send/login action. It discards
the QR token, image and account fields, never displays a QR and never polls it.
Subsequent requests reuse the same isolated WebKit and CookieJar. The official
request interceptor selects `passport_csrf_token || passport_csrf_token_default`.
No local CSRF token is invented. On iOS, `request_host` is taken from the actual
WebKit page's origin, matching the official interceptor's dynamic source.

Source 41, `@byted/uc-request-sec/es/middleware/response/show-sec-sdk.js`, lines
5-18 checks `verify_center_decision_conf` and
`verify_center_secondary_decision_conf` under both `data` and the root. It does
not depend solely on errors 1105/2032/2046. With 2046 and `sms_code_key`, the
next request must carry that key. Source 342,
`@byted/account-api-pro/es/plugins/verification.js`, lines 96-116 separately
handles an official 2046 `url` using the secondary-verification component.

Passport success and authenticated music requests have separate requirements.
In `app.asar/main.js.map`, source 640 `src/app.ts`, lines 54-75 removes
Origin/Referer and invokes native `bdms.generateHttpSignatureHeaders` for
Qishui requests except `/passport/` and `/ttwid/`. Bdticket handling follows.
Source 389, `services/user/user.ts`, lines 73-100 fetches `GetMyInfo` after
login. This confirms that the Passport JavaScript wrapper alone cannot be
claimed to replace the native music-request signer. Actual SMS delivery,
account acceptance, and local iPad music authorization still require device
acceptance testing.

## Local bridge and verification

`iOS_ipa/assets/qishui-phone-security.js` exposes:

- `__qishuiPhoneVerify(decision, {generalParams: currentSessionQuery})`:
  Promise resolving to `{status:true,fp,verifyFp,sms_code_key?}` on official
  completion, or `{status:false}` on cancellation/failure. Existing 2046 URL
  verification delegates to `__qishuiSecondVerify`.
- `__qishuiCancelPhoneVerify()`: cancels the active Promise and prevents a late
  SDK load from opening UI after cancellation.

Inject it after the existing host wrapper and the verified SDK. An already
inlined `window.verifySDK` is preferred. `__qishuiVerifySDKSource='bundled'` may
mark that configuration; it is not evaluated as code. When no SDK is inlined,
only script elements for the three exact official pinned URLs are permitted.
No fetch/eval loader, SMS request, credential value, or automatic replay is
implemented in this helper.

`node iOS_ipa/checks/check_qishui_phone_security.cjs` passes synthetic callback
checks for real API shape, both decision fields, identity options,
fingerprint, close-after-success races, explicit cancellation, late SDK load,
reopening after cancellation, secondary delegation, and resource restrictions.
These checks use no network and are not a claim of successful real login.
