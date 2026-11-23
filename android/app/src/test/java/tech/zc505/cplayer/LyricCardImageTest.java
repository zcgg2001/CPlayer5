package tech.zc505.cplayer;

import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.util.Base64;
import org.junit.Test;

public class LyricCardImageTest {
  private byte[] header(int width, int height) {
    ByteBuffer data = ByteBuffer.allocate(33);
    data.put(new byte[] {(byte)137, 80, 78, 71, 13, 10, 26, 10});
    data.putInt(13).putInt(0x49484452).putInt(width).putInt(height);
    return data.array();
  }
  private String encoded(byte[] data) { return "data:image/png;base64," + Base64.getEncoder().encodeToString(data); }

  @Test public void permitsPortraitCardButRejectsOtherFormatsAndUnboundedImages() {
    assertArrayEquals(header(1080, 1920), LyricCardImage.decode(encoded(header(1080, 1920))));
    for (String invalid : new String[] { "file:///private.png", "data:image/svg+xml,<svg/>", "data:image/png;base64,???", encoded(header(4000, 4000)), encoded(header(-1, 20)), encoded(new byte[33]), encoded(new byte[LyricCardImage.MAX_BYTES + 1]) })
      assertThrows(IllegalArgumentException.class, () -> LyricCardImage.decode(invalid));
  }
  @Test public void usesSafeNamesWithoutPathsAndAlwaysPng() {
    assertEquals("歌词卡片.png", LyricCardImage.fileName(".."));
    assertEquals("晴天-歌词卡片.png", LyricCardImage.fileName("晴天-歌词卡片.png"));
    assertFalse(LyricCardImage.fileName("../../a\nb.png").contains("/"));
    assertFalse(LyricCardImage.fileName("..\\a.png").contains("\\"));
    assertTrue(LyricCardImage.fileName("a".repeat(400)).length() <= 74);
  }
}
