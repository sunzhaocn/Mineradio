# Qishui local iPad playback: authorization and official public H5 evidence

Checked 2026-10-26. The initial read-only audit was followed by an authorized,
isolated public-web module and its tests. No user account, SMS request,
cookie export, official-client execution, or borrowed license was used.
Anonymous requests used ordinary verified TLS. This report describes a
limited public playback route and a separate unresolved authorized music API
integration; it does not establish working full-catalog search on iPad.

## What is established

- The installed native security library and phone login are separate from
  permission to call Qishui's signed music APIs. Successful phone login does
  not supply a MetaSec business license or prove music API acceptance.
- The official song H5 page really calls a public song-detail endpoint that
  returns both public audio and restricted previews. It can run directly on
  iPad without an application-operated server.
- That response includes a small official chart/artist recommendation list.
  Filtering that list locally would be a limited catalog filter, not Qishui
  keyword search or a complete chart service.
- No functional unsigned keyword-search API was established. An anonymous
  request to the project's existing PC search route returned HTTP 200 with
  zero response bytes. A guessed H5 search endpoint is not an implementation.

## Official public H5 route and response shape

Official entry page:
[Qishui song page](https://www.douyin.com/qishui/song/7634441185327745025).
Its first-party script
[6613.8cbf5b11.js](https://lf-luna.qishui.com/obj/music-luna-fe/ies/luna-share-h5-edenx/static/js/6613.8cbf5b11.js)
contains the actual `GetSeoTracks` call, not a guessed route:

`GET https://beta-luna.douyin.com/luna/h5/seo_track?track_id=<decimal string>&device_platform=web`

The official generated method specifies `track_id`; the anonymous verification
also supplied `device_platform=web`. It needed no account Cookie or native
X-Helios/X-Medusa. This is observed behavior, not a published API stability
promise or a grant of application-distribution rights.

Observed JSON shape, with text content and transient media URLs omitted:

```text
status_info: { log_id, now, now_ts_ms }
lyric: { content, type, ... }
seo_track:
  track:
    id: decimal string
    name, artists[], album
    duration: milliseconds
    label_info: { only_vip_playable?, only_vip_download?, quality_map?, ... }
    preview?: { start?: milliseconds, duration?: milliseconds, vid?, ... }
    audition_info?: { start_time_ms?, duration_ms?, vid?, ... }
    state, playable_range, limited_free_info, ...
  seo_url: { pc_url: { urls[] }, m_url: { urls[] } }
  genre_tag, create_time, update_time, ...
track_player:
  expire_at: Unix seconds
  media_id
  url_player_info: string
  video_model_type: number
  video_model: JSON string
    { status, version, media_type: "audio", video_duration: seconds,
      url_expire: Unix seconds, enable_ssl: boolean,
      video_list: [
        { main_url: HTTPS string, backup_url: HTTPS string,
          video_meta: { quality, vtype: "m4a", codec_type: "aac",
                        bitrate, size, audio_sample_rate, ... },
          gear_des_key: string }
      ], ... }
comments: { comments[], count }
artist_tracks: [ { track, already_upload, ... } ]
chart_tracks:  [ { track, already_upload, ... } ]
```

The response had 10 artist entries and 15 chart entries. The official frontend
maps these to `artistTracks` and `chartTracks`. No cursor, keyword-search call,
chart identifier, chart name, or complete-chart pagination was established
from this route. Related/album lists are optional in the frontend and were
absent in this sample. Resolve each selected track afresh; directory rows alone
are not evidence that a track is playable.

The official share-playlist page also returns server-rendered loader data at
`window._ROUTER_DATA.loaderData.playlist_page`, containing `medias`,
`playlistInfo`, and `audioWithLyricsOptionList`. The inspected public playlist
had 199 mixed media rows and zero audio options. It is not evidence of an
anonymous full music search API. The top-level
[official website](https://www.qishui.com/) is a download landing page in the
observed response, not a web search player.

### Media and access checks actually performed

| Track ID | Metadata duration | Returned media duration | Observed access metadata |
| --- | ---: | ---: | --- |
| `7634441185327745025` | 243.133 s | 30.001 s | `only_vip_playable=true`; preview 30.047 s |
| `7695376967742769187` | 229.077 s | 229.078 s | `only_vip_playable` absent; no audition duration |
| `7646998266635094067` | 211.114 s | 211.115 s | `only_vip_playable` absent; separate 30.001 s preview metadata |

These were three anonymous detail reads. The latter two establish that the
public response can return a full-duration media model; they do not establish
account membership, download permission, or availability for every song.
The official frontend treats `only_vip_playable === true` as preview-only and
otherwise maps playback level to free. Its preview branch uses `preview`
first, falling back to `audition_info`; a separate preview object alone is not
proof that the selected media model is clipped. Preserve explicit rights,
regional restrictions, errors, and the duration of the actual returned stream.

For the 30-second sample only, an ordinary bounded Range request to its
returned medium-quality `main_url` verified the container:

- HTTP 206, `Content-Type: audio/mp4`, 247,207 total bytes;
- boxes `ftyp`, `moov`, `free`, `mdat`; one clear `mp4a` sample entry;
- no `sinf`, `tenc`, or `senc` box names; existing
  `music_app.providers.qishui.media_ios.inspect_clear_mp4` passed;
- 1,294 AAC samples; no media byte was saved to the repository.

The three models had three AAC/M4A qualities. The preview metadata reports
about 66, 130, and 258 kbit/s. URLs were plain HTTPS strings, not base64, on
`v11-luna.douyinvod.com` with `v5-ex-luna.douyinvod.com` backup. Their paths have
no useful filename suffix. Both `track_player.play_auth` and model `spade_a`
were absent. `gear_des_key` is an observed descriptive field, not evidence that
AES decryption is needed. The official frontend sets `encrypt=false` on this
route. Therefore the verified preview can go through the clear AAC/iOS path,
without the project's signed-media `play_auth`/CENC flow. Native AVFoundation
playback/export on a real iPad was not exercised by this audit.

Do not publish complete signed CDN URLs or persist them as durable library
entries. Respect the earlier valid expiry from the player/model, refresh once
after expiry, validate HTTPS and expected official CDN host suffixes, and use
bounded response/media sizes and timeouts. Treat non-success HTTP, zero-byte
bodies, missing models, unknown encryption, explicit restrictions, or missing
audio options as failures. Do not claim membership access or substitute a full
stream when the official response provides only a preview. No alteration of
track IDs, rights flags, signing headers, or license checks is required for the
observed public route.

## MetaSec iOS 4.3.9: actual authorization requirements

The [official podspec](https://raw.githubusercontent.com/volcengine/volcengine-specs/master/VolMetaSecML/4.3.9/VolMetaSecML.podspec)
identifies VolMetaSecML 4.3.9 as an iOS security SDK and points to the official
[SDK archive](https://sf3-ttcdn-tos.pstatp.com/obj/volcengine/VolMetaSecML/4.3.9/VolMetaSecML.zip).
The local provenance hashes match the intended archive/library provenance:

- archive SHA-256: `06fe7eeaef17a76f61c6480299f22a9fa651770992ffda49ee970efaa513c1d5`;
- library SHA-256: `ccd447a70b69b593041efda9ccc675f8c60cc81dee61065a04977020231510d8`.

The shipped `MSConfig.h` gives these exact official workflow links:

- [Integration instructions](https://bytedance.feishu.cn/docs/doccnF0ltvaddAOoRSsFmH8ztBe).
- [License application instructions](https://bytedance.feishu.cn/docs/doccny0YGd9wpqwRCvKdXSFJuag).
- [New appId secondary authorization/oncall](https://bytedance.feishu.cn/docs/doccnDH6or8BeKzL5hRw1jxHa9d).

The Feishu documents were not publicly readable during this check. A verified
public self-service MetaSec account/console signup path was not established.
These are not Volcengine VOD/player licenses; unrelated VOD license instructions
must not be presented as proof of Qishui API authorization.

| Field or requirement | Shipped header contract and implementation implication |
| --- | --- |
| `appId` | Business app identifier issued/accepted for this integration; new appIds require secondary authorization. It is not automatically the official music client's URL `aid`. |
| `license` | MetaSec license string for the approved application/SDK setup. Linking the downloadable library does not supply it. |
| `clientType` | Required. External business apps use enum 1; ByteDance-developed apps use 0. Do not impersonate an internal app. |
| `channel` | Required installation channel. Obtain the approved value; the wrapper currently defaults to `App Store`, which does not describe iLoader sideloading by itself. |
| `collectMode` | Explicit collection mode. Current local integration chooses domestic minimize mode 290; do not silently raise collection. |
| `deviceId` | Required runtime DID. Calling its setter also confirms privacy consent and may trigger delayed collection; do not call it before consent. |
| `bdDeviceId` | Explicitly required for external/ToB apps by the header. The method of obtaining a valid value must come from the approved integration, not a fabricated or copied official-client identifier. |
| `installId` | Required runtime IID when available; a new install may omit it initially and update through the manager later. |
| `sessionId` | TTAccount session identifier, not UID. Optional before login; the manager must receive updates after login/logout changes it. Keep this per-account value local and out of the distributable config. |
| Bundle ID | No Bundle ID setter or binding contract appears in these public headers. Supply the actual installed bundle identifier if the issuer requests it, and obtain explicit binding requirements. Do not infer them from other SDKs. |

The source bundle ID is `dev.mineradio.mineradio`; sideloading can affect the
installed identity, so the identity actually signed onto the iPad is the one
to verify with an issuer. A generic valid MetaSec license still does not prove
that Qishui permits the resulting appId to access `/luna/search/track`,
`/luna/pc/search/track`, track player APIs, or account music libraries. Ask the
platform for both the application-specific security configuration and the
authorized music API scope. Do not extract an official app's license, hardcode
its internal client type, or use a signing relay as a replacement.

At the start of this audit, `iOS_ipa/qishui_config.py` retained only `appId`,
`license`, optional `clientType`/`channel`, and privacy-safe defaults. The native
wrapper could accept `installId` and `bdDeviceId`, but startup activation
supplied neither; there was no post-login manager `setSessionID` update.
Those are implementation gaps after legitimate configuration is supplied.
License values and account identifiers are intentionally absent from this
report. A future import should distinguish non-personal issuer configuration
from runtime device/session data and user consent.

## Account health is a different issue

The original health request in `providers/qishui/session_status.py` already
uses Passport directly, not the native music signer. A failure must not be
attributed to missing music SDK authorization without examining its error.
TLS trust, transport failure, incomplete common device query, risk challenges,
and genuine expiry need distinct outcomes. Do not label a network failure as
an expired account or label a saved cookie as verified login.

The installed official Soda Music 3.7.0 source maps provide narrower evidence:

- `app.asar/main.js.map`, source 640 `src/app.ts`, lines 57-75 explicitly
  excludes `/passport/` from native `generateHttpSignatureHeaders`.
- The same function still has a general bdticket hook at lines 84-94. This is
  not evidence that every plain Passport GET must succeed or that all risk
  protection is absent.
- `main.asar/assets/renderer-Cpp7FaSO.js.map`, source 352
  `@byted/douyin-login-new/es/api/index.js`, lines 409-413 calls GET
  `/passport/account/info/v2/` through the common account request path.
- Source 359 `src/renderer/constants/login.ts`, lines 17-24 supplies
  `device_id/install_id/did/iid`, PC platform and app version in common query;
  line 25 disables ztsdk for this app's setup.

This supports repairing verified TLS and using the session's same device
query before escalating to a browser security-context probe. It does not prove
a compulsory WKWebView signature. The profile loader's former fallback from
failed Passport to signed music `/luna/pc/me` can mask the actual Passport
failure with a missing-signer error; avoid that fallback on iOS. Any browser
probe should be separate from an active SMS/captcha session and cancel safely.

## Evidence identity and limitations

Downloaded H5 artifacts were saved only under ignored
`iOS_ipa/build/qishui-public-web`. HTML may contain request metadata and transient
URLs and is not a distributable test fixture. Official JavaScript was analyzed
as inert syntax with the reverse-engineer-anything workflow; no bootstrap or
page security script was executed.

| Official artifact | SHA-256 |
| --- | --- |
| `6613.8cbf5b11.js` | `6b3d671f805fb03a1eccf11946f3f4b567e325ac66e348d58ec1c5970512ccbe` |
| `9061.ac7819a7.js` | `fee1f94604b64bfb23654b33206772dc54e431b805d137c2af093ee4d2d8404f` |
| `song.6f3d71d3.js` | `35bea6cd6e2e1c1e00f5f83d06b255103a94aa548818489094b72d82708ab219` |

In the first artifact, zero-based UTF-8/ASCII character offsets include API
host at 39190, `GetSeoTracks` at 52332, URL selection at 59787,
`encrypt=false` at 59962, and chart list mapping at 60967. These offsets are
artifact-specific, not stable API identifiers.

REA parent evidence for these three newly fetched song bundles:
`ev_5193067b2cbaa46d24a0db2a77e9b3bbb9999b442747d1c3f09633690e39e5af`.
The earlier share-page bundle set used
`ev_81a86110c23f7abc69af727c752a67e232fa9d49cd297b17d65946d25dd7d12b`.
Static semantic coverage is partial; absence of a keyword-search call in the
examined pages does not prove that no official search product exists. Exact
route/model claims above also have direct network and focused text evidence.
PC source-map SHA-256 was independently rechecked as
`9dbc37e7e5c4a97ebbb09f9c2d61d99ccb20aeaa480d2716ebb84acdb8e158dc`,
matching the artifact recorded in `QISHUI_PHONE_LOGIN_EVIDENCE.md`.

The remaining substantive gap is authorized full-catalog search and
account-entitled playback acceptance on the real iPad. A public H5 song import
and its genuine preview/public stream can be implemented independently, with
accurate limits shown to the user; it cannot be reported as completing that
gap.

## Implemented public-web module and verification

`music_app/providers/qishui/public_web.py` exposes:

- `parse_track_id(value)`: exact decimal string or supported official song/share
  URL to a track ID; it never opens the supplied URL.
- `catalog_search(query, page=1, size=20)`: existing search response fields plus
  `scope=public_catalog` and a scope explanation. A keyword filters only
  existing official recommendations. A numeric ID/official URL imports exact
  metadata. Search does not fetch or probe any audio.
- `resolve(value)`: `{track, lyric, audio, access, scope, playable}`. `track`
  preserves the sanitized official shape needed by `api.normalize_track`;
  `lyric.content` is the official native lyric text. `audio` is a list of
  verified options with `{key, quality, url, backupUrl, durationMs, expiresAt,
  format, codec, bitrate, size, access, encrypted}`. Only actual AAC/M4A
  `medium`/`higher`/`highest` options are offered; there is no lossless label.

Each offered option needs a bounded CDN Range request and a complete early
`moov` header. The parser confirms one audio `mp4a` description with `esds`,
rejects protection boxes/fragmentation, and reads the actual `mdhd` duration.
This confirmation, not an absent encryption flag, permits `encrypted=false`.
The actual duration must agree with the model and determines `preview` versus
`full_public`; absent VIP flags alone never determine duration/access. An
explicit VIP-only or purchase-only track with an anonymous full-duration stream
is rejected. Nonempty unparsed digital-sale metadata blocks audio until its
access contract is established; a URL alone cannot establish purchase rights.
Unresolved restrictions, unavailable/expired metadata, unsupported formats,
unknown encryption, and failed probes do not produce a playable option.

Only HTTPS official `douyinvod.com` CDN hosts are allowed for media. Query
strings remain byte-for-byte unchanged. Metadata and media redirects are
rejected to preserve the checked resource and request bound. Unprobed backup
URLs are not offered as verified substitutes. The isolated HTTP opener has no account cookie
processor; neither account cookies nor authorization are passed to Douyin.
There are at most one metadata GET and three 128-KiB header reads per resolve,
24 HTTP calls per minute globally, 64 cached documents/results for at most
90 seconds or the earlier upstream expiry, and 128 directory entries with a
10-minute lifetime. No recommendation is recursively crawled.

`iOS_ipa/checks/test_qishui_public_web.py` has 15 passing offline boundary tests.
They cover credential-free HTTP, official URL parsing, URL signature retention,
redirect/size/rate limits, finite directory filtering, protected/invalid MP4
rejection, actual media durations, expiry, explicit VIP limits, and cache
isolation. The test fixtures are synthetic, not downloaded songs.

An additional anonymous live run of this module verified the preview's
30,000-ms AAC container and full-public 229,077-ms and 211,114-ms containers
for the three IDs above. The two latter tracks passed header checks for all
three AAC qualities. The run made 12 bounded HTTP reads, kept 64 deduplicated
metadata rows after merging only the directly returned recommendations, and
saved no media. Availability of individual CDN quality URLs can vary; a
failed probe hides that option. These checks were on the development computer;
the final integrated iPad player remains a separate device verification.

The API adapter now selects this limited mode only when iOS signer status
explicitly reports absent SDK configuration. Existing configured signer or
account failures are not converted to public success. API status exposes
`search_scope=public_catalog` and `public_catalog_available=true` in this mode.
Search/directory responses retain scope labels; the directory is explicitly
marked as a public recommendation directory, not a complete music chart.
Playback responses use actual stream duration in seconds (`duration_s`,
`duration`, `previewDuration`) and milliseconds (`durationMs`,
`previewDurationMs`), while `originalDuration_s` preserves original track
length. Each AAC option and the selected response carry a matching official
preview/public-version label and message. No verified stream means
`playback_supported=false`, `access=unknown`, and unconfirmed encryption state.

The additional `test_qishui_public_api.py` integration suite has 13 passing
tests. Together these 28 offline tests cover public/native routing, response
metadata, explicit purchase/VIP limits, and unparsed digital-sale rejection.
