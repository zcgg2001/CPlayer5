package tech.zc505.cplayer;

import java.io.File;
import java.io.FileInputStream;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Pure policy used by both the downloader and local unit tests. */
final class UpdatePolicy {
  static final long MAX_APK = 128L * 1024 * 1024;
  static final String API = "https://api.github.com/repos/zcgg2001/CPlayer5/releases";
  private static final Pattern APK = Pattern.compile("^https://github\\.com/zcgg2001/CPlayer5/releases/download/[^/?#]+/(?:ZPlayer|CPlayer5)-android-preview-([1-9]\\d*)\\.apk$");
  static final String[] IDS = {"mirror1", "mirror2", "direct"};
  static final String[] PREFIXES = {"https://gh-proxy.com/", "https://gh-proxy.org/", ""};
  static final String[] LABELS = {"gh-proxy.com", "gh-proxy.org", "GitHub"};

  static String feed(int page) {
    if (page < 1 || page > 20) throw new IllegalArgumentException("更新列表页数无效");
    return API + "?per_page=100&page=" + page;
  }

  static void release(String url, long code, long installed, long size, String digest) {
    Matcher match = APK.matcher(url);
    if (!match.matches() || !safe(url) || code <= installed || code > 2100000000
        || !match.group(1).equals(Long.toString(code)) || size < 1 || size > MAX_APK
        || !digest.matches("[a-fA-F0-9]{64}")) throw new IllegalArgumentException("更新信息无效，请重新检查更新");
  }

  static List<Integer> routes(String source) {
    if ("direct".equals(source)) return Arrays.asList(2);
    return "mirror2".equals(source) ? Arrays.asList(1, 0, 2) : Arrays.asList(0, 1, 2);
  }

  static boolean safe(String value) {
    try {
      URI uri = URI.create(value);
      return "https".equals(uri.getScheme()) && uri.getRawUserInfo() == null && uri.getRawFragment() == null
          && (uri.getPort() == -1 || uri.getPort() == 443)
          && Arrays.asList("gh-proxy.com", "gh-proxy.org", "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com").contains(uri.getHost());
    } catch (Exception ignored) { return false; }
  }

  static String sha256(byte[] bytes) throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }

  static String sha256(File file) throws Exception {
    MessageDigest hash = MessageDigest.getInstance("SHA-256");
    try (FileInputStream input = new FileInputStream(file)) {
      byte[] buffer = new byte[65536]; int count;
      while ((count = input.read(buffer)) != -1) hash.update(buffer, 0, count);
    }
    return hex(hash.digest());
  }

  private static String hex(byte[] bytes) {
    StringBuilder out = new StringBuilder();
    for (byte b : bytes) out.append(String.format("%02x", b & 255));
    return out.toString();
  }

  static void identity(String installedPackage, String archivePackage, long installedCode, long archiveCode,
      long expectedCode, Set<String> installedSigners, Set<String> archiveSigners) {
    if (!installedPackage.equals(archivePackage) || archiveCode != expectedCode || archiveCode <= installedCode
        || installedSigners.isEmpty() || !installedSigners.equals(archiveSigners))
      throw new IllegalArgumentException("安装包的包名、版本或签名不匹配，已停止更新");
  }
}
