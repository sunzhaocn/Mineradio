package dev.mineradio.android;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    public static java.lang.ref.WeakReference<MainActivity> current = new java.lang.ref.WeakReference<>(null);
    private WebView web;
    private static ValueCallback<Uri[]> fileCallback;
    private String profile;
    private String override;
    private static String downloadUrl;
    private static ExportStore.Entry blobExport;
    private static final int OPEN_AUDIO = 10, SAVE_AUDIO = 11, SAVE_BLOB = 12;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        current = new java.lang.ref.WeakReference<>(this);
        getWindow().setStatusBarColor(0xff101720);
        getWindow().setNavigationBarColor(0xff101720);
        if (Build.VERSION.SDK_INT >= 35) getWindow().setDecorFitsSystemWindows(true);
        if (BuildConfig.DEBUG) override = getIntent().getStringExtra("layout");
        startService(new Intent(this, PlayerService.class));
        TextView loading = new TextView(this); loading.setText("Mineradio\n正在启动设备内的音乐服务…");
        loading.setTextColor(0xffdce8ef); loading.setTextSize(19); loading.setGravity(Gravity.CENTER);
        loading.setBackgroundColor(0xff101720); setContentView(loading);
        MineradioApp.app.startEngine(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (MineradioApp.app.origin == null) { loading.setText(MineradioApp.app.startupError + "\n请重新打开应用"); return; }
            attachWeb();
        });
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 90);
    }
    private String selectProfile() {
        if (BuildConfig.DEBUG && ("phone".equals(override) || "tablet".equals(override))) return override;
        return getResources().getConfiguration().smallestScreenWidthDp >= 600 ? "tablet" : "phone";
    }
    @android.annotation.SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void attachWeb() {
        web = MineradioApp.app.webView;
        if (web == null) {
            web = new WebView(getApplicationContext()); MineradioApp.app.webView = web;
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
            settings.setBuiltInZoomControls(true); settings.setDisplayZoomControls(false);
            settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
            web.addJavascriptInterface(new NativeBridge(), "MineradioAndroid");
        }
        web.setBackgroundColor(0xff101720);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.toString().startsWith(MineradioApp.app.origin + "/")) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (BuildConfig.DEBUG) android.util.Log.i("Mineradio", "UI_READY " + profile);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent choose = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                choose.setType("*/*"); choose.addCategory(Intent.CATEGORY_OPENABLE);
                choose.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                java.util.Set<String> types = new java.util.LinkedHashSet<>();
                for (String group : params.getAcceptTypes()) for (String item : group.split(",")) {
                    item = item.trim();
                    if (item.startsWith(".")) {
                        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(item.substring(1).toLowerCase());
                        types.add(mime == null ? "application/octet-stream" : mime);
                        if (item.equalsIgnoreCase(".lrc")) types.add("text/plain");
                    } else if (item.contains("/")) types.add(item);
                }
                if (!types.isEmpty()) choose.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
                try { startActivityForResult(choose, OPEN_AUDIO); return true; }
                catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; return false; }
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (url.startsWith("blob:")) {
                web.evaluateJavascript("window.mineradioAndroidSaveBlob&&mineradioAndroidSaveBlob("+JSONObject.quote(url)+","+JSONObject.quote(URLUtil.guessFileName(url,disposition,mime))+")",null);
                return;
            }
            if (!url.startsWith(MineradioApp.app.origin + "/api/download")) return;
            downloadUrl = url;
            Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime == null ? "audio/*" : mime);
            save.putExtra(Intent.EXTRA_TITLE, URLUtil.guessFileName(url, disposition, mime));
            startActivityForResult(save, SAVE_AUDIO);
        });
        if (web.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) web.getParent()).removeView(web);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xff101720);
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        String next = selectProfile();
        String loaded = web.getUrl() == null ? null : Uri.parse(web.getUrl()).getQueryParameter("android_layout");
        profile = next;
        if (web.getUrl() == null || !next.equals(loaded)) loadProfile();
    }
    private void loadProfile() {
        int actual = getResources().getConfiguration().screenWidthDp;
        int width = Math.max(320, Math.min(880, actual));
        double scale = Math.max(1.0, (double) actual / width);
        web.loadUrl(MineradioApp.app.origin + "/?android_layout=" + profile + "&width=" + width + "&scale=" + scale);
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        String next = selectProfile();
        if (web == null) return;
        if (!next.equals(profile)) { profile = next; loadProfile(); }
        else if ("phone".equals(profile)) {
            int width = Math.max(320, Math.min(880, config.screenWidthDp));
            double scale = Math.max(1.0, (double) config.screenWidthDp / width);
            web.evaluateJavascript("document.querySelector('meta[name=viewport]').content='width=" + width + ",initial-scale=" + scale + ",viewport-fit=cover'", null);
        }
    }
    private void foreground(boolean active) {
        MineradioApp.app.activityForeground = active;
        if (web != null) web.evaluateJavascript("window.mineradioAndroidSetForeground&&mineradioAndroidSetForeground(" + active + ")", null);
    }
    @Override protected void onResume() { super.onResume(); foreground(true); }
    @Override protected void onPause() { foreground(false); super.onPause(); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_AUDIO && fileCallback != null) {
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result, data);
            if (selected != null && data != null && (data.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0)
                for (Uri uri : selected) try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) {}
            fileCallback.onReceiveValue(selected); fileCallback = null;
        }
        if (request == SAVE_AUDIO && result == RESULT_OK && data != null && downloadUrl != null) {
            final String source = downloadUrl; final Uri destination = data.getData(); downloadUrl = null;
            new Thread(() -> {
                try (java.io.InputStream in = new java.net.URL(source).openStream(); java.io.OutputStream out = getContentResolver().openOutputStream(destination)) {
                    byte[] buffer = new byte[32768]; int size; while ((size = in.read(buffer)) != -1) out.write(buffer, 0, size);
                    runOnUiThread(() -> Toast.makeText(this, "音频已保存", Toast.LENGTH_SHORT).show());
                } catch (Exception error) { runOnUiThread(() -> Toast.makeText(this, "保存失败，请重试", Toast.LENGTH_LONG).show()); }
            }, "MineradioSave").start();
        }
        if (request == SAVE_BLOB && blobExport != null) {
            final ExportStore.Entry selected=blobExport;blobExport=null;
            if(result!=RESULT_OK||data==null||data.getData()==null){ExportStore.release(selected.id);return;}
            final Uri destination=data.getData();
            new Thread(()->{
                try(java.io.InputStream in=new java.io.FileInputStream(selected.file);java.io.OutputStream out=getContentResolver().openOutputStream(destination)){
                    byte[] buffer=new byte[32768];int size;while((size=in.read(buffer))!=-1)out.write(buffer,0,size);
                    runOnUiThread(()->Toast.makeText(this,"文件已保存",Toast.LENGTH_SHORT).show());
                }catch(Exception error){runOnUiThread(()->Toast.makeText(this,"保存失败，请重试",Toast.LENGTH_LONG).show());}
                finally{ExportStore.release(selected.id);}
            },"MineradioExport").start();
        }
    }
    public void offerBlobSave(ExportStore.Entry entry) {
        if(blobExport!=null){ExportStore.release(entry.id);return;}
        blobExport=entry;
        Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(entry.mime);
        save.putExtra(Intent.EXTRA_TITLE,entry.name.isEmpty()?"Mineradio-export":entry.name);
        save.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download"));
        try{startActivityForResult(save,SAVE_BLOB);}catch(Exception error){blobExport=null;ExportStore.release(entry.id);}
    }
    @Override public void onBackPressed() {
        if (web != null) web.evaluateJavascript("(function(){if(window.webMobileNavigation&&webMobileNavigation.active()&&webMobileNavigation.current()!=='home'){webMobileNavigation.go('home');return true}return false})()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
        else super.onBackPressed();
    }
    private static final class NativeBridge {
        @JavascriptInterface public boolean hasArtwork() { return BuildConfig.DEBUG && PlayerService.instance != null && PlayerService.instance.hasArtwork(); }
        @JavascriptInterface public boolean isForeground() { return MineradioApp.app.activityForeground; }
        @JavascriptInterface public String beginSave(String name,String mime) { return ExportStore.begin(name,mime); }
        @JavascriptInterface public boolean appendSave(String id,String bytes) { return ExportStore.append(id,bytes); }
        @JavascriptInterface public void finishSave(String id) { ExportStore.finish(id); }
        @JavascriptInterface public void cancelSave(String id) { ExportStore.release(id); }
        @JavascriptInterface public void playback(String value) {
            try { JSONObject state = new JSONObject(value); MineradioApp.app.main.post(() -> {
                if (PlayerService.instance != null) { PlayerService.instance.update(state); return; }
                // Android may reclaim an idle service while the retained
                // WebView stays alive. Restore it on real playback instead of
                // silently dropping all subsequent system metadata/controls.
                if (state.optBoolean("playing")) {
                    Intent intent = new Intent(MineradioApp.app, PlayerService.class).putExtra("playback", value);
                    try {
                        if (Build.VERSION.SDK_INT >= 26) MineradioApp.app.startForegroundService(intent);
                        else MineradioApp.app.startService(intent);
                    } catch (RuntimeException ignored) {}
                }
            }); }
            catch (Exception ignored) {}
        }
    }
}
