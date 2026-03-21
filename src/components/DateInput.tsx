import React from 'react'
import { View, Text, StyleSheet, Platform } from 'react-native'
import { Colors, Spacing, Fonts, Radius } from '../utils/constants'

interface DateInputProps {
  label?: string
  value: string // YYYY-MM-DD
  onChange: (date: string) => void
  placeholder?: string
  error?: string
  hint?: string
}

export function DateInput({ label, value, onChange, placeholder, error, hint }: DateInputProps) {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        {label && <Text style={styles.label}>{label}</Text>}
        <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
              flex: 1,
              height: 52,
              paddingLeft: 16,
              paddingRight: 16,
              fontSize: 15,
              color: value ? Colors.textPrimary : Colors.textMuted,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              colorScheme: 'dark',
              width: '100%',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            } as React.CSSProperties}
          />
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        {hint && !error && <Text style={styles.hintText}>{hint}</Text>}
      </View>
    )
  }

  // Native fallback — plain text input
  const { TextInput } = require('react-native')
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? 'YYYY-MM-DD'}
          placeholderTextColor={Colors.textMuted}
          keyboardType="numeric"
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      {hint && !error && <Text style={styles.hintText}>{hint}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: Fonts.sizes.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  inputError: {
    borderColor: Colors.error,
  },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: Spacing.md,
    fontSize: Fonts.sizes.md,
    color: Colors.textPrimary,
  },
  errorText: {
    fontSize: Fonts.sizes.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
  hintText: {
    fontSize: Fonts.sizes.xs,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
})
