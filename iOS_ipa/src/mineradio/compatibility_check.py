"""Explicit CI-only checks of native login windows and public audio playback."""
import asyncio
import json
import time


async def run(app):
    from . import official_login
    result = {'complete': False, 'accountUsed': False, 'smsSent': False}
    path = app.paths.cache / 'ios-compatibility-diagnostic.json'

    def save():
        path.write_text(json.dumps(result, ensure_ascii=True), encoding='utf-8')

    save()
    try:
        for provider in ('netease', 'qq', 'kugou'):
            result['stage'] = provider
            save()
            value = await official_login.diagnostic(provider, verify_windows=True)
            result.setdefault('officialLogin', {})[provider] = value
            save()
        result['stage'] = 'publicAudio'
        save()
        # This is a new muted HTML audio element in the actual local player.
        # Its source is resolved and registered by the production song route,
        # then streamed through the production same-origin Range proxy.
        await app.web.evaluate_javascript(r"""void (function () {
          window.__mineradioPublicAudioCheck={complete:false};
          (async function () {
            var out=window.__mineradioPublicAudioCheck, media;
            try {
              var response=await fetch('/api/qishui/song/url?id=7695376967742769187&quality=auto');
              if (!response.ok) throw new Error('resolution_http_'+response.status);
              var data=await response.json();
              if (!data.url || data.sourceScope!=='public_catalog' || data.encrypted) throw new Error('public_audio_unavailable');
              out.access=data.access; out.scope=data.sourceScope;
              out.nativeQuality=data.nativeQuality; out.trial=!!data.trial;
              media=new Audio(); media.muted=true; media.preload='auto';
              media.src='/api/audio?url='+encodeURIComponent(data.url);
              await media.play();
              var deadline=Date.now()+20000;
              while (media.currentTime<0.5 && Date.now()<deadline) await new Promise(function (r) { setTimeout(r,200); });
              out.currentTime=media.currentTime; out.duration=media.duration;
              out.ready=media.currentTime>=0.5 && isFinite(media.duration) && media.duration>0;
            } catch (e) { out.ready=false; out.error=String(e.message||e).slice(0,100).replace(/https?:\/\/\S+/g,'[url]'); }
            finally { if (media) { media.pause(); media.removeAttribute('src'); media.load(); } out.complete=true; }
          })();
        })()""")
        deadline = time.monotonic() + 70
        while time.monotonic() < deadline:
            await asyncio.sleep(.5)
            value = json.loads(await app.web.evaluate_javascript('JSON.stringify(window.__mineradioPublicAudioCheck||{})'))
            if value.get('complete'):
                result['publicAudio'] = value
                break
        else:
            result['publicAudio'] = {'ready': False, 'error': 'timeout'}
        result['complete'] = True
    except Exception as error:
        result['error'] = type(error).__name__
    save()
