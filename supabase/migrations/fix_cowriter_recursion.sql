-- ============================================================
-- SONG VAULT — Fix infinite recursion in cowriter policies
-- Run this in Supabase → SQL Editor → New Query
-- ============================================================

-- The problem: policies on cowriters, songs, song_files, and publishing_deals
-- all query the cowriters table to check if a user is credited on a song.
-- When Postgres evaluates those policies it hits the cowriters RLS again,
-- causing infinite recursion.
--
-- The fix: a SECURITY DEFINER function that runs without RLS, used by all
-- four policies. The function is the only place that reads cowriters directly.

CREATE OR REPLACE FUNCTION public.user_is_credited_on_song(p_song_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cowriters c
    JOIN public.songwriters sw ON sw.id = c.songwriter_id
    WHERE c.song_id = p_song_id
      AND sw.user_id = auth.uid()
  );
$$;

-- Drop the broken policies
DROP POLICY IF EXISTS "Writers can view credited songs"          ON public.songs;
DROP POLICY IF EXISTS "Writers can update credited songs"        ON public.songs;
DROP POLICY IF EXISTS "Writers can view cowriters on credited songs" ON public.cowriters;
DROP POLICY IF EXISTS "Writers can view files on credited songs" ON public.song_files;
DROP POLICY IF EXISTS "Writers can upload files for credited songs" ON public.song_files;
DROP POLICY IF EXISTS "Writers can view deals for credited songs" ON public.publishing_deals;

-- Recreate all four using the security-definer function
CREATE POLICY "Writers can view credited songs"
  ON public.songs FOR SELECT
  USING (public.user_is_credited_on_song(songs.id));

CREATE POLICY "Writers can update credited songs"
  ON public.songs FOR UPDATE
  USING (public.user_is_credited_on_song(songs.id));

CREATE POLICY "Writers can view cowriters on credited songs"
  ON public.cowriters FOR SELECT
  USING (public.user_is_credited_on_song(cowriters.song_id));

CREATE POLICY "Writers can view files on credited songs"
  ON public.song_files FOR SELECT
  USING (public.user_is_credited_on_song(song_files.song_id));

CREATE POLICY "Writers can upload files for credited songs"
  ON public.song_files FOR INSERT
  WITH CHECK (public.user_is_credited_on_song(song_files.song_id));

CREATE POLICY "Writers can view deals for credited songs"
  ON public.publishing_deals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.songs s
      WHERE s.publishing_deal_id = publishing_deals.id
        AND public.user_is_credited_on_song(s.id)
    )
  );
