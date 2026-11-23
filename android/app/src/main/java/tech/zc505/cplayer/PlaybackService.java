package tech.zc505.cplayer;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import android.webkit.WebSettings;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.datasource.DataSourceBitmapLoader;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.session.CacheBitmapLoader;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.util.function.Consumer;
import org.json.JSONObject;

@UnstableApi
public final class PlaybackService extends MediaSessionService {
  static final String LOCAL_BIND = "tech.zc505.cplayer.BIND";
  private final Handler handler = new Handler(Looper.getMainLooper());
  private ExoPlayer player;
  private MediaSession session;
  private Consumer<String> listener;
  private int token;
  private boolean seeked;
  private WebPlayerHost webHost;
  private final ProgressiveMediaSource.Factory importedAudio =
      new ProgressiveMediaSource.Factory(new OkHttpDataSource.Factory(LxHttpBridge.publicClient().build()));

  WebPlayerHost webHost() {
    if (webHost == null) webHost = new WebPlayerHost(this);
    return webHost;
  }

  void pageUnloaded() {
    player.stop();
    player.clearMediaItems();
  }

  void rendererLost() {
    player.stop();
    listener = null;
    WebPlayerHost old = webHost;
    webHost = null;
    handler.post(
        () -> {
          if (old != null) old.destroy();
        });
  }

  private final Runnable ticker =
      new Runnable() {
        @Override
        public void run() {
          publish();
          handler.postDelayed(this, 500);
        }
      };

  // Same-process Activity binding only. This binder exposes no remote transactions.
  public final class LocalBinder extends Binder {
    PlaybackService service() {
      return PlaybackService.this;
    }
  }

  @Override
  public IBinder onBind(Intent intent) {
    return LOCAL_BIND.equals(intent.getAction()) ? new LocalBinder() : super.onBind(intent);
  }

