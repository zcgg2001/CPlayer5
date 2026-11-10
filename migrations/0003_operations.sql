CREATE TABLE IF NOT EXISTS cplayer_ops_config (
  id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, body TEXT NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cplayer_source_state (
  source TEXT NOT NULL, operation TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0,
  openUntil INTEGER NOT NULL DEFAULT 0, probeUntil INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source, operation)
);
CREATE TABLE IF NOT EXISTS cplayer_source_metrics (
  source TEXT NOT NULL, operation TEXT NOT NULL, bucket INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
  latency INTEGER NOT NULL DEFAULT 0, maxLatency INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, operation, bucket)
);
CREATE INDEX IF NOT EXISTS cplayer_metrics_expiry ON cplayer_source_metrics(bucket);
CREATE TABLE IF NOT EXISTS cplayer_api_limits (
  key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cplayer_limits_expiry ON cplayer_api_limits(expires);
CREATE TABLE IF NOT EXISTS cplayer_events (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, code TEXT NOT NULL,
  createdAt INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS cplayer_events_expiry ON cplayer_events(createdAt);
CREATE TABLE IF NOT EXISTS cplayer_ops_audit (
  revision INTEGER PRIMARY KEY, actor TEXT NOT NULL, createdAt INTEGER NOT NULL, body TEXT NOT NULL
);
