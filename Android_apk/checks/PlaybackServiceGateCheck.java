package dev.mineradio.android;

/** Runs without Android, accounts, emulator, or a test framework dependency. */
public final class PlaybackServiceGateCheck {
    private static void require(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] arguments) {
        PlaybackServiceGate gate = new PlaybackServiceGate();
        require(!gate.shouldStart(false, false, 0), "idle app must not create a service");
        require(gate.shouldStart(true, false, 100), "first playback starts immediately");
        require(!gate.shouldStart(true, false, 101), "coalesce callbacks before onCreate");
        require(!gate.shouldStart(true, false, 5099), "failed/pending starts are rate limited");
        require(gate.shouldStart(true, false, 5100), "a missed start can recover");
        gate.created();
        require(!gate.shouldStart(true, true, 5200), "running service does not start twice");
        require(gate.shouldStart(true, false, 5300), "reclaimed active service can be recreated");
        gate.failed(5400);
        require(!gate.shouldStart(true, false, 5500), "platform start failure cannot spin");
        require(!gate.shouldStart(false, false, 11000), "paused playback never restarts itself");
        require(gate.shouldStart(true, false, 11000), "a later explicit playback can retry");
        System.out.println("Playback service gate: 10 lifecycle checks passed");
    }
}
