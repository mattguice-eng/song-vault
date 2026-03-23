import React, { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Dimensions,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'

// ─── Theme (matches app but standalone — no auth needed) ───
const C = {
  bg: '#0B0E1A',
  surface: '#131729',
  surfaceElevated: '#1A1F35',
  border: '#252B45',
  primary: '#8B5CF6',
  primaryDark: '#6D28D9',
  primaryLight: '#C4B5FD',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  error: '#EF4444',
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

const apiFetch = (url: string) =>
  fetch(url, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })

interface Track {
  id: string
  song_id: string
  title: string
  writers: string[]
  lyrics: string | null
  has_audio: boolean
  file_id: string | null
  duration: number | null
}

interface PlaylistData {
  name: string
  description: string | null
  cover_image_url: string | null
  artist_name: string
  artist_avatar: string | null
  tracks: Track[]
}

interface ShareData {
  title: string
  writers: string[]
  lyrics: string | null
  artist_name: string
  artist_avatar: string | null
  has_audio: boolean
  file_id: string | null
  duration: number | null
}

export default function PublicPlayerScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Playlist mode
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null)
  // Single share mode
  const [share, setShare] = useState<ShareData | null>(null)

  // Player state
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [lyricsTrackIndex, setLyricsTrackIndex] = useState<number | null>(null)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressInterval = useRef<any>(null)

  // Determine if this is a playlist slug or a share slug
  useEffect(() => {
    if (!slug) return
    loadData()
  }, [slug])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Try playlist first (edge function is public — no auth needed)
      const plRes = await fetch(
        `${SUPABASE_URL}/functions/v1/public-share?action=playlist&slug=${slug}`
      )

      if (plRes.ok) {
        const data = await plRes.json()
        setPlaylist(data)
        setLoading(false)
        return
      }

      // Try single share
      const shRes = await fetch(
        `${SUPABASE_URL}/functions/v1/public-share?action=share&slug=${slug}`
      )

      if (shRes.ok) {
        const data = await shRes.json()
        setShare(data)
        setLoading(false)
        return
      }

      // Check for expired
      const errData = await shRes.json().catch(() => ({}))
      if (shRes.status === 410) {
        setError(errData.error || 'This link has expired')
      } else {
        setError('Link not found')
      }
    } catch (err) {
      setError('Unable to load. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ─── Audio controls (web only for now) ───
  const getStreamUrl = (fileId: string) => {
    const linkType = playlist ? 'playlist' : 'share'
    return `${SUPABASE_URL}/functions/v1/public-share?action=stream&file_id=${fileId}&link_type=${linkType}&link_slug=${slug}`
  }

  const stopAudio = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current)
      progressInterval.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
    }
    setIsPlaying(false)
    setLoadingAudio(false)
  }

  const playTrack = (index: number) => {
    if (loadingAudio) return // prevent double-fire
    const track = playlist ? playlist.tracks[index] : null
    const fileId = playlist ? track?.file_id : share?.file_id

    if (!fileId) return

    // Stop any current playback completely
    stopAudio()

    setCurrentTrackIndex(index)
    setCurrentTime(0)
    setDuration(0)
    setLoadingAudio(true)

    if (Platform.OS === 'web') {
      // Stream directly — edge function is public, no auth headers needed
      const audio = new Audio(getStreamUrl(fileId))
      audio.preload = 'auto'
      audioRef.current = audio

      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration)
      })

      audio.addEventListener('canplay', () => {
        setLoadingAudio(false)
      })

      audio.addEventListener('ended', () => {
        setIsPlaying(false)
        setCurrentTime(0)
        // Auto-advance in playlist mode
        if (playlist && index < playlist.tracks.length - 1) {
          setTimeout(() => playTrack(index + 1), 300)
        }
      })

      audio.addEventListener('error', () => {
        setIsPlaying(false)
        setLoadingAudio(false)
      })

      audio.play().then(() => {
        setIsPlaying(true)
      }).catch(err => {
        console.error('[player] play error:', err)
        setLoadingAudio(false)
      })

      progressInterval.current = setInterval(() => {
        if (audioRef.current && !audioRef.current.paused) {
          setCurrentTime(audioRef.current.currentTime)
        }
      }, 250)
    }
  }

  const togglePlayPause = () => {
    if (loadingAudio) return
    if (!audioRef.current) {
      playTrack(currentTrackIndex)
      return
    }

    if (audioRef.current.paused) {
      audioRef.current.play()
      setIsPlaying(true)
    } else {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }

  const seekTo = (fraction: number) => {
    if (audioRef.current && duration > 0) {
      audioRef.current.currentTime = fraction * duration
      setCurrentTime(fraction * duration)
    }
  }

  const skipNext = () => {
    if (playlist && currentTrackIndex < playlist.tracks.length - 1) {
      playTrack(currentTrackIndex + 1)
    }
  }

  const skipPrev = () => {
    if (currentTime > 3 && audioRef.current) {
      // Restart current track if > 3s in
      audioRef.current.currentTime = 0
      setCurrentTime(0)
    } else if (playlist && currentTrackIndex > 0) {
      playTrack(currentTrackIndex - 1)
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause()
      if (progressInterval.current) clearInterval(progressInterval.current)
    }
  }, [])

  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return '0:00'
    const mins = Math.floor(s / 60)
    const secs = Math.floor(s % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // ─── Current track info ───
  const currentTrack = playlist ? playlist.tracks[currentTrackIndex] : null
  const currentTitle = playlist ? currentTrack?.title : share?.title
  const currentWriters = playlist ? currentTrack?.writers : share?.writers
  const currentLyrics = playlist ? currentTrack?.lyrics : share?.lyrics
  const currentHasAudio = playlist ? currentTrack?.has_audio : share?.has_audio
  const artistName = playlist?.artist_name || share?.artist_name || ''

  // ─── Loading state ───
  if (loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    )
  }

  // ─── Error state ───
  if (error) {
    return (
      <View style={styles.fullCenter}>
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorTitle}>
          {error.includes('expired') ? 'Link Expired' : 'Not Found'}
        </Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <Text style={styles.brandFooter}>Song Vault</Text>
      </View>
    )
  }

  const isPlaylist = !!playlist
  const trackCount = playlist?.tracks.length ?? 1

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header / Artist */}
        <View style={styles.artistHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {artistName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.artistName}>{artistName}</Text>
        </View>

        {/* Playlist / Song title */}
        <View style={styles.titleSection}>
          {isPlaylist && playlist.cover_image_url && (
            <View style={styles.coverWrap}>
              {/* Using RN Image won't work well on web for external URLs without config,
                  so we use an img tag on web */}
              {Platform.OS === 'web' ? (
                <img
                  src={playlist.cover_image_url}
                  style={{
                    width: 160, height: 160, borderRadius: 16,
                    objectFit: 'cover',
                  }}
                  alt="cover"
                />
              ) : null}
            </View>
          )}
          <Text style={styles.mainTitle}>
            {isPlaylist ? playlist.name : share?.title}
          </Text>
          {isPlaylist && playlist.description && (
            <Text style={styles.mainDescription}>{playlist.description}</Text>
          )}
          <Text style={styles.trackCountText}>
            {isPlaylist
              ? `${trackCount} track${trackCount !== 1 ? 's' : ''}`
              : currentWriters?.join(', ') || ''
            }
          </Text>
        </View>

        {/* Track list (playlist mode) */}
        {isPlaylist && (
          <View style={styles.trackList}>
            {playlist.tracks.map((track, i) => {
              const isCurrent = i === currentTrackIndex
              const isCurrentPlaying = isCurrent && isPlaying
              return (
                <TouchableOpacity
                  key={track.id}
                  style={[styles.trackRow, isCurrent && styles.trackRowActive]}
                  onPress={() => track.has_audio ? playTrack(i) : setCurrentTrackIndex(i)}
                  activeOpacity={0.7}
                >
                  <View style={styles.trackNumCol}>
                    {isCurrentPlaying ? (
                      <View style={styles.playingBars}>
                        <View style={[styles.bar, styles.bar1]} />
                        <View style={[styles.bar, styles.bar2]} />
                        <View style={[styles.bar, styles.bar3]} />
                      </View>
                    ) : (
                      <Text style={[styles.trackNum, isCurrent && styles.trackNumActive]}>
                        {i + 1}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.trackTitle, isCurrent && styles.trackTitleActive]}
                      numberOfLines={1}
                    >
                      {track.title}
                    </Text>
                    <Text style={styles.trackWriters} numberOfLines={1}>
                      {track.writers.join(', ') || 'Unknown'}
                    </Text>
                  </View>
                  {track.lyrics && (
                    <TouchableOpacity
                      style={styles.lyricsBtn}
                      onPress={(e) => {
                        e.stopPropagation()
                        setLyricsTrackIndex(i)
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.lyricsBtnText}>Lyrics</Text>
                    </TouchableOpacity>
                  )}
                  {track.has_audio ? (
                    <Text style={styles.trackDuration}>
                      {track.duration ? formatTime(track.duration) : ''}
                    </Text>
                  ) : (
                    <Text style={styles.noAudioTag}>No audio</Text>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>
        )}

        {/* Single share: lyrics button + writer credits */}
        {!isPlaylist && share && (
          <View style={styles.writerCredits}>
            <Text style={styles.creditsLabel}>Written by</Text>
            <Text style={styles.creditsNames}>
              {share.writers.join(', ') || 'Unknown'}
            </Text>
            {share.lyrics && (
              <TouchableOpacity
                style={[styles.lyricsBtn, { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8 }]}
                onPress={() => setLyricsTrackIndex(0)}
              >
                <Text style={styles.lyricsBtnText}>View Lyrics</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Spacer for player */}
        <View style={{ height: 140 }} />
      </ScrollView>

      {/* ─── Fixed bottom player ─── */}
      <View style={styles.player}>
        {/* Now playing info */}
        <View style={styles.nowPlaying}>
          <Text style={styles.nowPlayingTitle} numberOfLines={1}>
            {currentTitle || 'Select a track'}
          </Text>
          <Text style={styles.nowPlayingArtist} numberOfLines={1}>
            {artistName}
          </Text>
        </View>

        {/* Progress bar */}
        <TouchableOpacity
          style={styles.progressContainer}
          onPress={(e) => {
            if (Platform.OS === 'web') {
              const nativeEvent = e.nativeEvent as any
              const target = nativeEvent.target as HTMLElement
              const rect = target.getBoundingClientRect()
              const x = nativeEvent.clientX - rect.left
              const fraction = x / rect.width
              seekTo(Math.max(0, Math.min(1, fraction)))
            }
          }}
          activeOpacity={1}
        >
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: (duration > 0 && isFinite(duration)) ? `${(currentTime / duration) * 100}%` as any : '0%' },
              ]}
            />
          </View>
        </TouchableOpacity>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          {isPlaylist && (
            <TouchableOpacity
              onPress={skipPrev}
              style={styles.controlBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <View style={{ width: 2, height: 14, backgroundColor: C.textPrimary }} />
                <View style={{ width: 0, height: 0, borderTopWidth: 8, borderBottomWidth: 8, borderRightWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: C.textPrimary }} />
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={currentHasAudio ? togglePlayPause : undefined}
            style={[styles.playBtn, !currentHasAudio && { opacity: 0.3 }]}
            activeOpacity={0.8}
          >
            {isPlaying ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 4, height: 18, backgroundColor: C.textPrimary, borderRadius: 1 }} />
                <View style={{ width: 4, height: 18, backgroundColor: C.textPrimary, borderRadius: 1 }} />
              </View>
            ) : (
              <View style={{ width: 0, height: 0, marginLeft: 3, borderTopWidth: 11, borderBottomWidth: 11, borderLeftWidth: 18, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: C.textPrimary }} />
            )}
          </TouchableOpacity>

          {isPlaylist && (
            <TouchableOpacity
              onPress={skipNext}
              style={styles.controlBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <View style={{ width: 0, height: 0, borderTopWidth: 8, borderBottomWidth: 8, borderLeftWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: C.textPrimary }} />
                <View style={{ width: 2, height: 14, backgroundColor: C.textPrimary }} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Brand */}
        <Text style={styles.playerBrand}>Song Vault</Text>
      </View>

      {/* ─── Lyrics Overlay ─── */}
      {lyricsTrackIndex !== null && (() => {
        const lTrack = playlist ? playlist.tracks[lyricsTrackIndex] : null
        const lTitle = playlist ? lTrack?.title : share?.title
        const lWriters = playlist ? lTrack?.writers : share?.writers
        const lLyrics = playlist ? lTrack?.lyrics : share?.lyrics
        return (
          <View style={styles.lyricsOverlay}>
            <View style={styles.lyricsOverlayHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lyricsOverlayTitle} numberOfLines={1}>{lTitle}</Text>
                <Text style={styles.lyricsOverlayWriters}>
                  Written by {lWriters?.join(', ') || 'Unknown'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.lyricsCloseBtn}
                onPress={() => setLyricsTrackIndex(null)}
              >
                <Text style={styles.lyricsCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.lyricsOverlayScroll}
              contentContainerStyle={{ paddingBottom: 60 }}
            >
              <Text style={styles.lyricsOverlayBody}>{lLyrics}</Text>
            </ScrollView>
          </View>
        )
      })()}
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 180,
    maxWidth: 600,
    alignSelf: 'center' as any,
    width: '100%' as any,
  },

  // Loading / Error
  fullCenter: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: C.textMuted,
    fontSize: 14,
    marginTop: 12,
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${C.error}20`,
    color: C.error,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 56,
    marginBottom: 16,
    overflow: 'hidden',
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.textPrimary,
    marginBottom: 8,
  },
  errorMsg: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
  brandFooter: {
    position: 'absolute',
    bottom: 32,
    fontSize: 12,
    color: C.textMuted,
    fontWeight: '600',
    letterSpacing: 1,
  },

  // Artist header
  artistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 28,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  artistName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.3,
  },

  // Title section
  titleSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  coverWrap: {
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
  },
  mainTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: C.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  mainDescription: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
    maxWidth: 400,
    lineHeight: 20,
  },
  trackCountText: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '600',
  },

  // Track list
  trackList: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    marginBottom: 24,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  trackRowActive: {
    backgroundColor: `${C.primary}12`,
  },
  trackNumCol: {
    width: 24,
    alignItems: 'center',
  },
  trackNum: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textMuted,
  },
  trackNumActive: {
    color: C.primary,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },
  trackTitleActive: {
    color: C.primary,
  },
  trackWriters: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },
  trackDuration: {
    fontSize: 12,
    color: C.textMuted,
    fontWeight: '500',
  },
  noAudioTag: {
    fontSize: 10,
    color: C.textMuted,
    backgroundColor: C.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    overflow: 'hidden',
    fontWeight: '600',
  },

  // Animated playing bars
  playingBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 14,
    gap: 2,
  },
  bar: {
    width: 3,
    backgroundColor: C.primary,
    borderRadius: 1,
  },
  bar1: { height: 10 },
  bar2: { height: 14 },
  bar3: { height: 7 },

  // Lyrics
  lyricsSection: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    marginBottom: 24,
  },
  lyricsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  lyricsToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textPrimary,
  },
  lyricsArrow: {
    fontSize: 12,
    color: C.textMuted,
  },
  lyricsContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 16,
  },
  lyricsSongTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.primary,
    marginBottom: 4,
  },
  lyricsWriters: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  lyricsBody: {
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 24,
    ...(Platform.OS === 'web' ? { whiteSpace: 'pre-wrap' } : {}),
  } as any,

  // Writer credits (single share, no lyrics)
  writerCredits: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  creditsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  creditsNames: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textPrimary,
  },

  // Fixed bottom player
  player: {
    position: 'absolute' as any,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'web' ? 20 : 34,
  },
  nowPlaying: {
    alignItems: 'center',
    marginBottom: 10,
  },
  nowPlayingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textPrimary,
    maxWidth: 300,
  },
  nowPlayingArtist: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },

  // Progress
  progressContainer: {
    paddingVertical: 6,
  },
  progressTrack: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: C.primary,
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 8,
  },
  timeText: {
    fontSize: 11,
    color: C.textMuted,
    fontVariant: ['tabular-nums'] as any,
  },

  // Controls
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    marginBottom: 8,
  },
  controlBtn: {
    padding: 4,
  },
  controlIcon: {
    fontSize: 20,
    color: C.textSecondary,
  },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  playIcon: {
    fontSize: 22,
    color: '#fff',
    marginLeft: 2,
  },
  playerBrand: {
    textAlign: 'center',
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 4,
  },

  // Lyrics button on tracks
  lyricsBtn: {
    backgroundColor: `${C.primary}20`,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: `${C.primary}40`,
  },
  lyricsBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.primary,
  },

  // Lyrics overlay
  lyricsOverlay: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: `${C.bg}F5`,
    zIndex: 100,
  },
  lyricsOverlayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 50 : 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
    backgroundColor: C.bg,
  },
  lyricsOverlayTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: C.primary,
    letterSpacing: -0.3,
  },
  lyricsOverlayWriters: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 3,
    fontStyle: 'italic',
  },
  lyricsCloseBtn: {
    backgroundColor: C.surfaceElevated,
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 2,
  },
  lyricsCloseBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },
  lyricsOverlayScroll: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  lyricsOverlayBody: {
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 26,
    ...(Platform.OS === 'web' ? { whiteSpace: 'pre-wrap' } : {}),
  } as any,
})
