package dev.mineradio.android;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

public final class UpdateTransferCheck {
    static int checks;
    interface Action { void run() throws Exception; }
    static void check(boolean value) { checks++; if (!value) throw new AssertionError("Check " + checks); }
    static void rejected(Action action) throws Exception {
        try { action.run(); throw new AssertionError("Accepted invalid input"); }
        catch (IOException expected) { checks++; }
    }
    public static void main(String[] args) throws Exception {
        check(UpdatePolicy.versionCode("1.1.12") == 10112);
        check(UpdatePolicy.versionCode("1.1.11") < UpdatePolicy.versionCode("1.1.12"));
        check(UpdatePolicy.versionCode("2.0.0") > UpdatePolicy.versionCode("1.99.99"));
        check(UpdatePolicy.versionCode("1.1.9999999999999999999999999") == -1);
        check(UpdatePolicy.apkVersion("Mineradio-1.1.12-release-arm64.apk").equals("1.1.12"));
        check(UpdatePolicy.apkVersion("Mineradio-2.3.15-Setup-x64.exe") == null);
        check(UpdatePolicy.apkVersion("Mineradio-1.1.12-debug-arm64.apk") == null);
        String name = "Mineradio-1.1.12-release-arm64.apk";
        String url = "https://github.com/sunzhaocn/Mineradio/releases/download/v2.3.15/" + name;
        UpdatePolicy.validateAsset(url, name, 100);
        UpdatePolicy.validateUrl("https://release-assets.githubusercontent.com/a?signature=x", false);
        for (String bad : new String[]{"http://github.com/sunzhaocn/Mineradio/releases/download/v1/a",
                "https://github.com.evil.test/sunzhaocn/Mineradio/releases/download/v1/a",
                "https://github.com/other/project/releases/download/v1/a", "https://evil.test/a",
                "https://user@github.com/sunzhaocn/Mineradio/releases/download/v1/a",
                "https://github.com:443/sunzhaocn/Mineradio/releases/download/v1/a",
                "https://github.com/sunzhaocn/Mineradio/releases/download/v1/a#fragment"})
            rejected(() -> UpdatePolicy.validateUrl(bad, false));
        rejected(() -> UpdatePolicy.validateUrl("https://release-assets.githubusercontent.com/a", true));
        rejected(() -> UpdatePolicy.validateAsset(url, "other.apk", 100));
        rejected(() -> UpdatePolicy.validateAsset(url, name, 0));
        rejected(() -> UpdatePolicy.validateAsset(url, name, UpdatePolicy.MAX_APK_BYTES + 1));
        rejected(() -> UpdatePolicy.validateAsset(url.replace(name, "other.apk"), name, 100));
        rejected(() -> UpdatePolicy.sha256("sha1:abc"));
        rejected(() -> UpdatePolicy.sha256(""));
        Set<String> signed = Collections.singleton("original-certificate");
        UpdatePolicy.validatePackage("dev.mineradio.android", "dev.mineradio.android", "1.1.12", "1.1.12", 10112, 10111, signed, signed);
        rejected(() -> UpdatePolicy.validatePackage("dev.mineradio.android", "other.app", "1.1.12", "1.1.12", 10112, 10111, signed, signed));
        rejected(() -> UpdatePolicy.validatePackage("dev.mineradio.android", "dev.mineradio.android", "1.1.12", "1.1.13", 10112, 10111, signed, signed));
        rejected(() -> UpdatePolicy.validatePackage("dev.mineradio.android", "dev.mineradio.android", "1.1.12", "1.1.12", 10112, 10112, signed, signed));
        rejected(() -> UpdatePolicy.validatePackage("dev.mineradio.android", "dev.mineradio.android", "1.1.12", "1.1.12", 10113, 10111, signed, signed));
        rejected(() -> UpdatePolicy.validatePackage("dev.mineradio.android", "dev.mineradio.android", "1.1.12", "1.1.12", 10112, 10111, Collections.emptySet(), signed));
        rejected(() -> UpdatePolicy.validatePackage("dev.mineradio.android", "dev.mineradio.android", "1.1.12", "1.1.12", 10112, 10111, Collections.singleton("other-certificate"), signed));
        byte[] bytes = new byte[160000]; new Random(42).nextBytes(bytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) hex.append(String.format("%02x", b & 255));
        String hash = UpdatePolicy.sha256("sha256:" + hex);
        Path folder = Files.createTempDirectory("mr-update-check-");
        File partial = folder.resolve("update.part").toFile(), ready = folder.resolve("update.apk").toFile();
        try {
            List<Long> progress = new ArrayList<>();
            UpdateTransfer.copyVerified(new ByteArrayInputStream(bytes), partial, ready, bytes.length, hash,
                (count, total) -> { check(total == bytes.length); progress.add(count); });
            check(ready.length() == bytes.length && !partial.exists());
            check(progress.size() >= 3 && progress.get(progress.size() - 1) == bytes.length);
            for (int i = 1; i < progress.size(); i++) check(progress.get(i) > progress.get(i - 1));
            check(Arrays.equals(Files.readAllBytes(ready.toPath()), bytes));
            rejected(() -> UpdateTransfer.copyVerified(new ByteArrayInputStream(bytes), partial, ready, bytes.length, "bad", (a,b)->{}));
            check(!partial.exists() && ready.length() == bytes.length);
            rejected(() -> UpdateTransfer.copyVerified(new ByteArrayInputStream(bytes), partial, ready, bytes.length + 1, hash, (a,b)->{}));
            check(!partial.exists());
            rejected(() -> UpdateTransfer.copyVerified(new ByteArrayInputStream(bytes), partial, ready, bytes.length - 1, hash, (a,b)->{}));
            check(!partial.exists());
            rejected(() -> UpdateTransfer.copyVerified(new InputStream() { public int read() throws IOException {throw new IOException("interrupted");}},
                partial, ready, bytes.length, hash, (a,b)->{}));
            check(!partial.exists());
            if (args.length == 4) {
                UpdatePolicy.validateAsset(args[0], new java.net.URI(args[0]).getPath().replaceAll(".*/", ""), Long.parseLong(args[2]));
                javax.net.ssl.HttpsURLConnection connection = UpdateTransfer.open(args[0], false);
                try (InputStream in = connection.getInputStream()) {
                    UpdateTransfer.copyVerified(in, partial, ready, Long.parseLong(args[2]), UpdatePolicy.sha256("sha256:" + args[1]), (a,b)->{});
                } finally { connection.disconnect(); }
                Files.copy(ready.toPath(), Paths.get(args[3]), StandardCopyOption.REPLACE_EXISTING);
                check(ready.length() == Long.parseLong(args[2]));
                System.out.println("Live GitHub HTTPS APK transfer and SHA-256 verification passed");
            }
        } finally { partial.delete(); ready.delete(); Files.delete(folder); }
        System.out.println(checks + " updater checks passed");
    }
}
