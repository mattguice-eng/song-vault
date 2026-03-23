import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, ActivityIndicator, Image,
} from 'react-native'
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { SongCard } from '../../../src/components/SongCard'
import { Button } from '../../../src/components/Button'
import { Input } from '../../../src/components/Input'
import { DateInput } from '../../../src/components/DateInput'
import { DatePickerModal } from '../../../src/components/DatePickerModal'
import { Artist, Publisher, PublishingDeal, SongWithDetails } from '../../../src/types/database'
import { Colors, Spacing, Fonts, Radius } from '../../../src/utils/constants'
import { fetchSpotifyArtist } from '../../../src/lib/spotify'
import { getGoogleAuthUrl } from '../../../src/lib/google-calendar'

interface Deal extends PublishingDeal {
  publisher: Publisher
}

const PERIOD_LABELS: Record<string, string> = {
  initial: 'Initial Period',
  option_1: 'Option 1',
  option_2: 'Option 2',
}

const PERIOD_ORDER: Record<string, number> = { initial: 0, option_1: 1, option_2: 2 }

export default function ArtistDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>()
  const { profile, setActiveArtist } = useAuthStore()
  const [artist, setArtist] = useState<Artist | null>(null)
  const [songs, setSongs] = useState<SongWithDetails[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [publishers, setPublishers] = useState<Publisher[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [spotifyUrl, setSpotifyUrl] = useState('')
  const [fetchingSpotify, setFetchingSpotify] = useState(false)
  const [photoActionVisible, setPhotoActionVisible] = useState(false)
  const [spotifyModalVisible, setSpotifyModalVisible] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [dealModalVisible, setDealModalVisible] = useState(false)
  const [savingDeal, setSavingDeal] = useState(false)
  const [dealForm, setDealForm] = useState({
    publisher_id: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    notes: '',
    min_delivery: '',
    period_type: 'initial' as 'initial' | 'option_1' | 'option_2',
    parent_deal_id: null as string | null,
  })
  // Inline new publisher form
  const [showNewPublisher, setShowNewPublisher] = useState(false)
  const [newPublisher, setNewPublisher] = useState({ name: '', email: '' })
  const [savingPublisher, setSavingPublisher] = useState(false)
  const [publisherError, setPublisherError] = useState('')
  const [dealErrors, setDealErrors] = useState<Record<string, string>>({})
  const [dealDeleteError, setDealDeleteError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // ── Invite ────────────────────────────────────────────────────────────────
  const [inviteModalVisible, setInviteModalVisible] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState('')

  // ── Team ─────────────────────────────────────────────────────────────────
  interface TeamMember {
    id: string
    user_id: string
    role: string
    profile?: { full_name: string; email: string; avatar_url: string | null }
  }
  interface TeamInvite {
    id: string
    email: string
    role: string
  }
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamInvites, setTeamInvites] = useState<TeamInvite[]>([])
  const [teamModalVisible, setTeamModalVisible] = useState(false)
  const [teamEmail, setTeamEmail] = useState('')
  const [teamRole, setTeamRole] = useState<'manager' | 'admin' | 'viewer'>('manager')
  const [addingTeamMember, setAddingTeamMember] = useState(false)
  const [teamError, setTeamError] = useState('')
  const [removingTeamId, setRemovingTeamId] = useState<string | null>(null)

  // ── Calendar ───────────────────────────────────────────────────────────
  const [calendarModalVisible, setCalendarModalVisible] = useState(false)
  const [calendarSyncFrom, setCalendarSyncFrom] = useState(new Date().toISOString().split('T')[0])
  const [syncingCalendar, setSyncingCalendar] = useState(false)
  const [calendarList, setCalendarList] = useState<{ id: string; summary: string; primary: boolean }[]>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)
  const [calendarPickerVisible, setCalendarPickerVisible] = useState(false)

  // ── Calendar Review ────────────────────────────────────────────────────
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
  const [importing, setImporting] = useState(false)

  const fetchData = useCallback(async () => {
    const [artistRes, songsRes, dealsRes, publishersRes] = await Promise.all([
      supabase.from('artists').select('*').eq('id', id).single(),
      supabase
        .from('songs')
        .select('*, cowriters(*), files:song_files(*), artist:artists(id, stage_name)')
        .eq('artist_id', id)
        .order('date_written', { ascending: false }),
      supabase
        .from('publishing_deals')
        .select('*, publisher:publishers(*)')
        .eq('artist_id', id)
        .order('start_date', { ascending: true }),
      supabase.from('publishers').select('*').order('name'),
    ])

    if (artistRes.data) setArtist(artistRes.data as Artist)
    if (songsRes.data) setSongs(songsRes.data as SongWithDetails[])
    if (dealsRes.data) setDeals(dealsRes.data as Deal[])
    if (publishersRes.data) setPublishers(publishersRes.data as Publisher[])
    setLoading(false)
  }, [id])

  const fetchTeam = async () => {
    const { data } = await supabase
      .from('artist_team_members')
      .select('id, user_id, role')
      .eq('artist_id', id)

    if (data && data.length > 0) {
      // Fetch profiles for team members
      const userIds = data.map(m => m.user_id)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', userIds)

      const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))
      setTeamMembers(data.map(m => ({
        ...m,
        profile: profileMap.get(m.user_id) as any,
      })))
    } else {
      setTeamMembers([])
    }

    // Fetch pending invites
    const { data: invites } = await supabase
      .from('artist_team_invites')
      .select('id, email, role')
      .eq('artist_id', id)
      .eq('accepted', false)
    setTeamInvites((invites ?? []) as TeamInvite[])
  }

  useFocusEffect(useCallback(() => {
    fetchData()
    fetchTeam()
  }, [fetchData]))

  const isOwner = artist?.manager_id === profile?.id

  const handleAddTeamMember = async () => {
    if (!teamEmail.trim() || !teamEmail.includes('@')) {
      setTeamError('Enter a valid email address.')
      return
    }
    setTeamError('')
    setAddingTeamMember(true)

    try {
      const email = teamEmail.trim().toLowerCase()

      // Call edge function to handle invite (sends email if new user, adds directly if existing)
      const session = (await supabase.auth.getSession()).data.session
      console.log('[team] calling invite function, has session:', !!session)
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/invite-team-member`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            artist_id: id,
            email,
            role: teamRole,
            artist_name: artist?.stage_name ?? '',
            inviter_name: profile?.full_name ?? '',
          }),
        }
      )

      console.log('[team] response status:', res.status)
      const resultText = await res.text()
      console.log('[team] response body:', resultText)

      let result: any
      try { result = JSON.parse(resultText) } catch { result = { error: resultText } }

      if (!res.ok || result.error) {
        throw new Error(result.error ?? 'Failed to send invite')
      }

      setTeamEmail('')
      if (result.existing) {
        setSuccessMsg(`Added to team!`)
      } else {
        setSuccessMsg(`Invite email sent to ${email}!`)
      }
      setTimeout(() => setSuccessMsg(''), 4000)
      fetchTeam()
      setTeamModalVisible(false)
    } catch (err: any) {
      setTeamError(err.message ?? 'Failed to add team member.')
    } finally {
      setAddingTeamMember(false)
    }
  }

  const handleRemoveTeamMember = async (memberId: string) => {
    setRemovingTeamId(memberId)
    try {
      await supabase.from('artist_team_members').delete().eq('id', memberId)
      setTeamMembers(prev => prev.filter(m => m.id !== memberId))
    } catch (err) {
      console.error('[artist-detail] remove team member error:', err)
    } finally {
      setRemovingTeamId(null)
    }
  }

  // ── Invite ────────────────────────────────────────────────────────────────
  const handleSendInvite = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      setInviteError('Please enter a valid email address.')
      return
    }
    setSendingInvite(true)
    setInviteError('')
    try {
      console.log('[invite] calling edge function...')
      const { data, error: fnError } = await supabase.functions.invoke('invite-artist', {
        body: {
          artist_id: id,
          email: inviteEmail.trim().toLowerCase(),
          artist_name: artist?.real_name ?? artist?.stage_name ?? '',
          manager_name: profile?.full_name ?? '',
        },
      })
      console.log('[invite] response:', { data, fnError })
      if (fnError) throw new Error(fnError.message ?? 'Failed to send invite')
      const json = data
      setInviteModalVisible(false)
      setInviteEmail('')
      await fetchData()
      setSuccessMsg(
        json.existing
          ? 'Artist account linked successfully!'
          : 'Invite sent! They\'ll receive an email with a link to join.'
      )
      setTimeout(() => setSuccessMsg(''), 4000)
    } catch (err: any) {
      setInviteError(err.message ?? 'Failed to send invite')
    } finally {
      setSendingInvite(false)
    }
  }

  // ── Calendar ───────────────────────────────────────────────────────────
  const fetchCalendarList = async () => {
    setLoadingCalendars(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('sync-calendar', {
        body: { action: 'list_calendars', artist_id: id },
      })
      if (fnError) throw new Error(fnError.message)
      setCalendarList(data?.calendars ?? [])
      setCalendarPickerVisible(true)
    } catch (err: any) {
      setDealDeleteError(err.message ?? 'Failed to load calendars')
    } finally {
      setLoadingCalendars(false)
    }
  }

  const handleSelectCalendar = async (calendarId: string) => {
    setCalendarPickerVisible(false)
    // Update the artist's calendar_id
    await supabase.from('artists').update({ google_calendar_id: calendarId }).eq('id', id)
    // Now sync with the selected calendar
    setSyncingCalendar(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('sync-calendar', {
        body: { action: 'sync', artist_id: id },
      })
      if (fnError) throw new Error(fnError.message)
      await fetchData()
      setSuccessMsg(`Calendar synced! ${data?.upserted ?? 0} events found.`)
      setTimeout(() => setSuccessMsg(''), 4000)
    } catch (err: any) {
      setDealDeleteError(err.message ?? 'Sync failed')
    } finally {
      setSyncingCalendar(false)
    }
  }

  const handleConnectCalendar = () => {
    if (typeof window === 'undefined') return
    // Store sync_from date so the callback page can use it
    localStorage.setItem(`calendar_sync_from_${id}`, calendarSyncFrom)
    // Redirect to Google OAuth
    const authUrl = getGoogleAuthUrl(id)
    window.location.href = authUrl
  }

  const handleSyncCalendar = async () => {
    setSyncingCalendar(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('sync-calendar', {
        body: { action: 'preview', artist_id: id },
      })
      console.log('[calendar-sync] preview:', JSON.stringify(data), 'error:', fnError)
      if (fnError) throw new Error(fnError.message)

      const events: PreviewEvent[] = data?.events ?? []
      const cancelled = data?.cancelled ?? []

      if (events.length === 0 && cancelled.length === 0) {
        setSuccessMsg('No new events to import.')
        setTimeout(() => setSuccessMsg(''), 4000)
        return
      }

      setPreviewEvents(events)
      setCancelledSessions(cancelled)
      // Pre-select likely writes that weren't previously dismissed
      setSelectedEventIds(new Set(
        events.filter(e => e.likely_write && !e.previously_dismissed).map(e => e.calendar_event_id)
      ))
      setReviewModalVisible(true)
    } catch (err: any) {
      setDealDeleteError(err.message ?? 'Sync failed')
    } finally {
      setSyncingCalendar(false)
    }
  }

  const toggleEventSelection = (eventId: string) => {
    setSelectedEventIds(prev => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  const handleImportSelected = async () => {
    setImporting(true)
    try {
      const selectedEvents = previewEvents.filter(e => selectedEventIds.has(e.calendar_event_id))
      const dismissedEvents = previewEvents.filter(e => !selectedEventIds.has(e.calendar_event_id))
      const { data, error: fnError } = await supabase.functions.invoke('sync-calendar', {
        body: {
          action: 'import',
          artist_id: id,
          selected_events: selectedEvents,
          dismissed_events: dismissedEvents,
          delete_session_ids: cancelledSessions.map(s => s.id),
        },
      })
      if (fnError) throw new Error(fnError.message)
      setReviewModalVisible(false)
      await fetchData()
      const imported = data?.imported ?? 0
      const deleted = data?.deleted ?? 0
      const parts = []
      if (imported > 0) parts.push(`Imported ${imported} write session${imported !== 1 ? 's' : ''}`)
      if (deleted > 0) parts.push(`Removed ${deleted} cancelled`)
      setSuccessMsg(parts.join(', ') || 'No changes made')
      setTimeout(() => setSuccessMsg(''), 4000)
    } catch (err: any) {
      setDealDeleteError(err.message ?? 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  // ── Progress calculation ──────────────────────────────────────────────────
  const computeWaterfallProgress = (): { delivered: Record<string, number>; overflow: Record<string, number> } => {
    const today = new Date()
    const artistDisplayName = (artist?.real_name ?? artist?.stage_name ?? '').toLowerCase()
    const stageName = (artist?.stage_name ?? '').toLowerCase()
    const realName = (artist?.real_name ?? '').toLowerCase()

    const getShare = (s: any) => {
      const cw = s.cowriters?.find((c: any) =>
        c.name.toLowerCase() === artistDisplayName ||
        c.name.toLowerCase() === stageName ||
        c.name.toLowerCase() === realName
      )
      return cw ? cw.split_percentage / 100 : 0
    }

    const sortedDeals = [...deals].sort(
      (a, b) => new Date(a.start_date + 'T00:00:00').getTime() - new Date(b.start_date + 'T00:00:00').getTime()
    )
    const sortedSongs = [...songs].sort(
      (a, b) => new Date(a.date_written + 'T12:00:00').getTime() - new Date(b.date_written + 'T12:00:00').getTime()
    )

    const delivered: Record<string, number> = {}
    const overflow: Record<string, number> = {}
    sortedDeals.forEach(d => { delivered[d.id] = 0; overflow[d.id] = 0 })

    for (const s of sortedSongs) {
      const share = getShare(s)
      if (share === 0) continue

      const songDate = new Date(s.date_written + 'T12:00:00')

      let naturalIdx = -1
      for (let i = 0; i < sortedDeals.length; i++) {
        const d = sortedDeals[i]
        const start = d.start_date ? new Date(d.start_date + 'T00:00:00') : null
        const end   = d.end_date   ? new Date(d.end_date   + 'T23:59:59') : null
        if (start && songDate >= start && (!end || songDate <= end)) { naturalIdx = i; break }
      }
      if (naturalIdx === -1) {
        const lastStart = sortedDeals.length ? new Date(sortedDeals[sortedDeals.length - 1].start_date + 'T00:00:00') : null
        if (lastStart && songDate >= lastStart) naturalIdx = sortedDeals.length - 1
      }
      if (naturalIdx === -1) continue

      let assigned = false
      for (let i = 0; i <= naturalIdx; i++) {
        const d = sortedDeals[i]
        if (i < naturalIdx) {
          const end = d.end_date ? new Date(d.end_date + 'T23:59:59') : null
          const hasEnded = end ? end < today : false
          if (hasEnded && (d.min_delivery ?? 0) > 0 && delivered[d.id] < (d.min_delivery ?? 0)) {
            delivered[d.id] += share
            overflow[d.id]  += share
            assigned = true
            break
          }
        } else {
          delivered[d.id] += share
          assigned = true
        }
      }
      if (!assigned && naturalIdx >= 0) delivered[sortedDeals[naturalIdx].id] += share
    }

    return { delivered, overflow }
  }

  // Build hierarchical deal groups: root deals + their option periods
  const buildDealTree = (): { root: Deal; options: Deal[] }[] => {
    const roots = deals.filter(d => !d.parent_deal_id)
    return roots
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
      .map(root => ({
        root,
        options: deals
          .filter(d => d.parent_deal_id === root.id)
          .sort((a, b) => PERIOD_ORDER[a.period_type ?? 'option_1'] - PERIOD_ORDER[b.period_type ?? 'option_1']),
      }))
  }

  const getNextOptionType = (rootDeal: Deal): 'option_1' | 'option_2' | null => {
    const children = deals.filter(d => d.parent_deal_id === rootDeal.id)
    const hasOption1 = children.some(d => d.period_type === 'option_1')
    const hasOption2 = children.some(d => d.period_type === 'option_2')
    if (!hasOption1) return 'option_1'
    if (!hasOption2) return 'option_2'
    return null // all options used
  }

  const openAddOptionModal = (parentDeal: Deal) => {
    const nextType = getNextOptionType(parentDeal)
    if (!nextType) return
    // Suggest start date = parent deal end_date + 1 day
    let suggestedStart = new Date().toISOString().split('T')[0]
    if (parentDeal.end_date) {
      const d = new Date(parentDeal.end_date)
      d.setDate(d.getDate() + 1)
      suggestedStart = d.toISOString().split('T')[0]
    }
    setDealForm({
      publisher_id: parentDeal.publisher_id,
      start_date: suggestedStart,
      end_date: '',
      notes: '',
      min_delivery: '',
      period_type: nextType,
      parent_deal_id: parentDeal.id,
    })
    setDealErrors({})
    setShowNewPublisher(false)
    setNewPublisher({ name: '', email: '' })
    setDealModalVisible(true)
  }

  const openAddDealModal = () => {
    setDealForm({
      publisher_id: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      notes: '',
      min_delivery: '',
      period_type: 'initial',
      parent_deal_id: null,
    })
    setDealErrors({})
    setShowNewPublisher(false)
    setNewPublisher({ name: '', email: '' })
    setDealModalVisible(true)
  }

  // ── Photo handlers ────────────────────────────────────────────────────────
  const handlePickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setPhotoError('Photo library access is required to upload a photo.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    })
    if (result.canceled || !result.assets?.[0]) return

    setUploadingPhoto(true)
    setPhotoError('')
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop() ?? 'jpg'
      const path = `artists/${id}/avatar_${Date.now()}.${ext}`

      const response = await fetch(asset.uri)
      const blob = await response.blob()

      const { error: uploadError } = await supabase.storage
        .from('song-files')
        .upload(path, blob, { contentType: `image/${ext}`, upsert: true })

      if (uploadError) throw uploadError

      const { data: signedData, error: signErr } = await supabase.storage
        .from('song-files')
        .createSignedUrl(path, 60 * 60 * 24 * 365) // 1 year
      if (signErr) throw signErr

      await supabase.from('artists').update({ avatar_url: signedData.signedUrl }).eq('id', id)
      fetchData()
    } catch (err: any) {
      setPhotoError(err.message ?? 'Upload failed')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleFetchSpotify = async () => {
    if (!spotifyUrl.trim()) return
    setFetchingSpotify(true)
    setPhotoError('')
    try {
      const result = await fetchSpotifyArtist(spotifyUrl.trim())
      await supabase.from('artists').update({
        avatar_url: result.imageUrl ?? artist?.avatar_url,
        spotify_url: result.spotifyUrl,
      }).eq('id', id)
      setSpotifyModalVisible(false)
      setSpotifyUrl('')
      setSuccessMsg(`Pulled ${result.name}'s Spotify photo!`)
      setTimeout(() => setSuccessMsg(''), 3000)
      fetchData()
    } catch (err: any) {
      setPhotoError(err.message ?? 'Could not fetch Spotify data')
    } finally {
      setFetchingSpotify(false)
    }
  }

  // ── Publisher creation ────────────────────────────────────────────────────
  const handleSaveNewPublisher = async () => {
    if (!newPublisher.name.trim()) {
      setPublisherError('Publisher name is required')
      return
    }
    if (!newPublisher.email.trim() || !/\S+@\S+\.\S+/.test(newPublisher.email)) {
      setPublisherError('Valid submission email is required')
      return
    }
    setSavingPublisher(true)
    setPublisherError('')
    const { data, error } = await supabase
      .from('publishers')
      .insert({ name: newPublisher.name.trim(), email: newPublisher.email.trim() })
      .select()
      .single()
    setSavingPublisher(false)
    if (error) {
      setPublisherError(error.message)
    } else {
      setPublishers((prev) => [...prev, data as Publisher].sort((a, b) => a.name.localeCompare(b.name)))
      setDealForm((f) => ({ ...f, publisher_id: data.id }))
      setNewPublisher({ name: '', email: '' })
      setShowNewPublisher(false)
    }
  }

  // ── Deal save ─────────────────────────────────────────────────────────────
  const validateDeal = () => {
    const e: Record<string, string> = {}
    if (!dealForm.publisher_id) e.publisher_id = 'Please select a publisher'
    if (!dealForm.start_date) e.start_date = 'Start date is required'
    if (dealForm.min_delivery && isNaN(parseFloat(dealForm.min_delivery))) {
      e.min_delivery = 'Must be a number (e.g. 10 or 7.5)'
    }
    setDealErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSaveDeal = async () => {
    if (!validateDeal()) return
    setSavingDeal(true)
    const { error } = await supabase.from('publishing_deals').insert({
      artist_id: id,
      publisher_id: dealForm.publisher_id,
      start_date: dealForm.start_date,
      end_date: dealForm.end_date || null,
      notes: dealForm.notes.trim() || null,
      is_active: true,
      min_delivery: dealForm.min_delivery ? parseFloat(dealForm.min_delivery) : null,
      period_type: dealForm.period_type,
      parent_deal_id: dealForm.parent_deal_id,
    })
    setSavingDeal(false)
    if (error) {
      setDealErrors({ publisher_id: error.message })
    } else {
      // Sync artist's songwriter registry entry with their publisher
      const pub = publishers.find(p => p.id === dealForm.publisher_id)
      if (pub && artist) {
        const artistName = artist.real_name ?? artist.stage_name
        // Find existing songwriter entry by user_id or name
        let swId: string | null = null
        if (artist.user_id) {
          const { data } = await supabase
            .from('songwriters').select('id').eq('user_id', artist.user_id).maybeSingle()
          swId = data?.id ?? null
        }
        if (!swId) {
          const { data } = await supabase
            .from('songwriters').select('id').ilike('name', artistName).maybeSingle()
          swId = data?.id ?? null
        }
        if (swId) {
          await supabase.from('songwriters')
            .update({ publisher_id: pub.id, publisher_name: pub.name })
            .eq('id', swId)
        } else {
          // Create the songwriter entry for this artist
          await supabase.from('songwriters').insert({
            name: artistName,
            publisher_id: pub.id,
            publisher_name: pub.name,
            user_id: artist.user_id ?? null,
            created_by: profile!.id,
          })
        }
      }

      setDealModalVisible(false)
      const label = dealForm.parent_deal_id
        ? `${PERIOD_LABELS[dealForm.period_type]} added!`
        : 'Publishing deal added!'
      setSuccessMsg(label)
      setTimeout(() => setSuccessMsg(''), 3000)
      fetchData()
    }
  }

  const handleToggleDeal = async (deal: Deal) => {
    await supabase
      .from('publishing_deals')
      .update({ is_active: !deal.is_active })
      .eq('id', deal.id)
    fetchData()
  }

  const handleDeleteDeal = async (deal: Deal) => {
    setDealDeleteError('')
    const { error } = await supabase.from('publishing_deals').delete().eq('id', deal.id)
    if (error) {
      if (error.code === '23503') {
        setDealDeleteError(`Can't delete — songs are still linked to this deal. Reassign or remove them first, or the deal will be cleared automatically once you run the DB fix.`)
      } else {
        setDealDeleteError(error.message)
      }
      setTimeout(() => setDealDeleteError(''), 6000)
    } else {
      fetchData()
    }
  }

  const activeDeal = deals.find((d) => d.is_active && !d.parent_deal_id) ?? deals.find((d) => d.is_active) ?? null
  const activeDealSongs = activeDeal ? songs.filter((s) => s.publishing_deal_id === activeDeal.id) : songs
  const stats = {
    total: activeDealSongs.length,
    submitted: activeDealSongs.filter((s) => s.status === 'submitted' || s.status === 'complete').length,
    pending: activeDealSongs.filter((s) => s.status !== 'submitted' && s.status !== 'complete').length,
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    )
  }

  if (!artist) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ color: Colors.textPrimary, padding: Spacing.lg }}>Artist not found.</Text>
      </SafeAreaView>
    )
  }

  const dealTree = buildDealTree()

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace({ pathname: '/(app)/dashboard', params: { artistId: id as string } })}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Artist Hero */}
        <View style={styles.hero}>
          <TouchableOpacity
            onPress={() => setPhotoActionVisible(true)}
            style={styles.avatarWrapper}
            disabled={uploadingPhoto}
          >
            {artist.avatar_url ? (
              <Image source={{ uri: artist.avatar_url }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarLetter}>
                  {artist.stage_name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              {uploadingPhoto
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="camera" size={14} color="#fff" />
              }
            </View>
          </TouchableOpacity>

          <Text style={styles.stageName}>{artist.stage_name}</Text>
          {artist.real_name && <Text style={styles.realName}>{artist.real_name}</Text>}

          {photoError !== '' && (
            <Text style={styles.photoError}>{photoError}</Text>
          )}
        </View>

        {/* Success message */}
        {successMsg !== '' && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.successText}>{successMsg}</Text>
          </View>
        )}

        {/* Deal delete error */}
        {dealDeleteError !== '' && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={Colors.error} />
            <Text style={styles.errorBannerText}>{dealDeleteError}</Text>
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.total}</Text>
            <Text style={styles.statLabel}>Songs</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: Colors.warning }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: Colors.success }]}>{stats.submitted}</Text>
            <Text style={styles.statLabel}>Submitted</Text>
          </View>
        </View>

        {/* Artist Portal Access */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Artist Portal</Text>
          </View>
          <View style={styles.inviteCard}>
            <View style={styles.inviteIcon}>
              <Ionicons
                name={artist.user_id ? 'checkmark-circle' : artist.invite_sent_at ? 'time-outline' : 'person-add-outline'}
                size={22}
                color={artist.user_id ? Colors.success : artist.invite_sent_at ? Colors.warning : Colors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              {artist.user_id ? (
                <>
                  <Text style={styles.inviteStatusText}>Account active</Text>
                  <Text style={styles.inviteSubText}>{artist.invite_email ?? 'Linked'}</Text>
                </>
              ) : artist.invite_sent_at ? (
                <>
                  <Text style={[styles.inviteStatusText, { color: Colors.warning }]}>Invite pending</Text>
                  <Text style={styles.inviteSubText}>Sent to {artist.invite_email}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.inviteStatusText}>No portal access</Text>
                  <Text style={styles.inviteSubText}>Send an invite so this artist can log in</Text>
                </>
              )}
            </View>
            <TouchableOpacity
              style={styles.inviteButton}
              onPress={() => {
                setInviteEmail(artist.invite_email ?? '')
                setInviteError('')
                setInviteModalVisible(true)
              }}
            >
              <Text style={styles.inviteButtonText}>
                {artist.user_id ? 'Re-invite' : artist.invite_sent_at ? 'Resend' : 'Invite'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Google Calendar */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Writing Calendar</Text>
          </View>

          {artist.google_refresh_token ? (
            // Connected — show status + sync button
            <View style={styles.calendarCard}>
              <View style={styles.calendarConnected}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.calendarStatusText}>Calendar connected</Text>
                  <Text style={styles.calendarSubText}>
                    {(artist as any).google_calendar_name
                      ? (artist as any).google_calendar_name
                      : artist.google_calendar_id && artist.google_calendar_id !== 'primary'
                        ? artist.google_calendar_id
                        : 'Primary calendar'}
                    {artist.calendar_last_synced_at
                      ? ` · Synced ${new Date(artist.calendar_last_synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                      : ' · Not yet synced'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.calendarSyncBtn}
                  onPress={handleSyncCalendar}
                  disabled={syncingCalendar}
                >
                  {syncingCalendar ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="sync-outline" size={14} color={Colors.primary} />
                      <Text style={styles.calendarSyncText}>Sync</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Not connected — show connect UI
            <View style={styles.calendarCard}>
              <View style={styles.calendarEmptyIcon}>
                <Ionicons name="calendar-outline" size={24} color={Colors.textMuted} />
              </View>
              <Text style={styles.calendarEmptyTitle}>Connect Google Calendar</Text>
              <Text style={styles.calendarEmptyDesc}>
                Pull in write sessions automatically. See upcoming writes and convert past sessions into songs with co-writers pre-filled.
              </Text>

              {/* Sync from date picker */}
              <View style={styles.calendarSyncFromRow}>
                <Text style={styles.calendarSyncFromLabel}>Sync events from:</Text>
                <TouchableOpacity
                  style={styles.calendarSyncFromPicker}
                  onPress={() => setCalendarModalVisible(true)}
                >
                  <Ionicons name="calendar-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.calendarSyncFromDate}>
                    {new Date(calendarSyncFrom + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  <Ionicons name="chevron-down" size={12} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.calendarConnectBtn}
                onPress={handleConnectCalendar}
              >
                <Image
                  source={{ uri: 'https://www.google.com/favicon.ico' }}
                  style={{ width: 16, height: 16 }}
                />
                <Text style={styles.calendarConnectText}>Connect with Google</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Publishing Deals */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Publishing Deals</Text>
            <TouchableOpacity style={styles.addDealButton} onPress={openAddDealModal}>
              <Ionicons name="add" size={16} color={Colors.primary} />
              <Text style={styles.addDealText}>Add Deal</Text>
            </TouchableOpacity>
          </View>

          {dealTree.length === 0 ? (
            <View style={styles.emptyDeals}>
              <Text style={styles.emptyDealsText}>No publishing deals yet</Text>
              <Text style={styles.emptyDealsSubtext}>
                Add a deal to link this artist to a publisher
              </Text>
            </View>
          ) : (() => {
            const { delivered: deliveredMap, overflow: overflowMap } = computeWaterfallProgress()
            return dealTree.map(({ root, options }) => (
              <DealGroup
                key={root.id}
                root={root}
                options={options}
                deliveredMap={deliveredMap}
                overflowMap={overflowMap}
                nextOption={getNextOptionType(root)}
                onAddOption={() => openAddOptionModal(root)}
                onToggle={handleToggleDeal}
                onDelete={handleDeleteDeal}
              />
            ))
          })()}
        </View>

        {/* Songs summary row */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.viewSongsRow}
            onPress={() => {
              if (artist) setActiveArtist(artist)
              router.replace('/(app)/songs')
            }}
          >
            <Ionicons name="musical-notes-outline" size={20} color={Colors.primary} />
            <Text style={styles.viewSongsText}>
              {songs.length} song{songs.length !== 1 ? 's' : ''} logged
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* ── Team ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Team</Text>
            {isOwner && (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => { setTeamModalVisible(true); setTeamError(''); setTeamEmail('') }}
              >
                <Ionicons name="person-add-outline" size={14} color="#fff" />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Owner */}
          <View style={styles.teamRow}>
            <View style={styles.teamAvatar}>
              <Ionicons name="shield" size={16} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName}>{profile?.full_name ?? profile?.email ?? 'Owner'}</Text>
              <Text style={styles.teamRole}>Owner</Text>
            </View>
          </View>

          {/* Team members */}
          {teamMembers.map(member => (
            <View key={member.id} style={styles.teamRow}>
              <View style={[styles.teamAvatar, { backgroundColor: `${Colors.primary}20` }]}>
                <Ionicons name="person" size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.teamName}>
                  {member.profile?.full_name || member.profile?.email || 'Unknown'}
                </Text>
                <Text style={styles.teamRole}>
                  {member.role === 'admin' ? 'Admin' : member.role === 'viewer' ? 'Viewer' : 'Manager'}
                </Text>
              </View>
              {isOwner && (
                <TouchableOpacity
                  onPress={() => handleRemoveTeamMember(member.id)}
                  disabled={removingTeamId === member.id}
                >
                  {removingTeamId === member.id ? (
                    <ActivityIndicator size="small" color={Colors.textMuted} />
                  ) : (
                    <Ionicons name="close-circle-outline" size={20} color={Colors.textMuted} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}

          {/* Pending invites */}
          {teamInvites.map(invite => (
            <View key={invite.id} style={styles.teamRow}>
              <View style={[styles.teamAvatar, { backgroundColor: `${Colors.warning ?? '#F59E0B'}20` }]}>
                <Ionicons name="mail-outline" size={16} color={Colors.warning ?? '#F59E0B'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.teamName}>{invite.email}</Text>
                <Text style={[styles.teamRole, { color: Colors.warning ?? '#F59E0B' }]}>
                  Pending · {invite.role === 'admin' ? 'Admin' : invite.role === 'viewer' ? 'Viewer' : 'Manager'}
                </Text>
              </View>
              {isOwner && (
                <TouchableOpacity onPress={async () => {
                  await supabase.from('artist_team_invites').delete().eq('id', invite.id)
                  setTeamInvites(prev => prev.filter(i => i.id !== invite.id))
                }}>
                  <Ionicons name="close-circle-outline" size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {teamMembers.length === 0 && teamInvites.length === 0 && (
            <Text style={styles.teamEmpty}>
              No team members yet. Add managers or admins to collaborate.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* ── Add Team Member Modal ─── */}
      <Modal visible={teamModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTeamModalVisible(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Team Member</Text>
            <TouchableOpacity onPress={() => setTeamModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ padding: Spacing.lg, gap: Spacing.md }}>
            <Text style={{ fontSize: Fonts.sizes.sm, color: Colors.textSecondary, lineHeight: 20 }}>
              Add someone to this artist's team. They'll be able to view and manage songs, playlists, and deals.
            </Text>
            <Input
              label="Email Address"
              value={teamEmail}
              onChangeText={setTeamEmail}
              placeholder="team@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />

            {/* Role picker */}
            <View>
              <Text style={{ fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Role
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                {(['manager', 'admin', 'viewer'] as const).map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.roleChip,
                      teamRole === r && styles.roleChipActive,
                    ]}
                    onPress={() => setTeamRole(r)}
                  >
                    <Text style={[
                      styles.roleChipText,
                      teamRole === r && styles.roleChipTextActive,
                    ]}>
                      {r === 'manager' ? 'Manager' : r === 'admin' ? 'Admin' : 'Viewer'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 6 }}>
                {teamRole === 'manager' ? 'Can view and manage songs, playlists, and deals.' :
                 teamRole === 'admin' ? 'Full access including adding/removing team members.' :
                 'Read-only access to songs and playlists.'}
              </Text>
            </View>

            {teamError ? (
              <Text style={{ color: Colors.error, fontSize: Fonts.sizes.sm }}>{teamError}</Text>
            ) : null}

            <Button
              title="Add to Team"
              onPress={handleAddTeamMember}
              loading={addingTeamMember}
              disabled={!teamEmail.trim()}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Photo Action Sheet */}
      <Modal visible={photoActionVisible} animationType="fade" transparent>
        <TouchableOpacity
          style={styles.actionSheetOverlay}
          activeOpacity={1}
          onPress={() => setPhotoActionVisible(false)}
        >
          <View style={styles.actionSheet}>
            <Text style={styles.actionSheetTitle}>Update Photo</Text>

            <TouchableOpacity
              style={styles.actionSheetOption}
              onPress={() => { setPhotoActionVisible(false); handlePickPhoto() }}
            >
              <Ionicons name="image-outline" size={22} color={Colors.textPrimary} />
              <Text style={styles.actionSheetOptionText}>Upload from camera roll</Text>
            </TouchableOpacity>

            {!artist?.spotify_url && (
              <TouchableOpacity
                style={styles.actionSheetOption}
                onPress={() => { setPhotoActionVisible(false); setSpotifyModalVisible(true) }}
              >
                <Ionicons name={"logo-spotify" as any} size={22} color="#1DB954" />
                <Text style={[styles.actionSheetOptionText, { color: '#1DB954' }]}>
                  Pull from Spotify
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionSheetOption, styles.actionSheetCancel]}
              onPress={() => setPhotoActionVisible(false)}
            >
              <Text style={styles.actionSheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Spotify Modal */}
      <Modal visible={spotifyModalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Pull from Spotify</Text>
            <TouchableOpacity onPress={() => { setSpotifyModalVisible(false); setSpotifyUrl(''); setPhotoError('') }}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.spotifyHint}>
            Paste the artist's Spotify URL or artist ID. We'll pull their profile photo automatically.
          </Text>
          <Input
            label="Spotify Artist URL"
            value={spotifyUrl}
            onChangeText={setSpotifyUrl}
            placeholder="https://open.spotify.com/artist/..."
            autoCapitalize="none"
            returnKeyType="go"
            onSubmitEditing={handleFetchSpotify}
          />
          {photoError !== '' && (
            <Text style={styles.photoError}>{photoError}</Text>
          )}
          <Button
            title="Fetch Photo"
            onPress={handleFetchSpotify}
            loading={fetchingSpotify}
            disabled={!spotifyUrl.trim()}
          />
        </View>
      </Modal>

      {/* Invite Artist Modal */}
      <Modal visible={inviteModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteModalVisible(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Invite Artist</Text>
            <TouchableOpacity onPress={() => setInviteModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ padding: Spacing.lg, gap: Spacing.lg }}>
            <Text style={styles.inviteModalDesc}>
              Enter the artist's email address. They'll receive a link to create their account and access their Song Vault portal.
            </Text>
            <Input
              label="Artist Email"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="artist@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={inviteError}
            />
            <Button
              title={sendingInvite ? 'Sending...' : 'Send Invite'}
              onPress={handleSendInvite}
              disabled={sendingInvite}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Calendar Review Modal */}
      <Modal visible={reviewModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setReviewModalVisible(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Review Calendar Events</Text>
            <TouchableOpacity onPress={() => setReviewModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm }}>
            <Text style={{ fontSize: Fonts.sizes.sm, color: Colors.textMuted }}>
              {selectedEventIds.size} of {previewEvents.length} selected · Pre-checked events look like write sessions
            </Text>
          </View>
          {/* Select All / Deselect All */}
          <View style={{ flexDirection: 'row', paddingHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.sm }}>
            <TouchableOpacity
              style={[styles.calendarSyncBtn, { flex: 0, paddingHorizontal: Spacing.md }]}
              onPress={() => setSelectedEventIds(new Set(previewEvents.map(e => e.calendar_event_id)))}
            >
              <Text style={styles.calendarSyncText}>Select All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.calendarPickBtn, { flex: 0, paddingHorizontal: Spacing.md }]}
              onPress={() => setSelectedEventIds(new Set())}
            >
              <Text style={[styles.calendarSyncText, { color: Colors.textMuted }]}>Deselect All</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: 100 }}>
            {/* Cancelled sessions */}
            {cancelledSessions.length > 0 && (
              <View style={{ marginBottom: Spacing.md }}>
                <Text style={{ fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.error, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm }}>
                  Cancelled — will be removed
                </Text>
                {cancelledSessions.map((cs) => (
                  <View key={cs.id} style={[styles.reviewEventCard, { borderColor: Colors.error, opacity: 0.7 }]}>
                    <Ionicons name="close-circle" size={22} color={Colors.error} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reviewEventTitle, { textDecorationLine: 'line-through' }]} numberOfLines={1}>{cs.raw_title}</Text>
                      <Text style={styles.reviewEventMeta}>
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
                  style={[
                    styles.reviewEventCard,
                    isSelected && styles.reviewEventCardSelected,
                  ]}
                  onPress={() => toggleEventSelection(event.calendar_event_id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.reviewCheckbox}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? Colors.primary : Colors.textMuted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewEventTitle} numberOfLines={2}>{event.raw_title}</Text>
                    <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: 3 }}>
                      <Text style={styles.reviewEventMeta}>{dateStr}{timeStr ? ` · ${timeStr}` : ''}</Text>
                      {event.is_past && (
                        <View style={styles.reviewPastBadge}>
                          <Text style={styles.reviewPastBadgeText}>Past</Text>
                        </View>
                      )}
                      {event.likely_write && !event.previously_dismissed && (
                        <View style={styles.reviewWriteBadge}>
                          <Text style={styles.reviewWriteBadgeText}>Likely Write</Text>
                        </View>
                      )}
                      {event.previously_dismissed && (
                        <View style={styles.reviewDismissedBadge}>
                          <Text style={styles.reviewDismissedBadgeText}>Skipped</Text>
                        </View>
                      )}
                    </View>
                    {event.parsed_cowriters.length > 0 && (
                      <Text style={styles.reviewEventCowriters}>
                        Co-writers: {event.parsed_cowriters.join(', ')}
                      </Text>
                    )}
                    {event.location && (
                      <Text style={styles.reviewEventMeta} numberOfLines={1}>📍 {event.location}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
          {/* Import button fixed at bottom */}
          <View style={styles.reviewFooter}>
            <Button
              title={importing ? 'Processing...' : selectedEventIds.size > 0 ? `Import ${selectedEventIds.size} Event${selectedEventIds.size !== 1 ? 's' : ''}${cancelledSessions.length > 0 ? ` & Remove ${cancelledSessions.length}` : ''}` : cancelledSessions.length > 0 ? `Remove ${cancelledSessions.length} Cancelled` : 'Import 0 Events'}
              onPress={handleImportSelected}
              disabled={importing || (selectedEventIds.size === 0 && cancelledSessions.length === 0)}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Add Deal Modal */}
      <Modal visible={dealModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {dealForm.parent_deal_id
                  ? `Add ${PERIOD_LABELS[dealForm.period_type]}`
                  : 'Add Publishing Deal'}
              </Text>
              <TouchableOpacity onPress={() => {
                setDealModalVisible(false)
                setShowNewPublisher(false)
                setNewPublisher({ name: '', email: '' })
                setPublisherError('')
              }}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Period type selector (only for new root deals) */}
            {!dealForm.parent_deal_id && (
              <>
                <Text style={styles.fieldLabel}>Period Type</Text>
                <View style={styles.periodSelector}>
                  {(['initial', 'option_1', 'option_2'] as const).map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.periodChip, dealForm.period_type === type && styles.periodChipActive]}
                      onPress={() => setDealForm({ ...dealForm, period_type: type })}
                    >
                      <Text style={[styles.periodChipText, dealForm.period_type === type && styles.periodChipTextActive]}>
                        {PERIOD_LABELS[type]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Publisher selector */}
            <View style={styles.publisherLabelRow}>
              <Text style={styles.fieldLabel}>Publisher *</Text>
              <TouchableOpacity
                onPress={() => { setShowNewPublisher(!showNewPublisher); setPublisherError('') }}
                style={styles.addPublisherInlineBtn}
              >
                <Ionicons name={showNewPublisher ? 'close-circle-outline' : 'add-circle-outline'} size={16} color={Colors.primary} />
                <Text style={styles.addPublisherInlineText}>
                  {showNewPublisher ? 'Cancel' : 'Add new publisher'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Inline new publisher form */}
            {showNewPublisher && (
              <View style={styles.newPublisherCard}>
                <Input
                  label="Publisher Name *"
                  value={newPublisher.name}
                  onChangeText={(v) => setNewPublisher({ ...newPublisher, name: v })}
                  placeholder="e.g. Warner Chappell"
                  autoCapitalize="words"
                  containerStyle={{ marginBottom: Spacing.sm }}
                />
                <Input
                  label="Submission Email *"
                  value={newPublisher.email}
                  onChangeText={(v) => setNewPublisher({ ...newPublisher, email: v })}
                  placeholder="submissions@publisher.com"
                  keyboardType="email-address"
                  containerStyle={{ marginBottom: Spacing.sm }}
                />
                {publisherError !== '' && (
                  <Text style={styles.errorText}>{publisherError}</Text>
                )}
                <Button
                  title="Save Publisher"
                  onPress={handleSaveNewPublisher}
                  loading={savingPublisher}
                />
              </View>
            )}

            {!showNewPublisher && (
              <>
                {publishers.length === 0 ? (
                  <View style={styles.noPublishers}>
                    <Text style={styles.noPublishersText}>
                      No publishers yet — tap "Add new publisher" above to create one.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.publisherPicker}>
                    {publishers.map((pub) => (
                      <TouchableOpacity
                        key={pub.id}
                        style={[
                          styles.publisherOption,
                          dealForm.publisher_id === pub.id && styles.publisherOptionActive,
                        ]}
                        onPress={() => setDealForm({ ...dealForm, publisher_id: pub.id })}
                      >
                        <Text style={[
                          styles.publisherOptionText,
                          dealForm.publisher_id === pub.id && styles.publisherOptionTextActive,
                        ]}>
                          {pub.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {dealErrors.publisher_id && (
                  <Text style={styles.errorText}>{dealErrors.publisher_id}</Text>
                )}
              </>
            )}

            <DateInput
              label="Start Date *"
              value={dealForm.start_date}
              onChange={(v) => setDealForm({ ...dealForm, start_date: v })}
              error={dealErrors.start_date}
            />
            <DateInput
              label="End Date (optional)"
              value={dealForm.end_date}
              onChange={(v) => setDealForm({ ...dealForm, end_date: v })}
              hint="Leave blank if ongoing"
            />
            <Input
              label="Minimum Song Delivery"
              value={dealForm.min_delivery}
              onChangeText={(v) => setDealForm({ ...dealForm, min_delivery: v })}
              placeholder="e.g. 10 or 7.5"
              keyboardType="decimal-pad"
              error={dealErrors.min_delivery}
              hint="Number of songs owed under this deal period"
            />
            <Input
              label="Notes (optional)"
              value={dealForm.notes}
              onChangeText={(v) => setDealForm({ ...dealForm, notes: v })}
              placeholder="Any deal notes..."
              multiline
              numberOfLines={2}
            />

            <Button title="Save Deal" onPress={handleSaveDeal} loading={savingDeal} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Calendar sync-from date picker */}
      <DatePickerModal
        visible={calendarModalVisible}
        value={calendarSyncFrom}
        onSelect={(ymd) => { setCalendarSyncFrom(ymd); setCalendarModalVisible(false) }}
        onClose={() => setCalendarModalVisible(false)}
      />
    </SafeAreaView>
  )
}

// ── Deal Group Component ────────────────────────────────────────────────────

interface DealGroupProps {
  root: Deal
  options: Deal[]
  deliveredMap: Record<string, number>
  overflowMap: Record<string, number>
  nextOption: 'option_1' | 'option_2' | null
  onAddOption: () => void
  onToggle: (deal: Deal) => void
  onDelete: (deal: Deal) => void
}

function DealGroup({ root, options, deliveredMap, overflowMap, nextOption, onAddOption, onToggle, onDelete }: DealGroupProps) {
  return (
    <View style={dealStyles.group}>
      <DealCard deal={root} delivered={deliveredMap[root.id] ?? 0} overflowCount={overflowMap[root.id] ?? 0} onToggle={onToggle} onDelete={onDelete} />
      {options.map(opt => (
        <View key={opt.id} style={dealStyles.optionRow}>
          <View style={dealStyles.optionConnector}>
            <View style={dealStyles.optionLine} />
            <Ionicons name="return-down-forward" size={14} color={Colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <DealCard deal={opt} delivered={deliveredMap[opt.id] ?? 0} overflowCount={overflowMap[opt.id] ?? 0} onToggle={onToggle} onDelete={onDelete} isOption />
          </View>
        </View>
      ))}
      {nextOption && (
        <TouchableOpacity style={dealStyles.addOptionBtn} onPress={onAddOption}>
          <Ionicons name="add-circle-outline" size={15} color={Colors.primary} />
          <Text style={dealStyles.addOptionText}>
            Add {nextOption === 'option_1' ? 'Option 1' : 'Option 2'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

interface DealCardProps {
  deal: Deal
  delivered: number
  overflowCount: number
  onToggle: (deal: Deal) => void
  onDelete: (deal: Deal) => void
  isOption?: boolean
}

function DealCard({ deal, delivered, overflowCount, onToggle, onDelete, isOption }: DealCardProps) {
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  const total = deal.min_delivery ?? 0
  const hasTarget = total > 0
  const pct = hasTarget ? Math.min(1, delivered / total) : 0

  const progressColor =
    !hasTarget ? Colors.primary :
    pct >= 0.8 ? Colors.success :
    pct >= 0.5 ? Colors.warning :
    Colors.error

  const periodLabel = deal.period_type ? PERIOD_LABELS[deal.period_type] : null

  return (
    <View style={[dealStyles.card, !deal.is_active && dealStyles.cardInactive]}>
      <View style={dealStyles.cardHeader}>
        <View style={dealStyles.cardTitleRow}>
          <Text style={dealStyles.publisher}>{deal.publisher?.name}</Text>
          {periodLabel && (
            <View style={dealStyles.periodBadge}>
              <Text style={dealStyles.periodBadgeText}>{periodLabel}</Text>
            </View>
          )}
          <View style={[dealStyles.statusBadge, deal.is_active ? dealStyles.statusActive : dealStyles.statusInactive]}>
            <Text style={[dealStyles.statusText, deal.is_active ? dealStyles.statusTextActive : dealStyles.statusTextInactive]}>
              {deal.is_active ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
        <Text style={dealStyles.dates}>
          {new Date(deal.start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          {deal.end_date
            ? ` → ${new Date(deal.end_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
            : ' → Present'}
        </Text>
      </View>

      {/* Progress bar */}
      {hasTarget ? (
        <View style={dealStyles.progressSection}>
          <View style={dealStyles.progressLabelRow}>
            <View>
              <Text style={dealStyles.progressLabel}>Delivery progress</Text>
              {overflowCount > 0 && (
                <Text style={dealStyles.overflowLabel}>
                  incl. {overflowCount % 1 === 0 ? overflowCount.toFixed(0) : overflowCount.toFixed(3)} overflow
                </Text>
              )}
            </View>
            <Text style={[dealStyles.progressCount, { color: progressColor }]}>
              {delivered % 1 === 0 ? delivered.toFixed(0) : delivered.toFixed(3)} / {total % 1 === 0 ? total.toFixed(0) : total.toFixed(3)} songs
            </Text>
          </View>
          <View style={dealStyles.progressTrack}>
            <View style={[dealStyles.progressFill, { width: `${pct * 100}%` as any, minWidth: pct > 0 ? 6 : 0, backgroundColor: progressColor }]} />
          </View>
        </View>
      ) : (
        <View style={dealStyles.progressSection}>
          <View style={dealStyles.progressLabelRow}>
            <Text style={dealStyles.progressLabel}>Songs logged</Text>
            <Text style={[dealStyles.progressCount, { color: Colors.primary }]}>
              {delivered % 1 === 0 ? delivered.toFixed(0) : delivered.toFixed(3)} songs
            </Text>
          </View>
        </View>
      )}

      {deal.notes && <Text style={dealStyles.notes}>{deal.notes}</Text>}

      {confirmDelete ? (
        <View style={dealStyles.confirmRow}>
          <Text style={dealStyles.confirmText}>Delete this deal?</Text>
          <TouchableOpacity onPress={() => setConfirmDelete(false)} style={dealStyles.confirmCancelBtn}>
            <Text style={dealStyles.confirmCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(deal)} style={dealStyles.confirmDeleteBtn}>
            <Text style={dealStyles.confirmDeleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={dealStyles.cardActions}>
          <TouchableOpacity onPress={() => onToggle(deal)} style={dealStyles.toggleBtn}>
            <Text style={dealStyles.toggleText}>{deal.is_active ? 'Deactivate' : 'Activate'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setConfirmDelete(true)} style={dealStyles.deleteBtn}>
            <Ionicons name="trash-outline" size={14} color={Colors.error} />
            <Text style={dealStyles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const dealStyles = StyleSheet.create({
  group: { marginBottom: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  cardInactive: { opacity: 0.5 },
  cardHeader: { marginBottom: Spacing.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: 4 },
  publisher: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  periodBadge: { backgroundColor: `${Colors.primary}20`, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.full },
  periodBadgeText: { fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.primary },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  statusActive: { backgroundColor: `${Colors.success}20` },
  statusInactive: { backgroundColor: Colors.border },
  statusText: { fontSize: Fonts.sizes.xs, fontWeight: '700' },
  statusTextActive: { color: Colors.success },
  statusTextInactive: { color: Colors.textMuted },
  dates: { fontSize: Fonts.sizes.sm, color: Colors.textMuted },
  progressSection: { marginBottom: Spacing.xs },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '500' },
  overflowLabel: { fontSize: Fonts.sizes.xs, color: Colors.warning, fontStyle: 'italic', marginTop: 1 },
  progressCount: { fontSize: Fonts.sizes.xs, fontWeight: '700' },
  progressTrack: {
    height: 6, borderRadius: 3,
    backgroundColor: Colors.border, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  notes: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontStyle: 'italic', marginTop: 4, marginBottom: 4 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.md, marginTop: 4 },
  toggleBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  toggleText: { fontSize: Fonts.sizes.xs, color: Colors.primary, fontWeight: '600' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  deleteText: { fontSize: Fonts.sizes.xs, color: Colors.error, fontWeight: '600' },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  confirmText: { flex: 1, fontSize: Fonts.sizes.xs, color: Colors.textSecondary, fontWeight: '600' },
  confirmCancelBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border },
  confirmCancelText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600' },
  confirmDeleteBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm, backgroundColor: Colors.error },
  confirmDeleteText: { fontSize: Fonts.sizes.xs, color: '#fff', fontWeight: '700' },
  optionRow: { flexDirection: 'row', marginTop: 4 },
  optionConnector: { width: 24, alignItems: 'center', paddingTop: Spacing.sm, marginRight: 4 },
  optionLine: { width: 1, flex: 1, backgroundColor: Colors.border, marginBottom: 4 },
  addOptionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm,
    marginTop: 4, alignSelf: 'flex-start',
  },
  addOptionText: { fontSize: Fonts.sizes.xs, color: Colors.primary, fontWeight: '600' },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { marginBottom: Spacing.md },
  hero: { alignItems: 'center', marginBottom: Spacing.xl },
  avatarWrapper: { position: 'relative', marginBottom: Spacing.md },
  avatarImage: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 2, borderColor: `${Colors.primary}50`,
  },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: `${Colors.primary}20`,
    borderWidth: 2, borderColor: `${Colors.primary}50`,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontSize: 40, fontWeight: '800', color: Colors.primary },
  avatarEditBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.background,
  },
  stageName: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  realName: { fontSize: Fonts.sizes.md, color: Colors.textMuted, marginTop: 4 },
  photoError: {
    color: Colors.error, fontSize: Fonts.sizes.xs,
    marginTop: Spacing.sm, textAlign: 'center',
  },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.success}15`, borderWidth: 1,
    borderColor: `${Colors.success}40`, borderRadius: Radius.md,
    padding: Spacing.sm, marginBottom: Spacing.md,
  },
  successText: { color: Colors.success, fontSize: Fonts.sizes.sm, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: `${Colors.error}15`, borderWidth: 1,
    borderColor: `${Colors.error}40`, borderRadius: Radius.md,
    padding: Spacing.sm, marginBottom: Spacing.md,
  },
  errorBannerText: { color: Colors.error, fontSize: Fonts.sizes.sm, fontWeight: '600', flex: 1 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl },
  statCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  statNumber: { fontSize: Fonts.sizes.xxl, fontWeight: '800', color: Colors.textPrimary },
  statLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  section: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteStatusText: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.textPrimary },
  inviteSubText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  inviteButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: `${Colors.primary}20`,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  inviteButtonText: { fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.primary },
  inviteModalDesc: { fontSize: Fonts.sizes.sm, color: Colors.textSecondary, lineHeight: 20 },

  // Calendar
  calendarCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', gap: Spacing.sm,
  },
  calendarConnected: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, width: '100%',
  },
  calendarStatusText: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.textPrimary },
  calendarSubText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  calendarActions: {
    flexDirection: 'row', gap: Spacing.sm, width: '100%', marginTop: Spacing.sm,
  },
  calendarPickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 6, borderRadius: Radius.sm,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  calendarSyncBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 6, borderRadius: Radius.sm,
    backgroundColor: `${Colors.primary}15`, borderWidth: 1, borderColor: Colors.primary,
  },
  calendarSyncText: { fontSize: Fonts.sizes.xs, fontWeight: '700', color: Colors.primary },
  calendarPickerList: {
    width: '100%', marginTop: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  calendarPickerLabel: {
    fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 4,
  },
  calendarPickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  calendarPickerItemActive: { backgroundColor: `${Colors.primary}10` },
  calendarPickerName: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary },
  calendarPickerMeta: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1 },
  calendarPickerClose: { padding: Spacing.sm, alignItems: 'center' },
  calendarPickerCloseText: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600' },
  // Review modal
  reviewEventCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    padding: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewEventCardSelected: {
    borderColor: Colors.primary, backgroundColor: `${Colors.primary}08`,
  },
  reviewCheckbox: { paddingTop: 2 },
  reviewEventTitle: {
    fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary,
  },
  reviewEventMeta: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2,
  },
  reviewEventCowriters: {
    fontSize: Fonts.sizes.xs, color: Colors.textSecondary, marginTop: 4,
  },
  reviewPastBadge: {
    backgroundColor: Colors.surface, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 1,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewPastBadgeText: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  reviewWriteBadge: {
    backgroundColor: `${Colors.primary}15`, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  reviewWriteBadgeText: { fontSize: 10, color: Colors.primary, fontWeight: '700' },
  reviewDismissedBadge: {
    backgroundColor: Colors.surface, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 1,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewDismissedBadgeText: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  reviewFooter: {
    padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  calendarEmptyIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  calendarEmptyTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  calendarEmptyDesc: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 20, maxWidth: 300,
  },
  calendarSyncFromRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    width: '100%', marginTop: Spacing.xs,
  },
  calendarSyncFromLabel: { fontSize: Fonts.sizes.sm, color: Colors.textSecondary, fontWeight: '500' },
  calendarSyncFromPicker: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    flex: 1,
  },
  calendarSyncFromDate: { flex: 1, fontSize: Fonts.sizes.sm, color: Colors.textPrimary },
  calendarConnectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    marginTop: Spacing.xs, width: '100%', justifyContent: 'center',
  },
  calendarConnectText: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: '#fff' },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: Spacing.md,
  },
  sectionTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  addDealButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary,
  },
  addDealText: { color: Colors.primary, fontSize: Fonts.sizes.xs, fontWeight: '600' },
  emptyDeals: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.xs },
  emptyDealsText: { color: Colors.textSecondary, fontWeight: '600', fontSize: Fonts.sizes.sm },
  emptyDealsSubtext: { color: Colors.textMuted, fontSize: Fonts.sizes.xs, textAlign: 'center' },
  emptySongs: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.sm },
  emptySongsText: { color: Colors.textMuted, fontSize: Fonts.sizes.sm },
  actionSheetOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg, padding: Spacing.lg,
    paddingBottom: Spacing.xxl, gap: Spacing.xs,
  },
  actionSheetTitle: {
    fontSize: Fonts.sizes.sm, fontWeight: '700',
    color: Colors.textMuted, textAlign: 'center',
    marginBottom: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  actionSheetOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
  },
  actionSheetOptionText: {
    fontSize: Fonts.sizes.md, fontWeight: '600', color: Colors.textPrimary,
  },
  actionSheetCancel: {
    backgroundColor: 'transparent', justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  actionSheetCancelText: {
    fontSize: Fonts.sizes.md, fontWeight: '600',
    color: Colors.textMuted, textAlign: 'center',
  },
  spotifyHint: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    lineHeight: 18, marginBottom: Spacing.lg,
  },
  viewSongsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  viewSongsText: {
    flex: 1,
    fontSize: Fonts.sizes.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  modalSafe: { flex: 1, backgroundColor: Colors.background },
  modal: { flex: 1, backgroundColor: Colors.background, padding: Spacing.lg },
  modalScroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: Spacing.xl,
  },
  modalTitle: { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.textPrimary },
  fieldLabel: {
    fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm,
  },
  periodSelector: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.lg, flexWrap: 'wrap' },
  periodChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  periodChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  periodChipText: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontWeight: '600' },
  periodChipTextActive: { color: '#fff' },
  publisherPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  publisherOption: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  publisherOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  publisherOptionText: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontWeight: '600' },
  publisherOptionTextActive: { color: '#fff' },
  publisherLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: Spacing.sm,
  },
  addPublisherInlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addPublisherInlineText: { fontSize: Fonts.sizes.xs, color: Colors.primary, fontWeight: '600' },
  newPublisherCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: `${Colors.primary}40`,
  },
  noPublishers: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.md,
  },
  noPublishersText: { color: Colors.textMuted, fontSize: Fonts.sizes.sm },
  errorText: { color: Colors.error, fontSize: Fonts.sizes.xs, marginBottom: Spacing.sm },

  // Team
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  addBtnText: {
    color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.xs,
  },
  teamRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  teamAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: `${Colors.primary}12`,
    alignItems: 'center', justifyContent: 'center',
  },
  teamName: {
    fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary,
  },
  teamRole: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1,
    textTransform: 'capitalize',
  },
  teamEmpty: {
    fontSize: Fonts.sizes.sm, color: Colors.textMuted,
    paddingVertical: Spacing.md, textAlign: 'center',
  },
  roleChip: {
    flex: 1, paddingVertical: 10,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  roleChipActive: {
    backgroundColor: `${Colors.primary}15`, borderColor: Colors.primary,
  },
  roleChipText: {
    fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textMuted,
  },
  roleChipTextActive: {
    color: Colors.primary,
  },
})
