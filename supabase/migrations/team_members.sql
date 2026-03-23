-- ============================================================
-- TEAM MEMBERS — allow multiple managers/admins per artist
-- ============================================================

-- Junction table: many-to-many between artists and profiles
CREATE TABLE public.artist_team_members (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  artist_id uuid REFERENCES public.artists(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL DEFAULT 'manager',
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT valid_team_role CHECK (role IN ('manager', 'admin', 'viewer')),
  CONSTRAINT unique_artist_user UNIQUE (artist_id, user_id)
);

ALTER TABLE public.artist_team_members ENABLE ROW LEVEL SECURITY;

-- RLS: team members can see other team members for their artists
-- Owner (manager_id) and existing team members can view
CREATE POLICY "Team members can view team"
  ON artist_team_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
  );

-- Only the artist owner (manager_id) and admin team members can add/remove
CREATE POLICY "Owners can add team members"
  ON artist_team_members FOR INSERT TO authenticated
  WITH CHECK (
    artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
  );

CREATE POLICY "Owners can remove team members"
  ON artist_team_members FOR DELETE TO authenticated
  USING (
    artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid())
  );

-- ============================================================
-- UPDATE EXISTING RLS POLICIES to include team members
-- ============================================================

-- ============================================================
-- TEAM INVITES — pending invites for users who don't have accounts yet
-- ============================================================
CREATE TABLE public.artist_team_invites (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  artist_id uuid REFERENCES public.artists(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'manager',
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT valid_invite_role CHECK (role IN ('manager', 'admin', 'viewer')),
  CONSTRAINT unique_invite UNIQUE (artist_id, email)
);

ALTER TABLE public.artist_team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage invites"
  ON artist_team_invites FOR ALL TO authenticated
  USING (artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid()))
  WITH CHECK (artist_id IN (SELECT id FROM artists WHERE manager_id = auth.uid()));

-- Auto-link: when a new user signs up, check for pending invites and add them to teams
CREATE OR REPLACE FUNCTION public.handle_team_invite_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Find any pending invites for this email
  INSERT INTO public.artist_team_members (artist_id, user_id, role, invited_by)
  SELECT i.artist_id, NEW.id, i.role, i.invited_by
  FROM public.artist_team_invites i
  WHERE lower(i.email) = lower(NEW.email)
    AND i.accepted = false;

  -- Mark invites as accepted
  UPDATE public.artist_team_invites
  SET accepted = true
  WHERE lower(email) = lower(NEW.email)
    AND accepted = false;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_check_team_invites
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_team_invite_on_signup();

-- Helper: look up a user by email (bypasses profiles RLS)
CREATE OR REPLACE FUNCTION public.lookup_profile_by_email(p_email text)
RETURNS TABLE(id uuid, full_name text, email text)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT p.id, p.full_name, p.email
  FROM public.profiles p
  WHERE lower(p.email) = lower(p_email)
  LIMIT 1;
$$;

-- Helper: create a function to check team access
CREATE OR REPLACE FUNCTION public.has_artist_access(p_artist_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.artists
    WHERE id = p_artist_id AND (manager_id = auth.uid() OR user_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.artist_team_members
    WHERE artist_id = p_artist_id AND user_id = auth.uid()
  );
$$;

-- ── Artists table: allow team members to view ──
DROP POLICY IF EXISTS "Managers can manage their artists" ON public.artists;

CREATE POLICY "Owners can manage their artists"
  ON public.artists FOR ALL
  USING (manager_id = auth.uid() OR user_id = auth.uid());

CREATE POLICY "Team members can view artists"
  ON public.artists FOR SELECT
  USING (
    id IN (
      SELECT artist_id FROM public.artist_team_members
      WHERE user_id = auth.uid()
    )
  );

-- ── Songs: allow team members to view ──
DROP POLICY IF EXISTS "Managers can view all artist songs" ON public.songs;

CREATE POLICY "Managers and team can view artist songs"
  ON public.songs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.artists a
      WHERE a.id = artist_id AND a.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.artist_team_members atm
      WHERE atm.artist_id = artist_id AND atm.user_id = auth.uid()
    )
  );

-- ── Publishing deals: allow team members to view ──
DROP POLICY IF EXISTS "Managers can manage deals" ON public.publishing_deals;

CREATE POLICY "Managers and team can manage deals"
  ON public.publishing_deals FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.artists a
      WHERE a.id = artist_id AND a.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.artist_team_members atm
      WHERE atm.artist_id = artist_id AND atm.user_id = auth.uid()
    )
  );

-- ── Cowriters: allow team members ──
DROP POLICY IF EXISTS "Song owners can manage cowriters" ON public.cowriters;

CREATE POLICY "Song owners and team can manage cowriters"
  ON public.cowriters FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.songs s
      JOIN public.artists a ON a.id = s.artist_id
      WHERE s.id = song_id AND (a.user_id = auth.uid() OR a.manager_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.songs s
      JOIN public.artist_team_members atm ON atm.artist_id = s.artist_id
      WHERE s.id = song_id AND atm.user_id = auth.uid()
    )
  );

-- ── Song files: allow team members ──
DROP POLICY IF EXISTS "Song owners can manage files" ON public.song_files;

CREATE POLICY "Song owners and team can manage files"
  ON public.song_files FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.songs s
      JOIN public.artists a ON a.id = s.artist_id
      WHERE s.id = song_id AND (a.user_id = auth.uid() OR a.manager_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.songs s
      JOIN public.artist_team_members atm ON atm.artist_id = s.artist_id
      WHERE s.id = song_id AND atm.user_id = auth.uid()
    )
  );
