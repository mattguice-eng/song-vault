import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { supabase } from '../src/lib/supabase'
import { useAuthStore } from '../src/store/authStore'

export default function RootLayout() {
  const { setSession, fetchProfile, setLoading } = useAuthStore()

  useEffect(() => {
    const isCallback = typeof window !== 'undefined' &&
      (window.location.pathname.includes('/callback') || window.location.pathname.includes('/calendar-callback'))

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isCallback) return // let callback.tsx handle it
      setSession(session)
      if (session?.user) {
        fetchProfile(session.user.id)
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (typeof window !== 'undefined' && window.location.pathname.includes('/callback')) return
        setSession(session)
        if (session?.user) {
          await fetchProfile(session.user.id)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="calendar-callback" />
      </Stack>
    </GestureHandlerRootView>
  )
}
