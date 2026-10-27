package dev.mineradio.android;

import java.io.IOException;
import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Release names use the Android version, independently of the Windows tag. */
final class UpdatePolicy {
    static final long MAX_APK_BYTES = 512L * 1024 * 1024;
    static final String RELEASE_API = "https://api.github.com/repos/sunzhaocn/Mineradio/releases/latest";
    static final String DOWNLOAD_PATH = "/sunzhaocn/Mineradio/releases/download/";
    private static final Pattern APK = Pattern.compile("Mineradio-([0-9]+\\.[0-9]+\\.[0-9]+)-release-arm64\\.apk");

    static String apkVersion(String name) {
        Matcher match = APK.matcher(name);
        return match.matches() ? match.group(1) : null;
    }

    static int versionCode(String version) {
        if (version == null || !version.matches("[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,2}")) return -1;
        String[] parts = version.split("\\.");
        return Integer.parseInt(parts[0]) * 10000 + Integer.parseInt(parts[1]) * 100 + Integer.parseInt(parts[2]);
    }

    static String sha256(String value) throws IOException {
        if (value == null || !value.matches("sha256:[a-fA-F0-9]{64}"))
            throw new IOException("发布文件缺少有效的 SHA-256 校验信息");
        return value.substring(7).toLowerCase(java.util.Locale.ROOT);
    }

    static void validateUrl(String value, boolean initial) throws IOException {
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getFragment() != null
                    || uri.getPort() != -1) throw new IOException("更新地址无效");
            String host = uri.getHost(), path = uri.getPath();
            boolean github = "github.com".equals(host) && path.startsWith(DOWNLOAD_PATH);
            boolean cdn = "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host);
            if (!(github || !initial && cdn)) throw new IOException("更新文件来源无效");
        } catch (java.net.URISyntaxException error) { throw new IOException("更新地址无效"); }
    }

    static void validateAsset(String url, String name, long size) throws IOException {
        validateUrl(url, true);
        String path = URI.create(url).getPath();
        String remaining = path.substring(DOWNLOAD_PATH.length());
        if (apkVersion(name) == null || versionCode(apkVersion(name)) < 0 || size <= 0 || size > MAX_APK_BYTES
                || !remaining.matches("[^/]+/" + Pattern.quote(name)))
            throw new IOException("发布安装包的信息无效");
    }

    static void validatePackage(String expectedId, String archiveId, String expectedVersion, String archiveVersion,
                                long archiveCode, long installedCode, java.util.Set<String> archiveSigners,
                                java.util.Set<String> installedSigners) throws IOException {
        if (!expectedId.equals(archiveId) || !expectedVersion.equals(archiveVersion)
                || archiveCode != versionCode(expectedVersion) || archiveCode <= installedCode
                || archiveSigners.isEmpty() || !archiveSigners.equals(installedSigners))
            throw new IOException("安装包的应用、版本或签名不匹配，已停止安装");
    }
}
