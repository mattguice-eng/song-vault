/**
 * Google Calendar OAuth + API helpers (web only for now)
 *
 * Flow:
 *  1. Manager clicks "Connect Calendar" → opens Google OAuth consent screen
 *  2. User grants access → redirect back with auth code
 *  3. We exchange code for access_token + refresh_token via edge function
 *  4. refresh_token is stored on the artist record
 *  5. Sync edge function uses refresh_token to fetch events
 */

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? ''
const REDIRECT_URI =
  typeof window !== 'undefined'
    ? `${window.location.origin}/calendar-callback`
    : ''

const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly'

/**
 * Build the Google OAuth consent URL.
 * We pass `artist_id` through the `state` param so the callback knows
 * which artist to link the calendar to.
 */
export function getGoogleAuthUrl(artistId: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',    // get a refresh_token
    prompt: 'consent',         // force consent so we always get refresh_token
    state: artistId,           // pass artist ID through OAuth flow
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * Parse a calendar event title into co-writer names.
 *
 * Common formats from Nashville publishers:
 *   "patrick mayberry — ricky jackson + jess cates"
 *   "Patrick Mayberry / Ricky Jackson / Jess Cates"
 *   "Write: Mayberry, Jackson, Cates"
 *
 * We split on common delimiters and clean up.
 */
export function parseCowritersFromTitle(title: string): string[] {
  // Remove common prefixes
  let cleaned = title
    .replace(/^(write|writing|session|co-?write)[:\s\-–—]*/i, '')
    .trim()

  // Split on common delimiters: —, –, /, +, &, "and", ","
  const names = cleaned
    .split(/\s*[—–\/\+&]\s*|\s*,\s*|\s+and\s+/i)
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n.length < 50) // filter garbage

  // Title-case each name
  return names.map((name) =>
    name
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  )
}

/**
 * Format a time string for display (e.g., "10 AM", "2:30 PM")
 */
export function formatEventTime(isoString: string | null): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/**
 * Format event date for display
 */
export function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'

  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
