import React, { useEffect, useState, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Input } from '../../../src/components/Input'
import { Button } from '../../../src/components/Button'
import { Publisher } from '../../../src/types/database'
import { Colors, Spacing, Fonts, Radius, PRO_OPTIONS } from '../../../src/utils/constants'

interface Songwriter {
  id: string; name: string; legal_name: string | null; email: string | null
  phone: string | null; ipi_number: string | null; pro: string | null
  publisher_id: string | null; publisher_name: string | null
  publisher?: Publisher; notes: string | null
  user_id: string | null
}

export default function WriterDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { profile } = useAuthStore()
  const [writer, setWriter] = useState<Songwriter | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishers, setPublishers] = useState<Publisher[]>([])
  const [form, setForm] = useState<any>({})
  const [successMsg, setSuccessMsg] = useState('')
  const [songCount, setSongCount] = useState(0)

  // Manager: link account
  const isManager = profile?.role === 'manager'
  const [linkEmail, setLinkEmail] = useState('')
  const [linkingAccount, setLinkingAccount] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [showLinkForm, setShowLinkForm] = useState(false)

  const fetchWriter = useCallback(async () => {
    const [writerRes, pubRes, countRes] = await Promise.all([
      supabase.from('songwriters').select('*, publisher:publishers(id, name)').eq('id', id).single(),
      supabase.from('publishers').select('*').order('name'),
      supabase.from('cowriters').select('id', { count: 'exact' }).eq('songwriter_id', id),
    ])
    if (writerRes.data) {
      setWriter(writerRes.data as Songwriter)
      setForm({ ...writerRes.data, publisher_id: writerRes.data.publisher_id ?? '', pro: writerRes.data.pro ?? '' })
    }
    if (pubRes.data) setPublishers(pubRes.data as Publisher[])
    setSongCount(countRes.count ?? 0)
    setLoading(false)
  }, [id])

  useEffect(() => { fetchWriter() }, [fetchWriter])

  const handleLinkAccount = async () => {
    if (!linkEmail.trim() || !/\S+@\S+\.\S+/.test(linkEmail)) {
      setLinkError('Enter a valid email address')
      return
    }
    setLinkingAccount(true)
    setLinkError('')
    // Find profile by email
    const { data: profileData, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('email', linkEmail.trim().toLowerCase())
      .single()
    if (profileErr || !profileData) {
      setLinkError('No Song Vault account found with that email.')
      setLinkingAccount(false)
      return
    }
    // Link the profile to this songwriter entry
    const { error: updateErr } = await supabase
      .from('songwriters')
      .update({ user_id: profileData.id })
      .eq('id', id)
    setLinkingAccount(false)
    if (updateErr) {
      setLinkError(updateErr.message)
    } else {
      setShowLinkForm(false)
      setLinkEmail('')
      setSuccessMsg(`Linked to ${profileData.full_name}'s account!`)
      setTimeout(() => setSuccessMsg(''), 3000)
      fetchWriter()
    }
  }

  const handleUnlinkAccount = async () => {
    const { error } = await supabase
      .from('songwriters')
      .update({ user_id: null })
      .eq('id', id)
    if (!error) {
      setSuccessMsg('Account unlinked.')
      setTimeout(() => setSuccessMsg(''), 2000)
      fetchWriter()
    }
  }

  const handleSave = async () => {
    setSaving(true)
    const { error } = await supabase.from('songwriters').update({
      name: form.name.trim(),
      legal_name: form.legal_name?.trim() || null,
      email: form.email?.trim() || null,
      phone: form.phone?.trim() || null,
      ipi_number: form.ipi_number?.trim() || null,
      pro: form.pro || null,
      publisher_id: form.publisher_id || null,
      publisher_name: form.publisher_name?.trim() || null,
      notes: form.notes?.trim() || null,
    }).eq('id', id)
    setSaving(false)
    if (!error) {
      setEditing(false)
      setSuccessMsg('Saved!')
      setTimeout(() => setSuccessMsg(''), 2000)
      fetchWriter()
    }
  }

  if (loading) return <SafeAreaView style={styles.container}><ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxl }} /></SafeAreaView>
  if (!writer) return <SafeAreaView style={styles.container}><Text style={{ color: Colors.textPrimary, padding: Spacing.lg }}>Writer not found.</Text></SafeAreaView>

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => editing ? handleSave() : setEditing(true)} style={styles.editBtn}>
            {saving ? <ActivityIndicator size="small" color={Colors.primary} /> :
              <Text style={styles.editBtnText}>{editing ? 'Save' : 'Edit'}</Text>}
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>{writer.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{writer.name}</Text>
          {writer.legal_name && <Text style={styles.legalName}>{writer.legal_name}</Text>}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{songCount}</Text>
              <Text style={styles.statLabel}>Songs in system</Text>
            </View>
            {writer.pro && (
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{writer.pro}</Text>
                <Text style={styles.statLabel}>PRO</Text>
              </View>
            )}
          </View>
        </View>

        {successMsg !== '' && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.successText}>{successMsg}</Text>
          </View>
        )}

        {/* Manager: link/unlink account */}
        {isManager && (
          <View style={styles.accountSection}>
            {writer.user_id ? (
              <View style={styles.linkedAccountRow}>
                <Ionicons name="person-circle" size={18} color={Colors.success} />
                <Text style={styles.linkedAccountText}>Song Vault account linked</Text>
                <TouchableOpacity onPress={handleUnlinkAccount} style={styles.unlinkBtn}>
                  <Text style={styles.unlinkBtnText}>Unlink</Text>
                </TouchableOpacity>
              </View>
            ) : showLinkForm ? (
              <View style={styles.linkForm}>
                <Text style={styles.linkFormTitle}>Link a Song Vault Account</Text>
                <Text style={styles.linkFormHint}>
                  Enter the email of the writer's Song Vault account. They'll be able to see all songs they're credited on.
                </Text>
                <Input
                  label="Account Email"
                  value={linkEmail}
                  onChangeText={setLinkEmail}
                  placeholder="writer@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                {linkError !== '' && (
                  <Text style={styles.linkError}>{linkError}</Text>
                )}
                <View style={styles.linkFormButtons}>
                  <TouchableOpacity
                    style={styles.linkCancelBtn}
                    onPress={() => { setShowLinkForm(false); setLinkEmail(''); setLinkError('') }}
                  >
                    <Text style={styles.linkCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.linkConfirmBtn}
                    onPress={handleLinkAccount}
                    disabled={linkingAccount}
                  >
                    {linkingAccount
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.linkConfirmText}>Link Account</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.linkAccountBtn}
                onPress={() => setShowLinkForm(true)}
              >
                <Ionicons name="person-add-outline" size={16} color={Colors.primary} />
                <Text style={styles.linkAccountText}>Link Song Vault account</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {editing ? (
          <View style={styles.editForm}>
            <Input label="Name *" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoCapitalize="words" />
            <Input label="Legal Name" value={form.legal_name ?? ''} onChangeText={(v) => setForm({ ...form, legal_name: v })} autoCapitalize="words" />
            <Input label="IPI Number" value={form.ipi_number ?? ''} onChangeText={(v) => setForm({ ...form, ipi_number: v })} keyboardType="numeric" />

            <Text style={styles.fieldLabel}>PRO</Text>
            <View style={styles.proSelector}>
              {PRO_OPTIONS.map((pro) => (
                <TouchableOpacity key={pro} style={[styles.proChip, form.pro === pro && styles.proChipActive]}
                  onPress={() => setForm({ ...form, pro: form.pro === pro ? '' : pro })}>
                  <Text style={[styles.proChipText, form.pro === pro && styles.proChipTextActive]}>{pro}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Publisher</Text>
            <View style={styles.publisherPicker}>
              {publishers.map((pub) => (
                <TouchableOpacity key={pub.id} style={[styles.publisherChip, form.publisher_id === pub.id && styles.publisherChipActive]}
                  onPress={() => setForm({ ...form, publisher_id: form.publisher_id === pub.id ? '' : pub.id, publisher_name: '' })}>
                  <Text style={[styles.publisherChipText, form.publisher_id === pub.id && styles.publisherChipTextActive]}>{pub.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!form.publisher_id && (
              <Input label="Publisher Name (if not listed)" value={form.publisher_name ?? ''} onChangeText={(v) => setForm({ ...form, publisher_name: v })} autoCapitalize="words" />
            )}

            <Input label="Email" value={form.email ?? ''} onChangeText={(v) => setForm({ ...form, email: v })} keyboardType="email-address" />
            <Input label="Phone" value={form.phone ?? ''} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
            <Input label="Notes" value={form.notes ?? ''} onChangeText={(v) => setForm({ ...form, notes: v })} multiline numberOfLines={3} />
            <Button title="Save Changes" onPress={handleSave} loading={saving} />
            <Button title="Cancel" onPress={() => setEditing(false)} variant="ghost" />
          </View>
        ) : (
          <View style={styles.infoGrid}>
            {[
              { label: 'IPI Number', value: writer.ipi_number, icon: 'key-outline' },
              { label: 'PRO', value: writer.pro, icon: 'shield-outline' },
              { label: 'Publisher', value: writer.publisher?.name ?? writer.publisher_name, icon: 'business-outline' },
              { label: 'Email', value: writer.email, icon: 'mail-outline' },
              { label: 'Phone', value: writer.phone, icon: 'call-outline' },
              { label: 'Notes', value: writer.notes, icon: 'document-text-outline' },
            ].map(({ label, value, icon }) => value ? (
              <View key={label} style={styles.infoRow}>
                <Ionicons name={icon as any} size={16} color={Colors.textMuted} style={{ marginTop: 2 }} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>{label}</Text>
                  <Text style={styles.infoValue}>{value}</Text>
                </View>
              </View>
            ) : null)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  editBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary },
  editBtnText: { color: Colors.primary, fontWeight: '700', fontSize: Fonts.sizes.sm },
  hero: { alignItems: 'center', marginBottom: Spacing.xl },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: `${Colors.primary}20`, borderWidth: 2, borderColor: `${Colors.primary}50`, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  avatarLetter: { fontSize: 36, fontWeight: '800', color: Colors.primary },
  name: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  legalName: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, minWidth: 100 },
  statNumber: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary },
  statLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: `${Colors.success}15`, borderWidth: 1, borderColor: `${Colors.success}40`, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.md },
  successText: { color: Colors.success, fontSize: Fonts.sizes.sm, fontWeight: '600' },
  infoGrid: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  infoValue: { fontSize: Fonts.sizes.md, color: Colors.textPrimary },
  editForm: { gap: 0 },
  fieldLabel: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  proSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.md },
  proChip: { paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  proChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  proChipText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600' },
  proChipTextActive: { color: '#fff' },
  publisherPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.md },
  publisherChip: { paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  publisherChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  publisherChipText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600' },
  publisherChipTextActive: { color: '#fff' },

  // Account linking
  accountSection: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  linkedAccountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
  },
  linkedAccountText: {
    flex: 1, fontSize: Fonts.sizes.sm, color: Colors.success, fontWeight: '600',
  },
  unlinkBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  unlinkBtnText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600' },
  linkAccountBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
  },
  linkAccountText: {
    fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600',
  },
  linkForm: { gap: Spacing.xs },
  linkFormTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  linkFormHint: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, lineHeight: 18, marginBottom: Spacing.sm },
  linkError: { color: Colors.error, fontSize: Fonts.sizes.xs },
  linkFormButtons: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  linkCancelBtn: {
    flex: 1, padding: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  linkCancelText: { color: Colors.textSecondary, fontWeight: '600', fontSize: Fonts.sizes.sm },
  linkConfirmBtn: {
    flex: 1, padding: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  linkConfirmText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.sm },
})
