// ─── Domain enums ────────────────────────────────────────────────────────────

export type UserRole = 'manager' | 'artist' | 'writer' | 'publisher'

export type SongStatus =
  | 'logged'
  | 'work_tape'
  | 'demo_ready'
  | 'complete'
  | 'submitted'

export type SongFileType = 'work_tape' | 'demo'

export type ProOrg = 'ASCAP' | 'BMI' | 'SESAC' | 'GMR' | 'SOCAN' | 'PRS' | 'other'

// ─── Row shapes (what you get back from SELECT) ───────────────────────────────

export interface Profile {
  id: string
  email: string
  full_name: string
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Artist {
  id: string
  user_id: string | null
  manager_id: string
  stage_name: string
  real_name: string | null
  avatar_url: string | null
  spotify_url: string | null
  invite_email: string | null
  invite_sent_at: string | null
  google_calendar_id: string | null
  google_refresh_token: string | null
  calendar_sync_from: string | null
  calendar_last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface Publisher {
  id: string
  user_id: string | null
  name: string
  email: string
  disco_label_id: string | null
  created_at: string
  updated_at: string
}

export interface PublishingDeal {
  id: string
  artist_id: string
  publisher_id: string
  start_date: string
  end_date: string | null
  is_active: boolean
  notes: string | null
  min_delivery: number | null
  period_type: 'initial' | 'option_1' | 'option_2' | null
  parent_deal_id: string | null
  created_at: string
  updated_at: string
}

export interface Song {
  id: string
  artist_id: string
  publishing_deal_id: string | null
  title: string
  date_written: string
  status: SongStatus
  lyrics: string | null
  notes: string | null
  bpm: number | null
  key: string | null
  total_splits: number
  submitted_at: string | null
  spotify_track_id: string | null
  spotify_track_name: string | null
  spotify_preview_url: string | null
  spotify_album_art: string | null
  spotify_track_url: string | null
  spotify_release_date: string | null
  created_at: string
  updated_at: string
}

export interface Songwriter {
  id: string
  user_id: string | null
  name: string
  legal_name: string | null
  email: string | null
  phone: string | null
  ipi_number: string | null
  pro: string | null
  publisher_id: string | null
  publisher_name: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Cowriter {
  id: string
  song_id: string
  songwriter_id: string | null
  name: string
  publisher_id: string | null
  publisher_name: string | null
  split_percentage: number
  ipi_number: string | null
  pro: string | null
  created_at: string
}

export interface SongFile {
  id: string
  song_id: string
  file_type: SongFileType
  file_url: string
  file_name: string
  file_size: number | null
  duration_seconds: number | null
  uploaded_by: string | null
  created_at: string
}

export type WriteSessionStatus = 'upcoming' | 'past' | 'cancelled' | 'logged'

export interface WriteSession {
  id: string
  artist_id: string
  calendar_event_id: string
  event_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  raw_title: string
  attendees: { name?: string; email: string }[]
  parsed_cowriters: string[]
  song_id: string | null
  status: WriteSessionStatus
  synced_at: string
  created_at: string
  updated_at: string
}

// ─── Supabase-js v2 Database type ────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string
          email: string
          full_name: string
          role: UserRole
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string
          full_name?: string
          role?: UserRole
          avatar_url?: string | null
          updated_at?: string
        }
      }
      artists: {
        Row: Artist
        Insert: {
          user_id: string
          manager_id: string
          stage_name: string
          real_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          stage_name?: string
          real_name?: string | null
          updated_at?: string
        }
      }
      publishers: {
        Row: Publisher
        Insert: {
          user_id?: string | null
          name: string
          email: string
          disco_label_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          email?: string
          disco_label_id?: string | null
          updated_at?: string
        }
      }
      publishing_deals: {
        Row: PublishingDeal
        Insert: {
          artist_id: string
          publisher_id: string
          start_date: string
          end_date?: string | null
          is_active?: boolean
          notes?: string | null
          min_delivery?: number | null
          period_type?: 'initial' | 'option_1' | 'option_2' | null
          parent_deal_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          end_date?: string | null
          is_active?: boolean
          notes?: string | null
          min_delivery?: number | null
          period_type?: 'initial' | 'option_1' | 'option_2' | null
          updated_at?: string
        }
      }
      songs: {
        Row: Song
        Insert: {
          artist_id: string
          publishing_deal_id?: string | null
          title: string
          date_written: string
          status?: SongStatus
          lyrics?: string | null
          notes?: string | null
          bpm?: number | null
          key?: string | null
          total_splits?: number
          submitted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          date_written?: string
          status?: SongStatus
          lyrics?: string | null
          notes?: string | null
          bpm?: number | null
          key?: string | null
          total_splits?: number
          submitted_at?: string | null
          updated_at?: string
        }
      }
      cowriters: {
        Row: Cowriter
        Insert: {
          song_id: string
          name: string
          publisher_id?: string | null
          publisher_name?: string | null
          split_percentage: number
          ipi_number?: string | null
          pro?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          publisher_id?: string | null
          publisher_name?: string | null
          split_percentage?: number
          ipi_number?: string | null
          pro?: string | null
        }
      }
      song_files: {
        Row: SongFile
        Insert: {
          song_id: string
          file_type: SongFileType
          file_url: string
          file_name: string
          file_size?: number | null
          duration_seconds?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          file_url?: string
          file_name?: string
          file_size?: number | null
          duration_seconds?: number | null
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

export interface Submission {
  id: string
  artist_id: string
  publisher_id: string | null
  publisher_name: string
  submitted_by: string
  song_count: number
  demo_count: number
  notes: string | null
  created_at: string
}

export interface SubmissionSong {
  id: string
  submission_id: string
  song_id: string
  had_demo: boolean
  created_at: string
}

// ─── Joined / computed types used in the UI ───────────────────────────────────

export interface SongWithDetails extends Song {
  cowriters: Cowriter[]
  files: SongFile[]
  artist?: Artist & { profiles?: Profile }
  publishing_deal?: PublishingDeal & { publisher: Publisher }
}
