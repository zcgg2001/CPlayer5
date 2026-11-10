-- Initial administrators must replace the temporary password before operations access.
CREATE TABLE IF NOT EXISTS cplayer_admin_bootstrap (
  userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  mustChange INTEGER NOT NULL DEFAULT 1 CHECK (mustChange IN (0, 1)),
  changedAt INTEGER
);
