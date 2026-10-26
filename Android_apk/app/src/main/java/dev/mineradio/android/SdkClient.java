package dev.mineradio.android;

import android.content.*;
import android.os.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class SdkClient {
    private static Messenger service;
    private static CountDownLatch connected;
    private static final AtomicInteger sequence = new AtomicInteger();
    private static final ConcurrentHashMap<Integer, CompletableFuture<String>> pending = new ConcurrentHashMap<>();
    private static final Messenger replies = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        CompletableFuture<String> future = pending.remove(message.what);
        if (future != null) {
            String value = message.getData().getString("result");
            if (value != null) future.complete(value); else future.completeExceptionally(new IllegalStateException("SDK request failed"));
        }
        return true;
    }));
    private static final ServiceConnection connection = new ServiceConnection() {
        public void onServiceConnected(ComponentName name, IBinder binder) { service = new Messenger(binder); connected.countDown(); }
        public void onServiceDisconnected(ComponentName name) { service = null; for (CompletableFuture<String> value : pending.values()) value.completeExceptionally(new IllegalStateException("SDK process stopped")); pending.clear(); }
    };
    public static String sign(String url, String headers) throws Exception {
        CountDownLatch latch;
        synchronized (SdkClient.class) {
            if (service == null) {
                if (connected == null || connected.getCount() == 0) {
                    connected = new CountDownLatch(1);
                    MineradioApp.app.main.post(() -> MineradioApp.app.bindService(new Intent(MineradioApp.app, SdkService.class), connection, Context.BIND_AUTO_CREATE));
                }
            }
            latch = connected;
        }
        if (service == null && (latch == null || !latch.await(12, TimeUnit.SECONDS))) throw new TimeoutException("SDK startup timeout");
        int id = sequence.incrementAndGet(); CompletableFuture<String> future = new CompletableFuture<>(); pending.put(id, future);
        try {
            Message request = Message.obtain(null, id); request.replyTo = replies;
            Bundle args = new Bundle(); args.putString("url", url); args.putString("headers", headers); request.setData(args);
            service.send(request); return future.get(15, TimeUnit.SECONDS);
        } finally { pending.remove(id); }
    }
}
