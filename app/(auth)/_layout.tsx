import { Stack } from 'expo-router'
import { Colors } from '../../src/utils/constants'

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'fade',
      }}
    />
  )
}
