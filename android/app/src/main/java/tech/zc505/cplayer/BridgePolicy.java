package tech.zc505.cplayer;

import java.net.URI;

// Pure Java policy shared by navigation, bridge checks and unit tests.
final class BridgePolicy {
  static boolean trusted(String value) {
    try {
      URI url = URI.create(value), origin = URI.create(BuildConfig.PLAYER_ORIGIN);
      return "https".equals(url.getScheme())
          && origin.getHost().equals(url.getHost())
          && url.getUserInfo() == null
          && (url.getPort() == -1 || url.getPort() == 443);
    } catch (Exception ignored) {
      return false;
    }
  }

  static boolean audio(String value) {
    try {
      URI url = URI.create(value);
      String host = url.getHost();
      return "https".equals(url.getScheme())
          && host != null
          && host.contains(".")
          && url.getUserInfo() == null
          && (url.getPort() == -1 || url.getPort() == 443)
          && !host.matches("[0-9.]+")
          && !host.endsWith(".localhost")
          && !host.endsWith(".local");
    } catch (Exception ignored) {
      return false;
    }
  }
}
