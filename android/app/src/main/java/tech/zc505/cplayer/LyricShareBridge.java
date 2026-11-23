package tech.zc505.cplayer;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.FileProvider;
import androidx.media3.common.util.UnstableApi;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewFeature;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;
import org.json.JSONObject;

/** Retained with WebPlayerHost while Android's document picker recreates the Activity. */
@UnstableApi
final class LyricShareBridge {
  static final int SAVE_REQUEST = 12;
  private final Context context;
  private final Supplier<MainActivity> activity;
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private JavaScriptReplyProxy reply;
  private String requestId;
  private File pending;
  private int generation;

  LyricShareBridge(Context context, Supplier<MainActivity> activity) {
    this.context = context.getApplicationContext();
    this.activity = activity;
  }

  void receive(String body, JavaScriptReplyProxy proxy) {
    if (body == null || body.length() > LyricCardImage.MAX_MESSAGE) return;
    try {
      JSONObject packet = new JSONObject(body);
      String id = packet.optString("id"), op = packet.optString("op");
      if (!id.matches("[a-zA-Z0-9_-]{1,64}") || !(op.equals("save") || op.equals("share"))) return;
      if (requestId != null) {
        respond(proxy, id, "error", "请先完成当前卡片的保存或分享");
        return;
      }
      requestId = id;
      reply = proxy;
      int token = ++generation;
      String png = packet.optString("png"), name = LyricCardImage.fileName(packet.optString("fileName"));
      io.execute(() -> {
        File file = null;
        try {
          byte[] bytes = LyricCardImage.decode(png);
          File directory = new File(context.getCacheDir(), "lyric-cards");
          if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException();
          File[] old = directory.listFiles();
          if (old != null) for (File entry : old)
            if (entry.lastModified() < System.currentTimeMillis() - 86_400_000) entry.delete();
          file = new File(directory, UUID.randomUUID() + ".png");
          try (OutputStream output = new FileOutputStream(file)) { output.write(bytes); }
          File ready = file;
          main.post(() -> {
            if (token != generation) { ready.delete(); return; }
            MainActivity host = activity.get();
            if (host == null) { ready.delete(); finish("error", "请回到播放器后重试"); return; }
            try {
              if (op.equals("save")) {
                pending = ready;
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("image/png")
                    .putExtra(Intent.EXTRA_TITLE, name);
                host.startActivityForResult(save, SAVE_REQUEST);
              } else {
                Uri uri = FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".lyriccards", ready, name);
                Intent send = new Intent(Intent.ACTION_SEND).setType("image/png")
                    .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newUri(context.getContentResolver(), name, uri));
                host.startActivity(Intent.createChooser(send, "分享歌词卡片"));
                finish("shared", "");
              }
            } catch (Exception error) { ready.delete(); finish("error", "无法打开系统保存或分享面板，请重试"); }
          });
        } catch (Exception error) {
          if (file != null) file.delete();
          main.post(() -> { if (token == generation) finish("error", "无法生成卡片文件，请减少选句后重试"); });
        }
      });
    } catch (Exception ignored) { /* Malformed messages do not access files. */ }
  }

  void saveResult(int result, Uri uri) {
    if (pending == null) return;
    File file = pending;
    if (result != Activity.RESULT_OK || uri == null) { file.delete(); finish("cancelled", ""); return; }
    int token = generation;
    io.execute(() -> {
      String error = "";
      try (OutputStream output = context.getContentResolver().openOutputStream(uri, "wt")) {
        if (output == null) throw new IllegalStateException();
        Files.copy(file.toPath(), output);
      } catch (Exception failure) { error = "图片保存失败，请重新选择保存位置"; }
      file.delete();
      String message = error;
      main.post(() -> { if (token == generation) finish(message.isEmpty() ? "saved" : "error", message); });
    });
  }

  private static void respond(JavaScriptReplyProxy proxy, String id, String status, String error) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
    try { proxy.postMessage(new JSONObject().put("id", id).put("status", status).put("error", error).toString()); }
    catch (Exception ignored) { /* The page may have closed while the system picker was open. */ }
  }

  private void finish(String status, String error) {
    if (reply != null) respond(reply, requestId, status, error);
    reply = null; requestId = null; pending = null;
  }

  void reset() {
    generation++;
    if (pending != null) pending.delete();
    reply = null; requestId = null; pending = null;
  }

  void destroy() { reset(); io.shutdown(); }
}
