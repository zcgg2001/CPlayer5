package tech.zc505.cplayer;

import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.TimeUnit;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Public lyric formats for an exact provider ID. Never searches by title or follows redirects. */
final class OnlineLyricsHandler {
  private static final String PATH = "/android-player/online-lyrics";
  private static final int MAX_BYTES = 512 * 1024;
  private final OkHttpClient client;

  OnlineLyricsHandler() { this(LxHttpBridge.publicClient()); }
  OnlineLyricsHandler(OkHttpClient.Builder builder) {
    client = builder.cookieJar(CookieJar.NO_COOKIES).followRedirects(false)
        .retryOnConnectionFailure(false).callTimeout(4500, TimeUnit.MILLISECONDS).build();
  }

  private static boolean matches(String value) {
    try { return BridgePolicy.trusted(value) && PATH.equals(URI.create(value).getPath()); }
    catch (Exception invalid) { return false; }
  }

  WebResourceResponse intercept(String value) {
    if (!matches(value)) return null;
    try { return response(200, "OK", read(value)); }
    catch (IOException unavailable) { return response(502, "Lyrics unavailable", "{}"); }
  }

  String read(String value) throws IOException {
    if (!matches(value) || value.length() > 512) throw new IOException("Invalid lyric route");
    HttpUrl route = HttpUrl.parse(value);
    if (route == null || route.querySize() != 2 || !route.queryParameterNames().contains("provider")
        || !route.queryParameterNames().contains("id")) throw new IOException("Invalid lyric query");
    String provider = route.queryParameter("provider"), id = route.queryParameter("id");
    try {
      JSONObject data;
      if ("netease".equals(provider) && id != null && id.matches("[1-9][0-9]{0,19}")) data = netease(id);
      else if ("qq".equals(provider) && id != null && id.matches("(?:[A-Za-z0-9]{14}|[1-9][0-9]{0,11})")) data = qq(id);
      else if ("kugou".equals(provider) && id != null && id.matches("[a-fA-F0-9]{32}")) data = kugou(id);
      else throw new IOException("Unsupported lyric identity");
      return data.put("provider", provider).put("id", id).toString();
    } catch (JSONException invalid) { throw new IOException("Invalid lyric data", invalid); }
  }

  private JSONObject netease(String id) throws IOException, JSONException {
    // Exact public catalog ID; independent of the audio resolver and GD's quota.
    // Keep real YRC when present, and ordinary LRC as the fallback.
    for (String path : new String[] { "/api/song/lyric/v1", "/api/song/lyric" }) {
      try {
        HttpUrl url = HttpUrl.get("https://music.163.com" + path).newBuilder()
            .addQueryParameter("id", id).addQueryParameter("lv", "-1").addQueryParameter("kv", "-1")
            .addQueryParameter("tv", "-1").addQueryParameter("rv", "-1").addQueryParameter("yv", "-1")
            .addQueryParameter("ytv", "-1").addQueryParameter("yrv", "-1").build();
        JSONObject data = json(new Request.Builder().url(url));
        if (data.optInt("code", -1) != 200) throw new IOException("NetEase lyrics unavailable");
        JSONObject result = new JSONObject().put("encoding", "netease-json");
        for (String field : new String[] { "lrc", "yrc", "tlyric", "romalrc", "ytlrc", "yromalrc" }) {
          JSONObject layer = data.optJSONObject(field);
          result.put("tlyric".equals(field) ? "tlrc" : field, layer == null ? "" : layer.optString("lyric", ""));
        }
        if (!result.optString("lrc").trim().isEmpty() || !result.optString("yrc").trim().isEmpty()) return result;
      } catch (IOException | JSONException error) {
        if (path.equals("/api/song/lyric")) throw error;
      }
    }
    throw new IOException("No NetEase lyrics");
  }

