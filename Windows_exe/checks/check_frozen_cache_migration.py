"""Upgrade an isolated real Electron profile from the installed old app to the build."""
import json
import hashlib
import atexit
import os
from pathlib import Path
import subprocess
import tempfile
import time
import wave
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'runtime/embedded-ui-retirement'
PROCESSES = []


@atexit.register
def cleanup_failed_fixture():
    # Only processes launched for this synthetic, isolated profile are owned.
    for process in PROCESSES:
        if process.poll() is None:
            process.terminate()


def launch(executable, folder, profile, label):
    report = folder / (label + '-smoke.json')
    environment = {**os.environ, 'MINERADIO_STARTUP_QA_HIDDEN': '1',
                   'MINERADIO_STARTUP_QA_USER_DATA': str(profile), 'MINERADIO_SMOKE_REPORT': str(report)}
    environment.pop('MINERADIO_STARTUP_QA_EXIT_MS', None)
    with (folder / (label + '-stdout.log')).open('wb') as stdout, (folder / (label + '-stderr.log')).open('wb') as stderr:
        process = subprocess.Popen([str(executable), '--remote-debugging-port=19427',
                                    '--remote-debugging-address=127.0.0.1', '--autoplay-policy=no-user-gesture-required'],
                                   env=environment, stdout=stdout, stderr=stderr,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
    PROCESSES.append(process)
    deadline = time.time() + 90
    while not report.is_file() and time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(label + ' exited before its startup report')
        time.sleep(.25)
    data = json.loads(report.read_text())
    assert data['ok'] and data['moduleCount'] == 334, data
    return process, data


def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    folder = OUTPUT / ('frozen-qa-' + str(time.time_ns()))
    folder.mkdir()
    # Chromium cache filenames add long hashes; keep the synthetic Windows
    # profile short instead of nesting it below a Unicode repository checkout.
    profile = Path(tempfile.mkdtemp(prefix='mrui-'))
    old_executable = Path(os.environ['LOCALAPPDATA']) / 'Programs/Mineradio/Mineradio.exe'
    new_executable = ROOT / 'Windows_exe/dist/win-unpacked/Mineradio.exe'
    old_process, old_smoke = launch(old_executable, folder, profile, 'old')
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp('http://127.0.0.1:19427')
        page = next(page for context in browser.contexts for page in context.pages if page.url.startswith('http://127.0.0.1:'))
        origin = page.evaluate('location.origin')
        legacy_worker = page.evaluate('!!navigator.serviceWorker.controller')
        old_version = page.evaluate('async()=>(await desktopWindow.getUpdateState()).currentVersion')
        legacy = subprocess.check_output(['git', 'show', '850a27c:web/player/js/features/shell/standalone.js'],
                                         cwd=ROOT, encoding='utf-8')
        page.evaluate('''async(legacy)=>{
          localStorage.setItem('migration-test-account','synthetic-retain');
          localStorage.setItem('migration-test-playlist','["saved-playlist"]');
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('migration-local-music-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('tracks');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise(resolve=>{const tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').put({audio:new Blob(['saved-local-audio']),lyric:'[00:00]keep lyrics'},'song');tx.oncomplete=resolve});db.close();
          const media=await caches.open('music-downloads');await media.put('/saved-music',new Response('keep music cache'));
          const legacyCache=await caches.open('mineradio-shell-frozen-fixture');await legacyCache.put('/obsolete-ui',new Response('old UI'));
          for(const key of await caches.keys())if(key.startsWith('mineradio-shell-')){
            const c=await caches.open(key);await c.put('/js/features/shell/standalone.js',new Response(legacy,{headers:{'Content-Type':'application/javascript'}}));
            await c.put('/js/features/shell/player-updates.js',new Response('window.obsoleteUpdater=true;',{headers:{'Content-Type':'application/javascript'}}));
          }
        }''', legacy)
        if legacy_worker:
            page.reload(wait_until='domcontentloaded')
            page.wait_for_function('window.MINERADIO_MODULE_STATUS?.ready')
            assert page.evaluate('typeof mineradioNativeUpdater') == 'undefined'
        page.evaluate('()=>desktopWindow.close("exit")')
        browser.close()
        assert old_process.wait(timeout=30) == 0

        new_process, new_smoke = launch(new_executable, folder, profile, 'new')
        browser = p.chromium.connect_over_cdp('http://127.0.0.1:19427')
        page = next(page for context in browser.contexts for page in context.pages if page.url.startswith('http://127.0.0.1:'))
        assert page.evaluate('location.origin') == origin, 'Profile origin must remain unchanged'
        state = page.evaluate('''async()=>{
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('migration-local-music-fixture',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          const song=await new Promise(resolve=>{const r=db.transaction('tracks').objectStore('tracks').get('song');r.onsuccess=()=>resolve(r.result)});db.close();
          return {version:(await desktopWindow.getUpdateState()).currentVersion,account:localStorage.getItem('migration-test-account'),playlist:localStorage.getItem('migration-test-playlist'),audio:await song.audio.text(),lyric:song.lyric,caches:await caches.keys(),registrations:(await navigator.serviceWorker.getRegistrations()).length,banner:!!document.getElementById('offline-status'),updater:typeof mineradioNativeUpdater,media:await(await(await caches.open('music-downloads')).match('/saved-music')).text()};
        }''')
        assert state['version'] == json.loads((ROOT / 'Windows_exe/package.json').read_text())['version']
        assert state['account'] == 'synthetic-retain' and state['playlist'] == '["saved-playlist"]'
        assert state['audio'] == 'saved-local-audio' and state['lyric'] == '[00:00]keep lyrics'
        assert state['caches'] == ['music-downloads'] and state['media'] == 'keep music cache'
        assert state['registrations'] == 0 and not state['banner'] and state['updater'] == 'object'
        fixture = profile / 'export-fixture.wav'
        with wave.open(str(fixture), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\0\0' * 16000)
        page.evaluate('''()=>{const input=document.createElement('input');
          input.type='file';input.id='native-export-fixture';document.body.append(input)}''')
        # Preserve Chromium's native file path: Playwright's remote upload
        # creates a byte-only File which Electron correctly cannot authorize.
        cdp = page.context.new_cdp_session(page)
        document = cdp.send('DOM.getDocument')['root']['nodeId']
        node = cdp.send('DOM.querySelector', {'nodeId': document, 'selector': '#native-export-fixture'})['nodeId']
        cdp.send('DOM.setFileInputFiles', {'nodeId': node, 'files': [str(fixture)]})
        cdp.detach()
        exported = page.evaluate('''async()=>{
          const imported=await desktopWindow.importLocalMusicFiles(Array.from(document.getElementById('native-export-fixture').files));
          if(!imported.ok)throw new Error(JSON.stringify(imported));
          const songs=(await desktopWindow.listLocalMusicLibrary()).tracks;
          const song=songs.find(song=>song.localPath.endsWith('export-fixture.wav'));
          if(!song)throw new Error('Native import missing: '+JSON.stringify(imported));
          const file=await browserLocalMusic.readLocalMusicFile(song.localFileId);
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.blob.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
          return {name:file.name,hash,videoState:await desktopWindow.getVisualVideoExportState(),
            rejectedEmpty:await desktopWindow.exportVisualVideo({}),saveApi:typeof desktopWindow.saveExportFile};
        }''')
        assert exported['name'] == fixture.name and exported['hash'] == hashlib.sha256(fixture.read_bytes()).hexdigest(), exported
        assert exported['videoState']['status'] == 'idle' and exported['saveApi'] == 'function', exported
        assert exported['rejectedEmpty']['ok'] is False and '音频' in exported['rejectedEmpty']['error'], exported
        page.evaluate('()=>desktopWindow.close("exit")')
        browser.close()
        assert new_process.wait(timeout=30) == 0
    result = dict(oldVersion=old_version, newVersion=state['version'], legacyUiCacheSeeded=True,
                  legacyWorkerWasPresent=legacy_worker,
                  automaticNativeBootstrapPassed=True, accountsPlaylistsLocalAudioLyricsPreserved=True,
                  mediaCachePreserved=True, shellCaches=0, serviceWorkers=0, offlineBanner=False,
                  oldAndNewModules=[old_smoke['moduleCount'], new_smoke['moduleCount']],
                  bothProcessesExitedNormally=True, existingUserInstallationModified=False)
    result.update(nativeImportedAudioExportBytesMatch=True, nativeVideoIpcRegisteredAndTrusted=True)
    (OUTPUT / 'frozen-windows.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    run()
