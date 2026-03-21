-- ============================================================
-- SONG VAULT — Writer Accounts Migration
-- Run this once in Supabase → SQL Editor → New Query
-- ============================================================

-- 1. Add 'writer' to the role enum
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('manager', 'artist', 'writer', 'publisher'));

-- 2. Link songwriter registry entries to user accounts
ALTER TABLE public.songwriters
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Ensure one songwriter entry per user
CREATE UNIQUE INDEX IF NOT EXISTS songwriters_user_id_unique
  ON public.songwriters(user_id) WHERE user_id IS NOT NULL;

-- 3. Enable RLS on songwriters (was missing)
ALTER TABLE public.songwriters ENABLE ROW LEVEL SECURITY;

-- Songwriters: anyone authenticated can search the registry
CREATE POLICY "Authenticated users can read songwriter registry"
  ON public.songwriters FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Songwriters: managers and artists can insert new registry entries
-- Uses auth.uid() directly in subquery — no recursive policy risk
CREATE POLICY "Managers and artists can create songwriter entries"
  ON public.songwriters FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('manager', 'artist', 'writer')
    )
  );

-- Songwriters: managers can update any entry; writers can update their own
CREATE POLICY "Managers can update any songwriter entry"
  ON public.songwriters FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'manager'
    )
  );

CREATE POLICY "Writers can update their own entry"
  ON public.songwriters FOR UPDATE
  USING (user_id = auth.uid());

-- 4. Songs: writers can view (and update lyrics/notes on) credited songs
--    FIX: qualify the row's primary key as songs.id to avoid ambiguity with joined table ids
CREATE POLICY "Writers can view credited songs"
  ON public.songs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cowriters cw
      JOIN public.songwriters sw ON sw.id = cw.songwriter_id
      WHERE cw.song_id = songs.id AND sw.user_id = auth.uid()
    )
  );

CREATE POLICY "Writers can update credited songs"
  ON public.songs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.cowriters cw
      JOIN public.songwriters sw ON sw.id = cw.songwriter_id
      WHERE cw.song_id = songs.id AND sw.user_id = auth.uid()
    )
  );

-- 5. Managers can fully manage songs for their artists (not just SELECT)
CREATE POLICY "Managers can manage artist songs"
  ON public.songs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artists a
      WHERE a.id = songs.artist_id AND a.manager_id = auth.uid()
    )
  );

CREATE POLICY "Managers can update artist songs"
  ON public.songs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.artists a
      WHERE a.id = songs.artist_id AND a.manager_id = auth.uid()
    )
  );

-- 6. Cowriters: writers can view ALL cowriter entries on songs they're credited on
--    (so they see the full split breakdown for the song)
--    cowriters.song_id is the current row; cw2 is the alias for the join
CREATE POLICY "Writers can view cowriters on credited songs"
  ON public.cowriters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cowriters cw2
      JOIN public.songwriters sw ON sw.id = cw2.songwriter_id
      WHERE cw2.song_id = cowriters.song_id AND sw.user_id = auth.uid()
    )
  );

-- 7. Song files: writers can view AND upload files for credited songs
--    song_files.song_id is the current row — qualify as song_files.song_id
CREATE POLICY "Writers can view files on credited songs"
  ON public.song_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.songs s
      JOIN public.cowriters cw ON cw.song_id = s.id
      JOIN public.songwriters sw ON sw.id = cw.songwriter_id
      WHERE s.id = song_files.song_id AND sw.user_id = auth.uid()
    )
  );

CREATE POLICY "Writers can upload files for credited songs"
  ON public.song_files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.songs s
      JOIN public.cowriters cw ON cw.song_id = s.id
      JOIN public.songwriters sw ON sw.id = cw.songwriter_id
      WHERE s.id = song_files.song_id AND sw.user_id = auth.uid()
    )
  );

-- 8. Profiles: allow all authenticated users to read profiles
--    (needed for manager email lookup when linking writer accounts)
--    Using a simple auth.uid() IS NOT NULL avoids recursive policy evaluation
--    Profile data (name, email, role) is not sensitive enough to restrict further
CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 9. Publishing deals: writers can view deals for songs they're credited on
--    FIX: qualify the row's primary key as publishing_deals.id
CREATE POLICY "Writers can view deals for credited songs"
  ON public.publishing_deals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.songs s
      JOIN public.cowriters cw ON cw.song_id = s.id
      JOIN public.songwriters sw ON sw.id = cw.songwriter_id
      WHERE s.publishing_deal_id = publishing_deals.id AND sw.user_id = auth.uid()
    )
  );
