package tech.zc505.cplayer;

import static org.junit.Assert.*;

import org.junit.Test;

public class BridgePolicyTest {
  @Test
  public void bridgeRequiresExactHttpsOrigin() {
    assertTrue(BridgePolicy.trusted("https://music.505zc.tech/?app=android"));
    for (String url :
        new String[] {
          "https://music.505zc.tech.evil.test",
          "http://music.505zc.tech",
          "https://user@music.505zc.tech",
          "https://music.505zc.tech:444",
          "file:///index.html",
          "javascript:alert(1)"
        }) assertFalse(url, BridgePolicy.trusted(url));
  }

  @Test
  public void playbackRejectsLocalAndActiveContent() {
    assertTrue(BridgePolicy.audio("https://cdn.music.126.net/song.flac"));
    for (String url :
        new String[] {
          "https://127.0.0.1/x",
          "https://router.local/x",
          "file:///etc/passwd",
          "http://music.test/a",
          "javascript:alert(1)",
          "https://user:pass@media.test/x"
        }) assertFalse(url, BridgePolicy.audio(url));
  }
}
