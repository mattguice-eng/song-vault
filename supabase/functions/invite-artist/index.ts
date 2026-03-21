// Supabase Edge Function — Invite an artist to join Song Vault
// Deploy with: npx supabase functions deploy invite-artist

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') ?? 'https://y-beta-lyart-64.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { artist_id, email, artist_name, manager_name } = await req.json()

    console.log('[invite-artist] received request:', { artist_id, email })

    if (!artist_id || !email) {
      return new Response(
        JSON.stringify({ error: 'artist_id and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[invite-artist] creating admin client...')
    console.log('[invite-artist] SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING')
    console.log('[invite-artist] SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'set' : 'MISSING')
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Check if a user with this email already exists via profiles table
    console.log('[invite-artist] checking profiles table...')
    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle()
    console.log('[invite-artist] profile check result:', { existingProfile, profileError })

    if (existingProfile) {
      await supabaseAdmin
        .from('artists')
        .update({
          user_id: existingProfile.id,
          invite_email: email.toLowerCase(),
          invite_sent_at: new Date().toISOString(),
        })
        .eq('id', artist_id)

      return new Response(
        JSON.stringify({ success: true, existing: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send Supabase invite
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      {
        data: {
          role: 'artist',
          artist_id,
          full_name: artist_name ?? '',
        },
        redirectTo: `${APP_URL}/callback`,
      }
    )

    console.log('[invite-artist] invite result:', { inviteData, inviteError })

    if (inviteError) {
      return new Response(
        JSON.stringify({ error: inviteError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    await supabaseAdmin
      .from('artists')
      .update({
        invite_email: email.toLowerCase(),
        invite_sent_at: new Date().toISOString(),
      })
      .eq('id', artist_id)

    return new Response(
      JSON.stringify({ success: true, existing: false }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[invite-artist] error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
