import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, TextInput, ActivityIndicator,
} from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { Input } from '../../../src/components/Input'
import { Button } from '../../../src/components/Button'
import { DatePickerModal } from '../../../src/components/DatePickerModal'
import { Colors, Spacing, Fonts, Radius, PRO_OPTIONS } from '../../../src/utils/constants'

interface Songwriter {
  id: string; name: string; ipi_number: string | null
  pro: string | null; publisher_name: string | null
  publisher?: { id: string; name: string } | null
  publisher_id: string | null
}

interface CowriterForm {
  id: string
  // Registry link
  songwriter_id: string | null
  linked: boolean
  isArtist?: boolean   // locked primary artist slot
  calendarNeedsReview?: boolean  // flagged from calendar pre-fill, needs user confirmation
  // Fields (auto-filled from registry or manual)
  name: string
  publisher_name: string
  publisher_id: string
  split_percentage: string
  pro: string
  ipi_number: string
  // Search state
  searchQuery: string
  searchResults: Songwriter[]
  searching: boolean
  showResults: boolean
}

const emptyCowriter = (): CowriterForm => ({
  id: Math.random().toString(),
  songwriter_id: null, linked: false,
  name: '', publisher_name: '', publisher_id: '',
  split_percentage: '', pro: '', ipi_number: '',
  searchQuery: '', searchResults: [], searching: false, showResults: false,
})

