import { useState } from 'react'
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useAuthStore } from '../../src/store/authStore'
import { Input } from '../../src/components/Input'
import { Button } from '../../src/components/Button'
import { Colors, Spacing, Fonts } from '../../src/utils/constants'

export default function SetPasswordScreen() {
  const { fetchProfile, session, setNeedsPasswordSetup } = useAuthStore()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSetPassword = async () => {
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      console.log('[set-password] updating user...')
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      if (!currentSession) throw new Error('No active session')

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/user`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.access_token}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
          },
          body: JSON.stringify({ password }),
        }
      )
      const result = await res.json()
      console.log('[set-password] update result:', res.status)
      if (!res.ok) throw new Error(result.msg || result.message || 'Failed to set password')
      console.log('[set-password] fetching profile...')
      if (session?.user) await fetchProfile(session.user.id)
      console.log('[set-password] done, navigating...')
      setNeedsPasswordSetup(false)
      router.replace('/(app)/dashboard')
    } catch (err: any) {
      console.error('[set-password] error:', err)
      setError(err.message ?? 'Failed to set password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Welcome to Song Vault</Text>
          <Text style={styles.subtitle}>Set a password to secure your account.</Text>
        </View>

        <Input
          label="New Password"
          value={password}
          onChangeText={setPassword}
          isPassword
          placeholder="At least 8 characters"
        />
        <Input
          label="Confirm Password"
          value={confirm}
          onChangeText={setConfirm}
          isPassword
          placeholder="Re-enter your password"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button title="Set Password & Enter" onPress={handleSetPassword} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { padding: Spacing.lg, paddingTop: Spacing.xxl, gap: Spacing.sm },
  header: { marginBottom: Spacing.xl, gap: Spacing.xs },
  title: { fontSize: Fonts.sizes.xxl, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: Fonts.sizes.md, color: Colors.textSecondary },
  error: { color: Colors.error, fontSize: Fonts.sizes.sm, marginBottom: Spacing.sm },
})
