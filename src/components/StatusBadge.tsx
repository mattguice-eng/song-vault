import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { SongStatus } from '../types/database'
import { Colors, Radius, Fonts, Spacing } from '../utils/constants'

const STATUS_CONFIG: Record<SongStatus, { label: string; color: string; bg: string }> = {
  logged: { label: 'Logged', color: Colors.statusLogged, bg: '#6B728020' },
  work_tape: { label: 'Work Tape', color: Colors.statusWorkTape, bg: '#F59E0B20' },
  demo_ready: { label: 'Demo Ready', color: Colors.statusDemoReady, bg: '#3B82F620' },
  complete: { label: 'Complete', color: Colors.statusComplete, bg: '#10B98120' },
  submitted: { label: 'Submitted', color: Colors.statusSubmitted, bg: '#A78BFA20' },
}

interface StatusBadgeProps {
  status: SongStatus
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = STATUS_CONFIG[status]

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: Fonts.sizes.xs,
    fontWeight: '600',
  },
})
