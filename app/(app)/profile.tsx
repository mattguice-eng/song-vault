import React, { useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, TextInput,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import { useAuthStore } from '../../src/store/authStore'
import { Songwriter } from '../../src/types/database'
import { Colors, Spacing, Fonts, Radius } from '../../src/utils/constants'

export default function ProfileScreen() {
  const { profile, songwriterProfile, setSongwriterProfile, signOut } = useAuthStore()
  const isWriter = profile?.role === 'writer'

  const [signOutConfirm, setSignOutConfirm] = useState(false)

  // Writer: link songwriter profile
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Songwriter[]>([])
  const [searching, setSearching] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [linkSuccess, setLinkSuccess] = useState('')

  const roleLabel =
    profile?.role === 'manager' ? 'Manager' :
    profile?.role === 'artist' ? 'Artist' :
    profile?.role === 'writer' ? 'Songwriter' : 'Publisher'
  const roleIcon =
    profile?.role === 'manager' ? 'briefcase-outline' :
    profile?.role === 'artist' ? 'mic-outline' :
    profile?.role === 'writer' ? 'pencil-outline' : 'business-outline'

  const handleSearch = async (q: string) => {
    setSearchQuery(q)
    if (q.trim().length < 2) { setSearchResults([]); return }
    setSearching(true)
    const { data } = await supabase
      .from('songwriters')
      .select('*')
      .ilike('name', `%${q.trim()}%`)
      .is('user_id', null) // only unlinked entries
      .limit(8)
    setSearchResults((data ?? []) as Songwriter[])
    setSearching(false)
  }

  const handleClaimProfile = async (sw: Songwriter) => {
    setLinking(true)
    setLinkError('')
    const { error } = await supabase
      .from('songwriters')
      .update({ user_id: profile!.id })
      .eq('id', sw.id)
    setLinking(false)
    if (error) {
      setLinkError(error.message)
    } else {
      setSongwriterProfile({ ...sw, user_id: profile!.id })
      setSearchQuery('')
      setSearchResults([])
      setLinkSuccess('Profile linked!')
      setTimeout(() => setLinkSuccess(''), 3000)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Profile</Text>

        {/* Identity card */}
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
            </Text>
          </View>
          <Text style={styles.name}>{profile?.full_name}</Text>
          <Text style={styles.email}>{profile?.email}</Text>
          <View style={styles.roleBadge}>
            <Ionicons name={roleIcon as any} size={14} color={Colors.primary} />
            <Text style={styles.roleText}>{roleLabel}</Text>
          </View>
        </View>

        {/* Writer: songwriter profile section */}
        {isWriter && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Songwriter Profile</Text>

            {songwriterProfile ? (
              // Linked — show their info
              <View style={styles.linkedCard}>
                <View style={styles.linkedHeader}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.linkedName}>{songwriterProfile.name}</Text>
                </View>
                {[
                  { label: 'Legal Name', value: songwriterProfile.legal_name },
                  { label: 'IPI Number', value: songwriterProfile.ipi_number },
                  { label: 'PRO', value: songwriterProfile.pro },
                  { label: 'Publisher', value: songwriterProfile.publisher_name },
                  { label: 'Email', value: songwriterProfile.email },
                ].map(({ label, value }) => value ? (
                  <View key={label} style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{label}</Text>
                    <Text style={styles.infoValue}>{value}</Text>
                  </View>
                ) : null)}
                <Text style={styles.linkedHint}>
                  Your manager can update this info from the Writers tab.
                </Text>
              </View>
            ) : (
              // Not linked — show search/claim UI
              <>
                <Text style={styles.claimHint}>
                  Search for your name in the songwriter registry to link your credits.
                  Once linked, you'll see all songs you're credited on.
                </Text>

                {linkSuccess !== '' && (
                  <View style={styles.successBanner}>
                    <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                    <Text style={styles.successText}>{linkSuccess}</Text>
                  </View>
                )}

                <View style={styles.searchWrapper}>
                  <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search your name..."
                    placeholderTextColor={Colors.textMuted}
                    value={searchQuery}
                    onChangeText={handleSearch}
                    autoCapitalize="words"
                  />
                  {searching && <ActivityIndicator size="small" color={Colors.primary} />}
                </View>

                {linkError !== '' && (
                  <Text style={styles.errorText}>{linkError}</Text>
                )}

                {searchResults.map(sw => (
                  <TouchableOpacity
                    key={sw.id}
                    style={styles.resultRow}
                    onPress={() => handleClaimProfile(sw)}
                    disabled={linking}
                  >
                    <View style={styles.resultAvatar}>
                      <Text style={styles.resultInitial}>
                        {sw.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{sw.name}</Text>
                      {(sw.pro || sw.ipi_number) && (
                        <Text style={styles.resultMeta}>
                          {[sw.pro, sw.ipi_number && `IPI ${sw.ipi_number}`].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </View>
                    {linking ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Text style={styles.claimBtn}>Claim</Text>
                    )}
                  </TouchableOpacity>
                ))}

                {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                  <Text style={styles.noResults}>
                    No unlinked registry entries found for "{searchQuery}".
                    Ask your manager to add you.
                  </Text>
                )}
              </>
            )}
          </View>
        )}

        {/* Menu */}
        <View style={styles.menuSection}>
          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="person-outline" size={20} color={Colors.textSecondary} />
            <Text style={styles.menuLabel}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="notifications-outline" size={20} color={Colors.textSecondary} />
            <Text style={styles.menuLabel}>Notifications</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]}>
            <Ionicons name="lock-closed-outline" size={20} color={Colors.textSecondary} />
            <Text style={styles.menuLabel}>Change Password</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Sign out */}
        {signOutConfirm ? (
          <View style={styles.confirmCard}>
            <Text style={styles.confirmText}>Sign out of Song Vault?</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setSignOutConfirm(false)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmSignOut} onPress={signOut}>
                <Text style={styles.confirmSignOutText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.signOutButton} onPress={() => setSignOutConfirm(true)}>
            <Ionicons name="log-out-outline" size={20} color={Colors.error} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary, marginBottom: Spacing.lg },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.xl, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.lg,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: `${Colors.primary}30`, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primary, marginBottom: Spacing.md,
  },
  avatarText: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.primary },
  name: { fontSize: Fonts.sizes.xl, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  email: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, marginBottom: Spacing.md },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${Colors.primary}15`, paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1, borderColor: `${Colors.primary}30`,
  },
  roleText: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600' },
  section: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  sectionTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.md },
  linkedCard: { gap: Spacing.xs },
  linkedHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  linkedName: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textPrimary },
  infoRow: { flexDirection: 'row', gap: Spacing.md, paddingVertical: 4, borderTopWidth: 1, borderTopColor: Colors.border },
  infoLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600', width: 80, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { flex: 1, fontSize: Fonts.sizes.sm, color: Colors.textPrimary },
  linkedHint: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: Spacing.sm, fontStyle: 'italic' },
  claimHint: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, lineHeight: 20, marginBottom: Spacing.md },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.success}15`, borderWidth: 1, borderColor: `${Colors.success}40`,
    borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.md,
  },
  successText: { color: Colors.success, fontSize: Fonts.sizes.sm, fontWeight: '600' },
  searchWrapper: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, height: 44,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: Fonts.sizes.md },
  errorText: { color: Colors.error, fontSize: Fonts.sizes.xs, marginBottom: Spacing.sm },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.xs,
    borderWidth: 1, borderColor: Colors.border,
  },
  resultAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: `${Colors.primary}20`, borderWidth: 1, borderColor: `${Colors.primary}40`,
    alignItems: 'center', justifyContent: 'center',
  },
  resultInitial: { fontSize: Fonts.sizes.md, fontWeight: '800', color: Colors.primary },
  resultInfo: { flex: 1 },
  resultName: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  resultMeta: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  claimBtn: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '700' },
  noResults: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontStyle: 'italic', textAlign: 'center', padding: Spacing.md },
  menuSection: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginBottom: Spacing.lg,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  menuLabel: { flex: 1, fontSize: Fonts.sizes.md, color: Colors.textPrimary },
  confirmCard: {
    backgroundColor: `${Colors.error}10`, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.error}30`,
    gap: Spacing.md,
  },
  confirmText: { fontSize: Fonts.sizes.md, color: Colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  confirmButtons: { flexDirection: 'row', gap: Spacing.sm },
  confirmCancel: {
    flex: 1, padding: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  confirmCancelText: { color: Colors.textSecondary, fontWeight: '600' },
  confirmSignOut: {
    flex: 1, padding: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.error, alignItems: 'center',
  },
  confirmSignOutText: { color: '#fff', fontWeight: '700' },
  signOutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    padding: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, borderColor: `${Colors.error}40`, backgroundColor: `${Colors.error}10`,
  },
  signOutText: { fontSize: Fonts.sizes.md, color: Colors.error, fontWeight: '600' },
})
