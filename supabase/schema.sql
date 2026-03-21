-- ============================================================
-- SONG VAULT — Full Database Schema
-- Run this in Supabase → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text not null,
  role text not null check (role in ('manager', 'artist', 'publisher')),
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'artist')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- PUBLISHERS
-- ============================================================
create table public.publishers (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text not null,
  disco_label_id text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- ARTISTS
-- ============================================================
create table public.artists (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  manager_id uuid references public.profiles(id) on delete cascade not null,
  stage_name text not null,
  real_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- PUBLISHING DEALS
-- ============================================================
create table public.publishing_deals (
  id uuid default uuid_generate_v4() primary key,
  artist_id uuid references public.artists(id) on delete cascade not null,
  publisher_id uuid references public.publishers(id) on delete cascade not null,
  start_date date not null,
  end_date date,
  is_active boolean default true not null,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- SONGS
-- ============================================================
create table public.songs (
  id uuid default uuid_generate_v4() primary key,
  artist_id uuid references public.artists(id) on delete cascade not null,
  publishing_deal_id uuid references public.publishing_deals(id) on delete set null,
  title text not null,
  date_written date not null,
  status text not null default 'logged'
    check (status in ('logged', 'work_tape', 'demo_ready', 'complete', 'submitted')),
  lyrics text,
  notes text,
  bpm integer,
  key text,
  total_splits integer default 0 not null,
  submitted_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- CO-WRITERS
-- ============================================================
create table public.cowriters (
  id uuid default uuid_generate_v4() primary key,
  song_id uuid references public.songs(id) on delete cascade not null,
  name text not null,
  publisher_id uuid references public.publishers(id) on delete set null,
  publisher_name text,
  split_percentage numeric(5,2) not null check (split_percentage > 0 and split_percentage <= 100),
  ipi_number text,
  pro text check (pro in ('ASCAP', 'BMI', 'SESAC', 'GMR', 'SOCAN', 'PRS', 'other')),
  created_at timestamptz default now() not null
);

-- Auto-update total_splits on songs when cowriters change
create or replace function public.update_song_splits()
returns trigger as $$
begin
  update public.songs
  set total_splits = (
    select coalesce(sum(split_percentage), 0)
    from public.cowriters
    where song_id = coalesce(new.song_id, old.song_id)
  )
  where id = coalesce(new.song_id, old.song_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger on_cowriter_change
  after insert or update or delete on public.cowriters
  for each row execute procedure public.update_song_splits();

-- ============================================================
-- SONG FILES (work tapes + demos)
-- ============================================================
create table public.song_files (
  id uuid default uuid_generate_v4() primary key,
  song_id uuid references public.songs(id) on delete cascade not null,
  file_type text not null check (file_type in ('work_tape', 'demo')),
  file_url text not null,
  file_name text not null,
  file_size integer,
  duration_seconds integer,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null
);

-- Auto-advance song status when files are uploaded
create or replace function public.advance_song_status()
returns trigger as $$
begin
  if new.file_type = 'work_tape' then
    update public.songs
    set status = case
      when status = 'logged' then 'work_tape'
      else status
    end
    where id = new.song_id;
  elsif new.file_type = 'demo' then
    update public.songs
    set status = case
      when status in ('logged', 'work_tape') then 'demo_ready'
      else status
    end
    where id = new.song_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_file_uploaded
  after insert on public.song_files
  for each row execute procedure public.advance_song_status();

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger set_artists_updated_at before update on public.artists
  for each row execute procedure public.set_updated_at();
create trigger set_publishers_updated_at before update on public.publishers
  for each row execute procedure public.set_updated_at();
create trigger set_deals_updated_at before update on public.publishing_deals
  for each row execute procedure public.set_updated_at();
create trigger set_songs_updated_at before update on public.songs
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.artists enable row level security;
alter table public.publishers enable row level security;
alter table public.publishing_deals enable row level security;
alter table public.songs enable row level security;
alter table public.cowriters enable row level security;
alter table public.song_files enable row level security;

-- Profiles: users can read their own profile; managers can read all
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Artists: manager can manage their artists; artist can see themselves
create policy "Managers can manage their artists" on public.artists
  for all using (
    manager_id = auth.uid() or user_id = auth.uid()
  );

-- Publishers: managers can create/read publishers
create policy "Managers can manage publishers" on public.publishers
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'manager'
    )
  );
create policy "Artists can view publishers" on public.publishers
  for select using (auth.uid() is not null);

-- Publishing deals: manager can manage; artist can view their own
create policy "Managers can manage deals" on public.publishing_deals
  for all using (
    exists (
      select 1 from public.artists a
      where a.id = artist_id and a.manager_id = auth.uid()
    )
  );
create policy "Artists can view own deals" on public.publishing_deals
  for select using (
    exists (
      select 1 from public.artists a
      where a.id = artist_id and a.user_id = auth.uid()
    )
  );

-- Songs: artists can manage their own; managers can view all their artists' songs
create policy "Artists can manage own songs" on public.songs
  for all using (
    exists (
      select 1 from public.artists a
      where a.id = artist_id and a.user_id = auth.uid()
    )
  );
create policy "Managers can view all artist songs" on public.songs
  for select using (
    exists (
      select 1 from public.artists a
      where a.id = artist_id and a.manager_id = auth.uid()
    )
  );

-- Cowriters: same access as songs
create policy "Song owners can manage cowriters" on public.cowriters
  for all using (
    exists (
      select 1 from public.songs s
      join public.artists a on a.id = s.artist_id
      where s.id = song_id and (a.user_id = auth.uid() or a.manager_id = auth.uid())
    )
  );

-- Song files: same access as songs
create policy "Song owners can manage files" on public.song_files
  for all using (
    exists (
      select 1 from public.songs s
      join public.artists a on a.id = s.artist_id
      where s.id = song_id and (a.user_id = auth.uid() or a.manager_id = auth.uid())
    )
  );

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public)
values ('song-files', 'song-files', false);

create policy "Authenticated users can upload song files"
  on storage.objects for insert
  with check (bucket_id = 'song-files' and auth.role() = 'authenticated');

create policy "Song file owners can read files"
  on storage.objects for select
  using (bucket_id = 'song-files' and auth.role() = 'authenticated');

create policy "Song file owners can delete files"
  on storage.objects for delete
  using (bucket_id = 'song-files' and auth.role() = 'authenticated');
