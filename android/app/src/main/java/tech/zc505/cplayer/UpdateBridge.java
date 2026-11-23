package tech.zc505.cplayer;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import androidx.media3.common.util.UnstableApi;
import androidx.webkit.JavaScriptReplyProxy;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

/** Public release traffic only. The signed APK is checked again before opening the installer. */
@UnstableApi
final class UpdateBridge {
  private final Context context;
  private final Supplier<MainActivity> activity;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService io = Executors.newFixedThreadPool(2);
  private final ConcurrentHashMap<String, Job> jobs = new ConcurrentHashMap<>();
  private final OkHttpClient http = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
      .connectTimeout(6, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS).build();
  private volatile File ready;
  private volatile JSONObject readyInfo;

  private static final class Job {
    final String id;
    final JavaScriptReplyProxy reply;
    volatile Call call;
    volatile boolean cancelled;
    Job(String id, JavaScriptReplyProxy reply) { this.id = id; this.reply = reply; }
    void check() throws IOException { if (cancelled) throw new IOException("下载已取消"); }
    void cancel() { cancelled = true; if (call != null) call.cancel(); }
  }

  UpdateBridge(Context context, Supplier<MainActivity> activity) {
    this.context = context.getApplicationContext(); this.activity = activity;
  }

  void receive(String raw, JavaScriptReplyProxy reply) {
    if (raw == null || raw.length() > 8192) return;
    try {
      JSONObject data = new JSONObject(raw);
      String id = data.optString("id"), op = data.optString("op");
      if (!id.matches("[A-Za-z0-9_-]{1,64}")) return;
      if ("cancel".equals(op)) { Job job = jobs.remove(id); if (job != null) job.cancel(); return; }
      if (!("feed".equals(op) || "download".equals(op) || "install".equals(op)) || jobs.size() >= 3) return;
      Job job = new Job(id, reply);
      if (jobs.putIfAbsent(id, job) != null) return;
      io.execute(() -> {
        try {
          if (op.equals("feed")) feed(job, data);
          else if (op.equals("download")) download(job, data);
          else install(job);
        } catch (Exception error) {
          fail(job, error instanceof IllegalArgumentException ? error.getMessage() : "更新请求未完成，请检查网络或切换线路后重试");
        }
      });
    } catch (Exception ignored) { /* Invalid input never becomes a URL or a file path. */ }
  }

  private static JSONObject packet(String status) {
    JSONObject value = new JSONObject();
    try { value.put("status", status); } catch (Exception ignored) { }
    return value;
  }

  private void fail(Job job, String message) {
    try { publish(job, packet("error").put("error", message), true); } catch (Exception ignored) { }
  }

  private void publish(Job job, JSONObject data, boolean done) {
    main.post(() -> {
      if (jobs.get(job.id) != job || job.cancelled) return;
      try { data.put("id", job.id); job.reply.postMessage(data.toString()); } catch (Exception ignored) { }
      if (done) jobs.remove(job.id, job);
    });
  }

  private Response open(Job job, String target, boolean feed) throws Exception {
    for (int hop = 0; hop < 5; hop++) {
      job.check();
      if (!UpdatePolicy.safe(target)) throw new IOException("更新线路重定向无效");
      Request request = new Request.Builder().url(target).header("User-Agent", "ZPlayer-Android")
          .header("Accept", feed ? "application/json" : "application/octet-stream")
          .header("Cache-Control", "no-cache").build();
      job.call = (feed ? http.newBuilder().callTimeout(10, TimeUnit.SECONDS).build() : http).newCall(request);
      Response response = job.call.execute();
      if (response.code() < 300 || response.code() >= 400) return response;
      String location = response.header("Location");
      okhttp3.HttpUrl next = location == null ? null : response.request().url().resolve(location);
      response.close();
      if (next == null) throw new IOException("更新线路重定向无效");
      target = next.toString();
    }
    throw new IOException("更新线路重定向过多");
  }

