import React, { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Input } from '../../../src/components/Input'
import { Button } from '../../../src/components/Button'
import { Publisher } from '../../../src/types/database'
import { Colors, Spacing, Fonts, Radius, PRO_OPTIONS } from '../../../src/utils/constants'

interface Songwriter {
  id: string
  name: string
  legal_name: string | null
  email: string | null
  phone: string | null
  ipi_number: string | null
  pro: string | null
  publisher_id: string | null
  publisher_name: string | null
  publisher?: Publisher
  notes: string | null
}

const emptyForm = {
  name: '', legal_name: '', email: '', phone: '',
  ipi_number: '', pro: '', publisher_id: '', publisher_name: '', notes: '',
}

export default function WritersScreen() {
  const { profile } = useAuthStore()
  const [writers, setWriters] = useState<Songwriter[]>([])
  const [filtered, setFiltered] = useState<Songwriter[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [publishers, setPublishers] = useState<Publisher[]>([])
  const [successMsg, setSuccessMsg] = useState('')

  const fetchWriters = async () => {
    const { data } = await supabase
      .from('songwriters')
      .select('*, publisher:publishers(id, name)')
      .order('name')
    setWriters((data ?? []) as Songwriter[])
    setFiltered((data ?? []) as Songwriter[])
    setLoading(false)
  }

  const fetchPublishers = async () => {
    const { data } = await supabase.from('publishers').select('*').order('name')
    setPublishers((data ?? []) as Publisher[])
  }

  useEffect(() => { fetchWriters(); fetchPublishers() }, [])

  useEffect(() => {
    if (!search.trim()) { setFiltered(writers); return }
    const q = search.toLowerCase()
    setFiltered(writers.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.ipi_number?.includes(q) ||
      w.publisher_name?.toLowerCase().includes(q) ||
      w.publisher?.name.toLowerCase().includes(q)
    ))
  }, [search, writers])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    const { error } = await supabase.from('songwriters').insert({
      name: form.name.trim(),
      legal_name: form.legal_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      ipi_number: form.ipi_number.trim() || null,
      pro: form.pro || null,
      publisher_id: form.publisher_id || null,
      publisher_name: form.publisher_name.trim() || null,
      notes: form.notes.trim() || null,
      created_by: profile!.id,
    })
    setSaving(false)
    if (error) {
      setErrors({ name: error.message })
    } else {
      setModalVisible(false)
      setForm(emptyForm)
      setSuccessMsg('Writer added to registry!')
      setTimeout(() => setSuccessMsg(''), 3000)
      fetchWriters()
    }
  }

  const openModal = () => { setForm(emptyForm); setErrors({}); setModalVisible(true) }

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
        <Text style={styles.title}>Writers</Text>
        <TouchableOpacity style={styles.addButton} onPress={openModal}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrapper}>
        <Ionicons name="search-outline" size={18} color={Colors.textMuted} style={{ marginRight: Spacing.sm }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search writers, IPI, publisher..."
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

      {successMsg !== '' && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
          <Text style={styles.successText}>{successMsg}</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {search ? 'No writers found' : 'No writers yet'}
            </Text>
            <Text style={styles.emptySubtext}>
              {search
                ? 'Try a different search or add a new writer'
                : 'Writers are added here when you log songs or manually'}
            </Text>
            {!search && (
              <TouchableOpacity style={styles.emptyAddButton} onPress={openModal}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.emptyAddText}>Add Writer</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.writerCard}
            onPress={() => router.push(`/(app)/writers/${item.id}`)}
          >
            <View style={styles.writerAvatar}>
              <Text style={styles.writerInitial}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.writerInfo}>
              <Text style={styles.writerName}>{item.name}</Text>
              <View style={styles.writerMeta}>
                {item.pro && (
                  <View style={styles.metaBadge}>
                    <Text style={styles.metaBadgeText}>{item.pro}</Text>
                  </View>
                )}
                {(item.publisher?.name || item.publisher_name) && (
                  <Text style={styles.metaText} numberOfLines={1}>
                    {item.publisher?.name ?? item.publisher_name}
                  </Text>
                )}
                {item.ipi_number && (
                  <Text style={styles.metaText} numberOfLines={1}>
                    IPI: {item.ipi_number}
                  </Text>
                )}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      />

      {/* Add Writer Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Writer</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Input label="Name *" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })}
              placeholder="Stage or full name" autoCapitalize="words" error={errors.name} />
            <Input label="Legal Name (optional)" value={form.legal_name}
              onChangeText={(v) => setForm({ ...form, legal_name: v })}
              placeholder="If different from above" autoCapitalize="words" />
            <Input label="IPI Number" value={form.ipi_number}
              onChangeText={(v) => setForm({ ...form, ipi_number: v })}
              placeholder="Performing rights ID" keyboardType="numeric" />

            {/* PRO selector */}
            <Text style={styles.fieldLabel}>PRO</Text>
            <View style={styles.proSelector}>
              {PRO_OPTIONS.map((pro) => (
                <TouchableOpacity
                  key={pro}
                  style={[styles.proChip, form.pro === pro && styles.proChipActive]}
                  onPress={() => setForm({ ...form, pro: form.pro === pro ? '' : pro })}
                >
                  <Text style={[styles.proChipText, form.pro === pro && styles.proChipTextActive]}>
                    {pro}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Publisher */}
            <Text style={styles.fieldLabel}>Publisher</Text>
            <View style={styles.publisherPicker}>
              {publishers.map((pub) => (
                <TouchableOpacity
                  key={pub.id}
                  style={[styles.publisherChip, form.publisher_id === pub.id && styles.publisherChipActive]}
                  onPress={() => setForm({ ...form, publisher_id: form.publisher_id === pub.id ? '' : pub.id, publisher_name: '' })}
                >
                  <Text style={[styles.publisherChipText, form.publisher_id === pub.id && styles.publisherChipTextActive]}>
                    {pub.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {!form.publisher_id && (
              <Input label="Publisher Name (if not listed)" value={form.publisher_name}
                onChangeText={(v) => setForm({ ...form, publisher_name: v })}
                placeholder="Type publisher name" autoCapitalize="words" />
            )}

            <Input label="Email" value={form.email}
              onChangeText={(v) => setForm({ ...form, email: v })}
              placeholder="writer@example.com" keyboardType="email-address" />
            <Input label="Phone" value={form.phone}
              onChangeText={(v) => setForm({ ...form, phone: v })}
              placeholder="+1 (555) 000-0000" keyboardType="phone-pad" />
            <Input label="Notes" value={form.notes}
              onChangeText={(v) => setForm({ ...form, notes: v })}
              placeholder="Any additional notes..." multiline numberOfLines={3} />

            <Button title="Add to Registry" onPress={handleSave} loading={saving} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.lg },
  title: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  addButton: { width: 38, height: 38, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  searchWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, paddingHorizontal: Spacing.md, height: 44 },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: Fonts.sizes.md },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: `${Colors.success}15`, borderWidth: 1, borderColor: `${Colors.success}40`, borderRadius: Radius.md, padding: Spacing.sm, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  successText: { color: Colors.success, fontSize: Fonts.sizes.sm, fontWeight: '600' },
  list: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  writerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md },
  writerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${Colors.primary}20`, borderWidth: 1, borderColor: `${Colors.primary}40`, alignItems: 'center', justifyContent: 'center' },
  writerInitial: { fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary },
  writerInfo: { flex: 1 },
  writerName: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  writerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  metaBadge: { backgroundColor: `${Colors.primary}20`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm },
  metaBadgeText: { fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.primary },
  metaText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textSecondary },
  emptySubtext: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, textAlign: 'center', maxWidth: 260 },
  emptyAddButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full, marginTop: Spacing.sm },
  emptyAddText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.md },
  modal: { flex: 1, backgroundColor: Colors.background },
  modalScroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
  modalTitle: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary },
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
})
