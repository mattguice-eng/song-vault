// Supabase Edge Function — Google Calendar Sync
// Handles two actions:
//   1. "exchange" — exchange OAuth auth code for tokens, store refresh_token
//   2. "sync" — fetch calendar events and upsert into write_sessions
//
// Deploy with: npx supabase functions deploy sync-calendar --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const APP_URL = Deno.env.get('APP_URL') ?? 'https://y-beta-lyart-64.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Token helpers ─────────────────────────────────────────────────────────

async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token exchange failed: ${err}`)
  }
  return res.json()
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token refresh failed: ${err}`)
  }
  const data = await res.json()
  return data.access_token
}

// ─── Calendar helpers ──────────────────────────────────────────────────────

interface CalendarEvent {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
  attendees?: { email: string; displayName?: string; responseStatus?: string }[]
  status?: string // confirmed, tentative, cancelled
}

function parseCowriters(title: string): string[] {
  let cleaned = title
    .replace(/^(write|writing|session|co-?write)[:\s\-–—]*/i, '')
    .trim()
  return cleaned
    .split(/\s*[—–\/\+&]\s*|\s*,\s*|\s+and\s+|\s+x\s+/i)
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n.length < 50)
    .map((name) =>
      name.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    )
}

// Keywords that indicate an event is NOT a write session
const EXCLUDE_KEYWORDS = [
  'block', 'hold', 'lunch', 'dinner', 'meeting', 'call', 'travel',
  'off', 'off day', 'day off', 'vacation', 'pto', 'break', 'personal',
  'appointment', 'doctor', 'dentist', 'gym', 'workout', 'flight',
  'pickup', 'drop off', 'dropoff', 'errands', 'busy', 'unavailable',
  'studio hold', 'reserved', 'reminder', 'birthday', 'anniversary',
]

function isLikelyWrite(title: string, attendeeCount: number): boolean {
  const lower = title.toLowerCase().trim()

  // Check exclusion keywords (exact match or starts with)
  for (const kw of EXCLUDE_KEYWORDS) {
    if (lower === kw || lower.startsWith(kw + ' ') || lower.startsWith(kw + ':')) return false
  }

  // Single word titles are almost never writes
  if (!lower.includes(' ') && !lower.includes('—') && !lower.includes('–') && !lower.includes('+')) return false

  // Strong signal: title has name separators (—, –, +, &, /, x)
  const hasSeparators = /[—–\+&\/]/.test(title) || /\s+x\s+/i.test(title)
  if (hasSeparators) {
    // Check if segments look like names (at least 2 segments with letters)
    const segments = title.split(/\s*[—–\/\+&]\s*|\s+x\s+/i).filter(s => s.trim().length > 1)
    if (segments.length >= 2) return true
  }

  // Medium signal: has multiple attendees (3+ people in a room = probably a write)
  if (attendeeCount >= 3) return true

  // Has "write" or "session" or "co-write" in the title
  if (/\b(writ|session|co[\s-]?writ)/i.test(lower)) return true

  // Default: not confident it's a write
  return false
}

