import { useEffect } from 'react'
import { View, ActivityIndicator, Text } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useAuthStore } from '../../src/store/authStore'
import { Colors } from '../../src/utils/constants'

export default function AuthCallback() {
  const { setSession, fetchProfile, setLoading, setNeedsPasswordSetup } = useAuthStore()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Give Supabase client a moment to process the hash tokens
        await new Promise(resolve => setTimeout(resolve, 500))

        const { data: { session }, error } = await supabase.auth.getSession()
        console.log('[callback] session:', session?.user?.email, 'error:', error)

        if (session?.user) {
          setSession(session)
          await fetchProfile(session.user.id)
          setNeedsPasswordSetup(true)
          setLoading(false)
          router.replace('/(auth)/set-password')
          return
        }

        // No session — try listening for it
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, authSession) => {
            console.log('[callback] late event:', event)
            if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && authSession) {
              setSession(authSession)
              await fetchProfile(authSession.user.id)
              setNeedsPasswordSetup(true)
              setLoading(false)
              subscription.unsubscribe()
              router.replace('/(auth)/set-password')
            }
          }
        )

        // Timeout fallback
        setTimeout(() => {
          subscription.unsubscribe()
          setLoading(false)
          router.replace('/(auth)/login')
        }, 10000)

      } catch (err) {
        console.error('[callback] error:', err)
        setLoading(false)
        router.replace('/(auth)/login')
      }
    }

    handleCallback()
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <ActivityIndicator color={Colors.primary} size="large" />
      <Text style={{ color: Colors.textMuted, fontSize: 14 }}>Setting up your account…</Text>
    </View>
  )
}
