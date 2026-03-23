import React, { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Image, Platform,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

interface SongOption {
  id: string
  title: string
  date_written: string
  status: string
  cowriters: { name: string }[]
  files: { id: string; file_type: string; file_name: string }[]
}

export default function NewPlaylistScreen() {
  const { profile, activeArtist } = useAuthStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [coverUri, setCoverUri] = useState<string | null>(null)
  const [coverStoragePath, setCoverStoragePath] = useState<string | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [songs, setSongs] = useState<SongOption[]>([])
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [resolvedArtistId, setResolvedArtistId] = useState<string | null>(null)

  const isManager = profile?.role === 'manager'
  const isArtist = profile?.role === 'artist'

  // Reset ALL form state every time this screen focuses
  useFocusEffect(useCallback(() => {
    console.log('[new-playlist] Screen focused — resetting form')
    setName('')
    setDescription('')
    setCoverUri(null)
    setCoverStoragePath(null)
    setUploadingCover(false)
    setSelectedSongIds([])
    setSearch('')
    setSaving(false)
    setErrorMsg('')

    // Resolve artist ID fresh from store
    const resolveAndFetch = async () => {
      let artId: string | null = null

      if (isManager) {
        artId = useAuthStore.getState().activeArtist?.id ?? null
        console.log('[new-playlist] Manager mode, activeArtist:', artId)
      } else if (isArtist && profile?.id) {
        const { data } = await supabase.from('artists').select('id').eq('user_id', profile.id).single()
        artId = data?.id ?? null
        console.log('[new-playlist] Artist mode, resolved:', artId)
      }

      setResolvedArtistId(artId)

      if (!artId) {
        setSongs([])
        setLoading(false)
        return
      }

      // Fetch songs inline — no separate useEffect needed
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('songs')
          .select('id, title, date_written, status, cowriters(*), files:song_files(*)')
          .eq('artist_id', artId)
          .order('date_written', { ascending: false })

        if (error) throw error
        console.log('[new-playlist] Fetched', data?.length ?? 0, 'songs')
        setSongs((data ?? []) as SongOption[])
      } catch (err) {
        console.error('[new-playlist] fetch songs error:', err)
      } finally {
        setLoading(false)
      }
    }

    resolveAndFetch()
  }, [isManager, isArtist, profile?.id]))

  const toggleSong = (songId: string) => {
    setSelectedSongIds(prev =>
      prev.includes(songId)
        ? prev.filter(id => id !== songId)
        : [...prev, songId]
    )
  }

  const handlePickCover = async () => {
    console.log('[new-playlist] handlePickCover called, resolvedArtistId:', resolvedArtistId)
    if (!resolvedArtistId) {
      setErrorMsg('Still loading artist info — try again in a moment.')
      return
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      })
      console.log('[new-playlist] ImagePicker result:', JSON.stringify({
        canceled: result.canceled,
        assetCount: result.assets?.length,
        uri: result.assets?.[0]?.uri?.substring(0, 60),
        mimeType: result.assets?.[0]?.mimeType,
      }))

      if (result.canceled || !result.assets?.[0]) return

      const asset = result.assets[0]
      setCoverUri(asset.uri)
      setUploadingCover(true)

      // Upload immediately while blob: URL is still valid
      const response = await fetch(asset.uri)
      const blob = await response.blob()
      console.log('[new-playlist] Blob fetched:', { type: blob.type, size: blob.size })

      // Convert to Uint8Array for reliable Supabase upload on web
      const arrayBuffer = await blob.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuffer)

      // Determine extension from blob MIME type (URI is blob: on web, no extension)
      const mimeType = blob.type || asset.mimeType || 'image/jpeg'
      const mimeExt = mimeType.includes('png') ? 'png' : 'jpg'
      const path = `${resolvedArtistId}/playlist_cover_${Date.now()}.${mimeExt}`

      console.log('[new-playlist] Uploading cover:', { path, mimeType, size: uint8.byteLength })

      const { error: upErr, data: upData } = await supabase.storage
        .from('song-files')
        .upload(path, uint8, { contentType: mimeType, upsert: true })

      if (upErr) {
        console.error('[new-playlist] Supabase upload error:', JSON.stringify(upErr))
        throw upErr
      }

      console.log('[new-playlist] Cover uploaded successfully:', JSON.stringify(upData))
      setCoverStoragePath(path)

      // Verify we can get a signed URL
      const { data: verifyData } = await supabase.storage
        .from('song-files')
        .createSignedUrl(path, 300)
      console.log('[new-playlist] Cover verify URL:', verifyData?.signedUrl?.substring(0, 80))
    } catch (err: any) {
      console.error('[new-playlist] cover upload failed:', err?.message, err)
      setCoverUri(null)
      setErrorMsg(`Cover upload failed: ${err?.message ?? 'Unknown error'}`)
    } finally {
      setUploadingCover(false)
    }
  }

  const generateSlug = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let slug = ''
    for (let i = 0; i < 10; i++) slug += chars[Math.floor(Math.random() * chars.length)]
    return slug
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setErrorMsg('Give your playlist a name.')
      return
    }
    if (selectedSongIds.length === 0) {
      setErrorMsg('Add at least one song.')
      return
    }
    if (!resolvedArtistId) {
      setErrorMsg('No artist selected.')
      return
    }
    setErrorMsg('')

    setSaving(true)
    try {
      const slug = generateSlug()
      // Get cover URL from already-uploaded file
      // Bucket is private, so use a long-lived signed URL (1 year)
      let coverUrl: string | null = null
      if (coverStoragePath) {
        const { data: signedData, error: signErr } = await supabase.storage
          .from('song-files')
          .createSignedUrl(coverStoragePath, 60 * 60 * 24 * 365) // 1 year
        if (signErr) {
          console.error('[new-playlist] signed URL error:', signErr)
        } else {
          coverUrl = signedData.signedUrl
          console.log('[new-playlist] cover signed URL:', coverUrl?.substring(0, 80))
        }
      }

      // Create playlist
      const { data: playlist, error: plErr } = await supabase
        .from('playlists')
        .insert({
          artist_id: resolvedArtistId,
          created_by: profile!.id,
          name: name.trim(),
          slug,
          description: description.trim() || null,
          cover_image_url: coverUrl,
        })
        .select('id')
        .single()

      if (plErr) throw plErr

      // Add songs in order
      const playlistSongs = selectedSongIds.map((songId, i) => {
        const song = songs.find(s => s.id === songId)
        // Auto-pick demo file, fallback to work tape
        const demoFile = song?.files.find(f => f.file_type === 'demo')
        const wtFile = song?.files.find(f => f.file_type === 'work_tape')
        return {
          playlist_id: playlist.id,
          song_id: songId,
          file_id: demoFile?.id ?? wtFile?.id ?? null,
          position: i,
        }
      })

      console.log('[new-playlist] Inserting playlist_songs:', JSON.stringify(playlistSongs, null, 2))
      const { error: psErr } = await supabase.from('playlist_songs').insert(playlistSongs)
      if (psErr) {
        console.error('[new-playlist] playlist_songs insert error:', psErr)
        throw psErr
      }

      console.log('[new-playlist] Created successfully, navigating to playlist:', playlist.id)
      router.push({ pathname: '/(app)/playlists/[id]', params: { id: playlist.id } })
    } catch (err: any) {
      console.error('[new-playlist] save error:', err)
      setErrorMsg(err.message ?? 'Failed to create playlist')
    } finally {
      setSaving(false)
    }
  }

  const filteredSongs = songs.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return s.title.toLowerCase().includes(q) ||
      s.cowriters?.some(c => c.name.toLowerCase().includes(q))
  })

  // Selected songs first, then songs with audio, then the rest
  const sortedSongs = [...filteredSongs].sort((a, b) => {
    const aSelected = selectedSongIds.includes(a.id) ? 0 : 1
    const bSelected = selectedSongIds.includes(b.id) ? 0 : 1
    if (aSelected !== bSelected) return aSelected - bSelected
    const aHasAudio = a.files.length > 0 ? 0 : 1
    const bHasAudio = b.files.length > 0 ? 0 : 1
    return aHasAudio - bHasAudio
  })

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Playlist</Text>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Create</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {errorMsg ? (
          <View style={{ backgroundColor: `${Colors.error}15`, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.md }}>
            <Text style={{ color: Colors.error, fontSize: Fonts.sizes.sm }}>{errorMsg}</Text>
          </View>
        ) : null}

        {/* Cover + Name */}
        <View style={styles.topSection}>
          <TouchableOpacity style={styles.coverPicker} onPress={handlePickCover} disabled={uploadingCover}>
            {coverUri ? (
              <View>
                <Image source={{ uri: coverUri }} style={styles.coverImage} />
                {uploadingCover && (
                  <View style={styles.coverUploading}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.coverPlaceholder}>
                <Ionicons name="image-outline" size={28} color={Colors.textMuted} />
                <Text style={styles.coverPlaceholderText}>Cover</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <TextInput
              style={styles.nameInput}
              placeholder="Playlist name"
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <TextInput
              style={styles.descInput}
              placeholder="Description (optional)"
              placeholderTextColor={Colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
            />
          </View>
        </View>

        {/* Song picker */}
        <View style={styles.songPickerHeader}>
          <Text style={styles.sectionTitle}>
            Add Songs {selectedSongIds.length > 0 ? `(${selectedSongIds.length} selected)` : ''}
          </Text>
        </View>

        {songs.length > 5 && (
          <TextInput
            style={styles.searchInput}
            placeholder="Filter songs..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        )}

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : songs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="musical-notes-outline" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No songs found</Text>
            <Text style={styles.emptySubtitle}>
              {isManager && !activeArtist
                ? 'Select an artist from the dashboard first.'
                : 'Add songs to your catalog to include them in playlists.'}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.songListLabel}>
              Tap songs to add them ({songs.length} in catalog)
            </Text>
            {sortedSongs.map((song) => {
              const isSelected = selectedSongIds.includes(song.id)
              const hasAudio = song.files.length > 0
              const hasDemo = song.files.some(f => f.file_type === 'demo')
              const position = isSelected ? selectedSongIds.indexOf(song.id) + 1 : null

              return (
                <TouchableOpacity
                  key={song.id}
                  style={[styles.songRow, isSelected && styles.songRowSelected]}
                  onPress={() => toggleSong(song.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.songCheck}>
                    {isSelected ? (
                      <View style={styles.songPosition}>
                        <Text style={styles.songPositionText}>{position}</Text>
                      </View>
                    ) : (
                      <Ionicons name="add-circle-outline" size={22} color={hasAudio ? Colors.textMuted : Colors.border} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.songTitle, !hasAudio && { color: Colors.textMuted }]} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.songMeta}>
                      {song.cowriters?.map(c => c.name).join(', ') || 'No writers'}
                      {!hasAudio ? ' · No audio' : hasDemo ? ' · Demo' : ' · Work tape'}
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              )
            })}
          </>
        )}
      </ScrollView>
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
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 18, paddingVertical: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.sm },
  scroll: { padding: Spacing.lg, paddingBottom: 100 },
  topSection: {
    flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg,
  },
  coverPicker: {
    width: 90, height: 90, borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  coverImage: { width: 90, height: 90, borderRadius: Radius.lg },
  coverUploading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
  coverPlaceholder: {
    width: 90, height: 90, borderRadius: Radius.lg,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  coverPlaceholderText: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  nameInput: {
    fontSize: Fonts.sizes.xl, fontWeight: '700', color: Colors.textPrimary,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  descInput: {
    fontSize: Fonts.sizes.sm, color: Colors.textSecondary,
    paddingVertical: Spacing.sm, minHeight: 36,
  },
  songPickerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  songListLabel: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginBottom: Spacing.sm,
    fontWeight: '600',
  },
  searchInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    fontSize: Fonts.sizes.sm, color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  emptyState: {
    alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    textAlign: 'center', maxWidth: 260, lineHeight: 20,
  },
  songRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 10, paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md, marginBottom: 2,
  },
  songRowSelected: {
    backgroundColor: `${Colors.primary}10`,
  },
  songCheck: { width: 28, alignItems: 'center' },
  songPosition: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  songPositionText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  songTitle: {
    fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary,
  },
  songMeta: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1,
  },
})