async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string,
  syncFrom: string,
  updatedSince?: string,
): Promise<CalendarEvent[]> {
  const timeMin = new Date(syncFrom + 'T00:00:00Z').toISOString()
  // Fetch up to 60 days in the future
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + 60)
  const timeMax = futureDate.toISOString()

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',     // expand recurring events
    orderBy: 'startTime',
    maxResults: '250',
  })

  // Only fetch events modified since last sync (for subsequent syncs)
  if (updatedSince) {
    params.set('updatedMin', new Date(updatedSince).toISOString())
    // When using updatedMin, orderBy must be 'updated' not 'startTime'
    params.set('orderBy', 'updated')
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Calendar fetch failed: ${err}`)
  }
  const data = await res.json()
  return data.items ?? []
}

// ─── Main handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action } = body

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: exchange — OAuth code → tokens, store on artist
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'exchange') {
      const { code, artist_id, redirect_uri, calendar_id, sync_from } = body

      console.log('[sync-calendar] exchanging code for artist:', artist_id)

      const tokens = await exchangeCodeForTokens(code, redirect_uri)
      console.log('[sync-calendar] got tokens, has refresh:', !!tokens.refresh_token)

      // Store refresh token and calendar config on the artist
      const { error: updateErr } = await supabaseAdmin
        .from('artists')
        .update({
          google_refresh_token: tokens.refresh_token,
          google_calendar_id: calendar_id || 'primary',
          calendar_sync_from: sync_from || new Date().toISOString().split('T')[0],
        })
        .eq('id', artist_id)

      if (updateErr) throw updateErr

      return new Response(
        JSON.stringify({ success: true, has_refresh_token: !!tokens.refresh_token }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: preview — fetch events, score them, return for review (no DB writes)
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'preview') {
      const { artist_id, is_initial } = body

      console.log('[sync-calendar] preview for artist:', artist_id, 'initial:', !!is_initial)

      const { data: artist, error: artistErr } = await supabaseAdmin
        .from('artists')
        .select('google_refresh_token, google_calendar_id, calendar_sync_from, calendar_last_synced_at, stage_name, real_name')
        .eq('id', artist_id)
        .single()

      if (artistErr || !artist) throw new Error('Artist not found')
      if (!artist.google_refresh_token) {
        return new Response(
          JSON.stringify({ error: 'Calendar not connected' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const accessToken = await refreshAccessToken(artist.google_refresh_token)
      const calendarId = artist.google_calendar_id || 'primary'

      // First sync: use sync_from date, no updatedMin
      // Subsequent syncs: from today, only events changed since last sync
      const isFirstSync = !artist.calendar_last_synced_at || is_initial
      const syncFrom = isFirstSync
        ? (artist.calendar_sync_from || new Date().toISOString().split('T')[0])
        : new Date().toISOString().split('T')[0]
      const updatedSince = isFirstSync ? undefined : artist.calendar_last_synced_at

      const events = await fetchCalendarEvents(accessToken, calendarId, syncFrom, updatedSince)

      console.log('[sync-calendar] preview fetched', events.length, 'events, first sync:', isFirstSync)

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const artistNames = [
        artist.stage_name?.toLowerCase(),
        artist.real_name?.toLowerCase(),
      ].filter(Boolean) as string[]

      // Get existing sessions — imported ones are hidden, dismissed ones show unchecked
      const { data: existingSessions } = await supabaseAdmin
        .from('write_sessions')
        .select('id, calendar_event_id, status, raw_title, event_date, parsed_cowriters')
        .eq('artist_id', artist_id)

      const importedIds = new Set<string>()
      const dismissedIds = new Set<string>()
      const upcomingSessions: typeof existingSessions = []
      for (const s of (existingSessions ?? [])) {
        if (s.status === 'dismissed') {
          dismissedIds.add(s.calendar_event_id)
        } else {
          importedIds.add(s.calendar_event_id)
          if (s.status === 'upcoming') upcomingSessions.push(s)
        }
      }

      const previewEvents = []

      // Track which calendar event IDs came back from Google
      const googleEventIds = new Set<string>()
      // Track events that Google says are cancelled
      const cancelledGoogleIds = new Set<string>()

      for (const event of events) {
        googleEventIds.add(event.id)
        if (event.status === 'cancelled') {
          cancelledGoogleIds.add(event.id)
          continue
        }
        if (!event.summary) continue
        if (importedIds.has(event.id)) continue // already imported — hide

        const startDate = event.start?.dateTime
          ? new Date(event.start.dateTime)
          : event.start?.date
            ? new Date(event.start.date + 'T12:00:00')
            : null

        if (!startDate) continue

        const eventDate = startDate.toISOString().split('T')[0]
        const isPast = startDate < today
        const wasDismissed = dismissedIds.has(event.id)

        const allWriters = parseCowriters(event.summary)
        const cowriters = allWriters.filter(
          (name) => !artistNames.some((an) => name.toLowerCase().includes(an) || an.includes(name.toLowerCase()))
        )

        const attendees = (event.attendees ?? [])
          .filter((a) => a.responseStatus !== 'declined')
          .map((a) => ({ name: a.displayName || null, email: a.email }))

        const likelyWrite = isLikelyWrite(event.summary, attendees.length)

        previewEvents.push({
          calendar_event_id: event.id,
          raw_title: event.summary,
          event_date: eventDate,
          start_time: event.start?.dateTime || null,
          end_time: event.end?.dateTime || null,
          location: event.location || null,
          attendees,
          parsed_cowriters: cowriters,
          is_past: isPast,
          likely_write: likelyWrite,
          previously_dismissed: wasDismissed,
        })
      }

      // Sort: likely writes first, dismissed last, then by date descending
      previewEvents.sort((a, b) => {
        if (a.previously_dismissed !== b.previously_dismissed) return a.previously_dismissed ? 1 : -1
        if (a.likely_write !== b.likely_write) return a.likely_write ? -1 : 1
        return b.event_date.localeCompare(a.event_date)
      })

      // Find upcoming write sessions that have been cancelled or deleted from calendar
      // On incremental syncs (updatedMin), Google only returns modified events,
      // so we can only flag events explicitly cancelled — not missing ones
      const cancelledSessions = upcomingSessions
        .filter(s => cancelledGoogleIds.has(s.calendar_event_id) || (isFirstSync && !googleEventIds.has(s.calendar_event_id)))
        .map(s => ({
          id: s.id,
          calendar_event_id: s.calendar_event_id,
          raw_title: s.raw_title,
          event_date: s.event_date,
          parsed_cowriters: s.parsed_cowriters ?? [],
        }))

      console.log('[sync-calendar] preview:', previewEvents.length, 'events,',
        previewEvents.filter(e => e.likely_write && !e.previously_dismissed).length, 'likely writes,',
        previewEvents.filter(e => e.previously_dismissed).length, 'previously dismissed,',
        cancelledSessions.length, 'cancelled')

      return new Response(
        JSON.stringify({ events: previewEvents, cancelled: cancelledSessions, is_first_sync: isFirstSync }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: import — save approved events to write_sessions
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'import') {
      const { artist_id, selected_events, dismissed_events, delete_session_ids } = body

      const selectedList = selected_events ?? []
      const dismissedList = dismissed_events ?? []
      const deleteIds = delete_session_ids ?? []

      console.log('[sync-calendar] importing', selectedList.length, 'events, dismissing', dismissedList.length, ', deleting', deleteIds.length, 'for artist:', artist_id)

      if (selectedList.length === 0 && dismissedList.length === 0 && deleteIds.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No events to process' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Delete cancelled sessions
      if (deleteIds.length > 0) {
        const { error: delErr } = await supabaseAdmin
          .from('write_sessions')
          .delete()
          .in('id', deleteIds)
          .eq('artist_id', artist_id)
        if (delErr) console.error('[sync-calendar] delete error:', delErr)
        else console.log('[sync-calendar] deleted', deleteIds.length, 'cancelled sessions')
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      let imported = 0

      // Save selected events as upcoming/past
      for (const event of selectedList) {
        const startDate = event.event_date ? new Date(event.event_date + 'T12:00:00') : null
        const isPast = startDate ? startDate < today : false

        const { error: upsertErr } = await supabaseAdmin
          .from('write_sessions')
          .upsert(
            {
              artist_id,
              calendar_event_id: event.calendar_event_id,
              event_date: event.event_date,
              start_time: event.start_time || null,
              end_time: event.end_time || null,
              location: event.location || null,
              raw_title: event.raw_title,
              attendees: event.attendees || [],
              parsed_cowriters: event.parsed_cowriters || [],
              status: isPast ? 'past' : 'upcoming',
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'artist_id,calendar_event_id' }
          )

        if (upsertErr) {
          console.error('[sync-calendar] import upsert error:', upsertErr)
        } else {
          imported++
        }
      }

      // Save dismissed events so they show unchecked on future syncs
      for (const event of dismissedList) {
        await supabaseAdmin
          .from('write_sessions')
          .upsert(
            {
              artist_id,
              calendar_event_id: event.calendar_event_id,
              event_date: event.event_date,
              start_time: event.start_time || null,
              end_time: event.end_time || null,
              location: event.location || null,
              raw_title: event.raw_title,
              attendees: event.attendees || [],
              parsed_cowriters: event.parsed_cowriters || [],
              status: 'dismissed',
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'artist_id,calendar_event_id' }
          )
      }

      // Update last synced timestamp
      await supabaseAdmin
        .from('artists')
        .update({ calendar_last_synced_at: new Date().toISOString() })
        .eq('id', artist_id)

      console.log('[sync-calendar] imported:', imported, 'deleted:', deleteIds.length)

      return new Response(
        JSON.stringify({ success: true, imported, deleted: deleteIds.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: list_calendars — list user's calendars so they can pick which one
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'list_calendars') {
      const { artist_id } = body

      const { data: artist } = await supabaseAdmin
        .from('artists')
        .select('google_refresh_token')
        .eq('id', artist_id)
        .single()

      if (!artist?.google_refresh_token) {
        return new Response(
          JSON.stringify({ error: 'Calendar not connected' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const accessToken = await refreshAccessToken(artist.google_refresh_token)
      const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json()
      const calendars = (data.items ?? []).map((c: any) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary ?? false,
      }))

      return new Response(
        JSON.stringify({ calendars }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action. Use "exchange", "sync", or "list_calendars".' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[sync-calendar] error:', err)
    return new Response(
      JSON.stringify({ error: err.message ?? 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
