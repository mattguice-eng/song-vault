import { Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuthStore } from '../src/store/authStore'
import { Colors } from '../src/utils/constants'

export default function Index() {
  const { session, loading, needsPasswordSetup } = useAuthStore()

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    )
  }

  if (session && needsPasswordSetup) {
    return <Redirect href="/(auth)/set-password" />
  }

  if (session) {
    return <Redirect href="/(app)/dashboard" />
  }

  return <Redirect href="/(auth)/login" />
}
