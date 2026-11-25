package tech.zc505.cplayer;

import static org.junit.Assert.*;
import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class OnlineLyricsHandlerTest {
  private MockWebServer server;
  private OnlineLyricsHandler handler;
  private static final String MID = "0039MnYb0qxYhV";
  private static final String HASH = "0123456789abcdef0123456789abcdef";
  private String route(String provider, String id) {
    return BuildConfig.PLAYER_ORIGIN + "/android-player/online-lyrics?provider=" + provider + "&id=" + id;
  }
  @Before public void setup() throws Exception {
    server = new MockWebServer(); server.start();
    handler = new OnlineLyricsHandler(new OkHttpClient.Builder().addInterceptor(chain -> {
      String host = chain.request().url().host();
      assertTrue(host.equals("c.y.qq.com") || host.equals("u.y.qq.com") || host.equals("lyrics.kugou.com"));
      assertTrue(chain.request().url().isHttps());
      assertNull(chain.request().header("Cookie")); assertNull(chain.request().header("Authorization"));
      return chain.proceed(chain.request().newBuilder().url(server.url(chain.request().url().encodedPath()
          + (chain.request().url().encodedQuery() == null ? "" : "?" + chain.request().url().encodedQuery()))).build());
    }));
  }
  @After public void close() throws Exception { server.shutdown(); }
  private void enqueue(String json) { server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody(json)); }
  private String qqResult(int id) { return "{\"code\":0,\"request\":{\"code\":0,\"data\":{\"songID\":" + id + ",\"lyric\":\"0123456789abcdef\",\"trans\":\"translation\",\"roma\":\"roma\"}}}"; }

  @Test public void qqResolvesExactMidAndPreservesAllLayers() throws Exception {
    enqueue("{\"code\":0,\"data\":[{\"mid\":\"004Fs2FP1EvZYc\",\"id\":1},{\"mid\":\"" + MID + "\",\"id\":97773}]}");
    enqueue(qqResult(97773));
    JSONObject result = new JSONObject(handler.read(route("qq", MID)));
    assertEquals(MID, result.getString("id")); assertEquals("qrc-hex", result.getString("encoding"));
    assertEquals("translation", result.getString("translation")); assertEquals("roma", result.getString("romanization"));
    assertEquals(MID, server.takeRequest().getRequestUrl().queryParameter("songmid"));
    RecordedRequest lyric = server.takeRequest(); assertEquals("POST", lyric.getMethod());
    JSONObject params = new JSONObject(lyric.getBody().readUtf8()).getJSONObject("request").getJSONObject("param");
    assertEquals(97773, params.getInt("songID")); assertEquals(1, params.getInt("qrc"));
  }

  @Test public void rejectsMismatchedQqDetailAndLyricIds() throws Exception {
    enqueue("{\"code\":0,\"data\":[{\"mid\":\"004Fs2FP1EvZYc\",\"id\":97773}]}");
    assertThrows(IOException.class, () -> handler.read(route("qq", MID)));
    assertEquals(1, server.getRequestCount());
    enqueue(qqResult(2)); assertThrows(IOException.class, () -> handler.read(route("qq", "97773")));
  }

  @Test public void kugouUsesHashAndOfficialProposalThenRequestsKrc() throws Exception {
    enqueue("{\"status\":200,\"proposal\":\"22\",\"candidates\":[{\"id\":\"11\",\"accesskey\":\"wrong\"},{\"id\":\"22\",\"accesskey\":\"publicKey\"}]}");
    enqueue("{\"status\":200,\"id\":\"22\",\"fmt\":\"krc\",\"content\":\"a3JjMQ==\"}");
    JSONObject result = new JSONObject(handler.read(route("kugou", HASH)));
    assertEquals("krc-base64", result.getString("encoding"));
    RecordedRequest search = server.takeRequest(), download = server.takeRequest();
    assertEquals(HASH, search.getRequestUrl().queryParameter("hash"));
    assertEquals("", search.getRequestUrl().queryParameter("keyword"));
    assertEquals("22", download.getRequestUrl().queryParameter("id"));
    assertEquals("publicKey", download.getRequestUrl().queryParameter("accesskey"));
    assertEquals("krc", download.getRequestUrl().queryParameter("fmt"));
  }

  @Test public void kugouAcceptsRealLrcFallbackButRejectsAmbiguityAndWrongDownload() throws Exception {
    String search = "{\"status\":200,\"candidates\":[{\"id\":\"22\",\"accesskey\":\"key\"}]}";
    enqueue(search); enqueue("{\"status\":200,\"id\":\"22\",\"fmt\":\"lrc\",\"content\":\"eA==\"}");
    assertEquals("lrc-base64", new JSONObject(handler.read(route("kugou", HASH))).getString("encoding"));
    enqueue("{\"status\":200,\"candidates\":[{\"id\":\"11\"},{\"id\":\"22\"}]}");
    assertThrows(IOException.class, () -> handler.read(route("kugou", HASH)));
    enqueue(search); enqueue("{\"status\":200,\"id\":\"23\",\"fmt\":\"krc\",\"content\":\"eA==\"}");
    assertThrows(IOException.class, () -> handler.read(route("kugou", HASH)));
  }

  @Test public void validatesRoutesBeforeNetworkAndBoundsResponses() throws Exception {
    for (String value : new String[] { route("qq", "wrong"), route("qq", MID) + "&url=https://other.test",
        route("qq", MID).replace(BuildConfig.PLAYER_ORIGIN, "https://other.test"), route("kugou", MID), route("netease", "1") })
      assertThrows(IOException.class, () -> handler.read(value));
    assertEquals(0, server.getRequestCount());
    server.enqueue(new MockResponse().setResponseCode(302).setHeader("Location", "https://other.test"));
    assertThrows(IOException.class, () -> handler.read(route("qq", "97773")));
    enqueue(" ".repeat(512 * 1024 + 1));
    assertThrows(IOException.class, () -> handler.read(route("qq", "97773")));
    enqueue("<html>not JSON</html>");
    assertThrows(IOException.class, () -> handler.read(route("qq", "97773")));
    assertEquals(3, server.getRequestCount());
  }
}
