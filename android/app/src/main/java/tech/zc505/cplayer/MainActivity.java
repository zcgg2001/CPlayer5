package tech.zc505.cplayer;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.media3.common.util.UnstableApi;
import java.util.ArrayList;

@UnstableApi
public final class MainActivity extends Activity {
  private FrameLayout root;
  private PlaybackService service;
  private WebPlayerHost host;
  private ValueCallback<Uri[]> fileResult;
  private boolean bound;
  private boolean resumed;
  private boolean cardResultReady;
  private int cardResult;
  private Uri cardUri;
  private final ServiceConnection connection =
      new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
          service = ((PlaybackService.LocalBinder) binder).service();
          try {
            host = service.webHost();
            host.attach(MainActivity.this);
            if (cardResultReady) {
              host.lyricShare.saveResult(cardResult, cardUri);
              cardResultReady = false; cardUri = null;
            }
            if (host.view.getParent() instanceof ViewGroup parent) parent.removeView(host.view);
            root.removeAllViews();
            root.addView(host.view, new FrameLayout.LayoutParams(-1, -1));
            notifyPlayerVisibility();
          } catch (Exception error) {
            TextView message = new TextView(MainActivity.this);
            message.setText(error.getMessage());
            root.addView(message);
          }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
          service = null;
          host = null;
          showLoadError();
        }
      };

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    root = new FrameLayout(this);
    applyAppearance(false);
    setContentView(root);
    if (Build.VERSION.SDK_INT >= 30)
      root.setOnApplyWindowInsetsListener(
          (view, insets) -> {
            Insets bars =
                insets.getInsets(
                    WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
          });
    if (Build.VERSION.SDK_INT >= 33)
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::back);
    bound =
        bindService(
            new Intent(this, PlaybackService.class).setAction(PlaybackService.LOCAL_BIND),
            connection,
            BIND_AUTO_CREATE);
  }

  void applyAppearance(boolean light) {
    int color = light ? 0xfffdf7ff : 0xff141218;
    root.setBackgroundColor(color);
    getWindow().setStatusBarColor(color);
    getWindow().setNavigationBarColor(color);
    View decor = getWindow().getDecorView();
    int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
    int previous = decor.getSystemUiVisibility();
    decor.setSystemUiVisibility(light ? previous | flags : previous & ~flags);
  }

  void showLoadError() {
    Button retry = new Button(this);
    retry.setText("网络连接失败，点击重新加载");
    retry.setOnClickListener(
        view -> {
          root.removeView(retry);
          if (host != null) host.view.loadUrl(WebPlayerHost.START_URL);
        });
    root.addView(retry);
  }

  void chooseFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
    if (fileResult != null) fileResult.onReceiveValue(null);
    fileResult = callback;
    Intent pick =
        new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*");
    pick.putExtra(
        Intent.EXTRA_ALLOW_MULTIPLE,
        params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
    try {
      startActivityForResult(pick, 10);
    } catch (Exception error) {
      fileResult.onReceiveValue(null);
      fileResult = null;
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == LyricShareBridge.SAVE_REQUEST) {
      Uri uri = data == null ? null : data.getData();
      if (host != null) host.lyricShare.saveResult(result, uri);
      else { cardResultReady = true; cardResult = result; cardUri = uri; }
    }
    if (request == 10 && fileResult != null) {
      ArrayList<Uri> files = new ArrayList<>();
      if (result == RESULT_OK && data != null) {
        if (data.getClipData() != null)
          for (int i = 0; i < data.getClipData().getItemCount(); i++)
            files.add(data.getClipData().getItemAt(i).getUri());
        else if (data.getData() != null) files.add(data.getData());
      }
      fileResult.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
      fileResult = null;
    }
  }

  private void back() {
    if (host == null) {
      moveTaskToBack(true);
      return;
    }
    host.view.evaluateJavascript(
        "window.cplayerAndroidBack?.() === true",
        closed -> {
          if ("true".equals(closed)) return;
          if (host != null && host.view.canGoBack()) host.view.goBack();
          else moveTaskToBack(true);
        });
  }

  // Android 13+ uses the OnBackInvoked callback registered in onCreate.
  @android.annotation.SuppressLint("GestureBackNavigation")
  @Override
  public void onBackPressed() {
    back();
  }

  @Override
  protected void onResume() {
    super.onResume();
    resumed = true;
    notifyPlayerVisibility();
  }

  @Override
  protected void onPause() {
    resumed = false;
    notifyPlayerVisibility();
    super.onPause();
  }

  private void notifyPlayerVisibility() {
    if (host == null || !BridgePolicy.trusted(host.view.getUrl())) return;
    String event = resumed ? "cplayer:resume" : "cplayer:pause";
    host.view.evaluateJavascript("window.dispatchEvent(new Event('" + event + "'))", null);
  }

  @Override
  protected void onDestroy() {
    if (fileResult != null) {
      fileResult.onReceiveValue(null);
      fileResult = null;
    }
    if (host != null) {
      root.removeView(host.view);
      host.detach(service == null ? getApplicationContext() : service);
    }
    if (bound) unbindService(connection);
    super.onDestroy();
  }
}
