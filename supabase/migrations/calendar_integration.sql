-- ══════════════════════════════════════════════════════════════════════════════
-- Google Calendar Integration — Write Sessions
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Add Google Calendar fields to artists table
ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS google_calendar_id text,
  ADD COLUMN IF NOT EXISTS google_refresh_token text,
  ADD COLUMN IF NOT EXISTS calendar_sync_from date,
  ADD COLUMN IF NOT EXISTS calendar_last_synced_at timestamptz;

-- 2. Create write_sessions table
CREATE TABLE IF NOT EXISTS public.write_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  calendar_event_id text NOT NULL,           -- Google Calendar event ID (for dedup)
  event_date date NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  location text,
  raw_title text NOT NULL,                   -- e.g. "patrick mayberry — ricky jackson + jess cates"
  attendees jsonb DEFAULT '[]'::jsonb,       -- [{ name, email }]
  parsed_cowriters text[] DEFAULT '{}',      -- extracted writer names from title
  song_id uuid REFERENCES public.songs(id) ON DELETE SET NULL,  -- null until converted to a song
  status text NOT NULL DEFAULT 'upcoming'    -- upcoming | past | cancelled | logged
    CHECK (status IN ('upcoming', 'past', 'cancelled', 'logged')),
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- One calendar event per artist (prevents duplicates)
  UNIQUE (artist_id, calendar_event_id)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_write_sessions_artist_status
  ON public.write_sessions(artist_id, status);
CREATE INDEX IF NOT EXISTS idx_write_sessions_event_date
  ON public.write_sessions(event_date DESC);

-- 4. RLS policies
ALTER TABLE public.write_sessions ENABLE ROW LEVEL SECURITY;

-- Managers can see write sessions for their artists
CREATE POLICY "Managers can view their artists write sessions"
  ON public.write_sessions FOR SELECT
  USING (
    artist_id IN (
      SELECT id FROM public.artists WHERE manager_id = auth.uid()
    )
  );

-- Artists can see their own write sessions
CREATE POLICY "Artists can view own write sessions"
  ON public.write_sessions FOR SELECT
  USING (
    artist_id IN (
      SELECT id FROM public.artists WHERE user_id = auth.uid()
    )
  );

-- Managers can insert/update/delete write sessions for their artists
CREATE POLICY "Managers can manage their artists write sessions"
  ON public.write_sessions FOR ALL
  USING (
    artist_id IN (
      SELECT id FROM public.artists WHERE manager_id = auth.uid()
    )
  );

-- Artists can update their own write sessions (e.g., log a song from one)
CREATE POLICY "Artists can update own write sessions"
  ON public.write_sessions FOR UPDATE
  USING (
    artist_id IN (
      SELECT id FROM public.artists WHERE user_id = auth.uid()
    )
  );
