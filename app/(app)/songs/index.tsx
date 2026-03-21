import React, { useCallback, useEffect, useState } from 'react'
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
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { SongCard } from '../../../src/components/SongCard'
import { SongWithDetails, SongStatus } from '../../../src/types/database'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

const STATUS_FILTERS: { label: string; value: SongStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Logged', value: 'logged' },
  { label: 'Work Tape', value: 'work_tape' },
  { label: 'Demo Ready', value: 'demo_ready' },
  { label: 'Complete', value: 'complete' },
  { label: 'Submitted', value: 'submitted' },
]

export default function SongsScreen() {
  const { profile, activeArtist } = useAuthStore()
  const [songs, setSongs] = useState<SongWithDetails[]>([])
  const [filtered, setFiltered] = useState<SongWithDetails[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SongStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const isManager = profile?.role === 'manager'
  const isPublisher = profile?.role === 'publisher'
  const isWriter = profile?.role === 'writer'
  const canAddSong = !isWriter
  const canImport = isManager || isPublisher

  const fetchSongs = async () => {
    if (!profile) return
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
    if (statusFilter !== 'all') result = result.filter((s) => s.status === statusFilter)
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
              artistName={activeArtist?.real_name ?? activeArtist?.stage_name}
            />
          )}
        />
      )}
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
})
