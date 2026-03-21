import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { StatusBadge } from './StatusBadge'
import { SongWithDetails } from '../types/database'
import { Colors, Radius, Spacing, Fonts } from '../utils/constants'

interface SongCardProps {
  song: SongWithDetails
  onPress: () => void
  showArtist?: boolean
  artistName?: string // real_name or stage_name of the active artist to show their split
}

export const SongCard: React.FC<SongCardProps> = ({ song, onPress, showArtist = false, artistName }) => {
  const cowriterCount = song.cowriters?.length ?? 0

  const artistSplit = artistName
    ? song.cowriters?.find(c => c.name.toLowerCase() === artistName.toLowerCase())?.split_percentage ?? null
    : null
  const hasFiles = (song.files?.length ?? 0) > 0
  const hasWorkTape = song.files?.some((f) => f.file_type === 'work_tape')
  const hasDemo = song.files?.some((f) => f.file_type === 'demo')

  const dateWritten = new Date(song.date_written + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {song.title}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </View>
        <StatusBadge status={song.status} />
      </View>

      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Ionicons name="calendar-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.metaText}>{dateWritten}</Text>
        </View>

        {cowriterCount > 0 && (
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.metaText}>
              {cowriterCount} co-writer{cowriterCount !== 1 ? 's' : ''}
            </Text>
          </View>
        )}

        {artistSplit !== null && (
          <View style={styles.metaItem}>
            <Ionicons name="pie-chart-outline" size={13} color={Colors.primary} />
            <Text style={[styles.metaText, styles.splitText]}>
              {Number.isInteger(artistSplit) ? artistSplit : parseFloat(artistSplit.toFixed(2))}%
            </Text>
          </View>
        )}

        {showArtist && song.artist && (
          <View style={styles.metaItem}>
            <Ionicons name="person-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.metaText}>{song.artist.stage_name}</Text>
          </View>
        )}
      </View>

      <View style={styles.fileIndicators}>
        <View style={[styles.fileTag, hasWorkTape ? styles.fileTagActive : styles.fileTagInactive]}>
          <Ionicons
            name="mic-outline"
            size={11}
            color={hasWorkTape ? Colors.statusWorkTape : Colors.textMuted}
          />
          <Text style={[styles.fileTagText, !hasWorkTape && styles.fileTagTextInactive]}>
            Work Tape
          </Text>
        </View>
        <View style={[styles.fileTag, hasDemo ? styles.fileTagActive : styles.fileTagInactive]}>
          <Ionicons
            name="musical-note-outline"
            size={11}
            color={hasDemo ? Colors.statusDemoReady : Colors.textMuted}
          />
          <Text style={[styles.fileTagText, !hasDemo && styles.fileTagTextInactive]}>Demo</Text>
        </View>
        {song.lyrics && (
          <View style={[styles.fileTag, styles.fileTagActive]}>
            <Ionicons name="document-text-outline" size={11} color={Colors.statusComplete} />
            <Text style={styles.fileTagText}>Lyrics</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  header: {
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: Fonts.sizes.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: Fonts.sizes.xs,
    color: Colors.textMuted,
  },
  splitText: {
    color: Colors.primary,
    fontWeight: '600',
  },
  fileIndicators: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  fileTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
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
    fontSize: Fonts.sizes.xs,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  fileTagTextInactive: {
    color: Colors.textMuted,
  },
})
