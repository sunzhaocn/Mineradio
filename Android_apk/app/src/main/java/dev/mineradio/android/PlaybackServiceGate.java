package dev.mineradio.android;

/** Coalesces asynchronous foreground-service starts and bounds failed retries. */
final class PlaybackServiceGate {
    private static final long RETRY_MILLIS = 5000;
    private long requestedAt = -1;

    boolean shouldStart(boolean playing, boolean running, long now) {
        if (running || !playing) return false;
        if (requestedAt >= 0 && now - requestedAt < RETRY_MILLIS) return false;
        requestedAt = now;
        return true;
    }

    void created() { requestedAt = -1; }
    void failed(long now) { requestedAt = now; }
}
