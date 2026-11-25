package tech.zc505.cplayer;

import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.TimeUnit;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Fixed public catalogue lookup for the bundled player; no site cookies or credentials. */
final class ArtworkSearchHandler {
  private static final String PATH = "/android-player/artwork-search";
  private static final int MAX_BYTES = 512 * 1024;
  private final OkHttpClient client;

  ArtworkSearchHandler() { this(LxHttpBridge.publicClient()); }

  ArtworkSearchHandler(OkHttpClient.Builder builder) {
    client = builder.cookieJar(CookieJar.NO_COOKIES).followRedirects(false)
        .retryOnConnectionFailure(false).callTimeout(5500, TimeUnit.MILLISECONDS).build();
  }

  private static boolean matches(String value) {
    try { return BridgePolicy.trusted(value) && PATH.equals(URI.create(value).getPath()); }
    catch (Exception invalid) { return false; }
  }

  WebResourceResponse intercept(String value) {
    if (!matches(value)) return null;
    try { return response(200, "OK", read(value)); }
    catch (IOException unavailable) { return response(502, "Artwork search unavailable", "{}"); }
  }

  String read(String value) throws IOException {
    if (!matches(value) || value.length() > 2048) throw new IOException("Invalid catalogue route");
    String term;
    try {
      String query = URI.create(value).getRawQuery();
      if (query == null || !query.startsWith("term=") || query.contains("&")) throw new IOException("Invalid search");
      term = URLDecoder.decode(query.substring(5), StandardCharsets.UTF_8.name()).trim();
      if (term.length() < 3 || term.length() > 241 || term.chars().anyMatch(c -> c < 32 || c == 127))
        throw new IOException("Invalid search");
    } catch (IllegalArgumentException invalid) { throw new IOException("Invalid search", invalid); }
    HttpUrl url = HttpUrl.get("https://itunes.apple.com/search").newBuilder()
        .addQueryParameter("term", term).addQueryParameter("country", "hk")
        .addQueryParameter("media", "music").addQueryParameter("entity", "song")
        .addQueryParameter("limit", "30").build();
    Request request = new Request.Builder().url(url).header("Accept", "application/json")
        .header("User-Agent", "ZPlayerArtwork/1").build();
    try (Response result = client.newCall(request).execute()) {
      String type = result.header("Content-Type", "").split(";", 2)[0].trim();
      if (!result.isSuccessful() || result.body() == null || result.body().contentLength() > MAX_BYTES
          || !(type.equalsIgnoreCase("application/json") || type.equalsIgnoreCase("text/javascript")))
        throw new IOException("Invalid catalogue response");
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (InputStream input = result.body().byteStream()) {
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
          if (bytes.size() + count > MAX_BYTES) throw new IOException("Catalogue response too large");
          bytes.write(buffer, 0, count);
        }
      }
      if (bytes.size() == 0) throw new IOException("Empty catalogue response");
      return bytes.toString(StandardCharsets.UTF_8.name());
    }
  }

  private static WebResourceResponse response(int status, String reason, String json) {
    return new WebResourceResponse("application/json", "utf-8", status, reason,
        Collections.singletonMap("Cache-Control", "no-store"),
        new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
  }
}
