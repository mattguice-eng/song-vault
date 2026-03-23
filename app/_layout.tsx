import { useEffect, useRef } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { supabase } from '../src/lib/supabase'
import { useAuthStore } from '../src/store/authStore'

export default function RootLayout() {
  const { setSession, fetchProfile, setLoading } = useAuthStore()
  const initializedRef = useRef(false) // tracks whether we've resolved the initial session

  useEffect(() => {
    const isCallback = typeof window !== 'undefined' &&
      (window.location.pathname.includes('/callback') || window.location.pathname.includes('/calendar-callback'))

    // Helper: apply session and fetch profile
    const applySession = async (session: any) => {
      setSession(session)
      if (session?.user) {
        await fetchProfile(session.user.id)
      }
      setLoading(false)
      initializedRef.current = true
    }

    // Listen for auth changes — this is the PRIMARY session source
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        try {
          if (isCallback && event !== 'SIGNED_OUT') return

          // INITIAL_SESSION: the definitive initial session from Supabase
          if (event === 'INITIAL_SESSION') {
            if (!session) {
              // No stored session — try refreshing in case there's a refresh token
              try {
                const { data: refreshData } = await supabase.auth.refreshSession()
                if (refreshData?.session) {
                  await applySession(refreshData.session)
                  return
                }
              } catch {
                // Refresh failed
              }
            }
            await applySession(session)
            return
          }

          // Token refreshes happen frequently — just update the token, don't refetch profile
          if (event === 'TOKEN_REFRESHED') {
            setSession(session)
            return
          }

          // Real auth changes: sign-in, sign-out, user update
          setSession(session)
          if (session?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
            await fetchProfile(session.user.id)
          }
          if (event === 'SIGNED_OUT') {
            setSession(null)
          }
          setLoading(false)
        } catch {
          // Auth state change handling failed — don't crash the app
          setLoading(false)
        }
      }
    )

    // Safety timeout: if INITIAL_SESSION never fires (shouldn't happen, but be safe), unblock after 5s
    const safetyTimeout = setTimeout(() => {
      if (!initializedRef.current) {
        console.warn('[auth] Safety timeout — INITIAL_SESSION never fired')
        setLoading(false)
        initializedRef.current = true
      }
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(safetyTimeout)
    }
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="calendar-callback" />
        <Stack.Screen name="listen/[slug]" />
      </Stack>
    </GestureHandlerRootView>
  )
}
