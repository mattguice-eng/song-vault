-- ============================================================
-- Artist Invite System
-- Run in Supabase → SQL Editor
-- ============================================================

-- 1. Make user_id nullable so artists can exist before they've signed up
ALTER TABLE public.artists ALTER COLUMN user_id DROP NOT NULL;

-- 2. Add invite tracking columns
ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS invite_email text,
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;

-- 3. Update handle_new_user trigger to auto-link artist record
--    when an invited user signs up (their metadata contains artist_id)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  artist_id_meta text;
BEGIN
  -- Create the user profile
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'artist')
  );

  -- If this user was invited as an artist, link them to their artist record
  artist_id_meta := new.raw_user_meta_data->>'artist_id';
  IF artist_id_meta IS NOT NULL THEN
    UPDATE public.artists
      SET user_id = new.id
      WHERE id = artist_id_meta::uuid;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
