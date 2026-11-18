package tech.zc505.cplayer;

import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

// The bundled player can look up a QQ album before the website's next deployment.
final class QqArtworkHandler implements WebViewAssetLoader.PathHandler {
  private static final int MAX_BYTES = 128 * 1024;

  @Override
  public WebResourceResponse handle(String mid) {
    if (!mid.matches("[A-Za-z0-9]{14}")) return response(400, "Invalid MID", "{}");
    HttpsURLConnection connection = null;
    try {
      URL url = new URL("https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=" + mid + "&format=json");
      connection = (HttpsURLConnection) url.openConnection();
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(3500);
      connection.setReadTimeout(3500);
      if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > MAX_BYTES)
        return response(502, "Upstream unavailable", "{}");
      try (InputStream input = connection.getInputStream()) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int count;
        while ((count = input.read(buf)) != -1) {
          if (bytes.size() + count > MAX_BYTES) return response(502, "Response too large", "{}");
          bytes.write(buf, 0, count);
        }
        JSONObject payload = new JSONObject(bytes.toString("UTF-8"));
        JSONArray songs = payload.getJSONArray("data");
        if (payload.getInt("code") != 0) return response(502, "Upstream unavailable", "{}");
        for (int index = 0; index < songs.length(); index++) {
          JSONObject song = songs.optJSONObject(index);
          if (song == null || !mid.equals(song.optString("mid"))) continue;
          JSONObject album = song.optJSONObject("album");
          String albumMid = album == null ? "" : album.optString("mid");
          if (albumMid.matches("[A-Za-z0-9]{14}")) {
            JSONObject data = new JSONObject().put("id", mid).put("albumMid", albumMid);
            return response(200, "OK", new JSONObject().put("code", 200).put("data", data).toString());
          }
        }
        return response(404, "No album artwork", "{}");
      }
    } catch (Exception error) {
      return response(502, "Upstream unavailable", "{}");
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private static WebResourceResponse response(int status, String reason, String json) {
    return new WebResourceResponse("application/json", "utf-8", status, reason,
        Collections.singletonMap("Cache-Control", status == 200 ? "public, max-age=300" : "no-store"),
        new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
  }
}
