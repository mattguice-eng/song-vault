import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Switch, Modal,
} from 'react-native'
import { router } from 'expo-router'
import { Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { SongWithDetails, Publisher } from '../../../src/types/database'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'

interface ExportSong extends SongWithDetails {
  selected: boolean
  hasDemo: boolean
  demoFile: { file_url: string; file_name: string } | null
  splitWarning: boolean // splits don't add to 100
}

export default function ExportScreen() {
  const { profile, activeArtist } = useAuthStore()
  const [songs, setSongs] = useState<ExportSong[]>([])
  const [loading, setLoading] = useState(true)
  const [includeNoDemos, setIncludeNoDemos] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportSuccess, setExportSuccess] = useState('')
  const [publishers, setPublishers] = useState<Publisher[]>([])
  const [selectedPublisherId, setSelectedPublisherId] = useState<string | null>(null)
  const [publisherPickerVisible, setPublisherPickerVisible] = useState(false)

  const isManager = profile?.role === 'manager'

  const artistId = isManager ? activeArtist?.id : null
  const artistName = isManager
    ? (activeArtist?.real_name ?? activeArtist?.stage_name ?? 'Artist')
    : profile?.full_name ?? 'Artist'

  useEffect(() => {
    fetchSongs()
    fetchPublishers()
  }, [])

  const fetchSongs = async () => {
    if (!profile) { setLoading(false); return }
    if (isManager && !activeArtist) { setLoading(false); return }
    try {
      let query = supabase
        .from('songs')
        .select('*, cowriters(*), files:song_files(*), artist:artists(id, stage_name, real_name)')
        .in('status', ['logged', 'complete']) // logged and complete songs eligible for export
        .order('date_written', { ascending: false })

      if (isManager && activeArtist) {
        query = query.eq('artist_id', activeArtist.id)
      } else if (!isManager) {
        const { data: artistData } = await supabase
          .from('artists')
          .select('id')
          .eq('user_id', profile.id)
          .single()
        if (artistData) query = query.eq('artist_id', artistData.id)
      }

      const { data, error } = await query
      if (error) throw error

      const exportSongs: ExportSong[] = (data ?? []).map((s: any) => {
        const demoFile = s.files?.find((f: any) => f.file_type === 'demo') ?? null
        const totalSplits = (s.cowriters ?? []).reduce((sum: number, c: any) => sum + (c.split_percentage ?? 0), 0)
        return {
          ...s,
          selected: true, // default all selected
          hasDemo: !!demoFile,
          demoFile: demoFile ? { file_url: demoFile.file_url, file_name: demoFile.file_name } : null,
          splitWarning: Math.abs(totalSplits - 100) > 0.1,
        }
      })

      setSongs(exportSongs)
    } catch (err) {
      console.error('[export] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchPublishers = async () => {
    const artistIdForQuery = isManager ? activeArtist?.id : null
    if (!artistIdForQuery) return
    // Get publishers from active deals
    const { data } = await supabase
      .from('publishing_deals')
      .select('publisher:publishers(*)')
      .eq('artist_id', artistIdForQuery)
      .eq('is_active', true)
    if (data) {
      const pubs = data.map((d: any) => d.publisher).filter(Boolean) as Publisher[]
      setPublishers(pubs)
      if (pubs.length === 1) setSelectedPublisherId(pubs[0].id)
    }
  }

  const toggleSong = (songId: string) => {
    setSongs(prev => prev.map(s => s.id === songId ? { ...s, selected: !s.selected } : s))
  }

  const selectAll = () => {
    const visibleSongs = includeNoDemos ? songs : songs.filter(s => s.hasDemo)
    const allSelected = visibleSongs.every(s => s.selected)
    setSongs(prev => prev.map(s => {
      if (!includeNoDemos && !s.hasDemo) return s
      return { ...s, selected: !allSelected }
    }))
  }

  const visibleSongs = includeNoDemos ? songs : songs.filter(s => s.hasDemo)
  const selectedSongs = visibleSongs.filter(s => s.selected)
  const selectedWithDemo = selectedSongs.filter(s => s.hasDemo)
  const selectedWithoutDemo = selectedSongs.filter(s => !s.hasDemo)
  const selectedWithSplitWarning = selectedSongs.filter(s => s.splitWarning)
  const selectedPublisher = publishers.find(p => p.id === selectedPublisherId)

  const sanitizeFilename = (name: string) => {
    return name.replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, ' ').trim()
  }

  const handleExport = async () => {
    if (selectedSongs.length === 0) return
    if (exporting) return
    setExporting(true)
    setExportError('')
    setExportSuccess('')

    try {
      console.log('[export] Starting export for', selectedSongs.length, 'songs')
      // Dynamic import JSZip (only needed on export)
      const JSZip = (await import('jszip')).default
      console.log('[export] JSZip loaded')
      const zip = new JSZip()

      const publisherName = selectedPublisher?.name ?? 'Publisher'
      const dateStr = new Date().toISOString().split('T')[0]
      const folderName = `${sanitizeFilename(artistName)}_Export_${dateStr}`

      // ── 1. Generate CSV ──────────────────────────────────────────────
      const csvHeaders = ['date', 'title', 'composers', 'artist_share']
      const csvRows = selectedSongs.map(song => {
        const composers = (song.cowriters ?? []).map(c => c.name).join('/')
        // Artist share = the first cowriter that matches the artist name, or calculate
        const artistCowriter = (song.cowriters ?? []).find(c =>
          c.name.toLowerCase() === artistName.toLowerCase()
        )
        const artistShare = artistCowriter?.split_percentage ?? ''
        const date = song.date_written ?? ''
        const title = song.title ?? ''
        return [date, `"${title.replace(/"/g, '""')}"`, `"${composers.replace(/"/g, '""')}"`, artistShare].join(',')
      })
      const csvContent = [csvHeaders.join(','), ...csvRows].join('\n')
      zip.file(`${folderName}/songs_export.csv`, csvContent)
      console.log('[export] CSV generated')

      // ── 2. Generate lyrics files ─────────────────────────────────────
      const lyricsFolder = zip.folder(`${folderName}/lyrics`)!
      for (const song of selectedSongs) {
        if (!song.lyrics?.trim()) continue
        const composers = (song.cowriters ?? []).map(c => c.name).join(', ')
        const lyricsContent = [
          song.title,
          `Date of Creation: ${song.date_written ?? 'Unknown'}`,
          `Songwriters: ${composers || 'Unknown'}`,
          '',
          '─'.repeat(40),
          '',
          song.lyrics,
        ].join('\n')
        const fileName = sanitizeFilename(song.title) + '.txt'
        lyricsFolder.file(fileName, lyricsContent)
      }

      // ── 3. Download and package demo files ───────────────────────────
      const demosFolder = zip.folder(`${folderName}/demos`)!
      let demoCount = 0
      for (const song of selectedSongs) {
        if (!song.demoFile) continue
        try {
          // Get a fresh signed URL for download
          const raw = song.demoFile.file_url.split('/song-files/')[1]
          if (!raw) continue
          const storagePath = decodeURIComponent(raw.split('?')[0])
          const { data: signedData, error: signErr } = await supabase.storage
            .from('song-files')
            .createSignedUrl(storagePath, 300) // 5 min
          if (signErr || !signedData?.signedUrl) continue

          const response = await fetch(signedData.signedUrl)
          if (!response.ok) continue
          const blob = await response.blob()

          // Name: SongTitle_Date_WriterName.ext
          const ext = song.demoFile.file_name?.split('.').pop() ?? 'mp3'
          const demoFileName = `${sanitizeFilename(song.title)}_${song.date_written ?? 'nodate'}_${sanitizeFilename(artistName)}.${ext}`
          demosFolder.file(demoFileName, blob)
          demoCount++
        } catch (e) {
          console.warn('[export] Failed to download demo for:', song.title, e)
        }
      }

      // ── 4. Generate zip and trigger download ─────────────────────────
      console.log('[export] Generating zip...')
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      console.log('[export] Zip generated, size:', zipBlob.size)

      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${folderName}.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }

      console.log('[export] Download triggered')

      // ── 5. Mark songs as submitted (best-effort) ────────────────────
      try {
        const now = new Date().toISOString()
        for (const song of selectedSongs) {
          const { error } = await supabase.from('songs').update({
            status: 'submitted',
            submitted_at: now,
          }).eq('id', song.id)
          if (error) console.warn('[export] Failed to mark song submitted:', song.title, error)
        }
        console.log('[export] Songs marked as submitted')
      } catch (e) {
        console.warn('[export] Failed to update song statuses:', e)
      }

      // ── 6. Save submission record (best-effort) ─────────────────────
      try {
        const songArtistId = isManager ? activeArtist?.id : (songs[0] as any)?.artist_id
        if (songArtistId) {
          const { data: submissionData, error: subErr } = await supabase.from('submissions').insert({
            artist_id: songArtistId,
            publisher_id: selectedPublisherId,
            publisher_name: selectedPublisher?.name ?? 'Unknown',
            submitted_by: profile!.id,
            song_count: selectedSongs.length,
            demo_count: demoCount,
          }).select('id').single()

          if (subErr) {
            console.warn('[export] Submission record failed:', subErr)
          } else if (submissionData) {
            const submissionSongs = selectedSongs.map(song => ({
              submission_id: submissionData.id,
              song_id: song.id,
              had_demo: song.hasDemo,
            }))
            await supabase.from('submission_songs').insert(submissionSongs)
            console.log('[export] Submission record saved')
          }
        }
      } catch (e) {
        console.warn('[export] Failed to save submission record:', e)
      }

      setExportSuccess(`Exported ${selectedSongs.length} songs (${demoCount} demos). Songs marked as submitted.`)

      // Remove exported songs from the list
      setSongs(prev => prev.filter(s => !selectedSongs.find(sel => sel.id === s.id)))

    } catch (err: any) {
      console.error('[export] error:', err)
      setExportError(err.message ?? 'Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Export for Publisher</Text>
            <Text style={styles.subtitle}>{artistName}</Text>
          </View>
        </View>

        {/* Publisher selector */}
        {publishers.length > 0 && (
          <TouchableOpacity
            style={styles.publisherPicker}
            onPress={() => setPublisherPickerVisible(true)}
          >
            <Text style={styles.publisherLabel}>Publisher:</Text>
            <Text style={styles.publisherValue}>
              {selectedPublisher?.name ?? 'Select publisher...'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={Colors.textPrimaryMuted} />
          </TouchableOpacity>
        )}

        {/* Include songs without demos toggle */}
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Include songs without demos</Text>
          <Switch
            value={includeNoDemos}
            onValueChange={setIncludeNoDemos}
            trackColor={{ false: Colors.border, true: Colors.primary }}
          />
        </View>

        {/* Summary bar */}
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {selectedSongs.length} selected
          </Text>
          {selectedWithDemo.length > 0 && (
            <Text style={styles.summaryDemo}>{selectedWithDemo.length} demos</Text>
          )}
          {selectedWithoutDemo.length > 0 && (
            <View style={styles.warningBadge}>
              <Ionicons name="warning" size={14} color="#F59E0B" />
              <Text style={styles.warningText}>{selectedWithoutDemo.length} no demo</Text>
            </View>
          )}
          {selectedWithSplitWarning.length > 0 && (
            <View style={styles.warningBadge}>
              <Ionicons name="alert-circle" size={14} color="#EF4444" />
              <Text style={[styles.warningText, { color: '#EF4444' }]}>
                {selectedWithSplitWarning.length} splits {'\u2260'} 100%
              </Text>
            </View>
          )}
        </View>

        {/* Select all */}
        <TouchableOpacity style={styles.selectAllRow} onPress={selectAll}>
          <Ionicons
            name={visibleSongs.length > 0 && visibleSongs.every(s => s.selected) ? 'checkbox' : 'square-outline'}
            size={22}
            color={Colors.primary}
          />
          <Text style={styles.selectAllText}>Select All</Text>
        </TouchableOpacity>

        {/* Song list */}
        {visibleSongs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-outline" size={48} color={Colors.textPrimaryMuted} />
            <Text style={styles.emptyText}>No complete songs ready for export</Text>
            <Text style={styles.emptySubtext}>Mark songs as "Complete" to include them here</Text>
          </View>
        ) : (
          visibleSongs.map(song => (
            <TouchableOpacity
              key={song.id}
              style={[styles.songRow, song.selected && styles.songRowSelected]}
              onPress={() => toggleSong(song.id)}
            >
              <Ionicons
                name={song.selected ? 'checkbox' : 'square-outline'}
                size={22}
                color={song.selected ? Colors.primary : Colors.textPrimaryMuted}
              />
              <View style={styles.songInfo}>
                <Text style={styles.songTitle}>{song.title}</Text>
                <Text style={styles.songMeta}>
                  {song.date_written ?? 'No date'}
                  {' \u2022 '}
                  {(song.cowriters ?? []).map(c => c.name).join(', ') || 'No writers'}
                </Text>
              </View>
              <View style={styles.songBadges}>
                {song.hasDemo ? (
                  <View style={[styles.badge, styles.badgeGreen]}>
                    <Text style={styles.badgeText}>Demo</Text>
                  </View>
                ) : (
                  <View style={[styles.badge, styles.badgeYellow]}>
                    <Text style={styles.badgeTextDark}>No Demo</Text>
                  </View>
                )}
                {song.splitWarning && (
                  <View style={[styles.badge, styles.badgeRed]}>
                    <Text style={styles.badgeText}>Splits</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}

        {/* Error / Success messages */}
        {exportError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color="#fff" />
            <Text style={styles.errorText}>{exportError}</Text>
          </View>
        ) : null}
        {exportSuccess ? (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={styles.successText}>{exportSuccess}</Text>
          </View>
        ) : null}

        {/* Export button */}
        {selectedSongs.length > 0 && (
          <TouchableOpacity
            style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
            onPress={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={20} color="#fff" />
                <Text style={styles.exportBtnText}>
                  Download Export Package ({selectedSongs.length} songs)
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Publisher picker modal */}
      <Modal visible={publisherPickerVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPublisherPickerVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Publisher</Text>
            {publishers.map(pub => (
              <TouchableOpacity
                key={pub.id}
                style={[
                  styles.modalOption,
                  selectedPublisherId === pub.id && styles.modalOptionSelected,
                ]}
                onPress={() => {
                  setSelectedPublisherId(pub.id)
                  setPublisherPickerVisible(false)
                }}
              >
                <Text style={styles.modalOptionText}>{pub.name}</Text>
                {selectedPublisherId === pub.id && (
                  <Ionicons name="checkmark" size={20} color={Colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.lg },
  backBtn: { marginRight: Spacing.sm, padding: 4 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textPrimaryMuted, marginTop: 2 },

  publisherPicker: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  publisherLabel: { fontSize: 14, color: Colors.textPrimaryMuted, marginRight: 8 },
  publisherValue: { flex: 1, fontSize: 15, color: Colors.textPrimary, fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  toggleLabel: { fontSize: 14, color: Colors.textPrimary },

  summaryBar: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm,
    gap: 10,
  },
  summaryText: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  summaryDemo: { fontSize: 13, color: Colors.primary },
  warningBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  warningText: { fontSize: 12, color: '#F59E0B', fontWeight: '500' },

  selectAllRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: Spacing.sm, marginBottom: 4,
  },
  selectAllText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },

  songRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  songRowSelected: { borderColor: Colors.primary, borderWidth: 1.5 },
  songInfo: { flex: 1, marginLeft: 12 },
  songTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  songMeta: { fontSize: 12, color: Colors.textPrimaryMuted, marginTop: 2 },
  songBadges: { flexDirection: 'row', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeGreen: { backgroundColor: '#059669' },
  badgeYellow: { backgroundColor: '#FBBF24' },
  badgeRed: { backgroundColor: '#EF4444' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  badgeTextDark: { fontSize: 11, fontWeight: '600', color: '#1a1a1a' },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: Colors.textPrimaryMuted, marginTop: 12 },
  emptySubtext: { fontSize: 13, color: Colors.textPrimaryMuted, marginTop: 4 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#DC2626', borderRadius: Radius.md,
    padding: Spacing.md, marginTop: Spacing.md,
  },
  errorText: { color: '#fff', fontSize: 14, flex: 1 },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#059669', borderRadius: Radius.md,
    padding: Spacing.md, marginTop: Spacing.md,
  },
  successText: { color: '#fff', fontSize: 14, flex: 1 },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    padding: Spacing.md, marginTop: Spacing.lg,
  },
  exportBtnDisabled: { opacity: 0.6 },
  exportBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.lg, width: '85%', maxWidth: 400,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.md },
  modalOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.md, borderRadius: Radius.sm,
    marginBottom: 4,
  },
  modalOptionSelected: { backgroundColor: Colors.background },
  modalOptionText: { fontSize: 15, color: Colors.textPrimary },
})
