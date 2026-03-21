import { Tabs, Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../src/store/authStore'
import { Colors } from '../../src/utils/constants'

export default function AppLayout() {
  const { session, profile } = useAuthStore()

  if (!session) {
    return <Redirect href="/(auth)/login" />
  }

  const isManager = profile?.role === 'manager'
  const isWriter = profile?.role === 'writer'
  const isArtist = profile?.role === 'artist'

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: 4,
          height: 60,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="songs/index"
        options={{
          title: 'Songs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="musical-notes-outline" size={size} color={color} />
          ),
        }}
      />

      {/* Artists — hidden, accessed from dashboard header */}
      <Tabs.Screen name="artists/index" options={{ href: null }} />

      {/* Writers tab: managers and artists only */}
      {!isWriter ? (
        <Tabs.Screen
          name="writers/index"
          options={{
            title: 'Writers',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="pencil-outline" size={size} color={color} />
            ),
          }}
        />
      ) : (
        <Tabs.Screen name="writers/index" options={{ href: null }} />
      )}

      {/* Publishers tab: managers only */}
      {isManager ? (
        <Tabs.Screen
          name="publishers/index"
          options={{
            title: 'Publishers',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="business-outline" size={size} color={color} />
            ),
          }}
        />
      ) : (
        <Tabs.Screen name="publishers/index" options={{ href: null }} />
      )}

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />

      {/* Hidden screens (no tab bar entry) */}
      <Tabs.Screen name="songs/new" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="songs/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="songs/import" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="artists/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="writers/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  )
}
