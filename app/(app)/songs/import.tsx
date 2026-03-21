import React, { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, TextInput,
} from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import Papa from 'papaparse'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedCowriter {
  name: string
  split: string  // kept as string during editing
}

interface ParsedRow {
  index: number
  title: string
  dateWritten: string
  cowriters: ParsedCowriter[]
  artistSplit: string
  errors: string[]
  warnings: string[]
  importStatus: 'pending' | 'importing' | 'done' | 'failed'
  importError?: string
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const findCol = (headers: string[], patterns: string[]): string | null => {
  const lower = headers.map((h) => h.trim().toLowerCase())
  for (const p of patterns) {
    const idx = lower.findIndex((h) => h.includes(p))
    if (idx !== -1) return headers[idx]
  }
  return null
}

const validateRow = (row: ParsedRow): ParsedRow => {
  const errors: string[] = []
  const warnings: string[] = []
  if (!row.title.trim()) errors.push('Title is required')
  const artistPct = parseFloat(row.artistSplit)
  if (isNaN(artistPct) || artistPct < 0 || artistPct > 100) {
    errors.push('Artist share must be a number between 0 and 100')
  }
  for (const cw of row.cowriters) {
    if (!cw.name.trim()) errors.push('Co-writer name cannot be blank')
    const s = parseFloat(cw.split)
    if (isNaN(s) || s < 0 || s > 100) errors.push(`Split for "${cw.name || 'co-writer'}" must be 0–100`)
  }
  if (!errors.length) {
    const total = (parseFloat(row.artistSplit) || 0) +
      row.cowriters.reduce((s, c) => s + (parseFloat(c.split) || 0), 0)
    if (Math.abs(total - 100) > 0.5) {
      warnings.push(`Splits total ${total.toFixed(2)}% — should equal 100%`)
    }
  }
  return { ...row, errors, warnings }
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ImportScreen() {
  const { profile, activeArtist } = useAuthStore()
  const [step, setStep] = useState<Step>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<ParsedRow | null>(null)
  const [doneCount, setDoneCount] = useState(0)
  const [parseError, setParseError] = useState('')

  const artistName = activeArtist?.real_name ?? activeArtist?.stage_name ?? ''

  // ── Template download ────────────────────────────────────────────────────
  const downloadTemplate = () => {
    const csv = [
      'date,title,composers,artist_share',
      '2025-01-15,Song Title Here,Artist Name/Co-Writer One/Co-Writer Two,33.33',
      '2025-02-20,Another Song,Artist Name/Writer B,50',
      ',Song With No Date,Artist Name/Writer C,33.33',
    ].join('\n')
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'songvault_import_template.csv'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  // ── File pick + parse ────────────────────────────────────────────────────
  const handlePickFile = async () => {
    setParseError('')
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const response = await fetch(result.assets[0].uri)
      const text = await response.text()
      parseCSV(text)
    } catch (err: any) {
      setParseError(err.message ?? 'Could not read file')
    }
  }

  const parseCSV = (text: string) => {
    const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    })
    if (parseErrors.length && !data.length) {
      setParseError('Could not parse CSV: ' + parseErrors[0].message)
      return
    }
    if (!data.length) { setParseError('The file appears to be empty.'); return }

    const headers = Object.keys(data[0])
    const dateCol     = findCol(headers, ['date of creation', 'date_written', 'date written', 'date'])
    const titleCol    = findCol(headers, ['title'])
    const composerCol = findCol(headers, ['composer', 'writer', 'co-writer', 'cowriter'])
    const shareCol    = findCol(headers, ['share', 'split', 'percentage', 'pct'])

    if (!titleCol) {
      setParseError('No "title" column found.')
      return
    }

    const parsed: ParsedRow[] = data.map((raw, i) => {
      const title = (titleCol ? raw[titleCol] ?? '' : '').trim()

      let dateWritten = ''
      if (dateCol) {
        const rawDate = (raw[dateCol] ?? '').trim()
        if (rawDate) {
          const d = new Date(rawDate)
          if (!isNaN(d.getTime())) dateWritten = d.toISOString().split('T')[0]
        }
      }

      const artistSplitRaw = shareCol ? (raw[shareCol] ?? '').replace('%', '').trim() : ''
      const artistSplitNum = parseFloat(artistSplitRaw)

      const composersRaw = composerCol ? (raw[composerCol] ?? '').trim() : ''
      let cowriters: ParsedCowriter[] = []
      if (composersRaw) {
        const names = composersRaw
          .split('/')
          .map((n) => n.trim())
          .filter(Boolean)
          .filter((n) => !artistName || n.toLowerCase() !== artistName.toLowerCase())
        if (names.length > 0) {
          const remaining = Math.max(0, 100 - (isNaN(artistSplitNum) ? 0 : artistSplitNum))
          const each = Math.round((remaining / names.length) * 100) / 100
          cowriters = names.map((name) => ({ name, split: String(each) }))
        }
      }

      const draft: ParsedRow = {
        index: i,
        title,
        dateWritten,
        cowriters,
        artistSplit: isNaN(artistSplitNum) ? '' : String(artistSplitNum),
        errors: [],
        warnings: [],
        importStatus: 'pending',
      }
      return validateRow(draft)
    })

    setRows(parsed)
    setEditingIndex(null)
    setEditDraft(null)
    setStep('preview')
  }

