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
  private final ServiceConnection connection =
      new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
          service = ((PlaybackService.LocalBinder) binder).service();
          try {
            host = service.webHost();
            host.attach(MainActivity.this);
            if (host.view.getParent() instanceof ViewGroup parent) parent.removeView(host.view);
            root.removeAllViews();
            root.addView(host.view, new FrameLayout.LayoutParams(-1, -1));
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
    getWindow().setStatusBarColor(0xff15151a);
    getWindow().setNavigationBarColor(0xff15151a);
    root = new FrameLayout(this);
    root.setBackgroundColor(0xff15151a);
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

  void showLoadError() {
    Button retry = new Button(this);
    retry.setText("网络连接失败，点击重新加载");
    retry.setOnClickListener(
        view -> {
          root.removeView(retry);
          if (host != null) host.view.loadUrl(BuildConfig.PLAYER_ORIGIN + "/?app=android");
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
        "(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true;}return"
            + " false;})()",
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
