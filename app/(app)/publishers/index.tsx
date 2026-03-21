import React, { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, Alert, TextInput, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Publisher } from '../../../src/types/database'
import { Input } from '../../../src/components/Input'
import { Button } from '../../../src/components/Button'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

export default function PublishersScreen() {
  const { profile } = useAuthStore()
  const [publishers, setPublishers] = useState<Publisher[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', disco_label_id: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const isManager = profile?.role === 'manager'

  const fetchPublishers = async () => {
    const { data } = await supabase.from('publishers').select('*').order('name')
    setPublishers((data ?? []) as Publisher[])
    setLoading(false)
  }

  useEffect(() => { fetchPublishers() }, [])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Publisher name is required'
    if (!form.email.trim()) e.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    const { error } = await supabase.from('publishers').insert({
      name: form.name.trim(),
      email: form.email.trim(),
      disco_label_id: form.disco_label_id.trim() || null,
    })
    setSaving(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      setModalVisible(false)
      setForm({ name: '', email: '', disco_label_id: '' })
      fetchPublishers()
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
        <Text style={styles.title}>Publishers</Text>
        {isManager && (
          <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={publishers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No publishers added yet</Text>
            {isManager && (
              <Text style={styles.emptySubtext}>Add your publishing companies above</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.publisherCard}>
            <View style={styles.publisherIcon}>
              <Ionicons name="business" size={20} color={Colors.primary} />
            </View>
            <View style={styles.publisherInfo}>
              <Text style={styles.publisherName}>{item.name}</Text>
              <Text style={styles.publisherEmail}>{item.email}</Text>
              {item.disco_label_id && (
                <Text style={styles.discoId}>Disco ID: {item.disco_label_id}</Text>
              )}
            </View>
          </View>
        )}
      />

      {/* Add Publisher Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Publisher</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Input
            label="Publisher Name"
            value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
            placeholder="e.g. Warner Chappell"
            autoCapitalize="words"
            error={errors.name}
          />
          <Input
            label="Submission Email"
            value={form.email}
            onChangeText={(v) => setForm({ ...form, email: v })}
            placeholder="submissions@publisher.com"
            keyboardType="email-address"
            error={errors.email}
          />
          <Input
            label="Disco Label ID (optional)"
            value={form.disco_label_id}
            onChangeText={(v) => setForm({ ...form, disco_label_id: v })}
            placeholder="From your Disco account"
            hint="Used for automatic Disco submissions"
          />

          <Button title="Save Publisher" onPress={handleSave} loading={saving} />
        </View>
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
    padding: Spacing.lg,
  },
  title: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  addButton: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  list: { padding: Spacing.lg, paddingTop: 0, gap: Spacing.sm },
  publisherCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  publisherIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center', justifyContent: 'center',
  },
  publisherInfo: { flex: 1 },
  publisherName: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  publisherEmail: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, marginTop: 2 },
  discoId: { fontSize: Fonts.sizes.xs, color: Colors.primary, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl, gap: Spacing.sm },
  emptyText: { fontSize: Fonts.sizes.md, color: Colors.textSecondary, fontWeight: '600' },
  emptySubtext: { fontSize: Fonts.sizes.sm, color: Colors.textMuted },
  modal: { flex: 1, backgroundColor: Colors.background, padding: Spacing.lg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: Spacing.xl,
  },
  modalTitle: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary },
})