  private JSONObject qq(String id) throws IOException, JSONException {
    long songId;
    if (id.length() == 14) {
      HttpUrl url = HttpUrl.get("https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg").newBuilder()
          .addQueryParameter("songmid", id).addQueryParameter("format", "json").build();
      JSONObject detail = json(new Request.Builder().url(url));
      if (detail.optInt("code", -1) != 0) throw new IOException("Song detail unavailable");
      JSONArray songs = detail.getJSONArray("data"); songId = 0;
      for (int i = 0; i < songs.length(); i++) {
        JSONObject song = songs.optJSONObject(i);
        if (song != null && id.equals(song.optString("mid"))) { songId = song.optLong("id"); break; }
      }
    } else songId = Long.parseLong(id);
    if (songId <= 0) throw new IOException("Song identity unavailable");
    JSONObject params = new JSONObject().put("songID", songId).put("crypt", 1).put("ct", 19).put("cv", 2111)
        .put("qrc", 1).put("roma", 1).put("trans", 1).put("type", 0)
        .put("lrc_t", 0).put("qrc_t", 0).put("roma_t", 0).put("trans_t", 0);
    JSONObject body = new JSONObject().put("comm", new JSONObject().put("ct", 11).put("cv", "1003006"))
        .put("request", new JSONObject().put("module", "music.musichallSong.PlayLyricInfo")
            .put("method", "GetPlayLyricInfo").put("param", params));
    JSONObject result = json(new Request.Builder().url("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .post(RequestBody.create(body.toString(), MediaType.get("application/json; charset=utf-8"))));
    JSONObject request = result.getJSONObject("request"), data = request.getJSONObject("data");
    if (result.optInt("code", -1) != 0 || request.optInt("code", -1) != 0 || data.optLong("songID") != songId)
      throw new IOException("Lyric identity mismatch");
    return new JSONObject().put("encoding", "qrc-hex").put("lyric", required(data, "lyric"))
        .put("translation", data.optString("trans", "")).put("romanization", data.optString("roma", ""));
  }

  private JSONObject kugou(String hash) throws IOException, JSONException {
    HttpUrl searchUrl = HttpUrl.get("https://lyrics.kugou.com/search").newBuilder()
        .addQueryParameter("ver", "1").addQueryParameter("client", "pc").addQueryParameter("hash", hash)
        .addQueryParameter("keyword", "").addQueryParameter("duration", "-1").build();
    JSONObject search = json(new Request.Builder().url(searchUrl));
    if (search.optInt("status") != 200) throw new IOException("No matching lyrics");
    JSONArray candidates = search.getJSONArray("candidates");
    JSONObject selected = candidates.length() == 1 ? candidates.optJSONObject(0) : null;
    String proposal = search.optString("proposal");
    for (int i = 0; i < candidates.length(); i++) {
      JSONObject candidate = candidates.optJSONObject(i);
      if (candidate != null && proposal.equals(candidate.optString("id"))) { selected = candidate; break; }
    }
    if (selected == null) throw new IOException("Ambiguous lyric candidate");
    String lyricId = required(selected, "id"), accessKey = required(selected, "accesskey");
    if (!lyricId.matches("[0-9]{1,20}") || !accessKey.matches("[A-Za-z0-9]{1,128}"))
      throw new IOException("Invalid lyric candidate");
    HttpUrl downloadUrl = HttpUrl.get("https://lyrics.kugou.com/download").newBuilder()
        .addQueryParameter("ver", "1").addQueryParameter("client", "pc").addQueryParameter("id", lyricId)
        .addQueryParameter("accesskey", accessKey).addQueryParameter("fmt", "krc").addQueryParameter("charset", "utf8").build();
    JSONObject data = json(new Request.Builder().url(downloadUrl));
    if (data.optInt("status") != 200 || !lyricId.equals(data.optString("id"))) throw new IOException("Lyric download mismatch");
    boolean lrc = "lrc".equals(data.optString("fmt")) || data.optInt("contenttype", -1) == 2;
    return new JSONObject().put("encoding", lrc ? "lrc-base64" : "krc-base64").put("lyric", required(data, "content"));
  }

  private JSONObject json(Request.Builder builder) throws IOException, JSONException {
    Request request = builder.header("Accept", "application/json")
        .header("Referer", builder.build().url().host().endsWith("qq.com") ? "https://y.qq.com/"
            : builder.build().url().host().endsWith("163.com") ? "https://music.163.com/" : "https://www.kugou.com/")
        .header("User-Agent", "ZPlayerLyrics/1").build();
    try (Response result = client.newCall(request).execute()) {
      if (!result.isSuccessful() || result.body() == null || result.body().contentLength() > MAX_BYTES)
        throw new IOException("Lyric response unavailable");
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (InputStream input = result.body().byteStream()) {
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
          if (bytes.size() + count > MAX_BYTES) throw new IOException("Lyric response too large");
          bytes.write(buffer, 0, count);
        }
      }
      return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
    }
  }

  private static String required(JSONObject data, String field) throws IOException {
    String value = data.optString(field, "");
    if (value.isEmpty() || value.length() > MAX_BYTES) throw new IOException("Missing lyric content");
    return value;
  }

  private static WebResourceResponse response(int status, String reason, String json) {
    return new WebResourceResponse("application/json", "utf-8", status, reason,
        Collections.singletonMap("Cache-Control", "no-store"),
        new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
  }
}
