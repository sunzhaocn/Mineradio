package dev.mineradio.android;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import java.io.*;
import java.util.concurrent.CopyOnWriteArrayList;

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
                copyAssets("bundle", root);
                prefs.edit().putLong("update", update).apply();
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
}
