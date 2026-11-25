package tech.zc505.cplayer;

import static org.junit.Assert.*;
import java.net.URLEncoder;
import org.junit.Test;

public class CoverCachePolicyTest {
  @Test public void onlyUnsignedPublicCdnImagesUseTheDiskCache() {
    assertTrue(CoverCachePolicy.allowed("https://p1.music.126.net/a.jpg?param=300y300"));
    assertTrue(CoverCachePolicy.allowed("https://y.gtimg.cn/music/photo_new/a.jpg"));
    for (String value : new String[]{"http://p1.music.126.net/a.jpg", "https://user@p1.music.126.net/a",
        "https://127.0.0.1/a", "https://gtimg.cn.evil.test/a", "https://p1.music.126.net:444/a",
        "https://p1.music.126.net/a?token=secret", "https://p1.music.126.net/a#x", "file:///a"}) {
      assertFalse(value, CoverCachePolicy.allowed(value));
    }
  }

  @Test public void interceptionRequiresTheTrustedCoverRouteOrUnsignedPublicCdn() throws Exception {
    String target = "https://p1.music.126.net/a.jpg?param=300y300";
    String route = BuildConfig.PLAYER_ORIGIN + "/api/cover?url=" + URLEncoder.encode(target, "UTF-8");
    assertEquals(target, CoverCachePolicy.target(route));
    assertEquals(target, CoverCachePolicy.target(target));
    assertNull(CoverCachePolicy.target("https://p1.music.126.net/a.jpg?token=secret"));
    assertNull(CoverCachePolicy.target(route.replace("/api/cover", "/api/account")));
    assertNull(CoverCachePolicy.target(route.replace(BuildConfig.PLAYER_ORIGIN, "https://other.test")));
    assertNull(CoverCachePolicy.target(route + "&token=secret"));
  }

  @Test public void cacheAcceptsImagesAndRejectsErrorPages() {
    assertEquals("image/jpeg", CoverCachePolicy.imageType("image/jpg; charset=utf-8"));
    assertEquals("image/webp", CoverCachePolicy.imageType("image/webp"));
    assertEquals("image/png", CoverCachePolicy.imageType("image/x-png"));
    assertNull(CoverCachePolicy.imageType("text/html"));
    assertNull(CoverCachePolicy.imageType("image/svg+xml"));
  }
}
