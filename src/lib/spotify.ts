// Spotify Client Credentials flow — fetches artist images from public Spotify data
// Requires EXPO_PUBLIC_SPOTIFY_CLIENT_ID and EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET in .env

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID
const CLIENT_SECRET = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token
  }

  const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) throw new Error('Failed to get Spotify token')

  const data = await response.json()
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }
  return cachedToken.token
}

// Extract artist ID from a Spotify URL
// Handles: https://open.spotify.com/artist/1234abc or spotify:artist:1234abc
export function extractSpotifyArtistId(input: string): string | null {
  const urlMatch = input.match(/artist\/([a-zA-Z0-9]+)/)
  if (urlMatch) return urlMatch[1]
  const uriMatch = input.match(/spotify:artist:([a-zA-Z0-9]+)/)
  if (uriMatch) return uriMatch[1]
  // Plain ID
  if (/^[a-zA-Z0-9]{22}$/.test(input.trim())) return input.trim()
  return null
}

export interface SpotifyArtistResult {
  name: string
  imageUrl: string | null
  spotifyUrl: string
  followers: number
  genres: string[]
}

export interface SpotifyTrackResult {
  id: string
  name: string
  artists: string
  albumArt: string | null
  previewUrl: string | null
  spotifyUrl: string
  releaseDate: string
}

export async function searchSpotifyTracks(query: string): Promise<SpotifyTrackResult[]> {
  if (!CLIENT_ID || !CLIENT_SECRET) return []
  const token = await getAccessToken()
  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=6`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!response.ok) return []
  const data = await response.json()
  return (data.tracks?.items ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    artists: t.artists.map((a: any) => a.name).join(', '),
    albumArt: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
    previewUrl: t.preview_url ?? null,
    spotifyUrl: t.external_urls?.spotify ?? '',
    releaseDate: t.album?.release_date ?? '',
  }))
}

export async function getSpotifyTrack(trackId: string): Promise<SpotifyTrackResult | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) return null
  try {
    const token = await getAccessToken()
    const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const t = await response.json()
    return {
      id: t.id,
      name: t.name,
      artists: t.artists.map((a: any) => a.name).join(', '),
      albumArt: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
      previewUrl: t.preview_url ?? null,
      spotifyUrl: t.external_urls?.spotify ?? '',
      releaseDate: t.album?.release_date ?? '',
    }
  } catch {
    return null
  }
}

export async function fetchSpotifyArtist(spotifyUrlOrId: string): Promise<SpotifyArtistResult> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Spotify credentials not configured. Add EXPO_PUBLIC_SPOTIFY_CLIENT_ID and EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET to your .env file.')
  }

  const artistId = extractSpotifyArtistId(spotifyUrlOrId)
  if (!artistId) throw new Error('Could not find a valid Spotify artist ID in that URL.')

  const token = await getAccessToken()
  const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    if (response.status === 404) throw new Error('Artist not found on Spotify.')
    throw new Error('Failed to fetch artist from Spotify.')
  }

  const data = await response.json()
  const imageUrl = data.images?.[0]?.url ?? null

  return {
    name: data.name,
    imageUrl,
    spotifyUrl: data.external_urls?.spotify ?? spotifyUrlOrId,
    followers: data.followers?.total ?? 0,
    genres: data.genres ?? [],
  }
}
