package tech.zc505.cplayer;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** Only public image CDN URLs can bypass the site's cover proxy. */
final class CoverCachePolicy {
  static boolean allowed(String value) {
    try {
      URI url = URI.create(value);
      String host = url.getHost();
      if (!"https".equals(url.getScheme()) || host == null || url.getUserInfo() != null
          || url.getPort() != -1 || url.getFragment() != null || value.length() > 2048) return false;
      // Signed/private references keep the original transport and are not persisted here.
      if (url.getRawQuery() != null && !url.getRawQuery().matches("param=\\d{2,4}y\\d{2,4}")) return false;
      for (String domain : new String[]{"music.126.net", "gtimg.cn", "qpic.cn", "kugou.com",
          "kgimg.com", "kuwo.cn", "hdslb.com", "mzstatic.com"}) {
        if (host.equals(domain) || host.endsWith("." + domain)) return true;
      }
    } catch (Exception ignored) { }
    return false;
  }

  static String target(String request) {
    try {
      URI uri = URI.create(request);
      if (!BridgePolicy.trusted(request) || !"/api/cover".equals(uri.getPath())) return null;
      String query = uri.getRawQuery();
      if (query == null || !query.startsWith("url=") || query.contains("&")) return null;
      String target = URLDecoder.decode(query.substring(4), StandardCharsets.UTF_8.name());
      return allowed(target) ? target : null;
    } catch (Exception ignored) { return null; }
  }

  static String imageType(String value) {
    if (value == null) return null;
    String type = value.split(";", 2)[0].trim().toLowerCase(java.util.Locale.ROOT);
    if (type.equals("image/jpg") || type.equals("image/pjpeg")) type = "image/jpeg";
    return type.matches("image/(jpeg|png|webp|avif|gif)") ? type : null;
  }
}
