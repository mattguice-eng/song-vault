// Supabase Edge Function — runs server-side with access to secrets
// Deploy with: npx supabase functions deploy send-submission

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  try {
    const { song_id } = await req.json()

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Fetch full song details
    const { data: song, error } = await supabase
      .from('songs')
      .select(`
        *,
        cowriters(*),
        files:song_files(*),
        artist:artists(id, stage_name, manager_id, user_id, user_profile:profiles!artists_user_id_fkey(full_name, email)),
        publishing_deal:publishing_deals(*, publisher:publishers(*))
      `)
      .eq('id', song_id)
      .single()

    if (error || !song) {
      return new Response(JSON.stringify({ error: 'Song not found' }), { status: 404 })
    }

    const publisher = song.publishing_deal?.publisher
    const artist = song.artist
    const artistProfile = artist?.user_profile
    const demoFile = song.files?.find((f: any) => f.file_type === 'demo')
    const workTapeFile = song.files?.find((f: any) => f.file_type === 'work_tape')

    if (!publisher?.email) {
      return new Response(JSON.stringify({ error: 'No publisher email found' }), { status: 400 })
    }

    // Build co-writers table HTML
    const cowritersTable = song.cowriters
      ?.map(
        (c: any) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #333;">${c.name}</td>
          <td style="padding:8px;border-bottom:1px solid #333;">${c.publisher_name ?? '—'}</td>
          <td style="padding:8px;border-bottom:1px solid #333;">${c.pro ?? '—'}</td>
          <td style="padding:8px;border-bottom:1px solid #333;font-weight:bold;">${c.split_percentage}%</td>
        </tr>
      `
      )
      .join('')

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:-apple-system,sans-serif;background:#0D0D0D;color:#F9FAFB;padding:40px;max-width:600px;margin:0 auto;">
        <div style="background:#1A1A1A;border-radius:12px;padding:32px;border:1px solid #2E2E2E;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
            <span style="font-size:24px;">🎵</span>
            <h1 style="margin:0;font-size:20px;color:#A78BFA;">Song Vault Submission</h1>
          </div>

          <h2 style="font-size:28px;margin:0 0 8px;color:#F9FAFB;">"${song.title}"</h2>
          <p style="color:#9CA3AF;margin:0 0 24px;">
            Written by ${artistProfile?.full_name ?? artist?.stage_name} &nbsp;·&nbsp;
            ${new Date(song.date_written).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>

          <h3 style="color:#A78BFA;margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Co-Writers & Splits</h3>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <thead>
              <tr style="background:#242424;">
                <th style="padding:8px;text-align:left;font-size:12px;color:#9CA3AF;">Name</th>
                <th style="padding:8px;text-align:left;font-size:12px;color:#9CA3AF;">Publisher</th>
                <th style="padding:8px;text-align:left;font-size:12px;color:#9CA3AF;">PRO</th>
                <th style="padding:8px;text-align:left;font-size:12px;color:#9CA3AF;">Split</th>
              </tr>
            </thead>
            <tbody>${cowritersTable}</tbody>
          </table>

          ${song.lyrics ? `
          <h3 style="color:#A78BFA;margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Lyrics</h3>
          <pre style="background:#242424;padding:16px;border-radius:8px;color:#F9FAFB;font-family:monospace;font-size:13px;white-space:pre-wrap;margin-bottom:24px;">${song.lyrics}</pre>
          ` : ''}

          <h3 style="color:#A78BFA;margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Files</h3>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">
            ${demoFile ? `<a href="${demoFile.file_url}" style="color:#A78BFA;">📎 Demo — ${demoFile.file_name}</a>` : '<p style="color:#6B7280;">No demo attached</p>'}
            ${workTapeFile ? `<a href="${workTapeFile.file_url}" style="color:#A78BFA;">📎 Work Tape — ${workTapeFile.file_name}</a>` : ''}
          </div>

          <p style="color:#6B7280;font-size:12px;margin:0;border-top:1px solid #2E2E2E;padding-top:16px;">
            Submitted via Song Vault · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </body>
      </html>
    `

    // Get manager profile for CC
    const { data: managerProfile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', artist.manager_id)
      .single()

    const ccEmails = managerProfile?.email ? [{ email: managerProfile.email }] : []

    // Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Song Vault <submissions@songvault.app>',
        to: [{ email: publisher.email }],
        cc: ccEmails,
        subject: `Song Submission: "${song.title}" — ${artistProfile?.full_name ?? artist?.stage_name}`,
        html: emailHtml,
      }),
    })

    if (!resendResponse.ok) {
      const err = await resendResponse.text()
      throw new Error(`Resend error: ${err}`)
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
