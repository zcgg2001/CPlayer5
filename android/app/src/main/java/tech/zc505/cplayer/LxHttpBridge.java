package tech.zc505.cplayer;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewFeature;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

final class LxHttpBridge {
  private static final int MAX_RESPONSE = 768 * 1024;
  private static final String[] HEADERS = {
      "accept", "content-type", "referer", "origin", "user-agent", "x-requested-with"};
  private final Map<Integer, Call> requests = new HashMap<>();
  private final OkHttpClient client = publicClient()
      .followRedirects(false)
      .retryOnConnectionFailure(false)
      .callTimeout(4, TimeUnit.SECONDS)
      .build();

  static OkHttpClient.Builder publicClient() {
    return new OkHttpClient.Builder().dns(LxHttpBridge::publicAddresses)
        .proxy(java.net.Proxy.NO_PROXY).followSslRedirects(false);
  }

  private static List<InetAddress> publicAddresses(String host) throws UnknownHostException {
    if (host.equals(HttpUrl.get(BuildConfig.PLAYER_ORIGIN).host())) {
      throw new UnknownHostException("LX cannot access the player origin");
    }
    List<InetAddress> addresses = Dns.SYSTEM.lookup(host);
    for (InetAddress address : addresses) {
      byte[] bytes = address.getAddress();
      int first = bytes[0] & 255, second = bytes[1] & 255;
      boolean publicRange = bytes.length == 4
          ? first > 0 && first < 224 && !(first == 100 && second >= 64 && second < 128)
              && !(first == 192 && second == 0) && !(first == 198 && (second == 18 || second == 19))
          : (first & 0xe0) == 0x20 && !(first == 0x20 && (second == 1 || second == 2));
      if (!publicRange || address.isAnyLocalAddress() || address.isLoopbackAddress()
          || address.isSiteLocalAddress() || address.isLinkLocalAddress() || address.isMulticastAddress()) {
        throw new UnknownHostException("LX hosts must resolve to public addresses");
      }
    }
    return addresses;
  }

  private static boolean allowed(HttpUrl url) {
    if (url == null || !url.isHttps() || url.port() != 443
        || !url.username().isEmpty() || !url.password().isEmpty()) return false;
    String host = url.host().replaceFirst("\\.$", "");
    return host.matches("(?:[a-z0-9-]+\\.)+[a-z0-9-]+")
        && !host.matches("[0-9.]+")
        && !host.matches(".*\\.(?:local|localhost|internal|lan|test)")
        && !host.equals(HttpUrl.get(BuildConfig.PLAYER_ORIGIN).host());
  }

  void receive(String message, JavaScriptReplyProxy reply) {
    if (message == null || message.length() > 18000) return;
    int id = -1;
    try {
      JSONObject command = new JSONObject(message);
      if (command.has("cancel")) {
        synchronized (requests) {
          Call call = requests.remove(command.getInt("cancel"));
          if (call != null) call.cancel();
        }
        return;
      }
      id = command.getInt("id");
      HttpUrl url = HttpUrl.parse(command.getString("url"));
      String method = command.getString("method");
      String body = command.optString("body");
      if (!allowed(url) || !(method.equals("GET") || method.equals("HEAD") || method.equals("POST"))
          || body.length() > 8192) {
        respond(reply, id, null);
        return;
      }
      Request.Builder request = new Request.Builder().url(url).method(method,
          method.equals("POST") ? RequestBody.create(body, null) : null);
      JSONObject headers = command.optJSONObject("headers");
      if (headers != null) for (String name : HEADERS) {
        String value = headers.optString(name);
        if (!value.isEmpty() && value.length() < 512) request.header(name, value);
      }
      start(id, request.build(), reply, 0, null);
    } catch (Exception ignored) {
      if (id >= 0) respond(reply, id, null);
    }
  }

  private void start(int id, Request request, JavaScriptReplyProxy reply, int redirects, Call previous) {
    Call call = client.newCall(request);
    synchronized (requests) {
      if (requests.get(id) != previous) return;
      if (requests.size() >= 16 && previous == null) {
        respond(reply, id, null);
        return;
      }
      requests.put(id, call);
    }
    call.enqueue(new Callback() {
      @Override public void onFailure(Call current, IOException failure) {
        finish(id, current, reply, null);
      }

      @Override public void onResponse(Call current, Response response) {
        try (response) {
          if (response.isRedirect() && redirects < 3) {
            String location = response.header("Location");
            HttpUrl target = location == null ? null : request.url().resolve(location);
            if (allowed(target) && !request.method().equals("POST")) {
              start(id, new Request.Builder().url(target).method(request.method(), null).build(),
                  reply, redirects + 1, current);
              return;
            }
          }
          JSONObject headers = new JSONObject();
          for (String name : new String[]{"content-type", "content-length"}) {
            headers.put(name, response.header(name));
          }
          byte[] body;
          try (InputStream stream = response.body().byteStream()) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int length; (length = stream.read(buffer)) != -1;) {
              if (bytes.size() + length > MAX_RESPONSE) throw new IOException("LX response too large");
              bytes.write(buffer, 0, length);
            }
            body = bytes.toByteArray();
          }
          finish(id, current, reply, new JSONObject().put("statusCode", response.code())
              .put("headers", headers).put("body", new String(body, StandardCharsets.UTF_8)));
        } catch (Exception ignored) {
          finish(id, current, reply, null);
        }
      }
    });
  }

  private void finish(int id, Call call, JavaScriptReplyProxy reply, JSONObject response) {
    synchronized (requests) {
      if (requests.get(id) != call) return;
      requests.remove(id);
    }
    respond(reply, id, response);
  }

  private static void respond(JavaScriptReplyProxy reply, int id, JSONObject response) {
    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
      try {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
          reply.postMessage(new JSONObject().put("id", id).put("error", response == null)
              .put("response", response).toString());
        }
      } catch (Exception ignored) {}
    });
  }

  void reset() {
    synchronized (requests) {
      for (Call call : requests.values()) call.cancel();
      requests.clear();
    }
  }
}
