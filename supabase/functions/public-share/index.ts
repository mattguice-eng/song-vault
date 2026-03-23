import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // GET PLAYLIST — public, no auth required
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'playlist') {
      const slug = url.searchParams.get('slug')
      if (!slug) throw new Error('Missing slug')

      // Fetch playlist
      const { data: playlist, error: plErr } = await supabaseAdmin
        .from('playlists')
        .select(`
          id, name, description, cover_image_url, expires_at, is_active,
          artist:artists ( stage_name, avatar_url )
        `)
        .eq('slug', slug)
        .single()

      if (plErr || !playlist) {
        return new Response(
          JSON.stringify({ error: 'Playlist not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check expiration
      if (!playlist.is_active || (playlist.expires_at && new Date(playlist.expires_at) < new Date())) {
        return new Response(
          JSON.stringify({ error: 'This link has expired' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Fetch songs in order
      const { data: playlistSongs } = await supabaseAdmin
        .from('playlist_songs')
        .select(`
          id, position, file_id,
          song:songs (
            id, title, lyrics, date_written,
            cowriters ( name ),
            files:song_files ( id, file_type, file_name, duration_seconds )
          )
        `)
        .eq('playlist_id', playlist.id)
        .order('position')

      // Build clean response — no file URLs, no splits
      const tracks = (playlistSongs ?? []).map((ps: any) => {
        const song = ps.song
        // Determine which file to use: specified file_id, or prefer demo > work_tape
        const files = song.files ?? []
        const selectedFile = ps.file_id
          ? files.find((f: any) => f.id === ps.file_id)
          : files.find((f: any) => f.file_type === 'demo') ?? files.find((f: any) => f.file_type === 'work_tape')

        return {
          id: ps.id,
          song_id: song.id,
          title: song.title,
          writers: (song.cowriters ?? []).map((c: any) => c.name),
          lyrics: song.lyrics,
          has_audio: !!selectedFile,
          file_id: selectedFile?.id ?? null,
          duration: selectedFile?.duration_seconds ?? null,
        }
      })

      // Log view
      const ipHash = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
      await supabaseAdmin.from('link_views').insert({
        link_type: 'playlist',
        link_id: playlist.id,
        action: 'view',
        ip_hash: ipHash,
        user_agent: req.headers.get('user-agent') ?? '',
      })

      return new Response(
        JSON.stringify({
          name: playlist.name,
          description: playlist.description,
          cover_image_url: playlist.cover_image_url,
          artist_name: playlist.artist?.stage_name ?? '',
          artist_avatar: playlist.artist?.avatar_url ?? null,
          tracks,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GET SINGLE SHARE — public, no auth required
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'share') {
      const slug = url.searchParams.get('slug')
      if (!slug) throw new Error('Missing slug')

      const { data: share, error: shErr } = await supabaseAdmin
        .from('share_links')
        .select(`
          id, file_id, expires_at, is_active,
          song:songs (
            id, title, lyrics, date_written,
            artist:artists ( stage_name, avatar_url ),
            cowriters ( name ),
            files:song_files ( id, file_type, file_name, duration_seconds )
          )
        `)
        .eq('slug', slug)
        .single()

      if (shErr || !share) {
        return new Response(
          JSON.stringify({ error: 'Link not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!share.is_active || (share.expires_at && new Date(share.expires_at) < new Date())) {
        return new Response(
          JSON.stringify({ error: 'This link has expired' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const song = share.song as any
      const files = song.files ?? []
      const selectedFile = share.file_id
        ? files.find((f: any) => f.id === share.file_id)
        : files.find((f: any) => f.file_type === 'demo') ?? files.find((f: any) => f.file_type === 'work_tape')

      // Log view
      const ipHash = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
      await supabaseAdmin.from('link_views').insert({
        link_type: 'share',
        link_id: share.id,
        action: 'view',
        ip_hash: ipHash,
        user_agent: req.headers.get('user-agent') ?? '',
      })

      return new Response(
        JSON.stringify({
          title: song.title,
          writers: (song.cowriters ?? []).map((c: any) => c.name),
          lyrics: song.lyrics,
          artist_name: song.artist?.stage_name ?? '',
          artist_avatar: song.artist?.avatar_url ?? null,
          has_audio: !!selectedFile,
          file_id: selectedFile?.id ?? null,
          duration: selectedFile?.duration_seconds ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STREAM AUDIO — proxies the file, no raw URL exposed
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'stream') {
      const fileId = url.searchParams.get('file_id')
      const linkType = url.searchParams.get('link_type') // playlist or share
      const linkSlug = url.searchParams.get('link_slug')

      if (!fileId || !linkType || !linkSlug) throw new Error('Missing params')

      // Verify the link is valid and active
      if (linkType === 'playlist') {
        const { data: pl } = await supabaseAdmin
          .from('playlists')
          .select('id, is_active, expires_at')
          .eq('slug', linkSlug)
          .single()
        if (!pl || !pl.is_active || (pl.expires_at && new Date(pl.expires_at) < new Date())) {
          return new Response('Unauthorized', { status: 403, headers: corsHeaders })
        }

        // Log play
        // Find the song_id from playlist_songs
        const { data: ps } = await supabaseAdmin
          .from('playlist_songs')
          .select('song_id')
          .eq('playlist_id', pl.id)
          .eq('file_id', fileId)
          .single()

        await supabaseAdmin.from('link_views').insert({
          link_type: 'playlist',
          link_id: pl.id,
          song_id: ps?.song_id ?? null,
          action: 'play',
          ip_hash: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
          user_agent: req.headers.get('user-agent') ?? '',
        })
      } else {
        const { data: sh } = await supabaseAdmin
          .from('share_links')
          .select('id, song_id, is_active, expires_at')
          .eq('slug', linkSlug)
          .single()
        if (!sh || !sh.is_active || (sh.expires_at && new Date(sh.expires_at) < new Date())) {
          return new Response('Unauthorized', { status: 403, headers: corsHeaders })
        }

        await supabaseAdmin.from('link_views').insert({
          link_type: 'share',
          link_id: sh.id,
          song_id: sh.song_id,
          action: 'play',
          ip_hash: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
          user_agent: req.headers.get('user-agent') ?? '',
        })
      }

      // Get the file URL
      const { data: file } = await supabaseAdmin
        .from('song_files')
        .select('file_url')
        .eq('id', fileId)
        .single()

      if (!file?.file_url) {
        return new Response('File not found', { status: 404, headers: corsHeaders })
      }

      // Extract storage path from the file URL (handles both public URLs and signed URLs)
      const supaUrl = Deno.env.get('SUPABASE_URL')!
      let filePath = file.file_url
      // Strip public URL prefix
      filePath = filePath.replace(supaUrl + '/storage/v1/object/public/song-files/', '')
      // Strip signed URL prefix
      filePath = filePath.replace(supaUrl + '/storage/v1/object/sign/song-files/', '')
      // Strip query params (token, etc)
      filePath = filePath.split('?')[0]

      // Create a signed URL (short-lived) and proxy the content
      const { data: signedData, error: signErr } = await supabaseAdmin
        .storage
        .from('song-files')
        .createSignedUrl(filePath, 300) // 5 min

      if (signErr || !signedData?.signedUrl) {
        return new Response('Could not access file', { status: 500, headers: corsHeaders })
      }

      // Fetch and proxy the audio
      const audioResponse = await fetch(signedData.signedUrl)
      const audioBody = audioResponse.body
      const contentType = audioResponse.headers.get('content-type') ?? 'audio/mpeg'
      const contentLength = audioResponse.headers.get('content-length')

      const responseHeaders: Record<string, string> = {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
      }
      if (contentLength) {
        responseHeaders['Content-Length'] = contentLength
      }

      return new Response(audioBody, { headers: responseHeaders })
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[public-share] error:', err)
    return new Response(
      JSON.stringify({ error: err.message ?? 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
