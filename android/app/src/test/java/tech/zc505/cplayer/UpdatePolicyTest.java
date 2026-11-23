package tech.zc505.cplayer;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Collections;

public class UpdatePolicyTest {
  private final String url = "https://github.com/zcgg2001/CPlayer5/releases/download/v1.13.0/ZPlayer-android-preview-17.apk";
  private final String digest = String.join("", Collections.nCopies(64, "a"));

  @Test public void onlyNewerReleaseApksWithChecksumsAreAccepted() {
    UpdatePolicy.release(url,17,16,6400000,digest);
    for (String invalid : Arrays.asList(url.replace("zcgg2001","other"), url+"?token=private",url+".zip",url.replace("https:","http:")))
      assertThrows(IllegalArgumentException.class,()->UpdatePolicy.release(invalid,17,16,100,digest));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.release(url,17,17,100,digest));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.release(url,18,16,100,digest));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.release(url,17,16,UpdatePolicy.MAX_APK+1,digest));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.release(url,17,16,100,"bad"));
  }
  @Test public void mirrorsFailOverButExplicitDirectStaysDirect() {
    assertEquals(Arrays.asList(0,1,2),UpdatePolicy.routes("auto"));
    assertEquals(Arrays.asList(1,0,2),UpdatePolicy.routes("mirror2"));
    assertEquals(Arrays.asList(2),UpdatePolicy.routes("direct"));
    assertTrue(UpdatePolicy.safe("https://release-assets.githubusercontent.com/a?signature=x"));
    for(String value:Arrays.asList("http://github.com/a","https://127.0.0.1/a","https://github.com.evil.test/a","https://user:pass@github.com/a","https://github.com:8443/a"))assertFalse(UpdatePolicy.safe(value));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.feed(21));
  }
  @Test public void apkIdentityRejectsWrongPackageVersionOrSigner() {
    java.util.Set<String> signer=Collections.singleton("trusted");
    UpdatePolicy.identity("app","app",16,17,17,signer,signer);
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.identity("app","other",16,17,17,signer,signer));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.identity("app","app",16,18,17,signer,signer));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.identity("app","app",16,17,17,signer,Collections.singleton("foreign")));
    assertThrows(IllegalArgumentException.class,()->UpdatePolicy.identity("app","app",16,17,17,signer,new HashSet<>(Arrays.asList("trusted","foreign"))));
  }
  @Test public void checksumMatchesKnownSha256() throws Exception {
    assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",UpdatePolicy.sha256("abc".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }
}
