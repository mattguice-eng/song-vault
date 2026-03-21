import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import { Input } from '../../src/components/Input'
import { Button } from '../../src/components/Button'
import { Colors, Spacing, Fonts, Radius } from '../../src/utils/constants'
import { UserRole } from '../../src/types/database'

const ROLES: { value: UserRole; label: string; description: string; icon: string }[] = [
  {
    value: 'manager',
    label: 'Manager',
    description: 'Oversee multiple artists and their publishing deals',
    icon: 'briefcase-outline',
  },
  {
    value: 'artist',
    label: 'Artist',
    description: 'Log your songs, uploads, and track submissions',
    icon: 'mic-outline',
  },
  {
    value: 'writer',
    label: 'Songwriter',
    description: 'See and contribute to songs you\'re credited on',
    icon: 'pencil-outline',
  },
]

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<UserRole>('artist')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!fullName.trim()) newErrors.fullName = 'Full name is required'
    if (!email.trim()) newErrors.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Enter a valid email'
    if (!password) newErrors.password = 'Password is required'
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters'
    if (password !== confirmPassword) newErrors.confirmPassword = 'Passwords do not match'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleRegister = async () => {
    if (!validate()) return
    setLoading(true)
    console.log('Attempting signup for:', email)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role },
      },
    })
    console.log('Signup result — data:', JSON.stringify(data), 'error:', JSON.stringify(error))
    setLoading(false)
    if (error) {
      console.log('Signup error:', error.message)
      setErrors({ password: error.message })
      return
    }
    // If session is returned immediately, email confirmation is off — go straight to app
    if (data.session) {
      console.log('Session found, redirecting to dashboard')
      router.replace('/(app)/dashboard')
      return
    }
    // Otherwise show inline success message (email confirmation is on)
    console.log('No session, showing success message')
    setSuccess(true)
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.heading}>Create Account</Text>
        <Text style={styles.subheading}>Join Song Vault and never lose a song again.</Text>

        {/* Role Selector */}
        <Text style={styles.sectionLabel}>I am a...</Text>
        <View style={styles.roleRow}>
          {ROLES.map((r) => (
            <TouchableOpacity
              key={r.value}
              style={[styles.roleCard, role === r.value && styles.roleCardActive]}
              onPress={() => setRole(r.value)}
            >
              <Ionicons
                name={r.icon as any}
                size={24}
                color={role === r.value ? Colors.primary : Colors.textMuted}
              />
              <Text style={[styles.roleLabel, role === r.value && styles.roleLabelActive]}>
                {r.label}
              </Text>
              <Text style={styles.roleDescription}>{r.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Form */}
        <Input
          label="Full Name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          placeholder="Your name"
          error={errors.fullName}
        />
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email}
        />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          isPassword
          placeholder="Min. 8 characters"
          error={errors.password}
        />
        <Input
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          isPassword
          placeholder="Repeat password"
          error={errors.confirmPassword}
        />

        {success ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
            <Text style={styles.successText}>
              Account created! Check your email for a confirmation link, then sign in.
            </Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.footerLink}>Go to Sign In →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Button title="Create Account" onPress={handleRegister} loading={loading} />
        )}

        <TouchableOpacity
          style={styles.footer}
          onPress={() => router.replace('/(auth)/login')}
        >
          <Text style={styles.footerText}>
            Already have an account?{' '}
            <Text style={styles.footerLink}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: Spacing.lg,
    paddingTop: Spacing.xxl,
  },
  backButton: {
    marginBottom: Spacing.lg,
  },
  heading: {
    fontSize: Fonts.sizes.xxxl,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: Spacing.xs,
  },
  subheading: {
    fontSize: Fonts.sizes.md,
    color: Colors.textMuted,
    marginBottom: Spacing.xl,
  },
  sectionLabel: {
    fontSize: Fonts.sizes.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  roleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  roleCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.xs,
  },
  roleCardActive: {
    borderColor: Colors.primary,
    backgroundColor: `${Colors.primary}15`,
  },
  roleLabel: {
    fontSize: Fonts.sizes.md,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  roleLabelActive: {
    color: Colors.primary,
  },
  roleDescription: {
    fontSize: Fonts.sizes.xs,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  footer: {
    alignItems: 'center',
    marginTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  footerText: {
    color: Colors.textMuted,
    fontSize: Fonts.sizes.sm,
  },
  footerLink: {
    color: Colors.primary,
    fontWeight: '600',
  },
  successBox: {
    backgroundColor: `${Colors.success}15`,
    borderWidth: 1,
    borderColor: `${Colors.success}40`,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  successText: {
    color: Colors.success,
    fontSize: Fonts.sizes.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
})
