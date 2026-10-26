package dev.mineradio.android;

import android.app.Service;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import java.lang.reflect.*;
import java.util.*;
import java.io.*;

/** Native failures stay in this private process, away from the player and Python. */
public final class SdkService extends Service {
    private HandlerThread thread;
    private boolean ready;
    @Override public void onCreate() { super.onCreate(); thread = new HandlerThread("MineradioSignWorker"); thread.start(); }
    @Override public IBinder onBind(Intent intent) {
        return new Messenger(new Handler(thread.getLooper(), message -> {
            Bundle output = new Bundle();
            try {
                if (!ready) initialize();
                String url = message.getData().getString("url", "");
                android.net.Uri uri = android.net.Uri.parse(url);
                if (!"https".equals(uri.getScheme()) || !"api.qishui.com".equals(uri.getHost()) || !uri.getPath().startsWith("/luna/")) throw new IllegalArgumentException();
                JSONObject input = new JSONObject(message.getData().getString("headers", "{}"));
                Map<String, List<String>> headers = new LinkedHashMap<>();
                Iterator<String> keys = input.keys();
                while (keys.hasNext()) { String name = keys.next(); headers.put(name, Collections.singletonList(input.getString(name))); }
                Class<?> network = Class.forName("com.bytedance.frameworks.baselib.network.http.NetworkParams");
                Object signed = network.getMethod("tryAddSecurityFactor", String.class, Map.class).invoke(null, url, headers);
                if (!(signed instanceof Map) || ((Map<?, ?>) signed).isEmpty()) throw new IllegalStateException();
                output.putString("result", new JSONObject((Map<?, ?>) signed).toString());
            } catch (Throwable failure) { output.putString("error", failure.getClass().getSimpleName()); }
            Message response = Message.obtain(null, message.what); response.setData(output);
            try { message.replyTo.send(response); } catch (RemoteException ignored) {}
            return true;
        })).getBinder();
    }
    private void initialize() throws Exception {
        JSONObject config;
        try (InputStream in = getAssets().open("sdk-config.json"); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048]; int n; while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            config = new JSONObject(new String(out.toByteArray(), "UTF-8"));
        }
        Class<?> holder = Class.forName("ms.bd.c.v2");
        Field singleton = holder.getDeclaredField("b"); singleton.setAccessible(true);
        Field context = holder.getDeclaredField("a"); context.setAccessible(true); context.set(singleton.get(null), getApplicationContext());
        Class<?> utility = Class.forName("com.luna.common.util.ContextUtil");
        utility.getMethod("setContext", android.app.Application.class).invoke(utility.getField("INSTANCE").get(null), getApplication());
        Class<?> lifecycle = Class.forName("ms.bd.c.i3"); Field f = lifecycle.getDeclaredField("f"); f.setAccessible(true);
        Object state = f.get(null); Field bits = state.getClass().getDeclaredField("a"); bits.setAccessible(true); ((BitSet) bits.get(state)).set(1);
        android.system.Os.setenv("28d7fdd567361198183fa7b8e", "a7", true);
        System.loadLibrary("metasec_ml");
        Class.forName("ms.bd.c.k3").getDeclaredMethod("a", int.class, int.class, long.class, String.class, Object.class)
            .invoke(null, 16777219, 0, 0L, null, getApplicationContext());
        Field initialized = lifecycle.getDeclaredField("d"); initialized.setAccessible(true); initialized.setBoolean(null, true);
        Class<?> builderClass = Class.forName("com.bytedance.mobsec.metasec.ml.MSConfig$Builder");
        Object builder = builderClass.getConstructor(String.class, String.class, int.class).newInstance(config.getString("appId"), config.getString("license"), config.getInt("collectMode"));
        builderClass.getMethod("setClientType", int.class).invoke(builder, config.getInt("clientType"));
        builderClass.getMethod("setChannel", String.class).invoke(builder, config.getString("channel"));
        Object sdkConfig = builderClass.getMethod("build").invoke(builder);
        Class<?> configClass = Class.forName("com.bytedance.mobsec.metasec.ml.MSConfig");
        Object ok = Class.forName("com.bytedance.mobsec.metasec.ml.MSManagerUtils").getMethod("init", Context.class, configClass).invoke(null, getApplicationContext(), sdkConfig);
        if (!Boolean.TRUE.equals(ok)) throw new IllegalStateException("SDK not initialized");
        ready = true;
    }
    @Override public void onDestroy() { thread.quitSafely(); super.onDestroy(); }
}
