-- ============================================================
-- Playlists & Sharing
-- ============================================================

-- Playlists table
CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_image_url TEXT,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Playlist songs (ordered)
CREATE TABLE IF NOT EXISTS playlist_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  file_id UUID REFERENCES song_files(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(playlist_id, song_id)
);

-- Single song share links
CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  file_id UUID REFERENCES song_files(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES profiles(id),
  slug TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Analytics for both playlists and single shares
CREATE TABLE IF NOT EXISTS link_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type TEXT NOT NULL CHECK (link_type IN ('playlist', 'share')),
  link_id UUID NOT NULL,
  song_id UUID REFERENCES songs(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'play')),
  ip_hash TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_playlists_artist ON playlists(artist_id);
CREATE INDEX IF NOT EXISTS idx_playlists_slug ON playlists(slug);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id);
CREATE INDEX IF NOT EXISTS idx_share_links_slug ON share_links(slug);
CREATE INDEX IF NOT EXISTS idx_link_views_link ON link_views(link_type, link_id);

-- RLS
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_views ENABLE ROW LEVEL SECURITY;

-- Playlists: managers/artists can manage their own
CREATE POLICY "Users can view playlists for their artists"
  ON playlists FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR artist_id IN (SELECT id FROM artists WHERE user_id = auth.uid())
    OR artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
  );

CREATE POLICY "Users can create playlists"
  ON playlists FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      artist_id IN (SELECT id FROM artists WHERE user_id = auth.uid())
      OR artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
    )
  );

CREATE POLICY "Users can update their playlists"
  ON playlists FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR artist_id IN (SELECT id FROM artists WHERE user_id = auth.uid())
    OR artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
  );

CREATE POLICY "Users can delete their playlists"
  ON playlists FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR artist_id IN (SELECT id FROM artists WHERE user_id = auth.uid())
    OR artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
  );

-- Playlist songs: same access as playlist
CREATE POLICY "Users can manage playlist songs"
  ON playlist_songs FOR ALL TO authenticated
  USING (
    playlist_id IN (
      SELECT id FROM playlists WHERE
        created_by = auth.uid()
        OR artist_id IN (SELECT id FROM artists WHERE user_id = auth.uid())
        OR artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
    )
  );

-- Share links: creators can manage
CREATE POLICY "Users can view their share links"
  ON share_links FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Users can create share links"
  ON share_links FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can delete share links"
  ON share_links FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- Link views: public insert (via edge function), authenticated read
CREATE POLICY "Anyone can insert views via service role"
  ON link_views FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can view analytics"
  ON link_views FOR SELECT TO authenticated
  USING (true);
