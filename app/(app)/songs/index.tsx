import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase, withAuthRetry } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { SongCard } from '../../../src/components/SongCard'
import { SongWithDetails, SongStatus } from '../../../src/types/database'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

const STATUS_FILTERS: { label: string; value: SongStatus | 'all' | 'to_submit' }[] = [
  { label: 'All', value: 'all' },
  { label: 'To Submit', value: 'to_submit' },
  { label: 'Logged', value: 'logged' },
  { label: 'Work Tape', value: 'work_tape' },
  { label: 'Demo Ready', value: 'demo_ready' },
  { label: 'Complete', value: 'complete' },
  { label: 'Submitted', value: 'submitted' },
]

export default function SongsScreen() {
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>()
  const { profile, activeArtist } = useAuthStore()
  const [songs, setSongs] = useState<SongWithDetails[]>([])
  const [filtered, setFiltered] = useState<SongWithDetails[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SongStatus | 'all' | 'to_submit'>(
    initialFilter === 'to_submit' ? 'to_submit' : 'all'
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const fetchIdRef = useRef(0)
  const [playlistPickerVisible, setPlaylistPickerVisible] = useState(false)
  const [playlistPickerSongId, setPlaylistPickerSongId] = useState<string | null>(null)
  const [playlists, setPlaylists] = useState<{ id: string; name: string; song_count: number }[]>([])
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  const isManager = profile?.role === 'manager'
  const isPublisher = profile?.role === 'publisher'
  const isWriter = profile?.role === 'writer'
  const canAddSong = !isWriter
  const canImport = isManager || isPublisher

  const fetchSongs = async () => {
    if (!profile) return
    const thisId = ++fetchIdRef.current
    try {
      let query = supabase
        .from('songs')
        .select(`*, cowriters(*), files:song_files(*), artist:artists(id, stage_name)`)
        .order('date_written', { ascending: false })

      if (isManager) {
        if (activeArtist) {
          query = query.eq('artist_id', activeArtist.id)
        } else {
          setSongs([])
          setLoading(false)
          setRefreshing(false)
          return
        }
      } else if (isWriter) {
        // Writers: RLS automatically returns only credited songs
        // No additional filter needed
      } else {
        // Artist: scope to their own artist record
        const { data: artistData } = await supabase
          .from('artists')
          .select('id')
          .eq('user_id', profile!.id)
          .single()
        if (artistData) query = query.eq('artist_id', artistData.id)
      }

      const { data, error } = await query
      if (error) throw error
      if (thisId !== fetchIdRef.current) return // stale fetch
      setSongs((data ?? []) as SongWithDetails[])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useFocusEffect(useCallback(() => { fetchSongs() }, [profile?.id, activeArtist?.id]))

  useEffect(() => {
    let result = songs
    if (statusFilter === 'to_submit') result = result.filter((s) => s.status !== 'submitted')
    else if (statusFilter !== 'all') result = result.filter((s) => s.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.cowriters?.some((c) => c.name.toLowerCase().includes(q))
      )
    }
    setFiltered(result)
  }, [songs, search, statusFilter])

  const fetchPlaylists = async () => {
    const { data } = await supabase
      .from('playlists')
      .select('id, name, playlist_songs(count)')
      .order('created_at', { ascending: false })
    setPlaylists((data ?? []).map((p: any) => ({
      id: p.id, name: p.name,
      song_count: p.playlist_songs?.[0]?.count ?? 0,
    })))
  }

  const openPlaylistPicker = (songId: string) => {
    setPlaylistPickerSongId(songId)
    setPlaylistPickerVisible(true)
  }

  const handleAddToPlaylist = async (playlistId: string) => {
    if (!playlistPickerSongId) return
    setAddingToPlaylist(playlistId)
    try {
      const { data: existing } = await supabase
        .from('playlist_songs')
        .select('position')
        .eq('playlist_id', playlistId)
        .order('position', { ascending: false })
        .limit(1)
      const nextPos = (existing?.[0]?.position ?? -1) + 1

      const song = songs.find(s => s.id === playlistPickerSongId)
      const demoFile = song?.files?.find(f => f.file_type === 'demo')
      const wtFile = song?.files?.find(f => f.file_type === 'work_tape')

      const { error } = await supabase.from('playlist_songs').insert({
        playlist_id: playlistId,
        song_id: playlistPickerSongId,
        file_id: demoFile?.id ?? wtFile?.id ?? null,
        position: nextPos,
      })
      if (error) {
        if (error.code === '23505') setSuccessMsg('Already in that playlist')
        else throw error
      } else {
        setSuccessMsg('Added to playlist!')
      }
      setTimeout(() => setSuccessMsg(''), 3000)
      setPlaylistPickerVisible(false)
    } catch (err: any) {
      console.error('[songs] add to playlist:', err)
    } finally {
      setAddingToPlaylist(null)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Songs</Text>
        <View style={styles.headerActions}>
          {canImport && (
            <TouchableOpacity
              style={styles.importButton}
              onPress={() => router.push('/(app)/songs/import')}
            >
              <Ionicons name="cloud-upload-outline" size={16} color={Colors.primary} />
              <Text style={styles.importButtonText}>Import</Text>
            </TouchableOpacity>
          )}
          {canAddSong && (
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => router.push('/(app)/songs/new')}
            >
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrapper}>
        <Ionicons name="search-outline" size={18} color={Colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search songs or co-writers..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Status filter chips */}
      <View style={styles.filterRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterList}
        style={styles.filterScroll}
      >
        {STATUS_FILTERS.map((item) => (
          <TouchableOpacity
            key={item.value}
            style={[styles.filterChip, statusFilter === item.value && styles.filterChipActive]}
            onPress={() => setStatusFilter(item.value)}
          >
            <Text
              style={[styles.filterChipText, statusFilter === item.value && styles.filterChipTextActive]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxl }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchSongs() }} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="musical-notes-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                {search || statusFilter !== 'all' ? 'No songs match your filters' : 'No songs yet'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <SongCard
              song={item}
              showArtist={isManager || isWriter}
              onPress={() => router.push({ pathname: '/(app)/songs/[id]', params: { id: item.id, from: 'songs' } })}
              onAddToPlaylist={!isWriter ? () => openPlaylistPicker(item.id) : undefined}
              artistName={activeArtist?.real_name ?? activeArtist?.stage_name}
            />
          )}
        />
      )}

      {/* Success toast */}
      {successMsg ? (
        <View style={styles.toast}>
          <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
          <Text style={styles.toastText}>{successMsg}</Text>
        </View>
      ) : null}

      {/* Add to Playlist Modal */}
      <Modal visible={playlistPickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPlaylistPickerVisible(false)} onShow={fetchPlaylists}>
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.playlistHeader}>
            <Text style={styles.playlistHeaderTitle}>Add to Playlist</Text>
            <TouchableOpacity onPress={() => setPlaylistPickerVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}>
            {playlists.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm }}>
                <Ionicons name="list-outline" size={40} color={Colors.textMuted} />
                <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '600', color: Colors.textSecondary }}>No playlists yet</Text>
                <TouchableOpacity
                  style={styles.playlistCreateBtn}
                  onPress={() => { setPlaylistPickerVisible(false); router.push('/(app)/playlists/new') }}
                >
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.sm }}>Create Playlist</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {playlists.map((pl) => (
                  <TouchableOpacity
                    key={pl.id}
                    style={styles.playlistRow}
                    onPress={() => handleAddToPlaylist(pl.id)}
                    disabled={addingToPlaylist !== null}
                    activeOpacity={0.7}
                  >
                    <View style={styles.playlistIcon}>
                      <Ionicons name="musical-notes" size={18} color={Colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.playlistName}>{pl.name}</Text>
                      <Text style={styles.playlistCount}>{pl.song_count} song{pl.song_count !== 1 ? 's' : ''}</Text>
                    </View>
                    {addingToPlaylist === pl.id ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.playlistNewRow}
                  onPress={() => { setPlaylistPickerVisible(false); router.push('/(app)/playlists/new') }}
                >
                  <Ionicons name="add" size={18} color={Colors.primary} />
                  <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: Fonts.sizes.sm }}>New Playlist</Text>
                </TouchableOpacity>
              </>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  importButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary,
  },
  importButtonText: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.primary },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  searchIcon: { marginRight: Spacing.sm },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: Fonts.sizes.md },
  filterRow: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterScroll: { flexGrow: 0 },
  filterList: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, flexDirection: 'row', gap: 8, alignItems: 'center' },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl, gap: Spacing.sm },
  emptyText: { fontSize: Fonts.sizes.md, color: Colors.textMuted },
  toast: {
    position: 'absolute', bottom: 100, left: Spacing.lg, right: Spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  toastText: { fontSize: Fonts.sizes.sm, color: Colors.textPrimary, fontWeight: '600' },
  playlistHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  playlistHeaderTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textPrimary },
  playlistRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, backgroundColor: Colors.surface,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
  },
  playlistIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: `${Colors.primary}12`,
    alignItems: 'center', justifyContent: 'center',
  },
  playlistName: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.textPrimary },
  playlistCount: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1 },
  playlistNewRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: `${Colors.primary}30`, borderStyle: 'dashed',
  },
  playlistCreateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg,
    paddingVertical: 10, borderRadius: Radius.full, marginTop: Spacing.sm,
  },
})
