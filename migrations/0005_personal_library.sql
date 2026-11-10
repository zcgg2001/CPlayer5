CREATE TABLE IF NOT EXISTS cplayer_shared_playlists (
  id TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  body TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_playlists_owner ON cplayer_shared_playlists(ownerId);
CREATE TABLE IF NOT EXISTS cplayer_playlist_members (
  playlistId TEXT NOT NULL REFERENCES cplayer_shared_playlists(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer','editor')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  PRIMARY KEY (playlistId,userId)
);
CREATE INDEX IF NOT EXISTS playlist_members_user ON cplayer_playlist_members(userId,status);
