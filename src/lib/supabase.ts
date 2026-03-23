import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// Use SecureStore on native, localStorage on web
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key)
    }
    return SecureStore.getItemAsync(key)
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value)
      return
    }
    SecureStore.setItemAsync(key, value)
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key)
      return
    }
    SecureStore.deleteItemAsync(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
})

/**
 * Retry a Supabase operation once if it fails with an auth error (JWT expired).
 * This handles the edge case where auto-refresh hasn't completed yet.
 */
export async function withAuthRetry<T>(
  operation: () => Promise<{ data: T; error: any }>
): Promise<{ data: T; error: any }> {
  const result = await operation()
  if (result.error && (
    result.error.message?.includes('JWT') ||
    result.error.message?.includes('token') ||
    result.error.code === 'PGRST301' ||
    result.error.status === 401
  )) {
    // Try refreshing the session and retry once
    const { error: refreshError } = await supabase.auth.refreshSession()
    if (!refreshError) {
      return operation()
    }
  }
  return result
}
