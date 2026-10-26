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

public final class PlayerService extends Service {
    static volatile PlayerService instance;
    private MediaSession session;
    private boolean foreground, playing;
    private String title = "Mineradio", artist = "";
    private String artworkKey = "";
    private volatile Bitmap artwork;
    private long duration;
    private final java.util.concurrent.ExecutorService images = java.util.concurrent.Executors.newSingleThreadExecutor();
    @Override public void onCreate() {
        super.onCreate(); instance = this;
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel("playback", "音乐播放", NotificationManager.IMPORTANCE_LOW));
        session = new MediaSession(this, "Mineradio");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MineradioApp.app.action("play", 0); }
            @Override public void onPause() { MineradioApp.app.action("pause", 0); }
            @Override public void onSkipToNext() { MineradioApp.app.action("next", 0); }
            @Override public void onSkipToPrevious() { MineradioApp.app.action("previous", 0); }
            @Override public void onSeekTo(long position) { MineradioApp.app.action("seek", position / 1000); }
        });
        // Chromium already owns the audio element's AudioFocusRequest. A second
        // request from this service makes Chromium lose focus and pause itself.
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    }
    private final BroadcastReceiver noisy = new BroadcastReceiver() { public void onReceive(Context context, Intent intent) { MineradioApp.app.action("pause", 0); } };
    void update(JSONObject state) {
        boolean now = state.optBoolean("playing");
        boolean changed = now != playing || !title.equals(state.optString("title")) || !artist.equals(state.optString("artist"));
        playing = now; title = state.optString("title", "Mineradio"); artist = state.optString("artist", "");
        duration = (long)(state.optDouble("duration") * 1000);
        String nextArt = state.optString("artwork");
        if (!nextArt.equals(artworkKey)) {
            artworkKey = nextArt; artwork = null; changed = true;
            if (nextArt.startsWith("data:image/jpeg;base64,") && nextArt.length() < 2 * 1024 * 1024) images.execute(() -> {
                Bitmap decoded = null;
                try {
                    byte[] bytes = Base64.decode(nextArt.substring(nextArt.indexOf(',') + 1), Base64.DEFAULT);
                    BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                    if (options.outWidth > 0 && options.outWidth <= 512 && options.outHeight > 0 && options.outHeight <= 512) {
                        options.inJustDecodeBounds = false; decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                    }
                } catch (Exception ignored) {}
                final Bitmap result = decoded;
                MineradioApp.app.main.post(() -> {
                    if (instance != this || !artworkKey.equals(nextArt)) return;
                    artwork = result; publishMetadata();
                    if (foreground) getSystemService(NotificationManager.class).notify(1, notification());
                });
            });
        }
        session.setActive(foreground || playing);
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions).setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, (long) (state.optDouble("position") * 1000), playing ? 1 : 0).build());
        publishMetadata();
        if (!foreground && playing) { startForeground(1, notification()); foreground = true; }
        else if (foreground && changed) getSystemService(NotificationManager.class).notify(1, notification());
    }
    private void publishMetadata() {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist).putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (artwork != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork).putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
        session.setMetadata(metadata.build());
    }
    boolean hasArtwork() { return artwork != null; }
    private PendingIntent control(String action) {
        return PendingIntent.getService(this, action.hashCode(), new Intent(this, PlayerService.class).setAction(action), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, "playback").setSmallIcon(dev.mineradio.android.R.drawable.ic_app).setContentTitle(title).setContentText(artist)
            .setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setLargeIcon(artwork)
            .addAction(new Notification.Action.Builder(null, "上一首", control("previous")).build())
            .addAction(new Notification.Action.Builder(null, playing ? "暂停" : "播放", control(playing ? "pause" : "play")).build())
            .addAction(new Notification.Action.Builder(null, "下一首", control("next")).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && intent.hasExtra("playback")) {
            try { update(new JSONObject(intent.getStringExtra("playback"))); } catch (Exception ignored) {}
        }
        if (intent != null && intent.getAction() != null) MineradioApp.app.action(intent.getAction(), 0);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() { instance = null; images.shutdownNow(); unregisterReceiver(noisy); session.release(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
