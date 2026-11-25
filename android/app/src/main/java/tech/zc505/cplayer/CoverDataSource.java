package tech.zc505.cplayer;

import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.ByteArrayDataSource;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Supplies notification artwork from the same disk cache used by the WebView. */
@UnstableApi
final class CoverDataSource implements DataSource {
  private final CoverImageCache covers;
  private final DataSource.Factory fallback;
  private final List<TransferListener> listeners = new ArrayList<>();
  private DataSource active;

  CoverDataSource(CoverImageCache covers, DataSource.Factory fallback) {
    this.covers = covers;
    this.fallback = fallback;
  }

  @Override public void addTransferListener(TransferListener listener) {
    listeners.add(listener);
    if (active != null) active.addTransferListener(listener);
  }

  @Override public long open(DataSpec spec) throws IOException {
    String value = spec.uri.toString();
    if (!BridgePolicy.artwork(value)) throw new IOException("Unsupported artwork route");
    if (CoverCachePolicy.target(value) != null) {
      try {
        active = new ByteArrayDataSource(covers.read(value).bytes);
      } catch (IOException unavailable) {
        // Preserve the existing proxy route when the device cannot reach the CDN.
        active = fallback.createDataSource();
      }
    } else {
      // Provider redirects and signed images retain their existing transport.
      active = fallback.createDataSource();
    }
    for (TransferListener listener : listeners) active.addTransferListener(listener);
    return active.open(spec);
  }

  @Override public int read(byte[] buffer, int offset, int length) throws IOException {
    if (active == null) throw new IOException("Artwork is not open");
    return active.read(buffer, offset, length);
  }

  @Nullable @Override public Uri getUri() { return active == null ? null : active.getUri(); }
  @Override public Map<String, List<String>> getResponseHeaders() {
    return active == null ? java.util.Collections.emptyMap() : active.getResponseHeaders();
  }
  @Override public void close() throws IOException {
    DataSource previous = active;
    active = null;
    if (previous != null) previous.close();
  }
}
