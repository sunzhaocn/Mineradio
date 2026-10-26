package dev.mineradio.android;

import android.media.*;
import java.nio.ByteBuffer;

/** Rebuild a local MP4 audio container using Android codecs, without an executable. */
public final class AudioRemuxer {
    public static String remux(String source, String destination) throws Exception {
        MediaExtractor extractor = new MediaExtractor(); MediaMuxer muxer = null;
        try {
            extractor.setDataSource(source);
            int selected = -1; MediaFormat original = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat candidate = extractor.getTrackFormat(i);
                if (candidate.getString(MediaFormat.KEY_MIME).startsWith("audio/")) { selected = i; original = candidate; break; }
            }
            if (selected < 0) throw new IllegalArgumentException("No audio track");
            MediaFormat clean = MediaFormat.createAudioFormat(original.getString(MediaFormat.KEY_MIME), original.getInteger(MediaFormat.KEY_SAMPLE_RATE), original.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
            for (String key : new String[]{"csd-0", "csd-1", "csd-2"}) if (original.containsKey(key)) clean.setByteBuffer(key, original.getByteBuffer(key));
            if (original.containsKey(MediaFormat.KEY_AAC_PROFILE)) clean.setInteger(MediaFormat.KEY_AAC_PROFILE, original.getInteger(MediaFormat.KEY_AAC_PROFILE));
            muxer = new MediaMuxer(destination, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int outputTrack = muxer.addTrack(clean); muxer.start(); extractor.selectTrack(selected);
            ByteBuffer bytes = ByteBuffer.allocateDirect(4 * 1024 * 1024); MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (true) {
                bytes.clear(); int size = extractor.readSampleData(bytes, 0); if (size < 0) break;
                info.set(0, size, extractor.getSampleTime(), extractor.getSampleFlags() & MediaCodec.BUFFER_FLAG_KEY_FRAME);
                muxer.writeSampleData(outputTrack, bytes, info); extractor.advance();
            }
            muxer.stop(); return "m4a";
        } finally { extractor.release(); if (muxer != null) muxer.release(); }
    }
}
