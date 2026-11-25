package tech.zc505.cplayer;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okio.Buffer;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class CoverImageCacheTest {
  @Rule public TemporaryFolder files = new TemporaryFolder();
  private MockWebServer server;
  private CoverImageCache cache;
  private File directory;
  private final AtomicInteger calls = new AtomicInteger();
  private volatile int status = 200;
  private volatile String type = "image/png";
  private volatile String age = "0";
  private volatile byte[] body = new byte[]{1, 2, 3, 4};

  @Before public void setup() throws Exception {
    server = new MockWebServer();
    server.setDispatcher(new Dispatcher() {
      @Override public MockResponse dispatch(RecordedRequest request) {
        calls.incrementAndGet();
        return new MockResponse().setResponseCode(status).setHeader("Content-Type", type)
            .setHeader("Age", age).setBody(new Buffer().write(body));
      }
    });
    server.start();
    directory = files.newFolder();
    cache = openCache();
  }

  private CoverImageCache openCache() {
    // Only the test transport redirects public CDN references to this local fixture.
    return new CoverImageCache(directory, new OkHttpClient.Builder().addInterceptor(chain ->
        chain.proceed(chain.request().newBuilder().url(server.url(chain.request().url().encodedPath())).build())));
  }

  private String route(String path) throws Exception {
    return BuildConfig.PLAYER_ORIGIN + "/api/cover?url="
        + URLEncoder.encode("https://p1.music.126.net/" + path, "UTF-8");
  }

  @After public void cleanup() throws Exception {
    if (cache != null) cache.close();
    if (server != null) server.shutdown();
  }

  @Test public void pageAndSessionReadsReuseDiskBytesAfterReopening() throws Exception {
    assertArrayEquals(body, cache.read(route("album.png")).bytes);
    assertArrayEquals(body, cache.read(route("album.png")).bytes);
    assertArrayEquals(body, cache.read("https://p1.music.126.net/album.png").bytes);
    assertEquals(1, calls.get());
    cache.close(); cache = openCache();
    status = 503;
    assertArrayEquals(body, cache.read(route("album.png")).bytes);
    assertEquals("a fresh disk entry needs no proxy or CDN request", 1, calls.get());
  }

  @Test public void anExpiredDiskImageRemainsAvailableWhenNetworkFails() throws Exception {
    age = "604801";
    byte[] first = cache.read(route("old.png")).bytes;
    status = 503;
    assertArrayEquals(first, cache.read(route("old.png")).bytes);
    assertEquals(2, calls.get());
  }

  @Test public void errorPagesAndOversizedImagesAreRejected() throws Exception {
    type = "text/html";
    assertThrows(IOException.class, () -> cache.read(route("error.png")));
    type = "image/png";
    body = new byte[2 * 1024 * 1024 + 1];
    assertThrows(IOException.class, () -> cache.read(route("huge.png")));
    assertThrows(IOException.class, () -> cache.read("https://other.test/api/cover?url=anything"));
    assertThrows(IOException.class, () -> cache.read(route("private.png?token=secret")));
    assertEquals(2, calls.get());
  }
}
