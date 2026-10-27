package dev.mineradio.android;

import android.app.Application;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import java.io.*;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONObject;

public final class MineradioApp extends Application {
    public static MineradioApp app;
    public volatile String origin;
    public volatile String startupError;
    public WebView webView;
    public volatile boolean activityForeground;
    public final Handler main = new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Runnable> listeners = new CopyOnWriteArrayList<>();
    private boolean starting;
    private boolean replaceAssets;
    private final PlaybackServiceGate playbackGate = new PlaybackServiceGate();
    private JSONObject pendingPlayback;
    private boolean playbackQueued;
    private JSONObject latestPlayback;

    @Override public void onCreate() { super.onCreate(); app = this; }
    public synchronized void startEngine(Runnable ready) {
        if (origin != null || startupError != null) { main.post(ready); return; }
        listeners.add(ready);
        if (starting) return;
        starting = true;
        new Thread(() -> {
            try {
                File root = new File(getFilesDir(), "player");
                long update = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
                android.content.SharedPreferences prefs = getSharedPreferences("bundle", MODE_PRIVATE);
                replaceAssets = prefs.getLong("update", -1) != update;
                // Installed assets do not change between app launches. Avoid
                // hundreds of AssetManager listings/stat calls on warm starts.
                if (replaceAssets || !new File(root, "web/player/index.html").isFile()) {
                    copyAssets("bundle", root);
                    prefs.edit().putLong("update", update).apply();
                }
                if (!Python.isStarted()) Python.start(new AndroidPlatform(this));
                int port = Python.getInstance().getModule("mineradio_android").callAttr("start", root.getAbsolutePath()).toInt();
                origin = "http://127.0.0.1:" + port;
            } catch (Throwable error) {
                // Do not expose authenticated exception messages in logs or UI.
                startupError = "本地服务启动失败（" + error.getClass().getSimpleName() + "）";
                android.util.Log.e("Mineradio", "Engine startup failed", error);
            }
            for (Runnable action : listeners) main.post(action);
            listeners.clear();
        }, "MineradioBootstrap").start();
    }
    private void copyAssets(String path, File target) throws IOException {
        String[] names = getAssets().list(path);
        if (names != null && names.length > 0) {
            if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Cannot create asset directory");
            for (String name : names) copyAssets(path + "/" + name, new File(target, name));
        } else {
            if (target.isFile() && !replaceAssets) return;
            File parent = target.getParentFile(); if (!parent.isDirectory()) parent.mkdirs();
            try (InputStream input = getAssets().open(path); OutputStream output = new FileOutputStream(target)) {
                byte[] block = new byte[32768]; int count;
                while ((count = input.read(block)) >= 0) output.write(block, 0, count);
            }
        }
    }
    public void action(String name, long value) {
        main.post(() -> { if (webView != null) webView.evaluateJavascript("window.mineradioAndroidAction&&mineradioAndroidAction(" + org.json.JSONObject.quote(name) + "," + value + ")", null); });
    }

    void reportPlayback(String value) {
        if (value == null || value.length() > 3 * 1024 * 1024) return;
        final JSONObject parsed;
        try { parsed = new JSONObject(value); } catch (Exception ignored) { return; }
        synchronized (this) {
            JSONObject previous = pendingPlayback != null ? pendingPlayback : latestPlayback;
            if (!parsed.has("artwork") && previous != null && previous.has("artwork")
                    && parsed.optString("artworkKey").equals(previous.optString("artworkKey"))) {
                try { parsed.put("artwork", previous.optString("artwork")); } catch (Exception ignored) {}
            }
            pendingPlayback = parsed;
            if (playbackQueued) return;
            playbackQueued = true;
        }
        main.post(() -> {
            synchronized (MineradioApp.this) {
                latestPlayback = pendingPlayback;
                pendingPlayback = null;
                playbackQueued = false;
            }
            PlayerService service = PlayerService.instance;
            if (service != null) { service.update(latestPlayback); return; }
            if (!playbackGate.shouldStart(latestPlayback.optBoolean("playing"), false, SystemClock.elapsedRealtime())) return;
            // Keep artwork out of Intent extras: a large cover can otherwise
            // exceed Binder's transaction limit during a background restart.
            Intent start = new Intent(this, PlayerService.class).setAction(PlayerService.SYNC);
            try {
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(start);
                else startService(start);
            } catch (RuntimeException ignored) {
                playbackGate.failed(SystemClock.elapsedRealtime());
            }
        });
    }

    JSONObject playbackSnapshot() { return latestPlayback; }
    synchronized void pausePlaybackSnapshot() {
        try {
            if (latestPlayback != null) latestPlayback.put("playing", false);
            if (pendingPlayback != null) pendingPlayback.put("playing", false);
        } catch (Exception ignored) {}
    }
    void playbackServiceCreated() {
        playbackGate.created();
        requestPlaybackSnapshot();
    }
    void playbackServiceFailed() { playbackGate.failed(SystemClock.elapsedRealtime()); }
    void requestPlaybackSnapshot() {
        main.post(() -> {
            if (webView != null) webView.evaluateJavascript(
                "window.mineradioAndroidReport&&window.mineradioAndroidReport(true)", null);
        });
    }
}
