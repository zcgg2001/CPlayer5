package tech.zc505.cplayer;

import java.nio.ByteBuffer;
import java.util.Base64;

/** Bounded PNG-only input for the dedicated, origin-scoped sharing bridge. */
final class LyricCardImage {
  static final int MAX_BYTES = 3 * 1024 * 1024;
  static final int MAX_MESSAGE = MAX_BYTES * 4 / 3 + 2048;
  private static final String PREFIX = "data:image/png;base64,";

  static byte[] decode(String value) {
    if (value == null || !value.startsWith(PREFIX) || value.length() > MAX_MESSAGE - 1024)
      throw new IllegalArgumentException("卡片图片过大或格式不正确");
    byte[] png = Base64.getDecoder().decode(value.substring(PREFIX.length()));
    if (png.length < 33 || png.length > MAX_BYTES) throw new IllegalArgumentException("卡片图片大小不正确");
    byte[] signature = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
    for (int i = 0; i < signature.length; i++)
      if (png[i] != signature[i]) throw new IllegalArgumentException("仅支持 PNG 卡片");
    ByteBuffer header = ByteBuffer.wrap(png);
    if (header.getInt(8) != 13 || header.getInt(12) != 0x49484452)
      throw new IllegalArgumentException("PNG 图片头不正确");
    int width = header.getInt(16), height = header.getInt(20);
    if (width < 1 || height < 1 || width > 2160 || height > 2160 || (long) width * height > 3_000_000)
      throw new IllegalArgumentException("卡片尺寸不正确");
    return png;
  }

  static String fileName(String name) {
    String value = (name == null ? "歌词卡片" : name).replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]", "_").trim();
    value = value.replaceFirst("(?i)\\.png$", "");
    if (value.isEmpty() || value.matches("\\.+")) value = "歌词卡片";
    return value.substring(0, Math.min(value.length(), 70)) + ".png";
  }
}
