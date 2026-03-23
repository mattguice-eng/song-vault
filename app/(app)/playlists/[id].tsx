import React, { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Share, Platform, Image, Modal, TextInput,
} from 'react-native'
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

interface PlaylistSong {
  id: string
  position: number
  file_id: string | null
  song: {
    id: string
    title: string
    cowriters: { name: string }[]
    files: { id: string; file_type: string; file_name: string }[]
  }
}

interface PlaylistData {
  id: string
  name: string
  slug: string
  description: string | null
  cover_image_url: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
  artist: { stage_name: string } | null
  artist_id: string
}

interface Analytics {
  total_views: number
  total_plays: number
  song_plays: Record<string, number>
}

interface AvailableSong {
  id: string
  title: string
  cowriters: { name: string }[]
  files: { id: string; file_type: string; file_name: string }[]
}

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams()
  const { profile } = useAuthStore()
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null)
  const [songs, setSongs] = useState<PlaylistSong[]>([])
  const [analytics, setAnalytics] = useState<Analytics>({ total_views: 0, total_plays: 0, song_plays: {} })
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Add songs modal
  const [addSongsVisible, setAddSongsVisible] = useState(false)
  const [availableSongs, setAvailableSongs] = useState<AvailableSong[]>([])
  const [addingSearch, setAddingSearch] = useState('')
  const [addingSongId, setAddingSongId] = useState<string | null>(null)
  const [loadingAvailable, setLoadingAvailable] = useState(false)

  const baseUrl = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : 'https://songvault.app'
  const shareUrl = playlist ? `${baseUrl}/listen/${playlist.slug}` : ''

  const fetchPlaylist = async () => {
    try {
      const { data: pl, error: plErr } = await supabase
        .from('playlists')
        .select('*, artist:artists(stage_name)')
        .eq('id', id)
        .single()

      if (plErr) throw plErr
      setPlaylist(pl)

      // Fetch songs
      const { data: ps, error: psErr } = await supabase
        .from('playlist_songs')
        .select(`
          id, position, file_id,
          song:songs (
            id, title,
            cowriters ( name ),
            files:song_files ( id, file_type, file_name )
          )
        `)
        .eq('playlist_id', id)
        .order('position')

      if (psErr) console.error('[playlist-detail] fetch songs error:', psErr)

      setSongs((ps ?? []) as unknown as PlaylistSong[])

      // Fetch analytics
      const { data: views } = await supabase
        .from('link_views')
        .select('action, song_id')
        .eq('link_type', 'playlist')
        .eq('link_id', id)

      const viewCount = (views ?? []).filter(v => v.action === 'view').length
      const plays = (views ?? []).filter(v => v.action === 'play')
      const songPlays: Record<string, number> = {}
      plays.forEach(p => {
        if (p.song_id) songPlays[p.song_id] = (songPlays[p.song_id] ?? 0) + 1
      })
      setAnalytics({ total_views: viewCount, total_plays: plays.length, song_plays: songPlays })
    } catch (err) {
      console.error('[playlist-detail] error:', err)
    } finally {
      setLoading(false)
    }
  }

  useFocusEffect(useCallback(() => {
    // Reset ALL state when screen focuses or id changes
    setPlaylist(null)
    setSongs([])
    setAnalytics({ total_views: 0, total_plays: 0, song_plays: {} })
    setLoading(true)
    setCopied(false)
    setConfirmDelete(false)
    setAddSongsVisible(false)
    setAvailableSongs([])
    setAddingSearch('')
    setAddingSongId(null)
    fetchPlaylist()
  }, [id]))

  const handleShare = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(shareUrl, '_blank')
    } else {
      await Share.share({ message: `Check out this playlist: ${shareUrl}`, url: shareUrl })
    }
  }

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleMoveSong = async (index: number, direction: 'up' | 'down') => {
    const newSongs = [...songs]
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= newSongs.length) return

    const temp = newSongs[index]
    newSongs[index] = newSongs[swapIndex]
    newSongs[swapIndex] = temp

    newSongs.forEach((s, i) => { s.position = i })
    setSongs(newSongs)

    try {
      for (const s of newSongs) {
        const { error } = await supabase.from('playlist_songs').update({ position: s.position }).eq('id', s.id)
        if (error) throw error
      }
    } catch {
      // Revert on failure
      fetchPlaylist()
    }
  }

  const handleRemoveSong = async (psId: string) => {
    const { error } = await supabase.from('playlist_songs').delete().eq('id', psId)
    if (error) return
    setSongs(prev => prev.filter(s => s.id !== psId))
  }

  const handleToggleActive = async () => {
    if (!playlist) return
    const newActive = !playlist.is_active
    const { error } = await supabase.from('playlists').update({ is_active: newActive }).eq('id', playlist.id)
    if (error) return
    setPlaylist({ ...playlist, is_active: newActive })
  }

  const handleDelete = async () => {
    if (Platform.OS === 'web') {
      // Use inline confirm on web (Alert.alert doesn't work)
      setConfirmDelete(true)
    } else {
      Alert.alert('Delete Playlist', 'This will permanently delete this playlist and its share link.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: doDelete,
        },
      ])
    }
  }

  const doDelete = async () => {
    try {
      // Delete child rows first to avoid FK constraint errors
      // (link_views has no DELETE RLS policy so skip it — analytics data is kept)
      const { error: psErr } = await supabase.from('playlist_songs').delete().eq('playlist_id', id)
      if (psErr) console.warn('[playlist-detail] playlist_songs delete:', psErr.message)

      const { error } = await supabase.from('playlists').delete().eq('id', id)
      if (error) throw error
      console.log('[playlist-detail] Deleted playlist:', id)
      router.push('/(app)/playlists')
    } catch (err: any) {
      console.error('[playlist-detail] delete error:', err)
      setConfirmDelete(false)
    }
  }

  // ─── Add Songs ───
  const fetchAvailableSongs = async () => {
    if (!playlist) return
    setLoadingAvailable(true)
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('id, title, cowriters(*), files:song_files(*)')
        .eq('artist_id', playlist.artist_id)
        .order('date_written', { ascending: false })

      if (error) throw error

      // Filter out songs already in the playlist
      const existingSongIds = songs.map(s => s.song.id)
      const filtered = (data ?? []).filter((s: any) => !existingSongIds.includes(s.id))
      setAvailableSongs(filtered as AvailableSong[])
    } catch (err) {
      console.error('[playlist-detail] fetch available songs:', err)
    } finally {
      setLoadingAvailable(false)
    }
  }

  const handleAddSong = async (song: AvailableSong) => {
    if (!playlist || addingSongId) return
    setAddingSongId(song.id)

    try {
      const demoFile = song.files.find(f => f.file_type === 'demo')
      const wtFile = song.files.find(f => f.file_type === 'work_tape')
      const nextPosition = songs.length

      const { data, error } = await supabase
        .from('playlist_songs')
        .insert({
          playlist_id: playlist.id,
          song_id: song.id,
          file_id: demoFile?.id ?? wtFile?.id ?? null,
          position: nextPosition,
        })
        .select('id, position, file_id')
        .single()

      if (error) throw error

      // Add to local state
      setSongs(prev => [...prev, {
        id: data.id,
        position: data.position,
        file_id: data.file_id,
        song: {
          id: song.id,
          title: song.title,
          cowriters: song.cowriters,
          files: song.files,
        }
      }])

      // Remove from available
      setAvailableSongs(prev => prev.filter(s => s.id !== song.id))
    } catch (err: any) {
      console.error('[playlist-detail] add song error:', err)
    } finally {
      setAddingSongId(null)
    }
  }

  const filteredAvailable = availableSongs.filter(s => {
    if (!addingSearch.trim()) return true
    const q = addingSearch.toLowerCase()
    return s.title.toLowerCase().includes(q) ||
      s.cowriters?.some(c => c.name.toLowerCase().includes(q))
  })

  if (loading || !playlist) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    )
  }

  const isExpired = playlist.expires_at && new Date(playlist.expires_at) < new Date()

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/(app)/playlists')} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{playlist.name}</Text>
        <TouchableOpacity onPress={handleDelete}>
          <Ionicons name="trash-outline" size={20} color={Colors.error} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Delete confirm banner (web) */}
        {confirmDelete && (
          <View style={styles.deleteConfirm}>
            <Text style={styles.deleteConfirmText}>Delete this playlist?</Text>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity
                style={styles.deleteConfirmCancel}
                onPress={() => setConfirmDelete(false)}
              >
                <Text style={{ color: Colors.textSecondary, fontWeight: '600', fontSize: Fonts.sizes.sm }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteConfirmBtn}
                onPress={doDelete}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.sm }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Playlist info */}
        <View style={styles.infoSection}>
          {playlist.cover_image_url && (
            <Image source={{ uri: playlist.cover_image_url }} style={styles.cover} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.playlistName}>{playlist.name}</Text>
            {playlist.artist && (
              <Text style={styles.artistName}>{playlist.artist.stage_name}</Text>
            )}
            {playlist.description && (
              <Text style={styles.description}>{playlist.description}</Text>
            )}
            <Text style={styles.songCount}>
              {songs.length} song{songs.length !== 1 ? 's' : ''}
              {isExpired ? ' · Expired' : !playlist.is_active ? ' · Disabled' : ''}
            </Text>
          </View>
        </View>

        {/* Share link */}
        <View style={styles.shareSection}>
          <Text style={styles.sectionLabel}>Share Link</Text>
          <View style={styles.shareRow}>
            <View style={styles.shareUrlBox}>
              <Text style={styles.shareUrlText} numberOfLines={1}>{shareUrl}</Text>
            </View>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopyLink}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? Colors.success : Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
              <Ionicons name="share-outline" size={16} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Active toggle */}
          <TouchableOpacity style={styles.toggleRow} onPress={handleToggleActive}>
            <Ionicons
              name={playlist.is_active ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={playlist.is_active ? Colors.success : Colors.textMuted}
            />
            <Text style={styles.toggleText}>
              {playlist.is_active ? 'Link is active' : 'Link is disabled'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Analytics */}
        <View style={styles.analyticsSection}>
          <Text style={styles.sectionLabel}>Analytics</Text>
          <View style={styles.analyticsRow}>
            <View style={styles.analyticCard}>
              <Ionicons name="eye-outline" size={18} color={Colors.primary} />
              <Text style={styles.analyticNumber}>{analytics.total_views}</Text>
              <Text style={styles.analyticLabel}>Views</Text>
            </View>
            <View style={styles.analyticCard}>
              <Ionicons name="play-outline" size={18} color={Colors.primary} />
              <Text style={styles.analyticNumber}>{analytics.total_plays}</Text>
              <Text style={styles.analyticLabel}>Plays</Text>
            </View>
            <View style={styles.analyticCard}>
              <Ionicons name="musical-notes-outline" size={18} color={Colors.primary} />
              <Text style={styles.analyticNumber}>{songs.length}</Text>
              <Text style={styles.analyticLabel}>Tracks</Text>
            </View>
          </View>
        </View>

        {/* Song list */}
        <View style={styles.tracksSection}>
          <View style={styles.tracksHeader}>
            <Text style={styles.sectionLabel}>Tracks</Text>
            <TouchableOpacity
              style={styles.addSongsBtn}
              onPress={() => { setAddSongsVisible(true); fetchAvailableSongs() }}
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addSongsBtnText}>Add Songs</Text>
            </TouchableOpacity>
          </View>

          {songs.length === 0 ? (
            <View style={styles.emptyTracks}>
              <Ionicons name="musical-notes-outline" size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTracksText}>No songs yet</Text>
              <TouchableOpacity
                style={styles.addSongsBtn}
                onPress={() => { setAddSongsVisible(true); fetchAvailableSongs() }}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addSongsBtnText}>Add Songs</Text>
              </TouchableOpacity>
            </View>
          ) : (
            songs.map((ps, index) => {
              const song = ps.song
              const playCount = analytics.song_plays[song.id] ?? 0

              return (
                <View key={ps.id} style={styles.trackRow}>
                  <Text style={styles.trackNum}>{index + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackTitle} numberOfLines={1}>{song.title}</Text>
                    <Text style={styles.trackMeta}>
                      {song.cowriters?.map(c => c.name).join(', ') || ''}
                      {playCount > 0 ? ` · ${playCount} play${playCount !== 1 ? 's' : ''}` : ''}
                    </Text>
                  </View>
                  <View style={styles.trackActions}>
                    {index > 0 && (
                      <TouchableOpacity onPress={() => handleMoveSong(index, 'up')}>
                        <Ionicons name="chevron-up" size={18} color={Colors.textMuted} />
                      </TouchableOpacity>
                    )}
                    {index < songs.length - 1 && (
                      <TouchableOpacity onPress={() => handleMoveSong(index, 'down')}>
                        <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => handleRemoveSong(ps.id)}>
                      <Ionicons name="close" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </ScrollView>

      {/* ─── Add Songs Modal ─── */}
      <Modal
        visible={addSongsVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAddSongsVisible(false)}
      >
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { flex: 1 }]}>Add Songs</Text>
            <TouchableOpacity onPress={() => setAddSongsVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}>
            {availableSongs.length > 5 && (
              <TextInput
                style={styles.searchInput}
                placeholder="Filter songs..."
                placeholderTextColor={Colors.textMuted}
                value={addingSearch}
                onChangeText={setAddingSearch}
              />
            )}

            {loadingAvailable ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
            ) : filteredAvailable.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm }}>
                <Ionicons name="checkmark-circle-outline" size={36} color={Colors.textMuted} />
                <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '600', color: Colors.textSecondary }}>
                  {availableSongs.length === 0 ? 'All songs are in this playlist' : 'No matches'}
                </Text>
              </View>
            ) : (
              filteredAvailable.map(song => {
                const hasAudio = song.files.length > 0
                const hasDemo = song.files.some(f => f.file_type === 'demo')
                return (
                  <TouchableOpacity
                    key={song.id}
                    style={styles.addSongRow}
                    onPress={() => handleAddSong(song)}
                    disabled={addingSongId !== null}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.trackTitle, !hasAudio && { color: Colors.textMuted }]} numberOfLines={1}>
                        {song.title}
                      </Text>
                      <Text style={styles.trackMeta}>
                        {song.cowriters?.map(c => c.name).join(', ') || 'No writers'}
                        {!hasAudio ? ' · No audio' : hasDemo ? ' · Demo' : ' · Work tape'}
                      </Text>
                    </View>
                    {addingSongId === song.id ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                )
              })
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    gap: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    flex: 1, fontSize: Fonts.sizes.lg, fontWeight: '800',
    color: Colors.textPrimary, letterSpacing: -0.3,
  },
  scroll: { padding: Spacing.lg, paddingBottom: 100 },

  // Delete confirm
  deleteConfirm: {
    backgroundColor: `${Colors.error}15`, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: `${Colors.error}30`,
  },
  deleteConfirmText: {
    fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.error,
  },
  deleteConfirmCancel: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
  },
  deleteConfirmBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, backgroundColor: Colors.error,
  },

  // Info
  infoSection: {
    flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg,
  },
  cover: {
    width: 80, height: 80, borderRadius: Radius.lg,
  },
  playlistName: {
    fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  artistName: {
    fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600', marginTop: 2,
  },
  description: {
    fontSize: Fonts.sizes.sm, color: Colors.textSecondary, marginTop: 4,
  },
  songCount: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 4,
  },

  // Share
  shareSection: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  sectionLabel: {
    fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm,
  },
  shareRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
  },
  shareUrlBox: {
    flex: 1, backgroundColor: Colors.background, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  shareUrlText: {
    fontSize: Fonts.sizes.xs, color: Colors.textSecondary, fontFamily: 'monospace',
  },
  copyBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: `${Colors.primary}12`, borderWidth: 1, borderColor: `${Colors.primary}30`,
    alignItems: 'center', justifyContent: 'center',
  },
  shareBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginTop: Spacing.sm, paddingTop: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  toggleText: {
    fontSize: Fonts.sizes.sm, color: Colors.textSecondary,
  },

  // Analytics
  analyticsSection: { marginBottom: Spacing.lg },
  analyticsRow: {
    flexDirection: 'row', gap: Spacing.sm,
  },
  analyticCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, gap: 4,
  },
  analyticNumber: {
    fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary,
  },
  analyticLabel: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600',
  },

  // Tracks
  tracksSection: {},
  tracksHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  addSongsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  addSongsBtnText: {
    color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.xs,
  },
  emptyTracks: {
    alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm,
  },
  emptyTracksText: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontWeight: '600',
  },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  trackNum: {
    width: 22, fontSize: Fonts.sizes.sm, fontWeight: '700',
    color: Colors.textMuted, textAlign: 'center',
  },
  trackTitle: {
    fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary,
  },
  trackMeta: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1,
  },
  trackActions: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },

  // Add songs modal
  searchInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    fontSize: Fonts.sizes.sm, color: Colors.textPrimary,
  },
  addSongRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
})
