package dev.mineradio.android;

import android.app.*;
import android.content.*;
import android.media.*;
import android.media.session.*;
import android.os.*;
import org.json.JSONObject;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Owns background priority and system controls; the retained WebView owns audio. */
public final class PlayerService extends Service {
    static final String SYNC = "dev.mineradio.android.SYNC_PLAYBACK";
    static volatile PlayerService instance;
    private static final int NOTIFICATION_ID = 1;
    private static final long PAUSED_GRACE_MS = 60000, WAKE_RENEW_MS = 5 * 60 * 1000;
    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private boolean foreground, playing, stopping, lifetimeSet;
    private String title = "Mineradio", artist = "", artworkKey = "", artworkContent = "";
    private volatile Bitmap artwork;
    private long duration;
    private final Handler main = new Handler(Looper.getMainLooper());
    // Decode only the newest pending cover when tracks change rapidly.
    private final ThreadPoolExecutor images = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.DiscardOldestPolicy());

    @Override public void onCreate() {
        super.onCreate(); instance = this;
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel("playback", "音乐播放", NotificationManager.IMPORTANCE_LOW));
        session = new MediaSession(this, "Mineradio");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { command("play", 0); }
            @Override public void onPause() { command("pause", 0); }
            @Override public void onStop() { command("stop", 0); }
            @Override public void onSkipToNext() { command("next", 0); }
            @Override public void onSkipToPrevious() { command("previous", 0); }
            @Override public void onSeekTo(long position) { command("seek", position / 1000); }
        });
        // Chromium owns audio focus. A second focus owner would pause it.
        wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Mineradio:Playback");
        wakeLock.setReferenceCounted(false);
        if (Build.VERSION.SDK_INT >= 33)
            registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        MineradioApp.app.playbackServiceCreated();
    }
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { command("pause", 0); }
    };
    private final Runnable releasePaused = () -> {
        if (playing || stopping) return;
        stopping = true;
        // An explicit notification Play action can restart this service.
        if (foreground) { stopForeground(STOP_FOREGROUND_DETACH); foreground = false; }
        stopSelf();
    };
    private final Runnable renewWake = new Runnable() {
        @Override public void run() {
            if (!playing || stopping) return;
            wakeLock.acquire(WAKE_RENEW_MS * 2);
            main.postDelayed(this, WAKE_RENEW_MS);
        }
    };
    private boolean promote() {
        if (foreground) return true;
        try { startForeground(NOTIFICATION_ID, notification()); foreground = true; return true; }
        catch (RuntimeException error) {
            MineradioApp.app.playbackServiceFailed();
            MineradioApp.app.action("pause", 0);
            stopping = true; stopSelf(); return false;
        }
    }
    private void powerAndLifetime() {
        lifetimeSet = true;
        main.removeCallbacks(renewWake); main.removeCallbacks(releasePaused);
        if (playing) renewWake.run();
        else {
            if (wakeLock.isHeld()) wakeLock.release();
            main.postDelayed(releasePaused, PAUSED_GRACE_MS);
        }
    }
    private static long millis(double seconds) {
        return Double.isFinite(seconds) && seconds > 0 ? (long)Math.min(seconds * 1000, Long.MAX_VALUE) : 0;
    }
    void update(JSONObject state) {
        if (stopping || state == null) return;
        boolean nextPlaying = state.optBoolean("playing");
        String nextTitle = state.optString("title", "Mineradio"), nextArtist = state.optString("artist", "");
        long nextDuration = millis(state.optDouble("duration"));
        boolean playbackChanged = nextPlaying != playing;
        boolean metadataChanged = !title.equals(nextTitle) || !artist.equals(nextArtist) || duration != nextDuration;
        playing = nextPlaying; title = nextTitle; artist = nextArtist; duration = nextDuration;
        String nextKey = state.has("artworkKey") ? state.optString("artworkKey") : state.optString("artwork");
        boolean artworkChanged = !nextKey.equals(artworkKey);
        if (artworkChanged) { artworkKey = nextKey; artworkContent = ""; artwork = null; }
        // New bridges omit unchanged bytes; an empty key clears the old cover.
        if (state.has("artwork")) {
            String encoded = state.optString("artwork");
            if (!encoded.equals(artworkContent) && encoded.startsWith("data:image/jpeg;base64,") && encoded.length() < 2 * 1024 * 1024) {
                artworkContent = encoded;
                final String expectedKey = artworkKey;
                images.execute(() -> decodeArtwork(encoded, expectedKey));
            }
        }
        if (playing && !promote()) return;
        session.setActive(foreground || playing);
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions).setState(
            playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
            millis(state.optDouble("position")), playing ? 1 : 0).build());
        if (metadataChanged || artworkChanged) publishMetadata();
        if (foreground && (playbackChanged || metadataChanged || artworkChanged))
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification());
        if (playbackChanged || metadataChanged) getSharedPreferences("playback", MODE_PRIVATE).edit()
            .putBoolean("active", playing).putString("title", title).putString("artist", artist).apply();
        if (playbackChanged || !lifetimeSet) powerAndLifetime();
    }
    private void decodeArtwork(String encoded, String expectedKey) {
        Bitmap decoded = null;
        try {
            byte[] bytes = Base64.decode(encoded.substring(encoded.indexOf(',') + 1), Base64.DEFAULT);
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (options.outWidth > 0 && options.outWidth <= 512 && options.outHeight > 0 && options.outHeight <= 512) {
                options.inJustDecodeBounds = false; decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            }
        } catch (Exception ignored) {}
        final Bitmap result = decoded;
        main.post(() -> {
            if (instance != this || stopping || !artworkKey.equals(expectedKey)) return;
            artwork = result; publishMetadata();
            if (foreground) getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification());
        });
    }
    private void publishMetadata() {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist).putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (artwork != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork).putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
        session.setMetadata(metadata.build());
    }
    boolean hasArtwork() { return artwork != null; }
    private PendingIntent openApp() {
        return PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private PendingIntent control(String action) {
        return PendingIntent.getForegroundService(this, action.hashCode(), new Intent(this, PlayerService.class).setAction(action),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private Notification notification() {
        return new Notification.Builder(this, "playback").setSmallIcon(dev.mineradio.android.R.drawable.ic_app)
            .setContentTitle(title).setContentText(artist).setContentIntent(openApp())
            .setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setLargeIcon(artwork)
            .setOngoing(playing).setDeleteIntent(control("stop"))
            .addAction(new Notification.Action.Builder(null, "上一首", control("previous")).build())
            .addAction(new Notification.Action.Builder(null, playing ? "暂停" : "播放", control(playing ? "pause" : "play")).build())
            .addAction(new Notification.Action.Builder(null, "下一首", control("next")).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    private void interruptedSession(boolean requested) {
        // A process restart destroyed the WebView. Offer the saved queue via
        // the app; do not claim playback or automatically start a new track.
        SharedPreferences saved = getSharedPreferences("playback", MODE_PRIVATE);
        if (requested || saved.getBoolean("active", false)) {
            title = saved.getString("title", "Mineradio");
            Notification notice = new Notification.Builder(this, "playback")
                .setSmallIcon(dev.mineradio.android.R.drawable.ic_app).setContentTitle(title)
                .setContentText("播放已中断，点击返回播放器").setContentIntent(openApp())
                .setAutoCancel(true).setOnlyAlertOnce(true).build();
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notice);
        }
        saved.edit().putBoolean("active", false).apply();
        stopping = true; stopSelf();
    }
    private void command(String action, long value) {
        if (stopping) return;
        if ("pause".equals(action) || "stop".equals(action)) {
            playing = false;
            MineradioApp.app.pausePlaybackSnapshot();
            getSharedPreferences("playback", MODE_PRIVATE).edit().putBoolean("active", false).apply();
            powerAndLifetime();
            if (foreground) getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification());
        }
        MineradioApp.app.action("stop".equals(action) ? "pause" : action, value);
        if ("stop".equals(action)) {
            stopping = true;
            MineradioApp.app.playbackServiceFailed();
            if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; }
            getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
            stopSelf();
        }
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        // Even a stale notification or sticky restart must satisfy the FGS
        // startup deadline before deciding that there is nothing to resume.
        if (!promote()) return START_NOT_STICKY;
        String action = intent == null ? null : intent.getAction();
        if ("stop".equals(action)) {
            command("stop", 0);
            return START_NOT_STICKY;
        }
        JSONObject current = MineradioApp.app.playbackSnapshot();
        if (MineradioApp.app.webView == null || current == null) {
            if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; }
            interruptedSession(intent != null);
            return START_NOT_STICKY;
        }
        update(current);
        if (action != null && !SYNC.equals(action)) command(action, 0);
        MineradioApp.app.requestPlaybackSnapshot();
        return !stopping && (playing || "play".equals(action) || "next".equals(action) || "previous".equals(action))
            ? START_STICKY : START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        if (instance == this) instance = null;
        main.removeCallbacksAndMessages(null);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        images.shutdownNow(); unregisterReceiver(noisy); session.release();
        if (foreground) stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