  private void feed(Job job, JSONObject data) throws Exception {
    String url = UpdatePolicy.feed(data.optInt("page"));
    JSONObject last = null;
    for (int route : UpdatePolicy.routes(data.optString("source"))) {
      job.check();
      try (Response response = open(job, UpdatePolicy.PREFIXES[route] + url, true)) {
        if (response.body() == null) continue;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = response.body().byteStream()) {
          byte[] buffer = new byte[8192]; int count;
          while ((count = input.read(buffer)) != -1) { job.check(); if (output.size() + count > 2 * 1024 * 1024) throw new IOException(); output.write(buffer, 0, count); }
        }
        String body = output.toString(StandardCharsets.UTF_8.name());
        JSONObject headers = new JSONObject();
        for (String key : new String[]{"Link", "Retry-After", "X-RateLimit-Reset"}) headers.put(key, response.header(key, ""));
        last = packet("complete").put("body", body).put("httpStatus", response.code()).put("headers", headers).put("route", UpdatePolicy.LABELS[route]);
        if (!response.isSuccessful()) continue;
        new JSONArray(body); // HTML landing pages must fall through to the next route.
        publish(job, last, true); return;
      } catch (Exception error) { job.check(); }
    }
    if (last != null && last.optInt("httpStatus") >= 400) publish(job, last, true);
    else throw new IOException("更新线路均不可用");
  }

  private void download(Job job, JSONObject data) throws Exception {
    long size = data.optLong("size"), code = data.optLong("code");
    String url = data.optString("url"), digest = data.optString("sha256");
    UpdatePolicy.release(url, code, BuildConfig.VERSION_CODE, size, digest);
    File dir = new File(context.getCacheDir(), "updates");
    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException();
    if (dir.getUsableSpace() < size + 8 * 1024 * 1024) throw new IllegalArgumentException("存储空间不足，请清理后重试");
    synchronized (this) { if (ready != null) ready.delete(); ready = null; readyInfo = null; }
    File file = new File(dir, UUID.randomUUID() + ".apk");
    try {
      for (int route : UpdatePolicy.routes(data.optString("source"))) {
        job.check();
        publish(job, packet("progress").put("phase", "downloading").put("route", UpdatePolicy.LABELS[route]).put("received", 0).put("total", size), false);
        try (Response response = open(job, UpdatePolicy.PREFIXES[route] + url, false)) {
          if (!response.isSuccessful() || response.body() == null) throw new IOException();
          if (response.body().contentLength() > 0 && response.body().contentLength() != size) throw new IOException();
          long copied = 0, lastProgress = 0;
          try (InputStream input = response.body().byteStream(); FileOutputStream output = new FileOutputStream(file)) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) != -1) {
              job.check(); copied += count;
              if (copied > size) throw new IOException();
              output.write(buffer, 0, count);
              long now = android.os.SystemClock.elapsedRealtime();
              if (now - lastProgress >= 120) {
                lastProgress = now;
                publish(job, packet("progress").put("phase", "downloading").put("route", UpdatePolicy.LABELS[route]).put("received", copied).put("total", size), false);
              }
            }
          }
          if (copied != size) throw new IOException();
          publish(job, packet("progress").put("phase", "verifying").put("received", size).put("total", size), false);
          verify(file, data); job.check();
          synchronized (this) { job.check(); ready = file; readyInfo = data; }
          publish(job, packet("ready"), true); return;
        } catch (Exception error) { file.delete(); job.check(); }
      }
      throw new IllegalArgumentException("所有更新线路下载或校验失败，可切换线路重试");
    } finally {
      synchronized (this) {
        if (job.cancelled && ready == file) { ready = null; readyInfo = null; }
        if (ready != file) file.delete();
      }
    }
  }

  @SuppressWarnings("deprecation")
  private static Set<String> signers(PackageInfo info) throws Exception {
    Set<String> values = new HashSet<>();
    Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null ? info.signingInfo.getApkContentsSigners() : info.signatures;
    if (signatures != null) for (Signature signature : signatures) values.add(UpdatePolicy.sha256(signature.toByteArray()));
    return values;
  }

  @SuppressWarnings("deprecation")
  private void verify(File file, JSONObject data) throws Exception {
    if (file.length() != data.optLong("size") || !UpdatePolicy.sha256(file).equalsIgnoreCase(data.optString("sha256"))) throw new IOException("安装包校验失败");
    PackageManager pm = context.getPackageManager();
    int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    PackageInfo current = pm.getPackageInfo(context.getPackageName(), flags), archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
    if (archive == null) throw new IOException("安装包无法识别");
    long version = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
    UpdatePolicy.identity(context.getPackageName(), archive.packageName, BuildConfig.VERSION_CODE, version, data.optLong("code"), signers(current), signers(archive));
  }

  private void install(Job job) throws Exception {
    File file = ready; JSONObject info = readyInfo;
    if (file == null || info == null) throw new IllegalArgumentException("请先下载更新包");
    verify(file, info); job.check();
    main.post(() -> {
      if (job.cancelled || jobs.get(job.id) != job) return;
      MainActivity host = activity.get();
      try {
        if (host == null) throw new IllegalStateException();
        if (!context.getPackageManager().canRequestPackageInstalls()) {
          host.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName())));
          publish(job, packet("permission"), true); return;
        }
        Uri uri = FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".lyriccards", file);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("ZPlayer 更新", uri));
        host.startActivity(intent); publish(job, packet("installer"), true);
      } catch (Exception error) {
        try { publish(job, packet("error").put("error", "无法打开安装器，请回到应用后重试"), true); } catch (Exception ignored) { }
      }
    });
  }

  void reset() {
    for (Job job : jobs.values()) job.cancel(); jobs.clear();
    synchronized (this) { if (ready != null) ready.delete(); ready = null; readyInfo = null; }
  }
  void destroy() { reset(); io.shutdownNow(); }
}
