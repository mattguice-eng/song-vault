import { Tabs, Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../src/store/authStore'
import { Colors } from '../../src/utils/constants'

export default function AppLayout() {
  const { session, profile, activeArtist } = useAuthStore()

  if (!session) {
    return <Redirect href="/(auth)/login" />
  }

  const isManager = profile?.role === 'manager'
  const isWriter = profile?.role === 'writer'
  const isArtist = profile?.role === 'artist'

  // Manager hasn't picked an artist yet — only show Home + Profile
  const needsArtist = isManager && !activeArtist

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

      {/* Songs — hidden until artist is selected for managers */}
      {!needsArtist ? (
        <Tabs.Screen
          name="songs/index"
          options={{
            title: 'Songs',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="musical-notes-outline" size={size} color={color} />
            ),
          }}
        />
      ) : (
        <Tabs.Screen name="songs/index" options={{ href: null }} />
      )}

      {/* Playlists tab: managers (with artist) and artists only */}
      {!isWriter && !needsArtist ? (
        <Tabs.Screen
          name="playlists/index"
          options={{
            title: 'Playlists',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="list-outline" size={size} color={color} />
            ),
          }}
        />
      ) : (
        <Tabs.Screen name="playlists/index" options={{ href: null }} />
      )}

      {/* Artists — hidden, accessed from dashboard header */}
      <Tabs.Screen name="artists/index" options={{ href: null }} />

      {/* Writers tab: managers (with artist) and artists only */}
      {!isWriter && !needsArtist ? (
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

      {/* Publishers tab: managers (with artist) only */}
      {isManager && !needsArtist ? (
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
      <Tabs.Screen name="songs/export" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="artists/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="writers/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="playlists/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="playlists/new" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  )
}