export default function NewSongScreen() {
  const { profile, activeArtist } = useAuthStore()
  const params = useLocalSearchParams<{
    from_write_session?: string
    prefill_date?: string
    prefill_cowriters?: string
    prefill_location?: string
  }>()
  const isManager = profile?.role === 'manager'
  const [title, setTitle] = useState('')
  const [dateWritten, setDateWritten] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [cowriters, setCowriters] = useState<CowriterForm[]>([emptyCowriter()])
  const [artistId, setArtistId] = useState<string | null>(null)
  const [dealId, setDealId] = useState<string | null>(null)
  const [writeSessionId, setWriteSessionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [datePickerVisible, setDatePickerVisible] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Ecosystem: writers this artist has worked with before
  const [ecosystemWriters, setEcosystemWriters] = useState<Songwriter[]>([])
  // Calendar pre-fill banner
  const [fromCalendar, setFromCalendar] = useState(false)

  // Reset form and reload artist/deal data every time screen comes into focus
  useFocusEffect(
    useCallback(() => {
      // Check for calendar pre-fill params
      const hasCalendarPrefill = !!params.from_write_session
      setFromCalendar(hasCalendarPrefill)
      setWriteSessionId(params.from_write_session ?? null)
      setTitle('')
      setDateWritten(params.prefill_date ?? new Date().toISOString().split('T')[0])
      setNotes(params.prefill_location ? `📍 ${params.prefill_location}` : '')
      setCowriters([emptyCowriter()])
      setErrors({})
      setDealId(null)
      setArtistId(null)
      fetchSetupData(hasCalendarPrefill ? params.prefill_cowriters : undefined)
    }, [profile?.id, activeArtist?.id, params.from_write_session])
  )

  const fetchSetupData = async (prefillCowritersJson?: string) => {
    let resolvedArtistId: string | null = null
    let artistRecord: any = null

    if (isManager && activeArtist) {
      resolvedArtistId = activeArtist.id
      // Fetch full artist record (activeArtist may be partial)
      const { data } = await supabase.from('artists').select('*').eq('id', activeArtist.id).single()
      artistRecord = data ?? activeArtist
    } else {
      const { data } = await supabase.from('artists').select('*').eq('user_id', profile!.id).single()
      resolvedArtistId = data?.id ?? null
      artistRecord = data
    }

    if (!resolvedArtistId || !artistRecord) return
    setArtistId(resolvedArtistId)

    // Active deal + publisher name
    const { data: dealData } = await supabase
      .from('publishing_deals')
      .select('id, publisher:publishers(id, name)')
      .eq('artist_id', resolvedArtistId)
      .eq('is_active', true)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (dealData) setDealId(dealData.id)
    const publisherName = (dealData?.publisher as any)?.name ?? ''
    const publisherId   = (dealData?.publisher as any)?.id   ?? ''

    // Find artist's songwriter registry entry (by user_id, then by name)
    let artistSW: Songwriter | null = null
    if (artistRecord.user_id) {
      const { data } = await supabase
        .from('songwriters')
        .select('id, name, ipi_number, pro, publisher_name, publisher_id, publisher:publishers(id, name)')
        .eq('user_id', artistRecord.user_id)
        .maybeSingle()
      artistSW = data as Songwriter | null
    }
    if (!artistSW) {
      const searchName = artistRecord.real_name ?? artistRecord.stage_name
      const { data } = await supabase
        .from('songwriters')
        .select('id, name, ipi_number, pro, publisher_name, publisher_id, publisher:publishers(id, name)')
        .ilike('name', searchName)
        .maybeSingle()
      artistSW = data as Songwriter | null
    }

    // Pre-populate Writer 1 as the primary artist
    const artistCowriter: CowriterForm = {
      id: 'artist-primary',
      songwriter_id: artistSW?.id ?? null,
      linked: !!artistSW,
      isArtist: true,
      name: artistRecord.real_name ?? artistRecord.stage_name,
      publisher_name: publisherName || (artistSW?.publisher as any)?.name || artistSW?.publisher_name || '',
      publisher_id:   publisherId   || (artistSW?.publisher as any)?.id   || artistSW?.publisher_id   || '',
      split_percentage: '100',
      pro:         artistSW?.pro          ?? '',
      ipi_number:  artistSW?.ipi_number   ?? '',
      searchQuery: artistRecord.real_name ?? artistRecord.stage_name,
      searchResults: [], searching: false, showResults: false,
    }
    // If pre-filling from calendar, add co-writers from the write session
    if (prefillCowritersJson) {
      try {
        const names: string[] = JSON.parse(prefillCowritersJson)
        if (names.length > 0) {
          // Smart match each name against the songwriter registry
          const calendarCowriters: CowriterForm[] = await Promise.all(
            names.map(async (name) => {
              const nameParts = name.trim().split(/\s+/)
              const firstName = nameParts[0] ?? ''
              const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''

              // Search by full name first
              const { data: fullMatches } = await supabase
                .from('songwriters')
                .select('id, name, ipi_number, pro, publisher_name, publisher_id, publisher:publishers(id, name)')
                .ilike('name', `%${name}%`)
                .limit(5)

              // If no full match and we have a last name, search by last name
              let lastNameMatches: Songwriter[] = []
              if ((!fullMatches || fullMatches.length === 0) && lastName) {
                const { data } = await supabase
                  .from('songwriters')
                  .select('id, name, ipi_number, pro, publisher_name, publisher_id, publisher:publishers(id, name)')
                  .ilike('name', `%${lastName}%`)
                  .limit(5)
                lastNameMatches = (data ?? []) as Songwriter[]
              }

              const allMatches = [...(fullMatches ?? []), ...lastNameMatches] as Songwriter[]
              // Deduplicate
              const uniqueMatches = allMatches.filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)

              // Exact full name match = high confidence, auto-link
              const exactMatch = uniqueMatches.find(m =>
                m.name.toLowerCase() === name.toLowerCase()
              )

              if (exactMatch) {
                return {
                  ...emptyCowriter(),
                  songwriter_id: exactMatch.id,
                  linked: true,
                  name: exactMatch.name,
                  ipi_number: exactMatch.ipi_number ?? '',
                  pro: exactMatch.pro ?? '',
                  publisher_id: (exactMatch.publisher as any)?.id ?? exactMatch.publisher_id ?? '',
                  publisher_name: (exactMatch.publisher as any)?.name ?? exactMatch.publisher_name ?? '',
                  searchQuery: exactMatch.name,
                }
              }

              // Partial matches found — show dropdown so user can pick
              if (uniqueMatches.length > 0) {
                return {
                  ...emptyCowriter(),
                  name,
                  searchQuery: name,
                  searchResults: uniqueMatches,
                  showResults: true, // auto-open dropdown
                  calendarNeedsReview: true,
                } as CowriterForm & { calendarNeedsReview?: boolean }
              }

              // No matches at all — new writer, user should confirm
              return {
                ...emptyCowriter(),
                name,
                searchQuery: name,
                showResults: false,
                calendarNeedsReview: true,
              } as CowriterForm & { calendarNeedsReview?: boolean }
            })
          )
          // Auto-split evenly
          const total = calendarCowriters.length + 1 // +1 for artist
          const split = Math.floor((100 / total) * 100) / 100
          const remainder = parseFloat((100 - split * total).toFixed(2))
          artistCowriter.split_percentage = (split + remainder).toFixed(2)
          calendarCowriters.forEach((cw) => { cw.split_percentage = split.toFixed(2) })
          setCowriters([artistCowriter, ...calendarCowriters])
        } else {
          setCowriters([artistCowriter])
        }
      } catch {
        setCowriters([artistCowriter])
      }
    } else {
      setCowriters([artistCowriter])
    }

    // Ecosystem writers (all registry writers for now)
    const { data: allWriters } = await supabase
      .from('songwriters')
      .select('id, name, ipi_number, pro, publisher_name, publisher_id, publisher:publishers(id, name)')
      .order('name')
      .limit(50)
    setEcosystemWriters((allWriters ?? []) as Songwriter[])
  }

  // Two-tier search: ecosystem first, then global registry
  const searchWriters = async (cw: CowriterForm, query: string) => {
    updateCowriter(cw.id, { searchQuery: query, showResults: true })
    if (!query.trim()) {
      updateCowriter(cw.id, { searchResults: ecosystemWriters.slice(0, 6), searching: false })
      return
    }
    updateCowriter(cw.id, { searching: true })
    const { data } = await supabase
      .from('songwriters')
      .select('id, name, ipi_number, pro, publisher_name, publisher_id, publisher:publishers(id, name)')
      .ilike('name', `%${query}%`)
      .limit(8)
    updateCowriter(cw.id, { searchResults: (data ?? []) as Songwriter[], searching: false })
  }

  const selectWriter = (cw: CowriterForm, writer: Songwriter) => {
    updateCowriter(cw.id, {
      songwriter_id: writer.id,
      linked: true,
      calendarNeedsReview: false,
      name: writer.name,
      ipi_number: writer.ipi_number ?? '',
      pro: writer.pro ?? '',
      publisher_id: writer.publisher?.id ?? writer.publisher_id ?? '',
      publisher_name: writer.publisher?.name ?? writer.publisher_name ?? '',
      searchQuery: writer.name,
      showResults: false,
      searchResults: [],
    })
  }

  const unlinkWriter = (cw: CowriterForm) => {
    updateCowriter(cw.id, {
      songwriter_id: null, linked: false,
      name: cw.searchQuery, searchQuery: cw.searchQuery,
      ipi_number: '', pro: '', publisher_id: '', publisher_name: '',
      showResults: false,
    })
  }

  const updateCowriter = (id: string, fields: Partial<CowriterForm>) => {
    setCowriters(prev => prev.map(c => c.id === id ? { ...c, ...fields } : c))
  }

  const addCowriter = () => setCowriters(prev => [...prev, emptyCowriter()])
  const removeCowriter = (id: string) => {
    if (id === 'artist-primary') return  // primary artist can't be removed
    setCowriters(prev => prev.filter(c => c.id !== id))
  }

  const totalSplits = cowriters.reduce((sum, c) => sum + (parseFloat(c.split_percentage) || 0), 0)
  const splitsValid = Math.abs(totalSplits - 100) < 0.01

  const validate = () => {
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = 'Song title is required'
    if (!dateWritten) e.dateWritten = 'Date written is required'
    cowriters.forEach((c, i) => {
      if (!c.name.trim()) e[`cw_${i}_name`] = 'Name is required'
      const s = parseFloat(c.split_percentage)
      if (!c.split_percentage || isNaN(s) || s <= 0 || s > 100) e[`cw_${i}_split`] = 'Valid split % required'
    })
    if (!splitsValid) e.splits = `Splits total ${totalSplits.toFixed(1)}% — must equal 100%`
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    if (!artistId) { setErrors({ title: 'No artist record found.' }); return }
    setSaving(true)
    try {
      const { data: songData, error: songError } = await supabase
        .from('songs')
        .insert({ artist_id: artistId, publishing_deal_id: dealId, title: title.trim(), date_written: dateWritten, notes: notes.trim() || null, status: 'logged', total_splits: 0 })
        .select().single()
      if (songError) throw songError

      // For any unlinked writers with a name, add them to global registry first
      const enrichedCowriters = await Promise.all(cowriters.map(async (c) => {
        if (!c.linked && c.name.trim()) {
          // Check if they exist by name first
          const { data: existing } = await supabase
            .from('songwriters').select('id').ilike('name', c.name.trim()).maybeSingle()
          if (existing) return { ...c, songwriter_id: existing.id, linked: true }
          // Create new registry entry
          const { data: newWriter } = await supabase
            .from('songwriters').insert({
              name: c.name.trim(), ipi_number: c.ipi_number || null,
              pro: c.pro || null, publisher_name: c.publisher_name || null,
              publisher_id: c.publisher_id || null,
            }).select().single()
          return { ...c, songwriter_id: newWriter?.id ?? null }
        }
        return c
      }))

      const { error: cwError } = await supabase.from('cowriters').insert(
        enrichedCowriters.map(c => ({
          song_id: songData.id,
          songwriter_id: c.songwriter_id || null,
          name: c.name.trim(),
          publisher_id: c.publisher_id || null,
          publisher_name: c.publisher_name.trim() || null,
          split_percentage: parseFloat(c.split_percentage),
          pro: c.pro || null,
          ipi_number: c.ipi_number.trim() || null,
        }))
      )
      if (cwError) throw cwError

      // If this song was created from a calendar write session, link them
      if (writeSessionId) {
        await supabase
          .from('write_sessions')
          .update({ song_id: songData.id, status: 'logged' })
          .eq('id', writeSessionId)
      }

      router.replace(`/(app)/songs/${songData.id}`)
    } catch (err: any) {
      setErrors({ title: err.message ?? 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.heading}>Log a Song</Text>
              {isManager && activeArtist && (
                <Text style={styles.headingSubtitle}>for {activeArtist.stage_name}</Text>
              )}
            </View>
            <View style={{ width: 24 }} />
          </View>

          {/* Calendar pre-fill banner */}
          {fromCalendar && (
            <View style={styles.calendarBanner}>
              <Ionicons name="calendar" size={16} color={Colors.primary} />
              <Text style={styles.calendarBannerText}>
                Pre-filled from calendar write session. Add a title and review the details.
              </Text>
            </View>
          )}

          {/* Error banner */}
          {errors.title && !title && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{errors.title}</Text>
            </View>
          )}

          {/* Song Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Song Info</Text>
            <Input label="Song Title" value={title} onChangeText={setTitle}
              placeholder="What's the song called?" autoCapitalize="words" error={errors.title} />
            <TouchableOpacity
              onPress={() => setDatePickerVisible(true)}
              style={[datePickerStyles.trigger, errors.dateWritten ? datePickerStyles.triggerError : null]}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
              <Text style={[datePickerStyles.triggerText, !dateWritten && { color: Colors.textMuted }]}>
                {dateWritten
                  ? new Date(dateWritten + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                  : 'Select date written'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
            {errors.dateWritten && <Text style={datePickerStyles.fieldError}>{errors.dateWritten}</Text>}
            <Input label="Notes (optional)" value={notes} onChangeText={setNotes}
              placeholder="Any quick notes..." multiline numberOfLines={3} containerStyle={{ marginBottom: 0 }} />
          </View>

          {/* Co-Writers & Splits */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Co-Writers & Splits</Text>
              <View style={[styles.splitTag, splitsValid ? styles.splitTagValid : styles.splitTagInvalid]}>
                <Text style={[styles.splitTagText, splitsValid ? styles.splitTagTextValid : styles.splitTagTextInvalid]}>
                  {totalSplits.toFixed(2)}% / 100%
                </Text>
              </View>
            </View>
            {errors.splits && <Text style={styles.splitsError}>{errors.splits}</Text>}

            {cowriters.map((cw, index) => (
              <View key={cw.id} style={[styles.cowriterCard, cw.isArtist && styles.cowriterCardArtist]}>
                <View style={styles.cowriterCardHeader}>
                  <View style={styles.cowriterHeaderLeft}>
                    <Text style={styles.cowriterLabel}>
                      {cw.isArtist ? 'Primary Artist' : `Co-Writer ${index}`}
                    </Text>
                    {cw.isArtist && (
                      <View style={styles.artistBadge}>
                        <Ionicons name="star" size={10} color={Colors.primary} />
                        <Text style={styles.artistBadgeText}>Auto-added</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.cowriterHeaderRight}>
                    {cw.linked && (
                      <View style={styles.linkedBadge}>
                        <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
                        <Text style={styles.linkedText}>Matched</Text>
                      </View>
                    )}
                    {!cw.linked && cw.calendarNeedsReview && cw.searchResults.length > 0 && (
                      <View style={styles.reviewBadge}>
                        <Ionicons name="alert-circle" size={12} color={Colors.warning} />
                        <Text style={styles.reviewBadgeText}>Review match</Text>
                      </View>
                    )}
                    {!cw.linked && cw.calendarNeedsReview && cw.searchResults.length === 0 && (
                      <View style={styles.newWriterBadge}>
                        <Ionicons name="person-add" size={12} color={Colors.primary} />
                        <Text style={styles.newWriterBadgeText}>New writer</Text>
                      </View>
                    )}
                    {!cw.isArtist && (
                      <TouchableOpacity onPress={() => removeCowriter(cw.id)}>
                        <Ionicons name="trash-outline" size={18} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Writer name — locked for primary artist, searchable for co-writers */}
                <View style={styles.writerSearchWrapper}>
                  {cw.isArtist ? (
                    <View style={[styles.writerSearchRow, styles.writerSearchRowLocked]}>
                      <Ionicons name="person" size={16} color={Colors.primary} style={{ marginRight: 6 }} />
                      <Text style={styles.writerNameLocked}>{cw.name}</Text>
                      {cw.publisher_name ? (
                        <Text style={styles.writerPublisherLocked}>{cw.publisher_name}</Text>
                      ) : null}
                    </View>
                  ) : (
                  <View style={styles.writerSearchRow}>
                    <TextInput
                      style={styles.writerSearchInput}
                      placeholder="Search writer name..."
                      placeholderTextColor={Colors.textMuted}
                      value={cw.linked ? cw.name : cw.searchQuery}
                      editable={!cw.linked}
                      onChangeText={(v) => searchWriters(cw, v)}
                      onFocus={() => {
                        if (!cw.linked) {
                          updateCowriter(cw.id, { showResults: true, searchResults: ecosystemWriters.slice(0, 6) })
                        }
                      }}
                    />
                    {cw.searching && <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 8 }} />}
                    {cw.linked && (
                      <TouchableOpacity onPress={() => unlinkWriter(cw)} style={styles.unlinkBtn}>
                        <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  )}

                  {/* Search results dropdown */}
                  {cw.showResults && !cw.linked && (
                    <View style={styles.searchDropdown}>
                      {cw.searchQuery === '' && cw.searchResults.length > 0 && (
                        <Text style={styles.dropdownSectionLabel}>
                          {ecosystemWriters.length > 0 ? 'Recent collaborators' : 'All writers'}
                        </Text>
                      )}
                      {cw.searchResults.map((writer) => (
                        <TouchableOpacity
                          key={writer.id}
                          style={styles.dropdownItem}
                          onPress={() => selectWriter(cw, writer)}
                        >
                          <View style={styles.dropdownItemLeft}>
                            <Text style={styles.dropdownName}>{writer.name}</Text>
                            <Text style={styles.dropdownMeta}>
                              {[writer.pro, writer.publisher?.name ?? writer.publisher_name, writer.ipi_number ? `IPI: ${writer.ipi_number}` : null]
                                .filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                          <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                        </TouchableOpacity>
                      ))}
                      {/* Add new to registry option */}
                      {cw.searchQuery.trim().length > 1 && (
                        <TouchableOpacity
                          style={[styles.dropdownItem, styles.dropdownAddNew]}
                          onPress={() => {
                            updateCowriter(cw.id, {
                              name: cw.searchQuery.trim(),
                              showResults: false, linked: false,
                              calendarNeedsReview: false,
                            })
                          }}
                        >
                          <Ionicons name="person-add-outline" size={16} color={Colors.primary} />
                          <Text style={styles.dropdownAddNewText}>
                            Add "{cw.searchQuery.trim()}" as new writer
                          </Text>
                        </TouchableOpacity>
                      )}
                      {cw.searchResults.length === 0 && !cw.searching && cw.searchQuery.trim().length > 0 && (
                        <Text style={styles.dropdownEmpty}>No writers found in registry</Text>
                      )}
                      <TouchableOpacity style={styles.dropdownClose} onPress={() => updateCowriter(cw.id, { showResults: false })}>
                        <Text style={styles.dropdownCloseText}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {errors[`cw_${index}_name`] && <Text style={styles.fieldError}>{errors[`cw_${index}_name`]}</Text>}

                {/* Split % — always shown */}
                <View style={styles.splitRow}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Split %"
                      value={cw.split_percentage}
                      onChangeText={(v) => updateCowriter(cw.id, { split_percentage: v })}
                      placeholder="e.g. 50"
                      keyboardType="decimal-pad"
                      error={errors[`cw_${index}_split`]}
                    />
                  </View>
                  {/* PRO chips — shown when not linked or after link */}
                  <View style={{ flex: 2 }}>
                    <Text style={styles.fieldLabel}>PRO</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.proScroll}>
                      {PRO_OPTIONS.map((pro) => (
                        <TouchableOpacity
                          key={pro}
                          style={[styles.proChip, cw.pro === pro && styles.proChipActive]}
                          onPress={() => updateCowriter(cw.id, { pro: cw.pro === pro ? '' : pro })}
                        >
                          <Text style={[styles.proChipText, cw.pro === pro && styles.proChipTextActive]}>{pro}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>

                {/* Additional info — shown collapsed if linked */}
                {!cw.linked && (
                  <>
                    <Input label="Publisher (optional)" value={cw.publisher_name}
                      onChangeText={(v) => updateCowriter(cw.id, { publisher_name: v })}
                      placeholder="Their publishing company" autoCapitalize="words" />
                    <Input label="IPI Number (optional)" value={cw.ipi_number}
                      onChangeText={(v) => updateCowriter(cw.id, { ipi_number: v })}
                      placeholder="Performing rights ID" keyboardType="numeric" containerStyle={{ marginBottom: 0 }} />
                  </>
                )}

                {/* Linked writer summary — hide on the locked artist row (publisher shown inline above) */}
                {cw.linked && !cw.isArtist && !!(cw.publisher_name || cw.ipi_number || cw.pro) && (
                  <View style={styles.linkedSummary}>
                    {!!cw.pro && <Text style={styles.linkedSummaryText}>{cw.pro}</Text>}
                    {!!cw.publisher_name && <Text style={styles.linkedSummaryText}>{cw.publisher_name}</Text>}
                    {!!cw.ipi_number && <Text style={styles.linkedSummaryText}>IPI: {cw.ipi_number}</Text>}
                  </View>
                )}
              </View>
            ))}

            <TouchableOpacity style={styles.addCowriterButton} onPress={addCowriter}>
              <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
              <Text style={styles.addCowriterText}>Add Co-Writer</Text>
            </TouchableOpacity>

            {cowriters.length > 1 && (
              <TouchableOpacity style={styles.evenSplitButton}
                onPress={() => {
                  const base = Math.floor((100 / cowriters.length) * 100) / 100
                  const remainder = parseFloat((100 - base * cowriters.length).toFixed(2))
                  setCowriters(prev => prev.map((c, i) => ({
                    ...c,
                    split_percentage: i === 0
                      ? (base + remainder).toFixed(2)
                      : base.toFixed(2)
                  })))
                }}>
                <Ionicons name="calculator-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.evenSplitText}>
                  Split evenly ({(100 / cowriters.length).toFixed(1)}% each)
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Save */}
          <View style={styles.saveSection}>
            <Button title="Log This Song" onPress={handleSave} loading={saving}
              disabled={!splitsValid || cowriters.some(c => !c.name.trim())} />
            <Text style={styles.saveHint}>
              You can add your work tape and demo after saving
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <DatePickerModal
        visible={datePickerVisible}
        value={dateWritten}
        onSelect={(ymd) => { setDateWritten(ymd); setDatePickerVisible(false) }}
        onClose={() => setDatePickerVisible(false)}
      />
    </SafeAreaView>
  )
}

const datePickerStyles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    marginBottom: Spacing.md,
  },
  triggerError: { borderColor: Colors.error },
  triggerText: { flex: 1, fontSize: Fonts.sizes.md, color: Colors.textPrimary },
  fieldError: { fontSize: Fonts.sizes.xs, color: Colors.error, marginTop: -Spacing.sm, marginBottom: Spacing.sm },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xl },
  heading: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary },
  headingSubtitle: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600', marginTop: 2 },
  calendarBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.primary}12`, borderRadius: Radius.md,
    padding: Spacing.sm, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: `${Colors.primary}30`,
  },
  calendarBannerText: { flex: 1, fontSize: Fonts.sizes.sm, color: Colors.primary, lineHeight: 18 },
  errorBanner: { backgroundColor: `${Colors.error}15`, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.sm, borderWidth: 1, borderColor: `${Colors.error}40` },
  errorBannerText: { color: Colors.error, fontSize: Fonts.sizes.sm },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  sectionTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  splitTag: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1 },
  splitTagValid: { backgroundColor: `${Colors.success}15`, borderColor: Colors.success },
  splitTagInvalid: { backgroundColor: `${Colors.error}15`, borderColor: Colors.error },
  splitTagText: { fontSize: Fonts.sizes.xs, fontWeight: '700' },
  splitTagTextValid: { color: Colors.success },
  splitTagTextInvalid: { color: Colors.error },
  splitsError: { fontSize: Fonts.sizes.sm, color: Colors.error, marginBottom: Spacing.sm, fontWeight: '500' },
  cowriterCard: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  cowriterCardArtist: { borderColor: `${Colors.primary}40`, backgroundColor: `${Colors.primary}08` },
  cowriterCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  cowriterHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  cowriterLabel: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.textSecondary },
  artistBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${Colors.primary}15`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full },
  artistBadgeText: { fontSize: 10, color: Colors.primary, fontWeight: '700' },
  cowriterHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  writerSearchRowLocked: { backgroundColor: `${Colors.primary}08`, borderColor: `${Colors.primary}30` },
  writerNameLocked: { flex: 1, fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  writerPublisherLocked: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '500' },
  linkedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${Colors.success}15`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full },
  linkedText: { fontSize: Fonts.sizes.xs, color: Colors.success, fontWeight: '600' },
  reviewBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${Colors.warning}15`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full },
  reviewBadgeText: { fontSize: Fonts.sizes.xs, color: Colors.warning, fontWeight: '600' },
  newWriterBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${Colors.primary}10`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full },
  newWriterBadgeText: { fontSize: Fonts.sizes.xs, color: Colors.primary, fontWeight: '600' },
  writerSearchWrapper: { marginBottom: Spacing.sm },
  writerSearchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, height: 48 },
  writerSearchInput: { flex: 1, fontSize: Fonts.sizes.md, color: Colors.textPrimary },
  unlinkBtn: { padding: 4 },
  searchDropdown: { marginTop: 4, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  dropdownSectionLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 4 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  dropdownItemLeft: { flex: 1 },
  dropdownName: { fontSize: Fonts.sizes.md, fontWeight: '600', color: Colors.textPrimary },
  dropdownMeta: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  dropdownAddNew: { backgroundColor: `${Colors.primary}10`, flexDirection: 'row', gap: Spacing.sm },
  dropdownAddNewText: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600', flex: 1 },
  dropdownEmpty: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, padding: Spacing.md, textAlign: 'center' },
  dropdownClose: { padding: Spacing.sm, alignItems: 'center' },
  dropdownCloseText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600' },
  fieldError: { color: Colors.error, fontSize: Fonts.sizes.xs, marginBottom: Spacing.sm },
  splitRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  fieldLabel: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.textSecondary, marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  proScroll: { marginBottom: Spacing.md },
  proChip: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, marginRight: Spacing.xs },
  proChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  proChipText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600' },
  proChipTextActive: { color: '#fff' },
  linkedSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  linkedSummaryText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, backgroundColor: Colors.surface, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm },
  addCowriterButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed', justifyContent: 'center', marginBottom: Spacing.sm },
  addCowriterText: { color: Colors.primary, fontSize: Fonts.sizes.sm, fontWeight: '600' },
  evenSplitButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, justifyContent: 'center' },
  evenSplitText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted },
  saveSection: { gap: Spacing.sm },
  saveHint: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, textAlign: 'center' },
})