  // ── Row mutations ────────────────────────────────────────────────────────
  const removeRow = (rowIndex: number) => {
    setRows((prev) => prev.filter((r) => r.index !== rowIndex))
    if (editingIndex === rowIndex) { setEditingIndex(null); setEditDraft(null) }
  }

  const startEdit = (row: ParsedRow) => {
    setEditDraft({ ...row, cowriters: row.cowriters.map((c) => ({ ...c })) })
    setEditingIndex(row.index)
  }

  const cancelEdit = () => { setEditingIndex(null); setEditDraft(null) }

  const saveEdit = () => {
    if (!editDraft) return
    const validated = validateRow(editDraft)
    setRows((prev) => prev.map((r) => r.index === editDraft.index ? validated : r))
    setEditingIndex(null)
    setEditDraft(null)
  }

  const updateDraftField = (field: keyof ParsedRow, value: any) => {
    setEditDraft((prev) => prev ? { ...prev, [field]: value } : prev)
  }

  const updateDraftCowriter = (i: number, field: keyof ParsedCowriter, value: string) => {
    setEditDraft((prev) => {
      if (!prev) return prev
      const cws = [...prev.cowriters]
      cws[i] = { ...cws[i], [field]: value }
      return { ...prev, cowriters: cws }
    })
  }

  const addDraftCowriter = () => {
    setEditDraft((prev) => prev ? {
      ...prev,
      cowriters: [...prev.cowriters, { name: '', split: '0' }],
    } : prev)
  }

  const removeDraftCowriter = (i: number) => {
    setEditDraft((prev) => {
      if (!prev) return prev
      const cws = [...prev.cowriters]
      cws.splice(i, 1)
      return { ...prev, cowriters: cws }
    })
  }

  // ── Import ───────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!activeArtist) return
    setStep('importing')

    const { data: dealData } = await supabase
      .from('publishing_deals')
      .select('id')
      .eq('artist_id', activeArtist.id)
      .eq('is_active', true)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    const dealId = dealData?.id ?? null

    // Resolve the artist's songwriter registry entry once, reuse for every song
    const artistDisplayName = activeArtist.real_name ?? activeArtist.stage_name
    let artistSwId: string | null = null
    if (activeArtist.user_id) {
      const { data } = await supabase
        .from('songwriters').select('id').eq('user_id', activeArtist.user_id).maybeSingle()
      artistSwId = data?.id ?? null
    }
    if (!artistSwId) {
      const { data } = await supabase
        .from('songwriters').select('id').ilike('name', artistDisplayName).maybeSingle()
      artistSwId = data?.id ?? null
    }
    if (!artistSwId) {
      const { data } = await supabase
        .from('songwriters').insert({ name: artistDisplayName }).select('id').single()
      artistSwId = data?.id ?? null
    }

    let done = 0
    const updated = [...rows]

    for (let i = 0; i < updated.length; i++) {
      const row = updated[i]
      if (row.errors.length > 0) continue

      updated[i] = { ...row, importStatus: 'importing' }
      setRows([...updated])

      try {
        const { data: songData, error: songErr } = await supabase
          .from('songs')
          .insert({
            title: row.title,
            artist_id: activeArtist.id,
            date_written: row.dateWritten || new Date().toISOString().split('T')[0],
            status: 'logged',
            publishing_deal_id: dealId,
          })
          .select('id')
          .single()
        if (songErr) throw songErr

        // Insert artist as first co-writer with their share
        await supabase.from('cowriters').insert({
          song_id: songData.id,
          name: artistDisplayName,
          split_percentage: parseFloat(row.artistSplit) || 0,
          songwriter_id: artistSwId,
        })

        // Insert remaining co-writers
        for (const cw of row.cowriters) {
          const { data: existing } = await supabase
            .from('songwriters').select('id').ilike('name', cw.name).maybeSingle()
          let swId = existing?.id ?? null
          if (!swId) {
            const { data: newSw } = await supabase
              .from('songwriters').insert({ name: cw.name }).select('id').single()
            swId = newSw?.id ?? null
          }
          await supabase.from('cowriters').insert({
            song_id: songData.id,
            name: cw.name,
            split_percentage: parseFloat(cw.split),
            songwriter_id: swId,
          })
        }

        updated[i] = { ...updated[i], importStatus: 'done' }
        done++
      } catch (err: any) {
        updated[i] = { ...updated[i], importStatus: 'failed', importError: err.message ?? String(err) }
      }
      setRows([...updated])
      setDoneCount(done)
    }
    setDoneCount(done)
    setStep('done')
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const validRows = rows.filter((r) => r.errors.length === 0)

