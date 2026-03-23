import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { StatusBadge } from './StatusBadge'
import { SongWithDetails } from '../types/database'
import { Colors, Radius, Spacing, Fonts } from '../utils/constants'

interface SongCardProps {
  song: SongWithDetails
  onPress: () => void
  onAddToPlaylist?: () => void
  showArtist?: boolean
  artistName?: string
}

export const SongCard: React.FC<SongCardProps> = ({ song, onPress, onAddToPlaylist, showArtist = false, artistName }) => {
  const cowriterCount = song.cowriters?.length ?? 0

  const artistSplit = artistName
    ? song.cowriters?.find(c => c.name.toLowerCase() === artistName.toLowerCase())?.split_percentage ?? null
    : null
  const hasWorkTape = song.files?.some((f) => f.file_type === 'work_tape')
  const hasDemo = song.files?.some((f) => f.file_type === 'demo')

  const dateWritten = new Date(song.date_written + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {/* Row 1: Title + Status badge */}
      <View style={styles.topRow}>
        <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
        {onAddToPlaylist && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={(e) => {
              e.stopPropagation()
              onAddToPlaylist()
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
          </TouchableOpacity>
        )}
        <StatusBadge status={song.status} />
      </View>

      {/* Row 2: Date, writers, split */}
      <View style={styles.metaRow}>
        <Ionicons name="calendar-outline" size={12} color={Colors.textMuted} />
        <Text style={styles.metaText}>{dateWritten}</Text>
        {cowriterCount > 0 && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Ionicons name="people-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.metaText}>
              {cowriterCount} writer{cowriterCount !== 1 ? 's' : ''}
            </Text>
          </>
        )}
        {artistSplit !== null && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={[styles.metaText, styles.splitText]}>
              {Number.isInteger(artistSplit) ? artistSplit : parseFloat(artistSplit.toFixed(2))}%
            </Text>
          </>
        )}
        {showArtist && song.artist && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{song.artist.stage_name}</Text>
          </>
        )}
      </View>

      {/* Row 3: File tags */}
      <View style={styles.fileRow}>
        <View style={[styles.fileTag, hasWorkTape ? styles.fileTagActive : styles.fileTagInactive]}>
          <Ionicons name="mic-outline" size={10} color={hasWorkTape ? Colors.statusWorkTape : Colors.textMuted} />
          <Text style={[styles.fileTagText, !hasWorkTape && styles.fileTagTextInactive]}>WT</Text>
        </View>
        <View style={[styles.fileTag, hasDemo ? styles.fileTagActive : styles.fileTagInactive]}>
          <Ionicons name="musical-note-outline" size={10} color={hasDemo ? Colors.statusDemoReady : Colors.textMuted} />
          <Text style={[styles.fileTagText, !hasDemo && styles.fileTagTextInactive]}>Demo</Text>
        </View>
        {song.lyrics && (
          <View style={[styles.fileTag, styles.fileTagActive]}>
            <Ionicons name="document-text-outline" size={10} color={Colors.statusComplete} />
            <Text style={styles.fileTagText}>Lyrics</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: 6,
  },
  title: {
    fontSize: Fonts.sizes.md,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
  },
  addBtn: {
    padding: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  metaText: {
    fontSize: Fonts.sizes.xs,
    color: Colors.textMuted,
  },
  metaDot: {
    fontSize: Fonts.sizes.xs,
    color: Colors.textMuted,
    marginHorizontal: 1,
  },
  splitText: {
    color: Colors.primary,
    fontWeight: '600',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fileTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  fileTagActive: {
    backgroundColor: Colors.surfaceElevated,
  },
  fileTagInactive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fileTagText: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  fileTagTextInactive: {
    color: Colors.textMuted,
  },
})
