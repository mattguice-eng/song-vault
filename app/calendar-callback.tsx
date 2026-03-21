import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../src/lib/supabase'
import { Colors, Spacing, Fonts, Radius } from '../src/utils/constants'
import { Ionicons } from '@expo/vector-icons'

/**
 * Google OAuth callback page.
 * Flow: exchange code → show calendar list → user picks → sync → redirect
 */
export default function CalendarCallbackScreen() {
  const [step, setStep] = useState<'exchanging' | 'pick_calendar' | 'syncing' | 'success' | 'error'>('exchanging')
  const [errorMsg, setErrorMsg] = useState('')
  const [artistId, setArtistId] = useState<string | null>(null)
  const [calendars, setCalendars] = useState<{ id: string; summary: string; primary: boolean }[]>([])

  useEffect(() => {
    handleExchange()
  }, [])

  const handleExchange = async () => {
    try {
      if (typeof window === 'undefined') return

      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const aId = params.get('state')
      const error = params.get('error')

      if (error) throw new Error(`Google auth error: ${error}`)
      if (!code || !aId) throw new Error('Missing auth code or artist ID')

      setArtistId(aId)

      // Get the sync_from date from localStorage
      const syncFrom = localStorage.getItem(`calendar_sync_from_${aId}`) || new Date().toISOString().split('T')[0]
      localStorage.removeItem(`calendar_sync_from_${aId}`)

      // Step 1: Exchange code for tokens (don't sync yet)
      const { error: fnError } = await supabase.functions.invoke('sync-calendar', {
        body: {
          action: 'exchange',
          code,
          artist_id: aId,
          redirect_uri: `${window.location.origin}/calendar-callback`,
          sync_from: syncFrom,
        },
      })

      if (fnError) throw new Error(fnError.message ?? 'Token exchange failed')

      // Step 2: Fetch calendar list
      const { data: listData, error: listError } = await supabase.functions.invoke('sync-calendar', {
        body: { action: 'list_calendars', artist_id: aId },
      })

      if (listError) throw new Error(listError.message ?? 'Failed to load calendars')

      const cals = listData?.calendars ?? []
      if (cals.length === 0) throw new Error('No calendars found on this Google account')

      // If only one calendar, skip the picker
      if (cals.length === 1) {
        await handleSelectCalendar(aId, cals[0].id)
        return
      }

      setCalendars(cals)
      setStep('pick_calendar')
    } catch (err: any) {
      console.error('[calendar-callback] error:', err)
      setErrorMsg(err.message ?? 'Something went wrong')
      setStep('error')
      setTimeout(() => router.replace('/(app)/dashboard'), 4000)
    }
  }

  const handleSelectCalendar = async (aId: string, calendarId: string, calendarName?: string) => {
    try {
      setStep('syncing')

      // Update artist with selected calendar
      await supabase.from('artists').update({
        google_calendar_id: calendarId,
        google_calendar_name: calendarName || calendarId,
      }).eq('id', aId)

      setStep('success')

      // Redirect back — user can use Sync button to preview & import events
      setTimeout(() => {
        router.replace({ pathname: '/(app)/artists/[id]', params: { id: aId } })
      }, 1500)
    } catch (err: any) {
      console.error('[calendar-callback] sync error:', err)
      setErrorMsg(err.message ?? 'Sync failed')
      setStep('error')
      setTimeout(() => router.replace('/(app)/dashboard'), 4000)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {step === 'exchanging' && (
          <>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.title}>Connecting Calendar…</Text>
            <Text style={styles.subtitle}>Exchanging credentials with Google</Text>
          </>
        )}

        {step === 'pick_calendar' && (
          <>
            <Ionicons name="calendar-outline" size={48} color={Colors.primary} />
            <Text style={styles.title}>Select a Calendar</Text>
            <Text style={styles.subtitle}>
              Which calendar has the write sessions?
            </Text>

            <View style={styles.calendarList}>
              {calendars.map((cal) => (
                <TouchableOpacity
                  key={cal.id}
                  style={styles.calendarItem}
                  onPress={() => artistId && handleSelectCalendar(artistId, cal.id, cal.summary)}
                >
                  <Ionicons name="calendar" size={20} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calendarName}>{cal.summary}</Text>
                    {cal.primary && <Text style={styles.calendarMeta}>Primary calendar</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {step === 'syncing' && (
          <>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.title}>Syncing Events…</Text>
            <Text style={styles.subtitle}>Pulling in write sessions from your calendar</Text>
          </>
        )}

        {step === 'success' && (
          <>
            <Ionicons name="checkmark-circle" size={48} color={Colors.success} />
            <Text style={styles.title}>Calendar Connected!</Text>
            <Text style={styles.subtitle}>Redirecting back to artist page…</Text>
          </>
        )}

        {step === 'error' && (
          <>
            <Ionicons name="alert-circle" size={48} color={Colors.error} />
            <Text style={styles.title}>Connection Failed</Text>
            <Text style={styles.subtitle}>{errorMsg}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    padding: Spacing.xl, gap: Spacing.md,
  },
  title: {
    fontSize: Fonts.sizes.xl, fontWeight: '700',
    color: Colors.textPrimary, textAlign: 'center',
  },
  subtitle: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    textAlign: 'center', maxWidth: 300,
  },
  calendarList: {
    width: '100%', maxWidth: 400, marginTop: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  calendarItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  calendarName: {
    fontSize: Fonts.sizes.md, fontWeight: '600', color: Colors.textPrimary,
  },
  calendarMeta: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1,
  },
})
