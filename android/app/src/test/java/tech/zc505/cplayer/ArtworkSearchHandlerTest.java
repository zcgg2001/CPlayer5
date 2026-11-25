package tech.zc505.cplayer;

import static org.junit.Assert.*;
import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class ArtworkSearchHandlerTest {
  private MockWebServer server;
  private ArtworkSearchHandler handler;
  private static final String ROUTE = BuildConfig.PLAYER_ORIGIN + "/android-player/artwork-search?term=Song+Artist";

  @Before public void setup() throws Exception {
    server = new MockWebServer(); server.start();
    handler = new ArtworkSearchHandler(new OkHttpClient.Builder().addInterceptor(chain -> {
      assertEquals("itunes.apple.com", chain.request().url().host());
      return chain.proceed(chain.request().newBuilder().url(server.url(chain.request().url().encodedPath() + "?" + chain.request().url().encodedQuery())).build());
    }));
  }
  @After public void close() throws Exception { server.shutdown(); }

  @Test public void fixedPublicSearchDoesNotSendCredentials() throws Exception {
    server.enqueue(new MockResponse().setHeader("Content-Type", "text/javascript; charset=utf-8").setBody("{\"results\":[]}"));
    assertEquals("{\"results\":[]}", handler.read(ROUTE));
    RecordedRequest request = server.takeRequest();
    assertEquals("Song Artist", request.getRequestUrl().queryParameter("term"));
    assertEquals("song", request.getRequestUrl().queryParameter("entity"));
    assertEquals("hk", request.getRequestUrl().queryParameter("country"));
    assertEquals("30", request.getRequestUrl().queryParameter("limit"));
    assertNull(request.getHeader("Cookie")); assertNull(request.getHeader("Authorization"));
  }

  @Test public void rejectsUnknownRoutesRedirectsAndOversizedResponses() throws Exception {
    assertThrows(IOException.class, () -> handler.read(ROUTE + "&url=https://other.test"));
    assertThrows(IOException.class, () -> handler.read(ROUTE.replace(BuildConfig.PLAYER_ORIGIN, "https://other.test")));
    assertThrows(IOException.class, () -> handler.read(ROUTE.replace("Song+Artist", "%0A")));
    assertEquals(0, server.getRequestCount());
    server.enqueue(new MockResponse().setResponseCode(302).setHeader("Location", "https://other.test"));
    assertThrows(IOException.class, () -> handler.read(ROUTE));
    server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody(" ".repeat(512 * 1024 + 1)));
    assertThrows(IOException.class, () -> handler.read(ROUTE));
    server.enqueue(new MockResponse().setHeader("Content-Type", "text/html").setBody("<html>error</html>"));
    assertThrows(IOException.class, () -> handler.read(ROUTE));
    assertEquals(3, server.getRequestCount());
  }
}
