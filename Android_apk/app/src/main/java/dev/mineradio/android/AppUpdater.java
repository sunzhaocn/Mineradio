package dev.mineradio.android;

import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Process-owned state survives Activity recreation and never holds an Activity. */
final class AppUpdater {
    private static AppUpdater instance;
    static synchronized AppUpdater get() {
        if (instance == null) instance = new AppUpdater();
        return instance;
    }
    private final java.util.concurrent.ExecutorService worker = Executors.newSingleThreadExecutor();
    private String status = "idle", version = BuildConfig.VERSION_NAME, url, hash, notes = "", error = "";
    private long total, transferred, lastProgress;
    private boolean available, busy, ready, pendingInstall, permissionPrompt;
    private final File directory = new File(MineradioApp.app.getCacheDir(), "updates");
    File readyFile() { return new File(directory, "update.apk"); }

    synchronized String state() {
        try {
            return new JSONObject().put("platform", "android").put("currentVersion", BuildConfig.VERSION_NAME)
                .put("version", version).put("status", status).put("updateAvailable", available)
                .put("progress", total > 0 ? Math.min(100, transferred * 100.0 / total) : 0)
                .put("transferred", transferred).put("total", total).put("notes", notes).put("error", error).toString();
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    private void publish() {
        final String value = state();
        MineradioApp.app.main.post(() -> {
            android.webkit.WebView web = MineradioApp.app.webView;
            if (web != null) web.evaluateJavascript("window.mineradioAndroidAcceptUpdate&&mineradioAndroidAcceptUpdate(" + value + ")", null);
        });
    }
    synchronized String check() {
        if (busy || ready) return state();
        busy = true; status = "checking"; error = ""; publish();
        worker.execute(() -> {
            try {
                JSONObject release = new JSONObject(UpdateTransfer.readRelease());
                if (release.optBoolean("draft") || release.optBoolean("prerelease")) throw new IOException("未找到正式版本");
                JSONArray assets = release.getJSONArray("assets");
                JSONObject chosen = null; int newest = -1;
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    int code = UpdatePolicy.versionCode(UpdatePolicy.apkVersion(asset.optString("name")));
                    if (code > newest) { chosen = asset; newest = code; }
                }
                if (chosen == null) throw new IOException("此版本尚未提供 ARM64 安卓安装包");
                String assetName = chosen.getString("name"), download = chosen.getString("browser_download_url");
                long size = chosen.getLong("size");
                UpdatePolicy.validateAsset(download, assetName, size);
                String digest = UpdatePolicy.sha256(chosen.optString("digest"));
                synchronized (this) {
                    version = UpdatePolicy.apkVersion(assetName); available = newest > BuildConfig.VERSION_CODE;
                    url = download; hash = digest; total = size; transferred = 0;
                    notes = release.optString("body"); status = available ? "available" : "not-available";
                    busy = false; error = "";
                }
                publish();
            } catch (Exception failure) { fail(failure); }
        });
        return state();
    }
    synchronized String download() {
        if (busy) return state();
        if (ready) { requestInstall(); return state(); }
        if (!available || url == null) return check();
        busy = true; status = "downloading"; error = ""; transferred = 0; lastProgress = 0; publish();
        final String source = url, digest = hash;
        final long size = total;
        worker.execute(() -> {
            HttpsURLConnection connection = null;
            try {
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建更新目录");
                if (directory.getUsableSpace() < size + 16L * 1024 * 1024) throw new IOException("手机存储空间不足，请清理后重试");
                connection = UpdateTransfer.open(source, false);
                long length = connection.getContentLengthLong();
                if (length >= 0 && length != size) throw new IOException("下载文件大小与发布信息不符");
                try (InputStream in = connection.getInputStream()) {
                    UpdateTransfer.copyVerified(in, new File(directory, "update.part"), readyFile(), size, digest, (bytes, all) -> {
                        boolean emit;
                        synchronized (this) {
                            transferred = bytes;
                            long now = android.os.SystemClock.elapsedRealtime();
                            emit = now - lastProgress >= 250 || bytes == all;
                            if (emit) lastProgress = now;
                        }
                        if (emit) publish();
                    });
                }
                verifyPackage();
                synchronized (this) { busy = false; ready = true; status = "downloaded"; pendingInstall = true; }
                publish();
                MineradioApp.app.main.post(() -> {
                    MainActivity activity = MainActivity.current.get();
                    if (activity != null && MineradioApp.app.activityForeground) offerInstall(activity);
                });
            } catch (Exception failure) {
                new File(directory, "update.part").delete(); readyFile().delete(); fail(failure);
            }
            finally { if (connection != null) connection.disconnect(); }
        });
        return state();
    }
    private void verifyPackage() throws Exception {
        PackageManager manager = MineradioApp.app.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(readyFile().getAbsolutePath(), flags);
        PackageInfo installed = manager.getPackageInfo(BuildConfig.APPLICATION_ID, flags);
        if (archive == null) throw new IOException("无法读取更新安装包");
        UpdatePolicy.validatePackage(BuildConfig.APPLICATION_ID, archive.packageName, version, archive.versionName,
            code(archive), code(installed), signatures(archive), signatures(installed));
    }
    private static long code(PackageInfo value) { return Build.VERSION.SDK_INT >= 28 ? value.getLongVersionCode() : value.versionCode; }
    private static Set<String> signatures(PackageInfo value) {
        Signature[] source = Build.VERSION.SDK_INT >= 28 && value.signingInfo != null
            ? value.signingInfo.getApkContentsSigners() : value.signatures;
        Set<String> result = new HashSet<>();
        if (source != null) for (Signature signature : source) result.add(signature.toCharsString());
        return result;
    }
    private synchronized void fail(Exception failure) {
        busy = false; ready = false; pendingInstall = false; status = "error";
        error = failure instanceof IOException ? failure.getMessage() : "更新失败，请检查网络后重试";
        publish();
    }
    synchronized void requestInstall() {
        if (!ready || !readyFile().isFile()) { ready = false; status = "error"; error = "安装包已被清理，请重新下载"; publish(); return; }
        pendingInstall = true;
        MineradioApp.app.main.post(() -> {
            MainActivity activity = MainActivity.current.get();
            if (activity != null && MineradioApp.app.activityForeground) offerInstall(activity);
        });
    }
    synchronized void onResume(MainActivity activity) {
        if (permissionPrompt) {
            permissionPrompt = false;
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                pendingInstall = false; error = "尚未允许安装来源，点击安装更新后可再次开启"; publish(); return;
            }
        }
        if (pendingInstall && ready) offerInstall(activity);
    }
    private synchronized void offerInstall(MainActivity activity) {
        if (!pendingInstall || !ready || activity.isFinishing() || activity.isDestroyed()) return;
        try {
            if (!readyFile().isFile()) throw new IOException("安装包已被清理，请重新下载");
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                permissionPrompt = true;
                error = "请允许 Mineradio 安装应用，返回后继续安装"; publish();
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + BuildConfig.APPLICATION_ID)));
                return;
            }
            Uri uri = Uri.parse("content://" + BuildConfig.APPLICATION_ID + ".updates/update.apk");
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("Mineradio update", uri));
            activity.startActivity(intent);
            pendingInstall = false; error = "已打开系统安装界面；若取消，可点击安装更新重试"; publish();
        } catch (Exception failure) {
            pendingInstall = false; permissionPrompt = false;
            error = "无法打开安装界面，请检查安装权限或重新下载"; publish();
        }
    }
}
