package dev.mineradio.android;

import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import javax.net.ssl.HttpsURLConnection;

/** Bounded streaming, checksum validation and a final rename; partial APKs never install. */
final class UpdateTransfer {
    interface Progress { void accept(long bytes, long total); }

    static HttpsURLConnection open(String value, boolean api) throws IOException {
        for (int redirects = 0; redirects < 6; redirects++) {
            if (api) {
                if (!UpdatePolicy.RELEASE_API.equals(value)) throw new IOException("更新信息来源无效");
            } else UpdatePolicy.validateUrl(value, redirects == 0);
            HttpsURLConnection connection = (HttpsURLConnection) new URL(value).openConnection();
            connection.setConnectTimeout(20000); connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "Mineradio-Android-Updater");
            connection.setRequestProperty("Accept", api ? "application/vnd.github+json" : "application/octet-stream");
            connection.setRequestProperty("Accept-Encoding", "identity");
            int code;
            try { code = connection.getResponseCode(); }
            catch (IOException error) { connection.disconnect(); throw error; }
            if (code == 200) return connection;
            String next = connection.getHeaderField("Location");
            connection.disconnect();
            if (!api && (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && next != null) {
                value = new URL(new URL(value), next).toString();
                continue;
            }
            throw new IOException(code == 403 || code == 429 ? "GitHub 请求过于频繁，请稍后重试" : "更新服务暂不可用（HTTP " + code + "）");
        }
        throw new IOException("更新下载重定向次数过多");
    }

    static String readRelease() throws IOException {
        HttpsURLConnection connection = open(UpdatePolicy.RELEASE_API, true);
        try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) {
                if (out.size() + count > 2 * 1024 * 1024) throw new IOException("更新信息过大");
                out.write(buffer, 0, count);
            }
            return out.toString("UTF-8");
        } finally { connection.disconnect(); }
    }

    static void copyVerified(InputStream in, File partial, File ready, long total, String expected, Progress progress) throws Exception {
        if (total <= 0 || total > UpdatePolicy.MAX_APK_BYTES) throw new IOException("安装包大小无效");
        boolean complete = false;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long bytes = 0;
            try (FileOutputStream out = new FileOutputStream(partial)) {
                byte[] buffer = new byte[65536]; int count;
                while ((count = in.read(buffer)) != -1) {
                    bytes += count;
                    if (bytes > total) throw new IOException("下载文件大小不符，请重试");
                    digest.update(buffer, 0, count); out.write(buffer, 0, count);
                    progress.accept(bytes, total);
                }
                out.getFD().sync();
            }
            StringBuilder actual = new StringBuilder();
            for (byte b : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            if (bytes != total || !actual.toString().equals(expected)) throw new IOException("安装包校验失败，请重新下载");
            if (ready.exists() && !ready.delete() || !partial.renameTo(ready)) throw new IOException("无法保存更新安装包");
            complete = true;
        } finally { if (!complete) partial.delete(); }
    }
}
