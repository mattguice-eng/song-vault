import { create } from 'zustand'
import { Session, User } from '@supabase/supabase-js'
import { Profile, Artist, Songwriter } from '../types/database'
import { supabase } from '../lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  needsPasswordSetup: boolean
  // Manager active artist context
  activeArtist: Artist | null
  setActiveArtist: (artist: Artist | null) => void
  // Writer linked songwriter entry
  songwriterProfile: Songwriter | null
  setSongwriterProfile: (sw: Songwriter | null) => void
  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  setNeedsPasswordSetup: (needs: boolean) => void
  fetchProfile: (userId: string) => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,
  needsPasswordSetup: false,
  activeArtist: null,
  songwriterProfile: null,

  setActiveArtist: (artist) => set({ activeArtist: artist }),
  setSongwriterProfile: (sw) => set({ songwriterProfile: sw }),
  setNeedsPasswordSetup: (needs) => set({ needsPasswordSetup: needs }),

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setProfile: (profile) => set({ profile }),

  setLoading: (loading) => set({ loading }),

  fetchProfile: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (!error && data) {
        const profile = data as Profile
        set({ profile })

        // If writer, also fetch their linked songwriter entry
        if (profile.role === 'writer') {
          const { data: swData } = await supabase
            .from('songwriters')
            .select('*')
            .eq('user_id', userId)
            .single()
          set({ songwriterProfile: swData ? (swData as Songwriter) : null })
        }
      }
    } catch {
      // Profile fetch failed — app will still load but profile will be null
      console.warn('Failed to fetch profile for user:', userId)
    }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, user: null, profile: null, activeArtist: null, songwriterProfile: null })
  },
}))
