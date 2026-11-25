package tech.zc505.cplayer;

import android.content.Context;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import okhttp3.Cache;
import okhttp3.CacheControl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Process-wide, bounded image-byte cache shared by WebViews and app restarts. */
final class CoverImageCache {
  private static CoverImageCache instance;
  private static final int MAX_BYTES = 2 * 1024 * 1024;
  private final OkHttpClient client;
  private final ConcurrentHashMap<String, FutureTask<ImageData>> pending = new ConcurrentHashMap<>();

  static final class ImageData {
    final String type;
    final byte[] bytes;
    ImageData(String type, byte[] bytes) { this.type = type; this.bytes = bytes; }
  }

  static synchronized CoverImageCache get(Context context) {
    if (instance == null) instance = new CoverImageCache(new File(context.getCacheDir(), "public-covers-v1"));
    return instance;
  }

  private CoverImageCache(File directory) {
    this(directory, LxHttpBridge.publicClient());
  }

  CoverImageCache(File directory, OkHttpClient.Builder builder) {
    client = builder.cache(new Cache(directory, 64L * 1024 * 1024))
        .followRedirects(false).retryOnConnectionFailure(false).callTimeout(2500, TimeUnit.MILLISECONDS)
        .addNetworkInterceptor(chain -> {
          Response response = chain.proceed(chain.request());
          if (response.isSuccessful()) {
            if (CoverCachePolicy.imageType(response.header("Content-Type")) == null
                || response.body() == null || response.body().contentLength() > MAX_BYTES) {
              response.close(); throw new IOException("Invalid public cover");
            }
            return response.newBuilder().removeHeader("Set-Cookie")
                .header("Cache-Control", "public, max-age=604800").build();
          }
          return response;
        }).build();
  }

  WebResourceResponse intercept(String value) {
    try {
      ImageData image = read(value);
      return new WebResourceResponse(image.type, null, 200, "OK",
          Map.of("Cache-Control", "public, max-age=604800", "X-Content-Type-Options", "nosniff"),
          new ByteArrayInputStream(image.bytes));
    } catch (IOException unavailable) { return null; }
  }

  // Both WebView and MediaSession resolve the proxy to the same public CDN cache key.
  ImageData read(String value) throws IOException {
    String target = CoverCachePolicy.target(value);
    if (target == null) throw new IOException("Unsupported cached cover");
    FutureTask<ImageData> task = new FutureTask<>(() -> {
      try { return load(target, false); }
      catch (IOException offline) { return load(target, true); }
    });
    FutureTask<ImageData> existing = pending.putIfAbsent(target, task);
    FutureTask<ImageData> shared = existing == null ? task : existing;
    try {
      if (existing == null) task.run();
      return shared.get();
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IOException("Cover request interrupted", interrupted);
    } catch (ExecutionException failed) {
      throw new IOException("Cover unavailable", failed.getCause());
    } finally {
      if (existing == null) pending.remove(target, task);
    }
  }

  void close() throws IOException { client.cache().close(); }

  private ImageData load(String target, boolean offline) throws IOException {
    for (int hop = 0; hop < 3; hop++) {
      Request.Builder request = new Request.Builder().url(target)
          .header("Accept", "image/avif,image/webp,image/jpeg,image/png");
      if (offline) request.cacheControl(CacheControl.FORCE_CACHE);
      try (Response response = client.newCall(request.build()).execute()) {
        if (response.isRedirect()) {
          okhttp3.HttpUrl next = response.request().url().resolve(response.header("Location", ""));
          if (next == null || !CoverCachePolicy.allowed(next.toString())) throw new IOException("Invalid cover redirect");
          target = next.toString(); continue;
        }
        String type = CoverCachePolicy.imageType(response.header("Content-Type"));
        if (!response.isSuccessful() || type == null || response.body() == null) throw new IOException("Cover unavailable");
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        try (InputStream body = response.body().byteStream()) {
          byte[] buffer = new byte[8192]; int count;
          while ((count = body.read(buffer)) != -1) {
            if (data.size() + count > MAX_BYTES) throw new IOException("Cover too large");
            data.write(buffer, 0, count);
          }
        }
        if (data.size() == 0) throw new IOException("Empty cover");
        return new ImageData(type, data.toByteArray());
      }
    }
    throw new IOException("Too many cover redirects");
  }
}