  // ── Upload step ──────────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Import Songs</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={styles.uploadContent}>
          {!activeArtist ? (
            <View style={styles.centered}>
              <Ionicons name="person-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.centeredText}>Select an artist from the Home tab first.</Text>
            </View>
          ) : (
            <>
              <View style={styles.artistBanner}>
                <Ionicons name="person-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.artistBannerText}>
                  Importing for{' '}
                  <Text style={{ fontWeight: '800' }}>{activeArtist.stage_name}</Text>
                </Text>
              </View>

              <View style={styles.formatCard}>
                <Text style={styles.formatTitle}>Expected CSV Columns</Text>
                <Text style={styles.formatDesc}>
                  {'• '}
                  <Text style={styles.code}>title</Text>
                  {' (required)\n• '}
                  <Text style={styles.code}>date</Text>
                  {' or '}
                  <Text style={styles.code}>date of creation</Text>
                  {'\n• '}
                  <Text style={styles.code}>composer</Text>
                  {' — slash-separated names (e.g. Artist/Writer A/Writer B)\n• '}
                  <Text style={styles.code}>share</Text>
                  {' or '}
                  <Text style={styles.code}>artist_share</Text>
                  {' — artist\'s % as a number\n\nPublisher exports map automatically. The artist\'s own name is removed from the co-writers list.'}
                </Text>
                <TouchableOpacity style={styles.templateBtn} onPress={downloadTemplate}>
                  <Ionicons name="download-outline" size={16} color={Colors.primary} />
                  <Text style={styles.templateBtnText}>Download Template CSV</Text>
                </TouchableOpacity>
              </View>

              {!!parseError && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
                  <Text style={styles.errorBannerText}>{parseError}</Text>
                </View>
              )}

              <TouchableOpacity style={styles.pickBtn} onPress={handlePickFile}>
                <Ionicons name="cloud-upload-outline" size={32} color={Colors.primary} />
                <Text style={styles.pickBtnTitle}>Choose CSV File</Text>
                <Text style={styles.pickBtnSub}>Tap to browse your files</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Preview step ─────────────────────────────────────────────────────────
  if (step === 'preview') {
    const invalidCount = rows.filter((r) => r.errors.length > 0).length
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setStep('upload'); setRows([]) }}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Review & Edit</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{rows.length}</Text>
            <Text style={styles.summaryLabel}>Total</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNum, { color: Colors.success }]}>{validRows.length}</Text>
            <Text style={styles.summaryLabel}>Ready</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNum, { color: invalidCount > 0 ? Colors.error : Colors.textMuted }]}>
              {invalidCount}
            </Text>
            <Text style={styles.summaryLabel}>Need Fixes</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.rowList}
          keyboardShouldPersistTaps="handled"
        >
          {rows.map((row) => {
            const isEditing = editingIndex === row.index
            const draft = isEditing ? editDraft : null
            const hasError = row.errors.length > 0
            const hasWarn = !hasError && row.warnings.length > 0

            return (
              <View
                key={row.index}
                style={[
                  styles.row,
                  hasError && styles.rowError,
                  hasWarn && styles.rowWarn,
                  isEditing && styles.rowEditing,
                ]}
              >
                {/* ── View mode ───────────────────────────── */}
                {!isEditing && (
                  <>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {row.title || <Text style={{ color: Colors.error }}>(no title)</Text>}
                      </Text>
                      <View style={styles.rowActions}>
                        <TouchableOpacity
                          style={styles.rowActionBtn}
                          onPress={() => startEdit(row)}
                        >
                          <Ionicons name="pencil-outline" size={15} color={Colors.primary} />
                          <Text style={styles.rowActionText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.rowActionBtn, styles.rowActionRemove]}
                          onPress={() => removeRow(row.index)}
                        >
                          <Ionicons name="trash-outline" size={15} color={Colors.error} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.chips}>
                      {!!row.dateWritten && (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>{row.dateWritten}</Text>
                        </View>
                      )}
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>Artist: {row.artistSplit || '?'}%</Text>
                      </View>
                      {row.cowriters.map((cw, i) => (
                        <View key={i} style={styles.chip}>
                          <Text style={styles.chipText}>{cw.name}: {cw.split}%</Text>
                        </View>
                      ))}
                    </View>

                    {row.errors.map((e, i) => (
                      <Text key={i} style={styles.rowErrorText}>✗ {e}</Text>
                    ))}
                    {row.warnings.map((w, i) => (
                      <Text key={i} style={styles.rowWarnText}>⚠ {w}</Text>
                    ))}
                  </>
                )}

                {/* ── Edit mode ───────────────────────────── */}
                {isEditing && draft && (
                  <>
                    <Text style={styles.editSectionLabel}>TITLE</Text>
                    <TextInput
                      style={styles.editInput}
                      value={draft.title}
                      onChangeText={(v) => updateDraftField('title', v)}
                      placeholder="Song title"
                      placeholderTextColor={Colors.textMuted}
                    />

                    <View style={styles.editRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.editSectionLabel}>DATE WRITTEN</Text>
                        <TextInput
                          style={styles.editInput}
                          value={draft.dateWritten}
                          onChangeText={(v) => updateDraftField('dateWritten', v)}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.editSectionLabel}>ARTIST SHARE %</Text>
                        <TextInput
                          style={styles.editInput}
                          value={draft.artistSplit}
                          onChangeText={(v) => updateDraftField('artistSplit', v)}
                          placeholder="e.g. 33.33"
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>

                    <Text style={styles.editSectionLabel}>CO-WRITERS</Text>
                    {draft.cowriters.map((cw, i) => (
                      <View key={i} style={styles.cwEditRow}>
                        <TextInput
                          style={[styles.editInput, { flex: 3 }]}
                          value={cw.name}
                          onChangeText={(v) => updateDraftCowriter(i, 'name', v)}
                          placeholder="Writer name"
                          placeholderTextColor={Colors.textMuted}
                        />
                        <TextInput
                          style={[styles.editInput, { width: 70 }]}
                          value={cw.split}
                          onChangeText={(v) => updateDraftCowriter(i, 'split', v)}
                          placeholder="%"
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="decimal-pad"
                        />
                        <TouchableOpacity
                          onPress={() => removeDraftCowriter(i)}
                          style={styles.cwRemoveBtn}
                        >
                          <Ionicons name="close-circle" size={20} color={Colors.error} />
                        </TouchableOpacity>
                      </View>
                    ))}

                    <TouchableOpacity style={styles.addCwBtn} onPress={addDraftCowriter}>
                      <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
                      <Text style={styles.addCwText}>Add Co-Writer</Text>
                    </TouchableOpacity>

                    <View style={styles.editFooter}>
                      <TouchableOpacity style={styles.cancelBtn} onPress={cancelEdit}>
                        <Text style={styles.cancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.saveBtn} onPress={saveEdit}>
                        <Text style={styles.saveBtnText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )
          })}

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.importFooter}>
          {validRows.length === 0 ? (
            <Text style={styles.noValidText}>Fix all errors before importing.</Text>
          ) : (
            <TouchableOpacity style={styles.importBtn} onPress={handleImport}>
              <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
              <Text style={styles.importBtnText}>
                Import {validRows.length} Song{validRows.length !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    )
  }

  // ── Importing step ───────────────────────────────────────────────────────
  if (step === 'importing') {
    const completed = rows.filter(
      (r) => r.importStatus === 'done' || r.importStatus === 'failed'
    ).length
    const total = validRows.length
    const pct = total > 0 ? completed / total : 0
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.progressTitle}>Importing…</Text>
          <Text style={styles.progressSub}>{completed} of {total} songs</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct * 100}%` as any }]} />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // ── Done step ────────────────────────────────────────────────────────────
  const failed = rows.filter((r) => r.importStatus === 'failed')
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.doneContent}>
        <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
        <Text style={styles.doneTitle}>Import Complete</Text>
        <Text style={styles.doneSub}>
          {doneCount} song{doneCount !== 1 ? 's' : ''} imported successfully
          {failed.length > 0 ? `, ${failed.length} failed` : ''}
        </Text>
        {failed.length > 0 && (
          <View style={styles.failedList}>
            {failed.map((r) => (
              <View key={r.index} style={styles.failedRow}>
                <Text style={styles.failedTitle}>{r.title}</Text>
                <Text style={styles.failedError}>{r.importError}</Text>
              </View>
            ))}
          </View>
        )}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.replace('/(app)/songs')}
        >
          <Text style={styles.doneBtnText}>Go to Songs</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textPrimary },

  // Shared
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xxl },
  centeredText: { color: Colors.textMuted, textAlign: 'center', fontSize: Fonts.sizes.md },

  // Upload
  uploadContent: { padding: Spacing.lg, gap: Spacing.lg },
  artistBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.primary}15`, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.primary}30`,
  },
  artistBannerText: { color: Colors.textPrimary, fontSize: Fonts.sizes.sm },
  formatCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md,
  },
  formatTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  formatDesc: { fontSize: Fonts.sizes.sm, color: Colors.textSecondary, lineHeight: 22 },
  code: { color: Colors.primary } as any,
  templateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary,
  },
  templateBtnText: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.error}15`, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.error}40`,
  },
  errorBannerText: { flex: 1, color: Colors.error, fontSize: Fonts.sizes.sm },
  pickBtn: {
    alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.xxl, borderWidth: 2, borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  pickBtnTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.primary },
  pickBtnSub: { fontSize: Fonts.sizes.sm, color: Colors.textMuted },

  // Preview
  summary: {
    flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  summaryItem: { alignItems: 'center' },
  summaryNum: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  summaryLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '500' },
  rowList: { padding: Spacing.md, gap: Spacing.sm },
  row: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  rowError: { borderColor: `${Colors.error}60`, backgroundColor: `${Colors.error}06` },
  rowWarn: { borderColor: `${Colors.warning}50`, backgroundColor: `${Colors.warning}06` },
  rowEditing: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}06` },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rowTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary, flex: 1, marginRight: 8 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  rowActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowActionRemove: { borderColor: `${Colors.error}50`, paddingHorizontal: 6 },
  rowActionText: { fontSize: Fonts.sizes.xs, color: Colors.primary, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 },
  chip: {
    backgroundColor: Colors.surfaceElevated, paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
  },
  chipText: { fontSize: Fonts.sizes.xs, color: Colors.textSecondary },
  rowErrorText: { fontSize: Fonts.sizes.xs, color: Colors.error, marginTop: 2 },
  rowWarnText: { fontSize: Fonts.sizes.xs, color: Colors.warning, marginTop: 2 },

  // Edit mode
  editSectionLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.5, marginBottom: 4, marginTop: Spacing.sm,
  },
  editInput: {
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 8,
    color: Colors.textPrimary, fontSize: Fonts.sizes.sm, marginBottom: 4,
  },
  editRow: { flexDirection: 'row', gap: Spacing.sm },
  cwEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: 4 },
  cwRemoveBtn: { padding: 4 },
  addCwBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: Spacing.xs, marginBottom: Spacing.sm,
  },
  addCwText: { fontSize: Fonts.sizes.xs, color: Colors.primary, fontWeight: '600' },
  editFooter: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  cancelBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  cancelBtnText: { color: Colors.textMuted, fontWeight: '600', fontSize: Fonts.sizes.sm },
  saveBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.sm },

  // Import footer
  importFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: Spacing.lg, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  noValidText: { color: Colors.textMuted, textAlign: 'center', fontSize: Fonts.sizes.sm },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.primary,
    paddingVertical: Spacing.md, borderRadius: Radius.full,
  },
  importBtnText: { color: '#fff', fontSize: Fonts.sizes.md, fontWeight: '700' },

  // Importing
  progressTitle: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary },
  progressSub: { fontSize: Fonts.sizes.md, color: Colors.textMuted },
  progressTrack: {
    width: '80%', height: 6, borderRadius: 3,
    backgroundColor: Colors.border, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },

  // Done
  doneContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xxl },
  doneTitle: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  doneSub: { fontSize: Fonts.sizes.md, color: Colors.textMuted, textAlign: 'center' },
  failedList: {
    width: '100%', backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.error}40`, gap: Spacing.sm,
  },
  failedRow: { gap: 2 },
  failedTitle: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary },
  failedError: { fontSize: Fonts.sizes.xs, color: Colors.error },
  doneBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md, borderRadius: Radius.full, marginTop: Spacing.sm,
  },
  doneBtnText: { color: '#fff', fontSize: Fonts.sizes.md, fontWeight: '700' },
})
