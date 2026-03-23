import React, { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

interface Playlist {
  id: string
  name: string
  slug: string
  description: string | null
  cover_image_url: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
  song_count?: number
}

export default function PlaylistsScreen() {
  const { profile, activeArtist } = useAuthStore()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const isManager = profile?.role === 'manager'
  const isArtist = profile?.role === 'artist'

  const resolveArtistId = async (): Promise<string | null> => {
    if (isManager) {
      return useAuthStore.getState().activeArtist?.id ?? null
    } else if (isArtist && profile?.id) {
      const { data } = await supabase.from('artists').select('id').eq('user_id', profile.id).single()
      return data?.id ?? null
    }
    return null
  }

  const loadPlaylists = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    const artId = await resolveArtistId()
    if (!artId) {
      setPlaylists([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('playlists')
        .select('*, playlist_songs(count)')
        .eq('artist_id', artId)
        .order('created_at', { ascending: false })

      if (error) throw error

      setPlaylists((data ?? []).map((p: any) => ({
        ...p,
        song_count: p.playlist_songs?.[0]?.count ?? 0,
      })))
    } catch (err) {
      console.error('[playlists] fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useFocusEffect(useCallback(() => {
    loadPlaylists()
  }, [isManager, isArtist, profile?.id]))

  const isExpired = (p: Playlist) =>
    !p.is_active || (p.expires_at && new Date(p.expires_at) < new Date())

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Playlists</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => router.push('/(app)/playlists/new')}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {playlists.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="list-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No playlists yet</Text>
          <Text style={styles.emptySubtitle}>
            Create a playlist to share your songs with labels, A&Rs, or collaborators.
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => router.push('/(app)/playlists/new')}
          >
            <Text style={styles.emptyBtnText}>Create Playlist</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadPlaylists(true)} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => {
            const expired = isExpired(item)
            return (
              <TouchableOpacity
                style={[styles.card, expired && styles.cardExpired]}
                onPress={() => router.push({ pathname: '/(app)/playlists/[id]', params: { id: item.id } })}
                activeOpacity={0.8}
              >
                <View style={styles.cardMain}>
                  {item.cover_image_url ? (
                    <Image source={{ uri: item.cover_image_url }} style={styles.cardCover} />
                  ) : (
                    <View style={styles.cardIcon}>
                      <Ionicons name="musical-notes" size={20} color={expired ? Colors.textMuted : Colors.primary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardName, expired && { color: Colors.textMuted }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {item.song_count} song{item.song_count !== 1 ? 's' : ''}
                      {expired ? ' · Expired' : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </View>
              </TouchableOpacity>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    flex: 1, fontSize: Fonts.sizes.xl, fontWeight: '800',
    color: Colors.textPrimary, letterSpacing: -0.5,
  },
  newBtn: {
    width: 36, height: 36, borderRadius: Radius.full,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl, gap: Spacing.sm,
  },
  emptyTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textSecondary },
  emptySubtitle: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 20, maxWidth: 280,
  },
  emptyBtn: {
    marginTop: Spacing.sm, backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg, paddingVertical: 10, borderRadius: Radius.full,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.md },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  cardExpired: { opacity: 0.5 },
  cardMain: {
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.md, gap: Spacing.md,
  },
  cardCover: {
    width: 44, height: 44, borderRadius: Radius.md,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: `${Colors.primary}12`,
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: {
    fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary,
  },
  cardMeta: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2,
  },
})
