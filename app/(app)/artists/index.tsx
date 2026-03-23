import React, { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ActivityIndicator, Image,
} from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Artist } from '../../../src/types/database'
import { Input } from '../../../src/components/Input'
import { Button } from '../../../src/components/Button'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'
import { fetchSpotifyArtist } from '../../../src/lib/spotify'

export default function ArtistsScreen() {
  const { profile, setActiveArtist } = useAuthStore()
  const [artists, setArtists] = useState<Artist[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [stageName, setStageName] = useState('')
  const [realName, setRealName] = useState('')
  const [linkEmail, setLinkEmail] = useState('')
  const [spotifyUrl, setSpotifyUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [successMsg, setSuccessMsg] = useState('')

  const fetchArtists = async () => {
    // Fetch artists you own
    const { data: owned } = await supabase
      .from('artists')
      .select('*')
      .eq('manager_id', profile?.id)
      .order('stage_name')

    // Fetch artists you're a team member of
    const { data: teamLinks } = await supabase
      .from('artist_team_members')
      .select('artist_id')
      .eq('user_id', profile?.id)

    const teamArtistIds = (teamLinks ?? []).map((t: any) => t.artist_id)
    let teamArtists: Artist[] = []
    if (teamArtistIds.length > 0) {
      const { data: ta } = await supabase
        .from('artists')
        .select('*')
        .in('id', teamArtistIds)
        .order('stage_name')
      teamArtists = (ta ?? []) as Artist[]
    }

    // Merge, deduplicate
    const ownedList = (owned ?? []) as Artist[]
    const allIds = new Set(ownedList.map(a => a.id))
    const merged = [...ownedList]
    for (const a of teamArtists) {
      if (!allIds.has(a.id)) {
        merged.push(a)
        allIds.add(a.id)
      }
    }
    setArtists(merged)
    setLoading(false)
  }

  useEffect(() => { fetchArtists() }, [profile])

  const handleAdd = async () => {
    const e: Record<string, string> = {}
    if (!stageName.trim()) e.stageName = 'Stage name is required'
    setErrors(e)
    if (Object.keys(e).length > 0) return

    setSaving(true)

    // If an email was provided, try to link an existing account
    let linkedUserId: string | null = null
    if (linkEmail.trim()) {
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', linkEmail.trim().toLowerCase())
        .maybeSingle()

      if (!existingProfile) {
        setErrors({ linkEmail: `No Song Vault account found for ${linkEmail}. Leave blank to add without linking.` })
        setSaving(false)
        return
      }
      linkedUserId = existingProfile.id
    }

    // Try to fetch Spotify photo if URL provided
    let avatarUrl: string | null = null
    let resolvedSpotifyUrl: string | null = null
    if (spotifyUrl.trim()) {
      try {
        const spotifyData = await fetchSpotifyArtist(spotifyUrl.trim())
        avatarUrl = spotifyData.imageUrl
        resolvedSpotifyUrl = spotifyData.spotifyUrl
      } catch {
        // Non-fatal — proceed without photo
      }
    }

    const { error } = await supabase.from('artists').insert({
      manager_id: profile!.id,
      user_id: linkedUserId,
      stage_name: stageName.trim(),
      real_name: realName.trim() || null,
      avatar_url: avatarUrl,
      spotify_url: resolvedSpotifyUrl,
    })

    setSaving(false)
    if (error) {
      setErrors({ stageName: error.message })
    } else {
      setModalVisible(false)
      setStageName('')
      setRealName('')
      setLinkEmail('')
      setSpotifyUrl('')
      setSuccessMsg(`${stageName} added!`)
      setTimeout(() => setSuccessMsg(''), 3000)
      fetchArtists()
    }
  }

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
        <Text style={styles.title}>Artists</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {successMsg !== '' && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
          <Text style={styles.successText}>{successMsg}</Text>
        </View>
      )}

      <FlatList
        data={artists}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No artists yet</Text>
            <Text style={styles.emptySubtext}>Add your first artist to get started</Text>
            <TouchableOpacity
              style={styles.emptyAddButton}
              onPress={() => setModalVisible(true)}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.emptyAddText}>Add Artist</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.artistCard}
            onPress={() => {
              setActiveArtist(item)
              router.push(`/(app)/artists/${item.id}`)
            }}
          >
            <View style={styles.artistAvatar}>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.artistAvatarImg} />
              ) : (
                <Text style={styles.artistInitial}>
                  {item.stage_name.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={styles.artistInfo}>
              <Text style={styles.artistName}>{item.stage_name}</Text>
              {item.real_name && (
                <Text style={styles.artistRealName}>{item.real_name}</Text>
              )}
              {!item.user_id && (
                <View style={styles.unlinkedBadge}>
                  <Ionicons
                    name={item.invite_sent_at ? 'time-outline' : 'person-add-outline'}
                    size={10}
                    color={item.invite_sent_at ? Colors.warning : Colors.textMuted}
                  />
                  <Text style={[styles.unlinkedText, item.invite_sent_at && { color: Colors.warning }]}>
                    {item.invite_sent_at ? 'Invite pending' : 'No portal access'}
                  </Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      />

      {/* Add Artist Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Artist</Text>
            <TouchableOpacity onPress={() => {
              setModalVisible(false)
              setStageName('')
              setRealName('')
              setLinkEmail('')
              setSpotifyUrl('')
              setErrors({})
            }}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Input
            label="Stage Name *"
            value={stageName}
            onChangeText={setStageName}
            placeholder="e.g. Taylor Swift"
            autoCapitalize="words"
            error={errors.stageName}
          />
          <Input
            label="Real Name (optional)"
            value={realName}
            onChangeText={setRealName}
            placeholder="Legal name"
            autoCapitalize="words"
          />
          <Input
            label="Spotify Artist URL (optional)"
            value={spotifyUrl}
            onChangeText={setSpotifyUrl}
            placeholder="https://open.spotify.com/artist/..."
            autoCapitalize="none"
            hint="We'll automatically pull their profile photo"
          />

          <Text style={styles.linkHint}>
            You can invite the artist to create their portal account after adding them.
          </Text>

          <Button title="Add Artist" onPress={handleAdd} loading={saving} />
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: Spacing.lg,
  },
  title: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  addButton: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.success}15`, borderWidth: 1,
    borderColor: `${Colors.success}40`, borderRadius: Radius.md,
    padding: Spacing.sm, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
  },
  successText: { color: Colors.success, fontSize: Fonts.sizes.sm, fontWeight: '600' },
  list: { padding: Spacing.lg, paddingTop: 0, gap: Spacing.sm },
  artistCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md,
  },
  artistAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: `${Colors.primary}20`,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: `${Colors.primary}40`,
    overflow: 'hidden',
  },
  artistAvatarImg: { width: 48, height: 48, borderRadius: 24 },
  artistInitial: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary },
  artistInfo: { flex: 1 },
  artistName: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  artistRealName: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, marginTop: 2 },
  unlinkedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    marginTop: 4,
  },
  unlinkedText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textSecondary },
  emptySubtext: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, textAlign: 'center' },
  emptyAddButton: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm, borderRadius: Radius.full, marginTop: Spacing.sm,
  },
  emptyAddText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.md },
  modal: { flex: 1, backgroundColor: Colors.background, padding: Spacing.lg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: Spacing.xl,
  },
  modalTitle: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary },
  divider: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.sm, marginVertical: Spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '500' },
  linkHint: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    lineHeight: 18, marginBottom: Spacing.sm,
  },
})
