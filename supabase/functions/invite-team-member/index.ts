// Supabase Edge Function — Invite a team member to Song Vault
// Deploy with: npx supabase functions deploy invite-team-member --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
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
    const { artist_id, email, role, artist_name, inviter_name } = await req.json()

    console.log('[invite-team] received:', { artist_id, email, role, artist_name, inviter_name })

    if (!artist_id || !email) {
      return new Response(
        JSON.stringify({ error: 'artist_id and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const lowerEmail = email.toLowerCase()

    // Check if user already has an account
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('email', lowerEmail)
      .maybeSingle()

    if (existingProfile) {
      // User exists — add them directly to the team
      const { error: insertErr } = await supabaseAdmin
        .from('artist_team_members')
        .insert({
          artist_id,
          user_id: existingProfile.id,
          role: role ?? 'manager',
        })

      if (insertErr) {
        return new Response(
          JSON.stringify({ error: insertErr.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Mark any pending invite as accepted
      await supabaseAdmin
        .from('artist_team_invites')
        .update({ accepted: true })
        .eq('artist_id', artist_id)
        .eq('email', lowerEmail)

      // Send a notification email to the existing user
      const roleLabel = (role ?? 'manager').charAt(0).toUpperCase() + (role ?? 'manager').slice(1)
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Song Vault <onboarding@resend.dev>',
          to: [lowerEmail],
          subject: `You've been added to ${artist_name || 'an artist'}'s team on Song Vault`,
          html: buildAddedEmail(artist_name, inviter_name, roleLabel, existingProfile.full_name),
        }),
      })

      return new Response(
        JSON.stringify({ success: true, existing: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // User doesn't exist — create Supabase auth invite (generates magic link)
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      lowerEmail,
      {
        data: {
          role: 'manager',
          team_artist_id: artist_id,
          team_role: role ?? 'manager',
          full_name: '',
        },
        redirectTo: `${APP_URL}/callback`,
      }
    )

    console.log('[invite-team] auth invite result:', { inviteData, inviteError })

    if (inviteError) {
      return new Response(
        JSON.stringify({ error: inviteError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create the pending invite record
    await supabaseAdmin
      .from('artist_team_invites')
      .upsert({
        artist_id,
        email: lowerEmail,
        role: role ?? 'manager',
        invited_by: null,
      }, { onConflict: 'artist_id,email' })

    // Supabase's inviteUserByEmail already sends a magic link email
    // Once songvault.app domain is verified in Resend, we can add a branded email here too
    console.log('[invite-team] Supabase magic link invite sent to:', lowerEmail)

    return new Response(
      JSON.stringify({ success: true, existing: false }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[invite-team] error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── Email templates ──

function buildInviteEmail(artistName: string, inviterName: string, role: string, signUpUrl: string) {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0D0D0D;color:#F9FAFB;padding:40px;max-width:600px;margin:0 auto;">
      <div style="background:#1A1A1A;border-radius:12px;padding:32px;border:1px solid #2E2E2E;">
        <div style="margin-bottom:24px;">
          <h1 style="margin:0;font-size:22px;color:#A78BFA;">Song Vault</h1>
        </div>

        <h2 style="font-size:24px;margin:0 0 16px;color:#F9FAFB;">You're invited!</h2>

        <p style="color:#D1D5DB;font-size:16px;line-height:1.6;margin:0 0 8px;">
          <strong style="color:#F9FAFB;">${inviterName || 'A Song Vault user'}</strong> has invited you to join
          <strong style="color:#F9FAFB;">${artistName || 'their artist'}</strong>'s team as a <strong style="color:#A78BFA;">${role}</strong>.
        </p>

        <p style="color:#9CA3AF;font-size:14px;line-height:1.6;margin:0 0 32px;">
          Song Vault is where artists and their teams manage songs, splits, playlists, and publishing — all in one place.
        </p>

        <div style="text-align:center;margin-bottom:32px;">
          <a href="${signUpUrl}" style="display:inline-block;background:#7C3AED;color:#FFFFFF;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;">
            Accept Invitation
          </a>
        </div>

        <p style="color:#6B7280;font-size:13px;line-height:1.5;margin:0 0 8px;">
          When you create your account, you'll automatically be connected to ${artistName || 'the artist'}'s team.
        </p>

        <p style="color:#6B7280;font-size:12px;margin:0;border-top:1px solid #2E2E2E;padding-top:16px;">
          Song Vault · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>
    </body>
    </html>
  `
}

function buildAddedEmail(artistName: string, inviterName: string, role: string, memberName: string) {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0D0D0D;color:#F9FAFB;padding:40px;max-width:600px;margin:0 auto;">
      <div style="background:#1A1A1A;border-radius:12px;padding:32px;border:1px solid #2E2E2E;">
        <div style="margin-bottom:24px;">
          <h1 style="margin:0;font-size:22px;color:#A78BFA;">Song Vault</h1>
        </div>

        <h2 style="font-size:24px;margin:0 0 16px;color:#F9FAFB;">You've been added to a team!</h2>

        <p style="color:#D1D5DB;font-size:16px;line-height:1.6;margin:0 0 8px;">
          Hey${memberName ? ` ${memberName}` : ''},
        </p>

        <p style="color:#D1D5DB;font-size:16px;line-height:1.6;margin:0 0 32px;">
          <strong style="color:#F9FAFB;">${inviterName || 'A team admin'}</strong> added you to
          <strong style="color:#F9FAFB;">${artistName || 'an artist'}</strong>'s team as a <strong style="color:#A78BFA;">${role}</strong>.
          Log in to Song Vault to see the artist's catalog.
        </p>

        <p style="color:#6B7280;font-size:12px;margin:0;border-top:1px solid #2E2E2E;padding-top:16px;">
          Song Vault · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>
    </body>
    </html>
  `
}
