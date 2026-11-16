package tech.zc505.cplayer;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.media3.common.util.UnstableApi;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import org.json.JSONObject;

// Retained by the playback service, so Activity recreation never creates a
// second queue or discards the source-recovery iterator during background music.
@UnstableApi
final class WebPlayerHost {
  final WebView view;
  private final MutableContextWrapper context;
  private JavaScriptReplyProxy reply;
  private MainActivity activity;

  @SuppressLint("SetJavaScriptEnabled")
  WebPlayerHost(PlaybackService service) {
    context = new MutableContextWrapper(service);
    view = new WebView(context);
    view.setBackgroundColor(Color.rgb(21, 21, 26));
    WebSettings settings = view.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true); // User-selected Storage Access Framework files.
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setSupportMultipleWindows(false);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setUserAgentString(settings.getUserAgentString() + " CPlayerAndroid/1.0");
    CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
      throw new IllegalStateException("请先更新 Android System WebView 或 Chrome 后再打开播放器");
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
      WebViewCompat.addWebMessageListener(
          view,
          "CPlayerNative",
          Collections.singleton(BuildConfig.PLAYER_ORIGIN),
          (web, message, origin, mainFrame, proxy) -> {
            if (!mainFrame
                || !BridgePolicy.trusted(origin.toString())
                || !BridgePolicy.trusted(view.getUrl())) return;
            String body = message.getData();
            if (body == null || body.length() > 8192) return;
            try {
              JSONObject command = new JSONObject(body);
              reply = proxy;
              service.command(command);
            } catch (Exception ignored) {
              /* Malformed messages carry no authority. */
            }
          });
    service.attach(
        data -> {
          if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            if (reply != null && BridgePolicy.trusted(view.getUrl())) reply.postMessage(data);
          }
        });
    view.setWebViewClient(
        new WebViewClient() {
          @Override
          public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
            String target = request.getUrl().toString();
            if (BridgePolicy.trusted(target)) return false;
            if (request.isForMainFrame() && "https".equals(request.getUrl().getScheme()))
              external(request.getUrl());
            return true;
          }

          @Override
          public void onPageStarted(WebView web, String url, android.graphics.Bitmap icon) {
            reply = null;
            service.pageUnloaded();
          }

          @Override
          public void onReceivedError(
              WebView web, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && activity != null) activity.showLoadError();
          }

          @Override
          public boolean onRenderProcessGone(WebView web, RenderProcessGoneDetail detail) {
            // The JS queue is gone. Stop native audio rather than continuing
            // with invisible controls or a stale recovery session.
            if (web.getParent() instanceof android.view.ViewGroup parent) parent.removeView(web);
            reply = null;
            service.rendererLost();
            if (activity != null) activity.recreate();
            return true;
          }
        });
    view.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public void onPermissionRequest(PermissionRequest request) {
            request.deny();
          }

          @Override
          public boolean onShowFileChooser(
              WebView web, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (activity == null || !BridgePolicy.trusted(web.getUrl())) return false;
            activity.chooseFiles(callback, params);
            return true;
          }
        });
    view.setDownloadListener(
        (url, userAgent, disposition, type, length) -> {
          if (url.startsWith("https://")) external(Uri.parse(url));
          else Toast.makeText(context, "请在浏览器中打开网站导出文件", Toast.LENGTH_LONG).show();
        });
    view.loadUrl(BuildConfig.PLAYER_ORIGIN + "/?app=android");
  }

  private void external(Uri uri) {
    try {
      Intent intent = new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
    } catch (Exception ignored) {
      Toast.makeText(context, "没有可打开此链接的应用", Toast.LENGTH_SHORT).show();
    }
  }

  void attach(MainActivity host) {
    activity = host;
    context.setBaseContext(host);
  }

  void detach(Context service) {
    activity = null;
    context.setBaseContext(service);
  }

  void destroy() {
    reply = null;
    view.stopLoading();
    view.destroy();
    activity = null;
  }
}
