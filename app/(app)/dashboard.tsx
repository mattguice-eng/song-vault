import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  FlatList,
  Image,
  Modal,
  TextInput,
} from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import { useAuthStore } from '../../src/store/authStore'
import { SongCard } from '../../src/components/SongCard'
import { SongWithDetails, Artist, PublishingDeal, Publisher, WriteSession } from '../../src/types/database'
import { Colors, Spacing, Fonts, Radius } from '../../src/utils/constants'
import { formatEventDate, formatEventTime } from '../../src/lib/google-calendar'

interface Stats {
  totalCatalog: number       // all songs for this artist ever
  totalDeal: number          // unique songs within current deal period (co-writes count as 1)
  toSubmit: number           // songs in deal not yet submitted
  needsAttention: number
}

interface DealWithPublisher extends PublishingDeal {
  publisher: Publisher
}

const PERIOD_LABELS: Record<string, string> = {
  initial: 'Initial Period',
  option_1: 'Option 1',
  option_2: 'Option 2',
}

export default function DashboardScreen() {
  const { artistId: routeArtistId } = useLocalSearchParams<{ artistId?: string }>()
  const { profile, activeArtist, setActiveArtist, songwriterProfile } = useAuthStore()
  const [songs, setSongs] = useState<SongWithDetails[]>([])
  const [artists, setArtists] = useState<Artist[]>([])
  const [activeDeals, setActiveDeals] = useState<DealWithPublisher[]>([])
  const [artistRecord, setArtistRecord] = useState<Artist | null>(null)
  const [stats, setStats] = useState<Stats>({ totalCatalog: 0, totalDeal: 0, toSubmit: 0, needsAttention: 0 })
  const [writeSessions, setWriteSessions] = useState<WriteSession[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showAllUnlogged, setShowAllUnlogged] = useState(false)
  const [syncingFromDashboard, setSyncingFromDashboard] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)

  // Calendar review modal state
  interface PreviewEvent {
    calendar_event_id: string
    raw_title: string
    event_date: string
    start_time: string | null
    end_time: string | null
    location: string | null
    attendees: { name: string | null; email: string }[]
    parsed_cowriters: string[]
    is_past: boolean
    likely_write: boolean
    previously_dismissed: boolean
  }
  const [reviewModalVisible, setReviewModalVisible] = useState(false)
  const [previewEvents, setPreviewEvents] = useState<PreviewEvent[]>([])
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set())
  const [cancelledSessions, setCancelledSessions] = useState<{ id: string; raw_title: string; event_date: string; parsed_cowriters: string[] }[]>([])
  const [importingEvents, setImportingEvents] = useState(false)

  // Link write to existing song
  const [linkModalVisible, setLinkModalVisible] = useState(false)
  const [linkingWriteSession, setLinkingWriteSession] = useState<WriteSession | null>(null)
  const [linkSearch, setLinkSearch] = useState('')

  const isManager = profile?.role === 'manager'
  const isWriter = profile?.role === 'writer'
  const isArtist = profile?.role === 'artist'

  // Fetch artists list for manager picker
  useEffect(() => {
    if (isManager) fetchArtists()
  }, [profile])

  // If returning from artist admin page with an artistId param, restore that artist
  useEffect(() => {
    if (routeArtistId && isManager && artists.length > 0 && activeArtist?.id !== routeArtistId) {
      const match = artists.find(a => a.id === routeArtistId)
      if (match) setActiveArtist(match)
    }
  }, [routeArtistId, artists])

  const fetchArtists = async () => {
    const { data } = await supabase
      .from('artists')
      .select('*')
      .eq('manager_id', profile!.id)
      .order('stage_name')
    setArtists((data ?? []) as Artist[])
  }

  // Refetch every time this screen comes into focus (catches status changes from song detail)
  useFocusEffect(
    useCallback(() => {
      fetchData()
    }, [profile?.id, activeArtist?.id])
  )

  const fetchData = async () => {
    if (!profile) return
    try {
      // ── Writer: fetch all credited songs (RLS handles the filter) ──────────
      if (isWriter) {
        const { data, error } = await supabase
          .from('songs')
          .select(`*, cowriters(*), files:song_files(*), artist:artists(id, stage_name, real_name)`)
          .order('date_written', { ascending: false })
          .limit(50)

        if (error) throw error

        const songList = (data ?? []) as SongWithDetails[]
        setSongs(songList)
        setActiveDeals([]) // writers don't see deal progress on dashboard

        setStats({
          totalCatalog: songList.length,
          totalDeal: 0,
          toSubmit: songList.filter(s => s.status !== 'submitted' && s.status !== 'complete').length,
          needsAttention: 0,
        })
        setLoading(false)
        setRefreshing(false)
        return
      }

      let artistId: string | null = null

      if (isManager) {
        if (!activeArtist) {
          // No artist selected yet — show empty
          setSongs([])
          setStats({ totalCatalog: 0, totalDeal: 0, toSubmit: 0, needsAttention: 0 })
          setCalendarConnected(false)
          setLoading(false)
          setRefreshing(false)
          return
        }
        artistId = activeArtist.id
        setCalendarConnected(!!activeArtist.google_refresh_token)
      } else {
        // Artist: find their own artist record
        const { data: artistData } = await supabase
          .from('artists')
          .select('*')
          .eq('user_id', profile!.id)
          .single()
        artistId = artistData?.id ?? null
        if (artistData) {
          setArtistRecord(artistData as Artist)
          setCalendarConnected(!!(artistData as any).google_refresh_token)
        }
      }

      if (!artistId) {
        setLoading(false)
        setRefreshing(false)
        return
      }

      const [songsRes, dealsRes, writeSessionsRes] = await Promise.all([
        supabase
          .from('songs')
          .select(`*, cowriters(*), files:song_files(*), artist:artists(id, stage_name, real_name)`)
          .eq('artist_id', artistId)
          .order('date_written', { ascending: false }),
        supabase
          .from('publishing_deals')
          .select('*, publisher:publishers(*)')
          .eq('artist_id', artistId)
          .eq('is_active', true)
          .order('start_date', { ascending: false }),
        supabase
          .from('write_sessions')
          .select('*')
          .eq('artist_id', artistId)
          .in('status', ['upcoming', 'past'])
          .order('event_date', { ascending: true }),
      ])

      if (songsRes.error) throw songsRes.error

      const songList = (songsRes.data ?? []) as SongWithDetails[]
      const dealList = (dealsRes.data ?? []) as DealWithPublisher[]
      setSongs(songList)
      setActiveDeals(dealList)
      setWriteSessions((writeSessionsRes.data ?? []) as WriteSession[])

      // Stats: Total Catalog, Total This Deal, Delivered This Deal Period
      const activeDeal = dealList[0] ?? null
      const dealStart = activeDeal?.start_date ? new Date(activeDeal.start_date + 'T00:00:00') : null
      const dealEnd = activeDeal?.end_date ? new Date(activeDeal.end_date + 'T23:59:59') : null
      const dealSongs = activeDeal
        ? songList.filter((s) => {
            if (s.publishing_deal_id === activeDeal.id) return true
            const written = new Date(s.date_written + 'T12:00:00')
            if (dealStart && written < dealStart) return false
            if (dealEnd && written > dealEnd) return false
            return dealStart != null
          })
        : []

      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      setStats({
        totalCatalog: songList.length,
        totalDeal: dealSongs.length,
        toSubmit: dealSongs.filter((s) => s.status !== 'submitted').length,
        needsAttention: dealSongs.filter(
          (s) => s.status === 'logged' && new Date(s.created_at) < sevenDaysAgo
        ).length,
      })
    } catch (err) {
      console.error('Dashboard fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = () => {
    setRefreshing(true)
    fetchData()
  }

  // ─── Waterfall deal progress ─────────────────────────────────────────────
  // Rules:
  //  1. Songs within a deal's date range always count toward that deal.
  //  2. If a deal has ENDED and its minimum isn't met, songs written in a
  //     later period overflow back to fill it before counting toward later deals.
  //  3. Active (not yet ended) deals never receive overflow — wait until the
  //     term closes before applying the waterfall so mid-entry data doesn't mislead.
  const computeDealProgress = () => {
    const today = new Date()
    const currentArtist = activeArtist ?? artistRecord
    const artistName = (currentArtist?.real_name ?? currentArtist?.stage_name ?? '').toLowerCase()
    const altName   = (currentArtist?.stage_name ?? '').toLowerCase()
    const altName2  = (currentArtist?.real_name  ?? '').toLowerCase()

    const getShare = (s: any) => {
      const cw = s.cowriters?.find((c: any) =>
        c.name.toLowerCase() === artistName ||
        c.name.toLowerCase() === altName    ||
        c.name.toLowerCase() === altName2
      )
      return cw ? cw.split_percentage / 100 : 0
    }

    // Sort deals oldest-first; sort songs oldest-first
    const sortedDeals = [...activeDeals].sort(
      (a, b) => new Date(a.start_date + 'T00:00:00').getTime() - new Date(b.start_date + 'T00:00:00').getTime()
    )
    const sortedSongs = [...songs].sort(
      (a, b) => new Date(a.date_written + 'T12:00:00').getTime() - new Date(b.date_written + 'T12:00:00').getTime()
    )

    const delivered:  Record<string, number> = {}
    const overflow:   Record<string, number> = {}
    sortedDeals.forEach(d => { delivered[d.id] = 0; overflow[d.id] = 0 })

    for (const s of sortedSongs) {
      const share = getShare(s)
      if (share === 0) continue

      const songDate = new Date(s.date_written + 'T12:00:00')

      // Find the "natural" deal index — the deal whose range contains this song
      let naturalIdx = -1
      for (let i = 0; i < sortedDeals.length; i++) {
        const d = sortedDeals[i]
        const start = d.start_date ? new Date(d.start_date + 'T00:00:00') : null
        const end   = d.end_date   ? new Date(d.end_date   + 'T23:59:59') : null
        if (start && songDate >= start && (!end || songDate <= end)) { naturalIdx = i; break }
      }
      // Song after all deal end dates → belongs to the last deal
      if (naturalIdx === -1) {
        const lastStart = sortedDeals.length
          ? new Date(sortedDeals[sortedDeals.length - 1].start_date + 'T00:00:00')
          : null
        if (lastStart && songDate >= lastStart) naturalIdx = sortedDeals.length - 1
      }
      if (naturalIdx === -1) continue // before any deal — skip

      // Walk from oldest deal up to natural deal, find earliest unmet ENDED deal
      let assigned = false
      for (let i = 0; i <= naturalIdx; i++) {
        const d = sortedDeals[i]
        if (i < naturalIdx) {
          // Only overflow here if this deal has already ended and still needs songs
          const end = d.end_date ? new Date(d.end_date + 'T23:59:59') : null
          const hasEnded = end ? end < today : false
          if (hasEnded && (d.min_delivery ?? 0) > 0 && delivered[d.id] < (d.min_delivery ?? 0)) {
            delivered[d.id] += share
            overflow[d.id]  += share
            assigned = true
            break
          }
        } else {
          // Natural deal — always assign here
          delivered[d.id] += share
          assigned = true
        }
      }
      if (!assigned && naturalIdx >= 0) delivered[sortedDeals[naturalIdx].id] += share
    }

    return { delivered, overflow, sortedDeals }
  }

  const renderDealProgress = () => {
    const { delivered: deliveredMap, overflow: overflowMap } = computeDealProgress()
    const today = new Date()

    // Sort oldest first, filter out fulfilled + expired deals
    const sortedDealsForDisplay = [...activeDeals]
      .sort((a, b) => new Date(a.start_date + 'T00:00:00').getTime() - new Date(b.start_date + 'T00:00:00').getTime())
      .filter(deal => {
        const delivered = deliveredMap[deal.id] ?? 0
        const total = deal.min_delivery ?? 0
        const hasTarget = total > 0
        const isFulfilled = hasTarget && delivered >= total
        const endDate = deal.end_date ? new Date(deal.end_date + 'T23:59:59') : null
        const isExpired = endDate ? endDate < today : false
        // Hide if both fulfilled AND past end date
        if (isFulfilled && isExpired) return false
        return true
      })

    return sortedDealsForDisplay.map(deal => {
      const delivered = deliveredMap[deal.id] ?? 0
      const overflowCount = overflowMap[deal.id] ?? 0
      const total = deal.min_delivery ?? 0
      const hasTarget = total > 0
      const pct = hasTarget ? Math.min(1, delivered / total) : 0
      const progressColor =
        !hasTarget ? Colors.primary :
        pct >= 0.8 ? Colors.success :
        pct >= 0.5 ? Colors.warning : Colors.error
      const periodLabel = deal.period_type ? PERIOD_LABELS[deal.period_type] : null

      return (
        <View key={deal.id} style={styles.dealProgress}>
          <View style={styles.dealProgressHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dealPublisher}>{deal.publisher?.name}</Text>
              {periodLabel && (
                <Text style={styles.dealPeriod}>{periodLabel}</Text>
              )}
              {overflowCount > 0 && (
                <Text style={styles.dealOverflow}>
                  incl. {overflowCount % 1 === 0 ? overflowCount.toFixed(0) : overflowCount.toFixed(3)} overflow
                </Text>
              )}
            </View>
            <Text style={[styles.dealCount, { color: progressColor }]}>
              {delivered % 1 === 0 ? delivered.toFixed(0) : delivered.toFixed(3)}
              {hasTarget ? ` / ${total % 1 === 0 ? total.toFixed(0) : total.toFixed(3)}` : ''} songs
            </Text>
          </View>
          {hasTarget && (
            <View style={styles.dealTrack}>
              <View style={[styles.dealFill, {
                width: `${pct * 100}%` as any,
                minWidth: pct > 0 ? 6 : 0,
                backgroundColor: progressColor,
              }]} />
            </View>
          )}
        </View>
      )
    })
  }

  // ─── Write Sessions ──────────────────────────────────────────────────────
  const upcomingWrites = writeSessions.filter((w) => w.status === 'upcoming')
  const pastWrites = writeSessions.filter((w) => w.status === 'past')

  const handleDashboardSync = async () => {
    const artistId = activeArtist?.id ?? artistRecord?.id
    if (!artistId) return
    setSyncingFromDashboard(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('sync-calendar', {
        body: { action: 'preview', artist_id: artistId },
      })
      if (fnError) throw new Error(fnError.message)
      const events: PreviewEvent[] = data?.events ?? []
      const cancelled = data?.cancelled ?? []

      if (events.length === 0 && cancelled.length === 0) {
        // No new events — just refresh data
        await fetchData()
        return
      }
      setPreviewEvents(events)
      setCancelledSessions(cancelled)
      setSelectedEventIds(new Set(
        events.filter(e => e.likely_write && !e.previously_dismissed).map(e => e.calendar_event_id)
      ))
      setReviewModalVisible(true)
    } catch (err: any) {
      console.error('[dashboard-sync] error:', err)
    } finally {
      setSyncingFromDashboard(false)
    }
  }

  const toggleSyncEventSelection = (eventId: string) => {
    setSelectedEventIds(prev => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  const handleDashboardImport = async () => {
    const artistId = activeArtist?.id ?? artistRecord?.id
    if (!artistId) return
    setImportingEvents(true)
    try {
      const selectedEvents = previewEvents.filter(e => selectedEventIds.has(e.calendar_event_id))
      const dismissedEvents = previewEvents.filter(e => !selectedEventIds.has(e.calendar_event_id))
      const { error: fnError } = await supabase.functions.invoke('sync-calendar', {
        body: {
          action: 'import',
          artist_id: artistId,
          selected_events: selectedEvents,
          dismissed_events: dismissedEvents,
          delete_session_ids: cancelledSessions.map(s => s.id),
        },
      })
      if (fnError) throw new Error(fnError.message)
      setReviewModalVisible(false)
      await fetchData()
    } catch (err: any) {
      console.error('[dashboard-import] error:', err)
    } finally {
      setImportingEvents(false)
    }
  }

  const handleLinkWrite = (ws: WriteSession) => {
    setLinkingWriteSession(ws)
    setLinkSearch('')
    setLinkModalVisible(true)
  }

  const handleLinkToSong = async (songId: string) => {
    if (!linkingWriteSession) return
    await supabase
      .from('write_sessions')
      .update({ song_id: songId, status: 'logged' })
      .eq('id', linkingWriteSession.id)
    setLinkModalVisible(false)
    setLinkingWriteSession(null)
    // Remove from local state immediately
    setWriteSessions(prev => prev.filter(w => w.id !== linkingWriteSession.id))
  }

  const filteredLinkSongs = songs.filter(s => {
    if (!linkSearch.trim()) return true
    const q = linkSearch.toLowerCase()
    return s.title.toLowerCase().includes(q) ||
      s.cowriters?.some((c: any) => c.name?.toLowerCase().includes(q))
  })

  const handleDismissWrite = async (writeId: string) => {
    // Remove from local state immediately
    setWriteSessions(prev => prev.filter(w => w.id !== writeId))
    // Delete from database
    await supabase.from('write_sessions').delete().eq('id', writeId)
  }

  const handleLogFromWrite = (ws: WriteSession) => {
    // Navigate to new song form with pre-fill params
    router.push({
      pathname: '/(app)/songs/new',
      params: {
        from_write_session: ws.id,
        prefill_date: ws.event_date,
        prefill_cowriters: JSON.stringify(ws.parsed_cowriters),
        prefill_location: ws.location ?? '',
      },
    })
  }

  const renderWriteSessions = () => (
    <>
      {/* Upcoming Writes */}
      {upcomingWrites.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Writes</Text>
            {calendarConnected && (
              <TouchableOpacity
                style={styles.dashboardSyncBtn}
                onPress={handleDashboardSync}
                disabled={syncingFromDashboard}
              >
                {syncingFromDashboard ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <>
                    <Ionicons name="sync-outline" size={12} color={Colors.primary} />
                    <Text style={styles.dashboardSyncText}>Sync</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
          {upcomingWrites.slice(0, 5).map((ws) => (
            <View key={ws.id} style={styles.writeCard}>
              <View style={styles.writeCardDate}>
                <Ionicons name="calendar-outline" size={14} color={Colors.primary} />
                <Text style={styles.writeCardDateText}>{formatEventDate(ws.event_date)}</Text>
                {ws.start_time && (
                  <Text style={styles.writeCardTime}>
                    {formatEventTime(ws.start_time)}
                    {ws.end_time ? ` – ${formatEventTime(ws.end_time)}` : ''}
                  </Text>
                )}
              </View>
              <Text style={styles.writeCardWriters} numberOfLines={1}>
                {ws.parsed_cowriters.length > 0
                  ? ws.parsed_cowriters.join(', ')
                  : ws.raw_title}
              </Text>
              {ws.location && (
                <View style={styles.writeCardLocation}>
                  <Ionicons name="location-outline" size={12} color={Colors.textMuted} />
                  <Text style={styles.writeCardLocationText} numberOfLines={1}>{ws.location}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Past Writes (Unlogged) — contained */}
      {pastWrites.length > 0 && (
        <View style={styles.unloggedContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Unlogged Writes</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <View style={styles.unloggedBadge}>
                <Text style={styles.unloggedBadgeText}>{pastWrites.length}</Text>
              </View>
              {calendarConnected && (
                <TouchableOpacity
                  style={styles.dashboardSyncBtn}
                  onPress={handleDashboardSync}
                  disabled={syncingFromDashboard}
                >
                  {syncingFromDashboard ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="sync-outline" size={12} color={Colors.primary} />
                      <Text style={styles.dashboardSyncText}>Sync</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
          {(showAllUnlogged ? pastWrites : pastWrites.slice(0, 3)).map((ws) => (
            <View key={ws.id} style={styles.writeCard}>
              <View style={styles.writeCardTop}>
                <View style={{ flex: 1 }}>
                  <View style={styles.writeCardDate}>
                    <Ionicons name="calendar-outline" size={14} color={Colors.warning} />
                    <Text style={styles.writeCardDateText}>{formatEventDate(ws.event_date)}</Text>
                  </View>
                  <Text style={styles.writeCardWriters} numberOfLines={1}>
                    {ws.parsed_cowriters.length > 0
                      ? ws.parsed_cowriters.join(', ')
                      : ws.raw_title}
                  </Text>
                  {ws.location && (
                    <View style={styles.writeCardLocation}>
                      <Ionicons name="location-outline" size={12} color={Colors.textMuted} />
                      <Text style={styles.writeCardLocationText} numberOfLines={1}>{ws.location}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.writeCardActions}>
                  <TouchableOpacity
                    style={styles.writeLinkBtn}
                    onPress={() => handleLinkWrite(ws)}
                  >
                    <Ionicons name="link-outline" size={14} color={Colors.primary} />
                    <Text style={styles.writeLinkBtnText}>Link</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.writeLogBtn}
                    onPress={() => handleLogFromWrite(ws)}
                  >
                    <Ionicons name="add-circle-outline" size={14} color="#fff" />
                    <Text style={styles.writeLogBtnText}>Log</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.writeDismissBtn}
                    onPress={() => handleDismissWrite(ws.id)}
                  >
                    <Ionicons name="close" size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          {pastWrites.length > 3 && (
            <TouchableOpacity
              style={styles.showMoreBtn}
              onPress={() => setShowAllUnlogged(!showAllUnlogged)}
            >
              <Text style={styles.showMoreText}>
                {showAllUnlogged ? 'Show less' : `Show ${pastWrites.length - 3} more`}
              </Text>
              <Ionicons name={showAllUnlogged ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </>
  )

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  // ─── Manager: no artist selected → show artist picker ───────────────────────
  if (isManager && !activeArtist) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.pickerHeader}>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.name}>{profile?.full_name?.split(' ')[0] ?? 'there'} 👋</Text>
          <Text style={styles.pickerSubtitle}>Select an artist to view their songs</Text>
        </View>

        {/* Add Artist button */}
        <TouchableOpacity
          style={styles.addArtistButton}
          onPress={() => router.push('/(app)/artists')}
        >
          <Ionicons name="person-add-outline" size={16} color={Colors.primary} />
          <Text style={styles.addArtistText}>Add Artist</Text>
        </TouchableOpacity>

        {artists.length === 0 ? (
          <View style={styles.noArtists}>
            <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.noArtistsTitle}>No artists yet</Text>
            <Text style={styles.noArtistsSubtitle}>
              Add your first artist to get started
            </Text>
          </View>
        ) : (
          <FlatList
            data={artists}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.artistPickerList}
            renderItem={({ item }) => (
              <View style={styles.artistPickerCard}>
                <TouchableOpacity
                  style={styles.artistPickerMain}
                  onPress={() => setActiveArtist(item)}
                >
                  <View style={styles.artistPickerAvatar}>
                    {item.avatar_url ? (
                      <Image source={{ uri: item.avatar_url }} style={styles.artistPickerAvatarImg} />
                    ) : (
                      <Text style={styles.artistPickerInitial}>
                        {item.stage_name.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={styles.artistPickerInfo}>
                    <Text style={styles.artistPickerName}>{item.stage_name}</Text>
                    {item.real_name && (
                      <Text style={styles.artistPickerRealName}>{item.real_name}</Text>
                    )}
                    {!item.user_id && (
                      <Text style={styles.artistPickerNoAccess}>
                        {item.invite_sent_at ? 'Invite pending' : 'No portal access'}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.artistPickerManage}
                  onPress={() => router.push({ pathname: '/(app)/artists/[id]', params: { id: item.id, from: 'home' } })}
                >
                  <Ionicons name="settings-outline" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    )
  }

  // ── Artist / Writer portal view ─────────────────────────────────────────
  if (isArtist || isWriter) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.artistHeaderRow}>
                {isArtist && artistRecord && (
                  <View style={styles.artistProfilePic}>
                    {artistRecord.avatar_url ? (
                      <Image source={{ uri: artistRecord.avatar_url }} style={styles.artistProfilePicImg} />
                    ) : (
                      <Text style={styles.artistProfilePicInitial}>
                        {artistRecord.stage_name.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                )}
                <View>
                  <Text style={styles.greeting}>{greeting()},</Text>
                  <Text style={styles.name}>{profile?.full_name?.split(' ')[0] ?? 'there'} 👋</Text>
                  {artistRecord && (
                    <Text style={styles.artistSubline}>{artistRecord.stage_name}</Text>
                  )}
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={styles.newSongButton}
              onPress={() => router.push('/(app)/songs/new')}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.newSongText}>New Song</Text>
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{stats.totalCatalog}</Text>
              <Text style={styles.statLabel}>Total Catalog</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNumber, { color: Colors.statusWorkTape }]}>{stats.totalDeal}</Text>
              <Text style={styles.statLabel}>Songs This{'\n'}Deal Period</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNumber, { color: Colors.statusSubmitted }]}>{stats.deliveredDeal}</Text>
              <Text style={styles.statLabel}>Delivered</Text>
            </View>
          </View>

          {/* Deal Progress */}
          {activeDeals.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Deal Progress</Text>
              </View>
              {renderDealProgress()}
            </View>
          )}

          {/* Write Sessions */}
          {writeSessions.length > 0 && renderWriteSessions()}

          {/* Recent Songs */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Songs</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/songs')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            {songs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="musical-notes-outline" size={48} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>No songs yet</Text>
                <Text style={styles.emptySubtitle}>Tap "New Song" to log your first song.</Text>
                <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/(app)/songs/new')}>
                  <Text style={styles.emptyButtonText}>Log a Song</Text>
                </TouchableOpacity>
              </View>
            ) : (
              songs.slice(0, 10).map((song) => (
                <SongCard
                  key={song.id}
                  song={song}
                  showArtist={false}
                  onPress={() => router.push({ pathname: '/(app)/songs/[id]', params: { id: song.id, from: 'home' } })}
                  artistName={artistRecord?.real_name ?? artistRecord?.stage_name}
                />
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {isManager ? (
              <TouchableOpacity onPress={() => setActiveArtist(null)} style={styles.artistSwitcher}>
                <Ionicons name="chevron-back" size={16} color={Colors.primary} />
                <Text style={styles.artistSwitcherText}>Switch Artist</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.greeting}>{greeting()},</Text>
            )}
            <View style={styles.nameRow}>
              {isManager && activeArtist && (
                <View style={styles.headerAvatar}>
                  {activeArtist.avatar_url ? (
                    <Image source={{ uri: activeArtist.avatar_url }} style={styles.headerAvatarImg} />
                  ) : (
                    <Text style={styles.headerAvatarInitial}>
                      {activeArtist.stage_name.charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
              )}
              <Text style={styles.name}>
                {isManager
                  ? activeArtist?.stage_name ?? ''
                  : profile?.full_name?.split(' ')[0] ?? 'there'} 👋
              </Text>
            </View>
            {isWriter && songwriterProfile && (
              <Text style={styles.writerSubline}>
                {songwriterProfile.pro ? `${songwriterProfile.pro} · ` : ''}
                {songwriterProfile.ipi_number ? `IPI ${songwriterProfile.ipi_number}` : 'Songwriter'}
              </Text>
            )}
          </View>
          <View style={styles.headerActions}>
            {isManager && activeArtist && (
              <TouchableOpacity
                style={styles.manageButton}
                onPress={() => router.push({ pathname: '/(app)/artists/[id]', params: { id: activeArtist.id, from: 'home' } })}
              >
                <Ionicons name="settings-outline" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
            {!isWriter && (
              <TouchableOpacity
                style={styles.newSongButton}
                onPress={() => router.push('/(app)/songs/new')}
              >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.newSongText}>New Song</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Attention Banner */}
        {stats.needsAttention > 0 && (
          <TouchableOpacity
            style={styles.attentionBanner}
            onPress={() => router.push('/(app)/songs/index')}
          >
            <Ionicons name="warning-outline" size={18} color={Colors.warning} />
            <Text style={styles.attentionText}>
              {stats.needsAttention} song{stats.needsAttention !== 1 ? 's' : ''} logged over a
              week ago with no files attached
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.warning} />
          </TouchableOpacity>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.totalCatalog}</Text>
            <Text style={styles.statLabel}>Total Catalog</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: Colors.statusWorkTape }]}>
              {stats.totalDeal}
            </Text>
            <Text style={styles.statLabel}>Songs This{'\n'}Deal Period</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: Colors.warning }]}>
              {stats.toSubmit}
            </Text>
            <Text style={styles.statLabel}>To Submit</Text>
          </View>
        </View>

        {/* Active Deal Progress — above write sessions */}
        {activeDeals.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Deal Progress</Text>
              {isManager && (
                <TouchableOpacity onPress={() => router.push(`/(app)/artists/${activeArtist?.id}`)}>
                  <Text style={styles.seeAll}>Manage deals</Text>
                </TouchableOpacity>
              )}
            </View>
            {renderDealProgress()}
          </View>
        )}

        {/* Write Sessions — contained */}
        {writeSessions.length > 0 && renderWriteSessions()}

        {/* Calendar sync button when connected but no sessions yet */}
        {calendarConnected && writeSessions.length === 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.standaloneSyncBtn}
              onPress={handleDashboardSync}
              disabled={syncingFromDashboard}
            >
              {syncingFromDashboard ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Ionicons name="sync-outline" size={16} color={Colors.primary} />
                  <Text style={styles.standaloneSyncText}>Sync Calendar</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Recent Songs */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{isWriter ? 'My Credits' : 'Recent Songs'}</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/songs')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>

          {songs.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="musical-notes-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No songs yet</Text>
              {isWriter ? (
                <Text style={styles.emptySubtitle}>
                  Songs you're credited on will appear here once your profile is linked to your songwriter entry.
                </Text>
              ) : (
                <>
                  <Text style={styles.emptySubtitle}>
                    Tap "New Song" to log the first song for {isManager ? activeArtist?.stage_name : 'yourself'}.
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyButton}
                    onPress={() => router.push('/(app)/songs/new')}
                  >
                    <Text style={styles.emptyButtonText}>Log a Song</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            songs.slice(0, 10).map((song) => (
              <SongCard
                key={song.id}
                song={song}
                showArtist={false}
                onPress={() => router.push({ pathname: '/(app)/songs/[id]', params: { id: song.id, from: 'home' } })}
                artistName={activeArtist?.real_name ?? activeArtist?.stage_name}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Link Write to Song Modal */}
      <Modal visible={linkModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLinkModalVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.reviewHeader}>
            <View>
              <Text style={styles.reviewHeaderTitle}>Link to Song</Text>
              {linkingWriteSession && (
                <Text style={{ fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 }}>
                  {formatEventDate(linkingWriteSession.event_date)} · {linkingWriteSession.parsed_cowriters.length > 0
                    ? linkingWriteSession.parsed_cowriters.join(', ')
                    : linkingWriteSession.raw_title}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setLinkModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm }}>
            <TextInput
              style={styles.linkSearchInput}
              placeholder="Search songs..."
              placeholderTextColor={Colors.textMuted}
              value={linkSearch}
              onChangeText={setLinkSearch}
              autoFocus
            />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl }}>
            {filteredLinkSongs.length === 0 ? (
              <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                <Text style={{ color: Colors.textMuted }}>No songs found</Text>
              </View>
            ) : (
              filteredLinkSongs.map((song) => (
                <TouchableOpacity
                  key={song.id}
                  style={styles.linkSongCard}
                  onPress={() => handleLinkToSong(song.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.linkSongTitle} numberOfLines={1}>{song.title}</Text>
                    <Text style={styles.linkSongMeta}>
                      {new Date(song.date_written + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {song.cowriters && song.cowriters.length > 0
                        ? ` · ${song.cowriters.map((c: any) => c.name).join(', ')}`
                        : ''}
                    </Text>
                  </View>
                  <Ionicons name="link" size={18} color={Colors.primary} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Calendar Review Modal */}
      <Modal visible={reviewModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setReviewModalVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewHeaderTitle}>Review Calendar Events</Text>
            <TouchableOpacity onPress={() => setReviewModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm }}>
            <Text style={{ fontSize: Fonts.sizes.sm, color: Colors.textMuted }}>
              {selectedEventIds.size} of {previewEvents.length} selected
            </Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: 100 }}>
            {/* Cancelled sessions */}
            {cancelledSessions.length > 0 && (
              <View style={{ marginBottom: Spacing.md }}>
                <Text style={{ fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.error, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm }}>
                  Cancelled — will be removed
                </Text>
                {cancelledSessions.map((cs) => (
                  <View key={cs.id} style={[styles.reviewCard, { borderColor: Colors.error, opacity: 0.7 }]}>
                    <Ionicons name="close-circle" size={22} color={Colors.error} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reviewCardTitle, { textDecorationLine: 'line-through' }]} numberOfLines={1}>{cs.raw_title}</Text>
                      <Text style={styles.reviewCardMeta}>
                        {new Date(cs.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {cs.parsed_cowriters?.length > 0 ? ` · ${cs.parsed_cowriters.join(', ')}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setCancelledSessions(prev => prev.filter(c => c.id !== cs.id))} hitSlop={8}>
                      <Ionicons name="close" size={20} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {previewEvents.map((event) => {
              const isSelected = selectedEventIds.has(event.calendar_event_id)
              const dateStr = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const timeStr = event.start_time
                ? new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : ''
              return (
                <TouchableOpacity
                  key={event.calendar_event_id}
                  style={[styles.reviewCard, isSelected && styles.reviewCardSelected]}
                  onPress={() => toggleSyncEventSelection(event.calendar_event_id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? Colors.primary : Colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewCardTitle} numberOfLines={2}>{event.raw_title}</Text>
                    <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: 3 }}>
                      <Text style={styles.reviewCardMeta}>{dateStr}{timeStr ? ` · ${timeStr}` : ''}</Text>
                      {event.likely_write && !event.previously_dismissed && (
                        <View style={styles.reviewLikelyBadge}>
                          <Text style={styles.reviewLikelyText}>Likely Write</Text>
                        </View>
                      )}
                      {event.previously_dismissed && (
                        <View style={styles.reviewSkippedBadge}>
                          <Text style={styles.reviewSkippedText}>Skipped</Text>
                        </View>
                      )}
                    </View>
                    {event.parsed_cowriters.length > 0 && (
                      <Text style={styles.reviewCardCowriters}>
                        {event.parsed_cowriters.join(', ')}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
          <View style={styles.reviewImportFooter}>
            <TouchableOpacity
              style={[styles.reviewImportBtn, (importingEvents || (selectedEventIds.size === 0 && cancelledSessions.length === 0)) && { opacity: 0.5 }]}
              onPress={handleDashboardImport}
              disabled={importingEvents || (selectedEventIds.size === 0 && cancelledSessions.length === 0)}
            >
              {importingEvents ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.reviewImportBtnText}>
                  {selectedEventIds.size > 0
                    ? `Import ${selectedEventIds.size} Event${selectedEventIds.size !== 1 ? 's' : ''}${cancelledSessions.length > 0 ? ` & Remove ${cancelledSessions.length}` : ''}`
                    : cancelledSessions.length > 0
                      ? `Remove ${cancelledSessions.length} Cancelled`
                      : 'Import 0 Events'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },

  // Artist picker styles
  pickerHeader: { padding: Spacing.lg, paddingBottom: Spacing.md },
  pickerSubtitle: { fontSize: Fonts.sizes.md, color: Colors.textMuted, marginTop: Spacing.xs },
  artistPickerList: { padding: Spacing.lg, paddingTop: 0, gap: Spacing.sm },
  addArtistButton: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    alignSelf: 'flex-end', marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.primary,
    backgroundColor: `${Colors.primary}10`,
  },
  addArtistText: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.primary },
  artistPickerCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  artistPickerMain: {
    flexDirection: 'row', alignItems: 'center',
    flex: 1, padding: Spacing.md, gap: Spacing.md,
  },
  artistPickerManage: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderLeftWidth: 1, borderLeftColor: Colors.border,
  },
  artistPickerNoAccess: { fontSize: Fonts.sizes.xs, color: Colors.warning, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  manageButton: {
    width: 36, height: 36, borderRadius: Radius.full,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  artistPickerAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: `${Colors.primary}20`,
    borderWidth: 2, borderColor: `${Colors.primary}40`,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  artistPickerAvatarImg: { width: 52, height: 52, borderRadius: 26 },
  artistPickerInitial: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary },
  artistPickerInfo: { flex: 1 },
  artistPickerName: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textPrimary },
  artistPickerRealName: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, marginTop: 2 },
  noArtists: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md },
  noArtistsTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textSecondary },
  noArtistsSubtitle: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, textAlign: 'center' },

  // Dashboard styles
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginBottom: Spacing.lg,
  },
  headerLeft: { flex: 1, marginRight: Spacing.sm },
  artistHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  artistProfilePic: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: `${Colors.primary}20`,
    borderWidth: 2, borderColor: `${Colors.primary}40`,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  artistProfilePicImg: { width: 52, height: 52, borderRadius: 26 },
  artistProfilePicInitial: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: `${Colors.primary}20`,
    borderWidth: 2, borderColor: `${Colors.primary}40`,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarImg: { width: 38, height: 38, borderRadius: 19 },
  headerAvatarInitial: { fontSize: Fonts.sizes.md, fontWeight: '800', color: Colors.primary },
  artistSwitcher: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  artistSwitcherText: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600' },
  greeting: { fontSize: Fonts.sizes.md, color: Colors.textMuted },
  name: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  writerSubline: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, marginTop: 2 },
  artistSubline: { fontSize: Fonts.sizes.sm, color: Colors.primary, marginTop: 2, fontWeight: '600' },
  newSongButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderRadius: Radius.full,
  },
  newSongText: { color: '#fff', fontSize: Fonts.sizes.sm, fontWeight: '700' },
  attentionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.warning}15`, borderWidth: 1,
    borderColor: `${Colors.warning}40`, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.lg,
  },
  attentionText: { flex: 1, fontSize: Fonts.sizes.sm, color: Colors.warning, lineHeight: 18 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl },
  statCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  statNumber: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  statLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2, fontWeight: '500' },
  section: { marginBottom: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: Spacing.md,
  },
  sectionTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textPrimary },
  seeAll: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textSecondary },
  emptySubtitle: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    textAlign: 'center', maxWidth: 260, lineHeight: 20,
  },
  emptyButton: {
    marginTop: Spacing.sm, backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full,
  },
  emptyButtonText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.md },
  dealProgress: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  dealProgressHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  dealPublisher: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.textPrimary },
  dealPeriod: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1 },
  dealOverflow: { fontSize: Fonts.sizes.xs, color: Colors.warning, marginTop: 2, fontStyle: 'italic' },
  dealCount: { fontSize: Fonts.sizes.sm, fontWeight: '800' },
  dealTrack: {
    height: 6, borderRadius: 3,
    backgroundColor: Colors.border, overflow: 'hidden',
  },
  dealFill: { height: '100%', borderRadius: 3 },

  // Write Sessions
  writeCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  writeCardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  writeCardDate: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  writeCardDateText: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.textPrimary },
  writeCardTime: { fontSize: Fonts.sizes.xs, color: Colors.textMuted },
  writeCardWriters: { fontSize: Fonts.sizes.md, color: Colors.textSecondary, fontWeight: '500' },
  writeCardLocation: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  writeCardLocationText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted },
  writeCardActions: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  writeLogBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
  },
  writeLogBtnText: { fontSize: Fonts.sizes.xs, fontWeight: '700', color: '#fff' },
  writeLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary,
  },
  writeLinkBtnText: { fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.primary },
  writeDismissBtn: {
    width: 28, height: 28, borderRadius: Radius.full,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  linkSearchInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    fontSize: Fonts.sizes.sm, color: Colors.textPrimary,
  },
  linkSongCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  linkSongTitle: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary },
  linkSongMeta: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  unloggedContainer: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.lg,
  },
  unloggedBadge: {
    backgroundColor: `${Colors.warning}15`, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: Radius.full,
  },
  unloggedBadgeText: {
    fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.warning,
  },
  showMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: Spacing.sm, marginTop: Spacing.xs,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  showMoreText: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.primary },
  writeCountBadge: {
    fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.warning,
    backgroundColor: `${Colors.warning}15`, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: Radius.full, overflow: 'hidden',
  },
  // Dashboard sync button
  dashboardSyncBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: Radius.sm, backgroundColor: `${Colors.primary}10`,
    borderWidth: 1, borderColor: `${Colors.primary}30`,
  },
  dashboardSyncText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  standaloneSyncBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  standaloneSyncText: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.primary },
  // Review modal
  reviewHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  reviewHeaderTitle: { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.textPrimary },
  reviewCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    padding: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewCardSelected: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}08` },
  reviewCardTitle: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary },
  reviewCardMeta: { fontSize: Fonts.sizes.xs, color: Colors.textMuted },
  reviewCardCowriters: { fontSize: Fonts.sizes.xs, color: Colors.textSecondary, marginTop: 4 },
  reviewLikelyBadge: {
    backgroundColor: `${Colors.primary}15`, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  reviewLikelyText: { fontSize: 10, color: Colors.primary, fontWeight: '700' },
  reviewSkippedBadge: {
    backgroundColor: Colors.surface, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 1,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewSkippedText: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  reviewImportFooter: {
    padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  reviewImportBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  reviewImportBtnText: { fontSize: Fonts.sizes.md, fontWeight: '700', color: '#fff' },
})
