-- ============================================================
-- PUBLISHER SUBMISSIONS
-- Track batch exports sent to publishers
-- ============================================================

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  publisher_id uuid references public.publishers(id) on delete set null,
  publisher_name text not null,  -- snapshot in case publisher record changes
  submitted_by uuid not null references auth.users(id),
  song_count int not null default 0,
  demo_count int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table public.submission_songs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  had_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.submissions enable row level security;
alter table public.submission_songs enable row level security;

create policy "Managers can manage submissions for their artists"
  on public.submissions for all using (
    exists (
      select 1 from public.artists a
      where a.id = submissions.artist_id
      and a.manager_id = auth.uid()
    )
  );

create policy "Artists can view their own submissions"
  on public.submissions for select using (
    exists (
      select 1 from public.artists a
      where a.id = submissions.artist_id
      and a.user_id = auth.uid()
    )
  );

create policy "Submission songs follow submission access"
  on public.submission_songs for all using (
    exists (
      select 1 from public.submissions s
      join public.artists a on a.id = s.artist_id
      where s.id = submission_songs.submission_id
      and (a.manager_id = auth.uid() or a.user_id = auth.uid())
    )
  );

-- Index for fast lookups
create index idx_submissions_artist on public.submissions(artist_id);
create index idx_submission_songs_submission on public.submission_songs(submission_id);
create index idx_submission_songs_song on public.submission_songs(song_id);