  @Override
  public void onCreate() {
    super.onCreate();
    player =
        new ExoPlayer.Builder(this)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
    Player controls =
        new ForwardingPlayer(player) {
          @Override
          public Commands getAvailableCommands() {
            return super.getAvailableCommands()
                .buildUpon()
                .add(COMMAND_SEEK_TO_NEXT)
                .add(COMMAND_SEEK_TO_PREVIOUS)
                .add(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .add(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build();
          }

          @Override
          public boolean isCommandAvailable(int command) {
            return getAvailableCommands().contains(command);
          }

          @Override
          public void seekToNext() {
            action("next");
          }

          @Override
          public void seekToNextMediaItem() {
            action("next");
          }

          @Override
          public void seekToPrevious() {
            action("previous");
          }

          @Override
          public void seekToPreviousMediaItem() {
            action("previous");
          }
        };
    PendingIntent open =
        PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    CacheBitmapLoader artworkLoader = new CacheBitmapLoader(
        new DataSourceBitmapLoader.Builder(this)
            .setDataSourceFactory(new DefaultHttpDataSource.Factory()
                .setUserAgent(WebSettings.getDefaultUserAgent(this) + " CPlayerAndroid/" + BuildConfig.VERSION_NAME)
                .setConnectTimeoutMs(8000)
                .setReadTimeoutMs(8000))
            .setMaximumOutputDimension(512)
            .build());
    session = new MediaSession.Builder(this, controls)
        .setSessionActivity(open)
        .setBitmapLoader(artworkLoader)
        .setCallback(new MediaSession.Callback() {
          @Override
          public MediaSession.ConnectionResult onConnect(
              MediaSession mediaSession, MediaSession.ControllerInfo controller) {
            if (!allowedController(controller)) return MediaSession.ConnectionResult.reject();
            return MediaSession.Callback.super.onConnect(mediaSession, controller);
          }
        })
        .build();
    DefaultMediaNotificationProvider notifications = new DefaultMediaNotificationProvider(this);
    notifications.setSmallIcon(R.drawable.ic_playback);
    setMediaNotificationProvider(notifications);
    // The Activity uses a local binder, so no external MediaController calls
    // onGetSession to register it for us. Registration drives the foreground
    // notification and keeps playback eligible for background network access.
    addSession(session);
    player.addListener(
        new Player.Listener() {
          @Override
          public void onEvents(Player p, Player.Events events) {
            publish();
          }

          @Override
          public void onPositionDiscontinuity(
              Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
            seeked = reason == Player.DISCONTINUITY_REASON_SEEK;
            publish();
          }
        });
    handler.post(ticker);
  }

  @Override
  public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
    return allowedController(controller) ? session : null;
  }

  private boolean allowedController(MediaSession.ControllerInfo controller) {
    return controller.getUid() == Process.myUid() || controller.isTrusted();
  }

  void attach(@Nullable Consumer<String> callback) {
    listener = callback;
    publish();
  }

  private void action(String action) {
    if (listener != null) listener.accept("{\"type\":\"action\",\"action\":\"" + action + "\"}");
  }

  void command(JSONObject message) {
    String op = message.optString("op");
    int incoming = message.optInt("token");
    if (op.equals("load")) {
      String url = message.optString("url");
      token = incoming;
      if (!BridgePolicy.audio(url)) {
        error(4, "不支持此音频地址");
        return;
      }
      player.setPlayWhenReady(false);
      MediaItem item = new MediaItem.Builder()
              .setMediaId(message.optString("mediaId"))
              .setUri(url)
              .setMediaMetadata(
                  new MediaMetadata.Builder()
                      .setTitle(message.optString("title"))
                      .setArtist(message.optString("artist"))
                      .setAlbumTitle(message.optString("album"))
                      .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                      .build())
              .build();
      if (message.optBoolean("importedAudio")) player.setMediaSource(importedAudio.createMediaSource(item));
      else player.setMediaItem(item);
      player.setVolume((float) Math.max(0, Math.min(1, message.optDouble("volume", 1))));
      player.prepare();
    } else if (incoming == token) {
      switch (op) {
        case "play":
          player.play();
          break;
        case "pause":
          player.pause();
          break;
        case "stop":
          player.stop();
          player.clearMediaItems();
          break;
        case "seek":
          player.seekTo(Math.max(0, (long) (message.optDouble("position") * 1000)));
          break;
        case "volume":
          player.setVolume((float) Math.max(0, Math.min(1, message.optDouble("volume"))));
          break;
        case "artwork":
          MediaItem item = player.getCurrentMediaItem();
          if (item != null && item.mediaId.equals(message.optString("mediaId"))) {
            String artwork = message.optString("artworkUri");
            Uri artworkUri = BridgePolicy.artwork(artwork) ? Uri.parse(artwork) : null;
            if (java.util.Objects.equals(item.mediaMetadata.artworkUri, artworkUri)) break;
            player.replaceMediaItem(
                0,
                item.buildUpon()
                    .setMediaMetadata(item.mediaMetadata.buildUpon()
                            .setArtworkUri(artworkUri)
                            .build())
                    .build());
          }
          break;
        default:
          break;
      }
    }
    publish();
  }

  private void error(int code, String message) {
    try {
      if (listener != null)
        listener.accept(
            new JSONObject()
                .put("type", "state")
                .put("token", token)
                .put("error", new JSONObject().put("code", code).put("message", message))
                .toString());
    } catch (Exception ignored) {
    }
  }

  private void publish() {
    if (listener == null || player == null) return;
    try {
      int state = player.getPlaybackState();
      PlaybackException failure = player.getPlayerError();
      if (failure != null) {
        error(failure.errorCode >= 3000 ? 4 : 2, "音频播放失败");
        return;
      }
      JSONObject data =
          new JSONObject()
              .put("type", "state")
              .put("token", token)
              .put("position", player.getCurrentPosition() / 1000.0)
              .put("duration", Math.max(0, player.getDuration()) / 1000.0)
              .put("buffered", player.getBufferedPosition() / 1000.0)
              .put("playWhenReady", player.getPlayWhenReady())
              .put("playing", player.isPlaying())
              .put("ready", state == Player.STATE_READY || state == Player.STATE_ENDED)
              .put("buffering", state == Player.STATE_BUFFERING)
              .put("ended", state == Player.STATE_ENDED)
              .put("seeked", seeked);
      seeked = false;
      listener.accept(data.toString());
    } catch (Exception ignored) {
      /* A closing WebView must not interrupt native audio. */
    }
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    player.stop();
    stopSelf();
  }

  @Override
  public void onDestroy() {
    listener = null;
    handler.removeCallbacksAndMessages(null);
    if (webHost != null) webHost.destroy();
    if (session != null) session.release();
    if (player != null) player.release();
    super.onDestroy();
  }
}
