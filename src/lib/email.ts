import { SongWithDetails } from '../types/database'

// NOTE: Resend cannot be called directly from a React Native client —
// it must go through a server/edge function. This module calls a
// Supabase Edge Function that has the RESEND_API_KEY server-side.
// See supabase/functions/send-submission/index.ts

import { supabase } from './supabase'

export async function sendSubmissionEmail(song: SongWithDetails): Promise<void> {
  const { error } = await supabase.functions.invoke('send-submission', {
    body: { song_id: song.id },
  })

  if (error) {
    throw new Error(error.message ?? 'Failed to send submission email')
  }
}
