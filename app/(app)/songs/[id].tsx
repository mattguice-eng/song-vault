import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Linking, Modal, Animated, Image,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { Audio, AVPlaybackStatus } from 'expo-av'
import { supabase } from '../../../src/lib/supabase'
import { useAuthStore } from '../../../src/store/authStore'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { Button } from '../../../src/components/Button'
import { DatePickerModal } from '../../../src/components/DatePickerModal'
import { SongWithDetails, SongFile, Cowriter } from '../../../src/types/database'
import { Colors, Spacing, Fonts, Radius, STATUS_LABELS } from '../../../src/utils/constants'
import { sendSubmissionEmail } from '../../../src/lib/email'
import { searchSpotifyTracks, getSpotifyTrack, SpotifyTrackResult } from '../../../src/lib/spotify'

export default function SongDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>()
  const { profile } = useAuthStore()
  const [song, setSong] = useState<SongWithDetails | null>(null)
  const [linkedWrite, setLinkedWrite] = useState<{ event_date: string; raw_title: string; location: string | null; parsed_cowriters: string[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploadingType, setUploadingType] = useState<'work_tape' | 'demo' | null>(null)
  const [editingLyrics, setEditingLyrics] = useState(false)
  const [lyrics, setLyrics] = useState('')
  const [savingLyrics, setSavingLyrics] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'complete' | 'submit' | 'delete_worktape' | 'delete_song' | null>(null)
  const [actionError, setActionError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [datePickerVisible, setDatePickerVisible] = useState(false)
  const [savingDate, setSavingDate] = useState(false)
  const [spotifySearchVisible, setSpotifySearchVisible] = useState(false)
  const [spotifyQuery, setSpotifyQuery] = useState('')
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrackResult[]>([])
  const [spotifySearching, setSpotifySearching] = useState(false)
  const [savingSpotify, setSavingSpotify] = useState(false)
  const [editingCowriters, setEditingCowriters] = useState(false)
  const [cwArtistSuggestion, setCwArtistSuggestion] = useState<any>(null)
  const [cwDraft, setCwDraft] = useState<{
    id: string; name: string; split: string
    songwriter_id: string | null; publisher_name: string; pro: string; ipi_number: string
    searchQuery: string; searchResults: any[]; searching: boolean; showResults: boolean; linked: boolean
  }[]>([])
  const [savingCowriters, setSavingCowriters] = useState(false)

  const isWriter = profile?.role === 'writer'

  // ── Audio player ─────────────────────────────────────────────────────────
  const [playerVisible, setPlayerVisible] = useState(false)
  const [playerFile, setPlayerFile] = useState<SongFile | null>(null)
  const [sound, setSound] = useState<Audio.Sound | null>(null)
  const webAudioRef = React.useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [position, setPosition] = useState(0)      // ms
  const [duration, setDuration] = useState(0)      // ms
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubPosition, setScrubPosition] = useState(0)
  const [backdropActive, setBackdropActive] = useState(false)
  const [playerError, setPlayerError] = useState('')

  // ── Voice recorder ───────────────────────────────────────────────────────
  const [recording, setRecording] = useState<Audio.Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const trackRef = useRef<View>(null)
  const trackWidth = useRef(0)
  const slideAnim = useRef(new Animated.Value(400)).current

  const fetchSong = useCallback(async () => {
    const { data, error } = await supabase
      .from('songs')
      .select(`
        *,
        cowriters(*),
        files:song_files(*),
        artist:artists(*),
        publishing_deal:publishing_deals(*, publisher:publishers(*))
      `)
      .eq('id', id)
      .single()

    if (!error && data) {
      setSong(data as SongWithDetails)
      setLyrics(data.lyrics ?? '')
      // Fetch linked write session
      supabase.from('write_sessions')
        .select('event_date, raw_title, location, parsed_cowriters')
        .eq('song_id', data.id)
        .maybeSingle()
        .then(({ data: ws }) => setLinkedWrite(ws))
      // Backfill release date for tracks linked before this field existed
      if (data.spotify_track_id && !data.spotify_release_date) {
        getSpotifyTrack(data.spotify_track_id).then((track) => {
          if (track?.releaseDate) {
            supabase.from('songs').update({ spotify_release_date: track.releaseDate }).eq('id', data.id)
            setSong((prev) => prev ? { ...prev, spotify_release_date: track.releaseDate } : prev)
          }
        })
      }
    }
    setLoading(false)
  }, [id])

  useEffect(() => { fetchSong() }, [fetchSong])

  // Clean up sound on unmount
  useEffect(() => {
    return () => {
      sound?.unloadAsync()
      if (webAudioRef.current) {
        webAudioRef.current.pause()
        webAudioRef.current = null
      }
    }
  }, [sound])

  const openPlayer = async (file: SongFile) => {
    // Unload any previous sound
    if (sound) {
      await sound.unloadAsync()
      setSound(null)
    }
    if (webAudioRef.current) {
      webAudioRef.current.pause()
      webAudioRef.current = null
    }
    setPlayerFile(file)
    setPosition(0)
    setDuration(0)
    setIsPlaying(false)
    setIsBuffering(true)
    setPlayerError('')
    setBackdropActive(false)
    setPlayerVisible(true)

    // Slide up — useNativeDriver: false for web compatibility
    slideAnim.setValue(400)
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: false,
      tension: 60,
      friction: 12,
    }).start()

    // Enable backdrop after animation so the opening tap doesn't immediately close it
    setTimeout(() => setBackdropActive(true), 400)

    try {
      // Generate a signed URL so playback works regardless of bucket permissions
      let playUri = file.file_url
      try {
        const urlObj = new URL(file.file_url)
        const match = urlObj.pathname.match(/\/object\/(?:public\/)?song-files\/(.+)/)
        const filePath = match?.[1]
        if (filePath) {
          const { data } = await supabase.storage
            .from('song-files')
            .createSignedUrl(decodeURIComponent(filePath), 3600)
          if (data?.signedUrl) playUri = data.signedUrl
        }
      } catch {
        // Fall back to stored URL if signed URL fails
      }

      if (Platform.OS === 'web') {
        // Use HTML5 Audio on web for Safari/iOS compatibility
        const audio = new window.Audio(playUri)
        webAudioRef.current = audio
        audio.addEventListener('loadedmetadata', () => {
          setDuration(audio.duration * 1000)
          setIsBuffering(false)
        })
        audio.addEventListener('timeupdate', () => {
          setPosition(audio.currentTime * 1000)
        })
        audio.addEventListener('playing', () => {
          setIsPlaying(true)
          setIsBuffering(false)
        })
        audio.addEventListener('pause', () => setIsPlaying(false))
        audio.addEventListener('ended', () => {
          setIsPlaying(false)
          setPosition(0)
        })
        audio.addEventListener('error', (e: any) => {
          setIsBuffering(false)
          setPlayerError('Playback failed. Tap play to try again.')
        })
        audio.play().catch(() => {
          // iOS may block autoplay — user can tap play button
          setIsBuffering(false)
          setPlayerError('')
        })
      } else {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: playUri },
          { shouldPlay: true },
          onPlaybackStatusUpdate
        )
        setSound(newSound)
      }
    } catch (err: any) {
      setIsBuffering(false)
      setPlayerError(err?.message ?? String(err))
    }
  }

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return
    setIsBuffering(status.isBuffering)
    setIsPlaying(status.isPlaying)
    setPosition(status.positionMillis)
    setDuration(status.durationMillis ?? 0)
  }

  const closePlayer = async () => {
    setBackdropActive(false)
    Animated.timing(slideAnim, { toValue: 400, duration: 250, useNativeDriver: false }).start(() => {
      setPlayerVisible(false)
      setPlayerFile(null)
    })
    if (webAudioRef.current) {
      webAudioRef.current.pause()
      webAudioRef.current = null
    }
    if (sound) {
      await sound.stopAsync()
      await sound.unloadAsync()
      setSound(null)
    }
    setIsPlaying(false)
    setPosition(0)
    setDuration(0)
  }

  const togglePlayPause = async () => {
    if (Platform.OS === 'web' && webAudioRef.current) {
      if (isPlaying) {
        webAudioRef.current.pause()
      } else {
        webAudioRef.current.play()
      }
      return
    }
    if (!sound) return
    if (isPlaying) {
      await sound.pauseAsync()
    } else {
      await sound.playAsync()
    }
  }

  const handleScrubStart = (x: number) => {
    setScrubbing(true)
    const pct = Math.max(0, Math.min(1, x / trackWidth.current))
    setScrubPosition(pct * duration)
  }

  const handleScrubMove = (x: number) => {
    const pct = Math.max(0, Math.min(1, x / trackWidth.current))
    setScrubPosition(pct * duration)
  }

  const handleScrubEnd = async () => {
    if (Platform.OS === 'web' && webAudioRef.current) {
      webAudioRef.current.currentTime = scrubPosition / 1000
      setPosition(scrubPosition)
      setScrubbing(false)
      return
    }
    if (!sound) { setScrubbing(false); return }
    await sound.setPositionAsync(scrubPosition)
    setPosition(scrubPosition)
    setScrubbing(false)
  }

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min}:${sec.toString().padStart(2, '0')}`
  }

  const displayPosition = scrubbing ? scrubPosition : position
  const progress = duration > 0 ? displayPosition / duration : 0

  const handleUploadFile = async (fileType: 'work_tape' | 'demo') => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      })

      if (result.canceled || !result.assets?.[0]) return

      const file = result.assets[0]
      setUploadingType(fileType)

      // Upload to Supabase Storage
      const ext = file.name.split('.').pop()
      const path = `${song!.artist_id}/${id}/${fileType}_${Date.now()}.${ext}`

      const response = await fetch(file.uri)
      const blob = await response.blob()

      const { error: uploadError } = await supabase.storage
        .from('song-files')
        .upload(path, blob, { contentType: file.mimeType ?? 'audio/mpeg' })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('song-files')
        .getPublicUrl(path)

      // Save file record
      const { error: fileError } = await supabase.from('song_files').insert({
        song_id: id,
        file_type: fileType,
        file_url: publicUrl,
        file_name: file.name,
        file_size: file.size,
        uploaded_by: profile!.id,
      })

      if (fileError) throw fileError

      await fetchSong()
      setSuccessMsg(`${fileType === 'work_tape' ? 'Work tape' : 'Demo'} uploaded!`)
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err: any) {
      setActionError(err.message ?? 'Upload failed')
    } finally {
      setUploadingType(null)
    }
  }

  const handleStartRecording = async () => {
    try {
      if (sound) { await sound.unloadAsync(); setSound(null) }
      const { granted } = await Audio.requestPermissionsAsync()
      if (!granted) { setActionError('Microphone permission is required to record.'); return }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )
      setRecording(newRecording)
      setIsRecording(true)
      setRecordingDuration(0)
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000)
    } catch {
      setActionError('Could not start recording.')
    }
  }

  const handleStopRecording = async () => {
    if (!recording) return
    try {
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null }
      await recording.stopAndUnloadAsync()
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true })
      const uri = recording.getURI()
      setRecording(null)
      setIsRecording(false)
      setRecordingDuration(0)
      if (!uri) throw new Error('No recording URI')
      setUploadingType('work_tape')
      const songTitle = song?.title?.replace(/[^a-z0-9]/gi, '_').toLowerCase() ?? 'recording'
      const fileName = `${songTitle}_worktape_${Date.now()}.m4a`
      const path = `${id}/${fileName}`
      const response = await fetch(uri)
      const blob = await response.blob()
      const { error: uploadError } = await supabase.storage
        .from('song-files')
        .upload(path, blob, { contentType: 'audio/m4a' })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('song-files').getPublicUrl(path)
      const { error: fileError } = await supabase.from('song_files').insert({
        song_id: id,
        file_name: fileName,
        file_url: publicUrl,
        file_type: 'work_tape',
        file_size: blob.size,
        uploaded_by: profile!.id,
      })
      if (fileError) throw fileError
      await fetchSong()
      setSuccessMsg('Work tape recorded!')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err: any) {
      setActionError(err.message ?? 'Recording failed')
    } finally {
      setUploadingType(null)
    }
  }

  const formatRecordingTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const handleSaveLyrics = async () => {
    setSavingLyrics(true)
    const { error } = await supabase
      .from('songs')
      .update({ lyrics })
      .eq('id', id)
    setSavingLyrics(false)
    if (error) {
      setActionError(error.message)
    } else {
      setEditingLyrics(false)
      fetchSong()
    }
  }

  const handleSaveDate = async (ymd: string) => {
    setSavingDate(true)
    const { error } = await supabase
      .from('songs')
      .update({ date_written: ymd })
      .eq('id', id)
    setSavingDate(false)
    if (error) setActionError(error.message)
    else fetchSong()
  }

  const startEditCowriters = async () => {
    const artistDisplayName = (song?.artist as any)?.real_name ?? (song?.artist as any)?.stage_name ?? ''
    let suggestion: any = null
    if (artistDisplayName) {
      const { data } = await supabase
        .from('songwriters')
        .select('id, name, pro, publisher_name, ipi_number')
        .ilike('name', artistDisplayName)
        .maybeSingle()
      suggestion = data ?? { id: null, name: artistDisplayName, pro: null, publisher_name: null, ipi_number: null, _needsCreate: true }
    }
    setCwArtistSuggestion(suggestion)

    setCwDraft(
      (song?.cowriters ?? []).map((cw) => ({
        id: cw.id,
        name: cw.name,
        split: String(cw.split_percentage),
        songwriter_id: cw.songwriter_id ?? null,
        publisher_name: cw.publisher_name ?? '',
        pro: cw.pro ?? '',
        ipi_number: cw.ipi_number ?? '',
        searchQuery: cw.name,
        searchResults: [],
        searching: false,
        showResults: false,
        linked: !!cw.songwriter_id,
      }))
    )
    setEditingCowriters(true)
  }

  const searchCwRegistry = async (idx: number, query: string) => {
    setCwDraft((d) => d.map((c, i) => i === idx ? { ...c, searchQuery: query, linked: false, songwriter_id: null, showResults: true } : c))
    if (!query.trim()) {
      setCwDraft((d) => d.map((c, i) => i === idx ? { ...c, searchResults: cwArtistSuggestion ? [cwArtistSuggestion] : [] } : c))
      return
    }
    setCwDraft((d) => d.map((c, i) => i === idx ? { ...c, searching: true } : c))
    const { data } = await supabase
      .from('songwriters')
      .select('id, name, legal_name, pro, publisher_name, ipi_number')
      .or(`name.ilike.%${query}%,legal_name.ilike.%${query}%`)
      .limit(10)
    setCwDraft((d) => d.map((c, i) => {
      if (i !== idx) return c
      // Dedupe and normalise — show legal_name as display name if name doesn't match
      const q = query.toLowerCase()
      let results = (data ?? []).map((r: any) => ({
        ...r,
        name: r.name.toLowerCase().includes(q) ? r.name : (r.legal_name ?? r.name),
      }))
      if (cwArtistSuggestion && cwArtistSuggestion.name.toLowerCase().includes(q)) {
        const alreadyIn = results.some((r: any) => r.name.toLowerCase() === cwArtistSuggestion.name.toLowerCase())
        if (!alreadyIn) results = [cwArtistSuggestion, ...results]
      }
      return { ...c, searching: false, searchResults: results }
    }))
  }

  const selectCwFromRegistry = async (idx: number, sw: any) => {
    let swId = sw.id
    // If the artist has no registry entry yet, create one now
    if (!swId && sw._needsCreate) {
      const { data } = await supabase.from('songwriters').insert({ name: sw.name }).select('id').single()
      swId = data?.id ?? null
    }
    setCwDraft((d) => d.map((c, i) => i === idx ? {
      ...c,
      name: sw.name,
      songwriter_id: swId,
      publisher_name: sw.publisher_name ?? '',
      pro: sw.pro ?? '',
      ipi_number: sw.ipi_number ?? '',
      searchQuery: sw.name,
      linked: true,
      showResults: false,
      searchResults: [],
    } : c))
  }

  const handleSaveCowriters = async () => {
    const resolved = cwDraft.map((c) => ({ ...c, name: (c.linked ? c.name : c.searchQuery).trim() }))
    const total = resolved.reduce((s, c) => s + (parseFloat(c.split) || 0), 0)
    if (resolved.some((c) => !c.name)) { setActionError('All co-writers must have a name.'); return }
    const roundedTotal = Math.round(total * 100) / 100
    if (Math.abs(roundedTotal - 100) > 0.5) { setActionError(`Splits total ${roundedTotal}% — must equal 100%.`); return }

    setSavingCowriters(true)
    try {
      // For unlinked writers with a name, find or create registry entry
      const enriched = await Promise.all(resolved.map(async (c) => {
        if (c.songwriter_id) return c
        const { data: existing } = await supabase.from('songwriters').select('id').ilike('name', c.name).maybeSingle()
        if (existing) return { ...c, songwriter_id: existing.id }
        const { data: newSw } = await supabase.from('songwriters').insert({ name: c.name }).select('id').single()
        return { ...c, songwriter_id: newSw?.id ?? null }
      }))

      const { error: delErr } = await supabase.from('cowriters').delete().eq('song_id', id)
      if (delErr) throw delErr
      const rows = enriched.map((c) => ({
        song_id: id,
        name: c.name,
        split_percentage: Math.round(parseFloat(c.split) * 100) / 100,
        songwriter_id: c.songwriter_id ?? null,
        publisher_name: c.publisher_name || null,
        pro: c.pro || null,
        ipi_number: c.ipi_number || null,
      }))
      const { error: insErr } = await supabase.from('cowriters').insert(rows)
      if (insErr) throw insErr
      // Keep total_splits in sync — round to avoid floating point drift
      const newTotal = Math.round(rows.reduce((s, r) => s + r.split_percentage, 0) * 100) / 100
      await supabase.from('songs').update({ total_splits: newTotal }).eq('id', id)
      setEditingCowriters(false)
      fetchSong()
    } catch (err: any) {
      setActionError(err.message ?? 'Failed to save')
    } finally {
      setSavingCowriters(false)
    }
  }

  const openSpotifyPreview = async (previewUrl: string, trackName: string) => {
    if (sound) { await sound.unloadAsync(); setSound(null) }
    setPlayerFile({ id: 'spotify', song_id: id as string, file_type: 'demo', file_url: previewUrl, file_name: trackName, file_size: null, duration_seconds: 30, uploaded_by: null, created_at: '' })
    setPosition(0); setDuration(0); setIsPlaying(false); setIsBuffering(true)
    setPlayerError(''); setBackdropActive(false); setPlayerVisible(true)
    slideAnim.setValue(400)
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: false, tension: 60, friction: 12 }).start()
    setTimeout(() => setBackdropActive(true), 400)
    try {
      if (Platform.OS !== 'web') await Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: previewUrl },
        { shouldPlay: true },
        onPlaybackStatusUpdate
      )
      setSound(newSound)
    } catch (err: any) {
      setIsBuffering(false)
      setPlayerError(err?.message ?? String(err))
    }
  }

  const handleSpotifySearch = async (q: string) => {
    setSpotifyQuery(q)
    if (!q.trim()) { setSpotifyResults([]); return }
    setSpotifySearching(true)
    const results = await searchSpotifyTracks(q)
    setSpotifyResults(results)
    setSpotifySearching(false)
  }

  const handleLinkTrack = async (track: SpotifyTrackResult) => {
    setSavingSpotify(true)
    const { error } = await supabase.from('songs').update({
      spotify_track_id: track.id,
      spotify_track_name: track.name,
      spotify_preview_url: track.previewUrl,
      spotify_album_art: track.albumArt,
      spotify_track_url: track.spotifyUrl,
      spotify_release_date: track.releaseDate || null,
    }).eq('id', id)
    setSavingSpotify(false)
    if (error) { setActionError(error.message); return }
    setSpotifySearchVisible(false)
    setSpotifyQuery('')
    setSpotifyResults([])
    fetchSong()
  }

  const handleUnlinkTrack = async () => {
    await supabase.from('songs').update({
      spotify_track_id: null, spotify_track_name: null,
      spotify_preview_url: null, spotify_album_art: null, spotify_track_url: null,
      spotify_release_date: null,
    }).eq('id', id)
    fetchSong()
  }

  const handleMarkComplete = async () => {
    const hasDemo = song?.files?.some((f) => f.file_type === 'demo')
    if (!hasDemo) {
      setActionError('You need to upload a demo before marking this song as complete.')
      return
    }
    setConfirmAction('complete')
  }

  const handleSubmit = async () => {
    if (!song) return
    setConfirmAction('submit')
  }

  const handleConfirm = async () => {
    if (confirmAction === 'complete') {
      await supabase.from('songs').update({ status: 'complete' }).eq('id', id)
      setConfirmAction(null)
      fetchSong()
    } else if (confirmAction === 'submit') {
      setSubmitting(true)
      setConfirmAction(null)
      try {
        await supabase
          .from('songs')
          .update({ status: 'submitted', submitted_at: new Date().toISOString() })
          .eq('id', id)
        await sendSubmissionEmail(song!)
        await fetchSong()
        setSuccessMsg('Submitted! The publisher has been notified and your manager is CC\'d.')
      } catch (err: any) {
        setActionError(err.message)
      } finally {
        setSubmitting(false)
      }
    } else if (confirmAction === 'delete_worktape') {
      setConfirmAction(null)
      try {
        const wtFile = song?.files?.find((f) => f.file_type === 'work_tape')
        if (wtFile) {
          // Delete from storage
          if (wtFile.file_url) {
            const path = wtFile.file_url.split('/song-files/')[1]
            if (path) {
              await supabase.storage.from('song-files').remove([decodeURIComponent(path)])
            }
          }
          // Delete the file record
          await supabase.from('song_files').delete().eq('id', wtFile.id)
          // If song was at work_tape status, revert to logged
          if (song?.status === 'work_tape') {
            await supabase.from('songs').update({ status: 'logged' }).eq('id', id)
          }
          await fetchSong()
          setSuccessMsg('Work tape deleted')
          setTimeout(() => setSuccessMsg(''), 3000)
        }
      } catch (err: any) {
        setActionError(err.message ?? 'Failed to delete work tape')
      }
    } else if (confirmAction === 'delete_song') {
      setConfirmAction(null)
      try {
        // Delete all files from storage
        const filesToDelete = song?.files?.map((f) => {
          const path = f.file_url?.split('/song-files/')[1]
          return path ? decodeURIComponent(path) : null
        }).filter(Boolean) as string[]
        if (filesToDelete?.length) {
          await supabase.storage.from('song-files').remove(filesToDelete)
        }
        // Delete file records, cowriters, then the song itself
        await supabase.from('song_files').delete().eq('song_id', id)
        await supabase.from('cowriters').delete().eq('song_id', id)
        await supabase.from('songs').delete().eq('id', id)
        // Navigate back
        router.back()
      } catch (err: any) {
        setActionError(err.message ?? 'Failed to delete song')
      }
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    )
  }

  if (!song) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ color: Colors.textPrimary, padding: Spacing.lg }}>Song not found.</Text>
      </SafeAreaView>
    )
  }

  const hasWorkTape = song.files?.some((f) => f.file_type === 'work_tape')
  const hasDemo = song.files?.some((f) => f.file_type === 'demo')
  const workTapeFile = song.files?.find((f) => f.file_type === 'work_tape')
  const demoFile = song.files?.find((f) => f.file_type === 'demo')
  const publisher = (song.publishing_deal as any)?.publisher

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => {
            if (from === 'home') router.replace('/(app)/dashboard')
            else router.replace('/(app)/songs')
          }}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <StatusBadge status={song.status} />
            {!isWriter && song.status !== 'submitted' && (
              <TouchableOpacity
                style={styles.headerDeleteBtn}
                onPress={() => setConfirmAction('delete_song')}
              >
                <Ionicons name="trash-outline" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.title}>{song.title}</Text>

        <View style={styles.metaRow}>
          <TouchableOpacity
            style={styles.metaItem}
            onPress={!isWriter ? () => setDatePickerVisible(true) : undefined}
            activeOpacity={isWriter ? 1 : 0.6}
          >
            <Ionicons name="calendar-outline" size={14} color={Colors.textMuted} />
            {savingDate ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.metaText}>
                {new Date(song.date_written + 'T12:00:00').toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </Text>
            )}
            {!isWriter && <Ionicons name="pencil-outline" size={13} color={Colors.textMuted} />}
          </TouchableOpacity>
          {publisher && (
            <View style={styles.metaItem}>
              <Ionicons name="business-outline" size={14} color={Colors.textMuted} />
              <Text style={styles.metaText}>{publisher.name}</Text>
            </View>
          )}
          {linkedWrite && (
            <View style={styles.linkedWriteRow}>
              <Ionicons name="git-merge-outline" size={14} color={Colors.primary} />
              <Text style={styles.linkedWriteText}>
                Write session {new Date(linkedWrite.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {linkedWrite.parsed_cowriters?.length > 0 ? ` — ${linkedWrite.parsed_cowriters.join(', ')}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Progress Steps */}
        <View style={styles.progressSection}>
          <Text style={styles.sectionTitle}>Progress</Text>
          {(['logged', 'work_tape', 'demo_ready', 'complete', 'submitted'] as const).map((step, i) => {
            const statuses = ['logged', 'work_tape', 'demo_ready', 'complete', 'submitted']
            const currentIndex = statuses.indexOf(song.status)
            const stepIndex = statuses.indexOf(step)
            const isDone = stepIndex <= currentIndex
            return (
              <View key={step} style={styles.progressStep}>
                <View style={[styles.progressDot, isDone && styles.progressDotDone]}>
                  {isDone && <Ionicons name="checkmark" size={12} color="#fff" />}
                </View>
                <Text style={[styles.progressLabel, isDone && styles.progressLabelDone]}>
                  {STATUS_LABELS[step]}
                </Text>
              </View>
            )
          })}
        </View>

        {/* Co-Writers */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Co-Writers & Splits</Text>
            {!isWriter && !editingCowriters && (
              <TouchableOpacity onPress={startEditCowriters}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {editingCowriters ? (
            <>
              {cwDraft.map((cw, i) => (
                <View key={cw.id} style={styles.cwEditBlock}>
                  <View style={styles.cwEditRow}>
                    {/* Name / registry search */}
                    <View style={{ flex: 3 }}>
                      <View style={[styles.cwEditInput, styles.cwSearchRow]}>
                        <TextInput
                          style={{ flex: 1, color: Colors.textPrimary, fontSize: Fonts.sizes.sm }}
                          value={cw.linked ? cw.name : cw.searchQuery}
                          editable={!cw.linked}
                          onChangeText={(v) => searchCwRegistry(i, v)}
                          onFocus={() => !cw.linked && setCwDraft((d) => d.map((c, j) => j === i ? { ...c, showResults: true } : c))}
                          placeholder="Search writer..."
                          placeholderTextColor={Colors.textMuted}
                        />
                        {cw.searching && <ActivityIndicator size="small" color={Colors.primary} />}
                        {cw.linked && (
                          <TouchableOpacity onPress={() => setCwDraft((d) => d.map((c, j) => j === i ? { ...c, linked: false, songwriter_id: null, searchQuery: cw.name } : c))}>
                            <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                          </TouchableOpacity>
                        )}
                      </View>
                      {/* Dropdown results */}
                      {cw.showResults && !cw.linked && cw.searchResults.length > 0 && (
                        <View style={styles.cwDropdown}>
                          {cw.searchResults.map((sw: any) => (
                            <TouchableOpacity
                              key={sw.id ?? sw.name}
                              style={styles.cwDropdownItem}
                              onPress={() => selectCwFromRegistry(i, sw)}
                            >
                              <Text style={styles.cwDropdownName}>{sw.name}</Text>
                              {sw.legal_name && sw.legal_name !== sw.name && (
                                <Text style={styles.cwDropdownMeta}>{sw.legal_name}</Text>
                              )}
                              {(sw.pro || sw.publisher_name) && (
                                <Text style={styles.cwDropdownMeta}>{[sw.pro, sw.publisher_name].filter(Boolean).join(' · ')}</Text>
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                    <View style={styles.cwSplitWrapper}>
                      <TextInput
                        style={[styles.cwEditInput, styles.cwSplitInput]}
                        value={cw.split}
                        onChangeText={(v) => setCwDraft((d) => d.map((c, j) => j === i ? { ...c, split: v } : c))}
                        placeholder="%"
                        placeholderTextColor={Colors.textMuted}
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.cwSplitSign}>%</Text>
                    </View>
                    <TouchableOpacity onPress={() => setCwDraft((d) => d.filter((_, j) => j !== i))} style={styles.cwRemoveBtn}>
                      <Ionicons name="close-circle" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                  {cw.linked && (
                    <View style={styles.cwLinkedBadge}>
                      <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
                      <Text style={styles.cwLinkedText}>Linked to registry</Text>
                    </View>
                  )}
                  {!cw.linked && cw.searchQuery.trim().length > 1 && !cw.showResults && (
                    <TouchableOpacity
                      style={styles.cwLinkedBadge}
                      onPress={() => setCwDraft((d) => d.map((c, j) => j === i ? { ...c, name: cw.searchQuery, showResults: false } : c))}
                    >
                      <Ionicons name="person-add-outline" size={12} color={Colors.textMuted} />
                      <Text style={[styles.cwLinkedText, { color: Colors.textMuted }]}>Will add as new writer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              {/* Split total indicator */}
              {(() => {
                const total = Math.round(cwDraft.reduce((s, c) => s + (parseFloat(c.split) || 0), 0) * 100) / 100
                const ok = Math.abs(total - 100) < 0.5
                return (
                  <Text style={[styles.cwTotalText, ok ? styles.cwTotalOk : styles.cwTotalBad]}>
                    Total: {total}% {ok ? '✓' : '— must equal 100%'}
                  </Text>
                )
              })()}

              <TouchableOpacity
                style={styles.cwAddBtn}
                onPress={() => setCwDraft((d) => [...d, { id: Math.random().toString(), name: '', split: '', songwriter_id: null, publisher_name: '', pro: '', ipi_number: '', searchQuery: '', searchResults: cwArtistSuggestion ? [cwArtistSuggestion] : [], searching: false, showResults: true, linked: false }])}
              >
                <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
                <Text style={styles.cwAddText}>Add Co-Writer</Text>
              </TouchableOpacity>

              <View style={styles.cwEditFooter}>
                <TouchableOpacity
                  style={styles.cwCancelBtn}
                  onPress={() => setEditingCowriters(false)}
                >
                  <Text style={styles.cwCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cwSaveBtn}
                  onPress={handleSaveCowriters}
                  disabled={savingCowriters}
                >
                  {savingCowriters
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.cwSaveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              {song.cowriters?.map((cw: Cowriter) => (
                <View key={cw.id} style={styles.cowriterRow}>
                  <View style={styles.cowriterLeft}>
                    <Text style={styles.cowriterName}>{cw.name}</Text>
                    <Text style={styles.cowriterPublisher}>
                      {cw.publisher_name ?? 'No publisher listed'}
                      {cw.pro ? ` · ${cw.pro}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.cowriterSplit}>{cw.split_percentage}%</Text>
                </View>
              ))}
              <View style={styles.splitsTotal}>
                <Text style={styles.splitsTotalLabel}>Total</Text>
                <Text style={[styles.splitsTotalValue, song.total_splits === 100 ? styles.splitsTotalOk : styles.splitsTotalBad]}>
                  {song.total_splits}%
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Files */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Files</Text>

          {/* Work Tape */}
          {confirmAction === 'delete_worktape' ? (
            <View style={styles.fileRowDeleteConfirm}>
              <Ionicons name="warning-outline" size={18} color={Colors.error} />
              <Text style={styles.fileDeleteText} numberOfLines={2}>Delete work tape?</Text>
              <TouchableOpacity style={styles.fileDeleteCancel} onPress={() => setConfirmAction(null)}>
                <Text style={styles.fileDeleteCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fileDeleteConfirmBtn} onPress={handleConfirm}>
                <Ionicons name="trash" size={14} color="#fff" />
                <Text style={styles.fileDeleteConfirmText}>Delete</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <View style={styles.fileRow}>
            <TouchableOpacity
              style={styles.fileInfo}
              onPress={() => workTapeFile && openPlayer(workTapeFile)}
              disabled={!workTapeFile || isRecording}
              activeOpacity={workTapeFile ? 0.7 : 1}
            >
              <Ionicons
                name={isRecording ? 'mic' : 'mic-outline'}
                size={20}
                color={isRecording ? Colors.error : hasWorkTape ? Colors.statusWorkTape : Colors.textMuted}
              />
              <View>
                <Text style={styles.fileLabel}>Work Tape</Text>
                {isRecording ? (
                  <Text style={[styles.fileName, { color: Colors.error }]}>
                    ● REC {formatRecordingTime(recordingDuration)}
                  </Text>
                ) : workTapeFile ? (
                  <Text style={[styles.fileName, styles.fileNamePlayable]} numberOfLines={1}>
                    ▶ {workTapeFile.file_name}
                  </Text>
                ) : (
                  <Text style={styles.fileNameEmpty}>Not uploaded</Text>
                )}
              </View>
            </TouchableOpacity>
            <View style={styles.fileActions}>
              {/* Record button */}
              {!isRecording ? (
                <TouchableOpacity
                  style={styles.recordButton}
                  onPress={handleStartRecording}
                  disabled={uploadingType !== null}
                >
                  <Ionicons name="mic" size={15} color={Colors.error} />
                  <Text style={styles.recordButtonText}>Record</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.stopButton}
                  onPress={handleStopRecording}
                >
                  <Ionicons name="stop" size={15} color="#fff" />
                  <Text style={styles.stopButtonText}>Stop</Text>
                </TouchableOpacity>
              )}
              {/* Upload button */}
              {!isRecording && (
                <TouchableOpacity
                  style={[styles.uploadButton, hasWorkTape && styles.uploadButtonDone]}
                  onPress={() => handleUploadFile('work_tape')}
                  disabled={uploadingType !== null}
                >
                  {uploadingType === 'work_tape' ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <>
                      <Ionicons
                        name={hasWorkTape ? 'refresh-outline' : 'cloud-upload-outline'}
                        size={16}
                        color={hasWorkTape ? Colors.textMuted : Colors.primary}
                      />
                      <Text style={[styles.uploadButtonText, hasWorkTape && styles.uploadButtonTextDone]}>
                        {hasWorkTape ? 'Replace' : 'Upload'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {/* Delete work tape */}
              {hasWorkTape && !isRecording && !isWriter && (
                <TouchableOpacity
                  style={styles.deleteFileButton}
                  onPress={() => setConfirmAction('delete_worktape')}
                >
                  <Ionicons name="trash-outline" size={14} color={Colors.error} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          )}

          {/* Demo */}
          <View style={styles.fileRow}>
            <TouchableOpacity
              style={styles.fileInfo}
              onPress={() => demoFile && openPlayer(demoFile)}
              disabled={!demoFile}
              activeOpacity={demoFile ? 0.7 : 1}
            >
              <Ionicons name="musical-note-outline" size={20} color={hasDemo ? Colors.statusDemoReady : Colors.textMuted} />
              <View>
                <Text style={styles.fileLabel}>Demo</Text>
                {demoFile ? (
                  <Text style={[styles.fileName, styles.fileNamePlayable]} numberOfLines={1}>
                    ▶ {demoFile.file_name}
                  </Text>
                ) : (
                  <Text style={styles.fileNameEmpty}>Not uploaded</Text>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.uploadButton, hasDemo && styles.uploadButtonDone]}
              onPress={() => handleUploadFile('demo')}
              disabled={uploadingType !== null}
            >
              {uploadingType === 'demo' ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Ionicons
                    name={hasDemo ? 'refresh-outline' : 'cloud-upload-outline'}
                    size={16}
                    color={hasDemo ? Colors.textMuted : Colors.primary}
                  />
                  <Text style={[styles.uploadButtonText, hasDemo && styles.uploadButtonTextDone]}>
                    {hasDemo ? 'Replace' : 'Upload'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Released Version — Spotify */}
          <View style={[styles.fileRow, { borderBottomWidth: 0 }]}>
            {song.spotify_track_id ? (
              // Linked — show album art, preview, open in Spotify, unlink
              <TouchableOpacity
                style={styles.fileInfo}
                onPress={() => song.spotify_preview_url && openSpotifyPreview(song.spotify_preview_url, song.spotify_track_name ?? 'Preview')}
                activeOpacity={song.spotify_preview_url ? 0.7 : 1}
                disabled={!song.spotify_preview_url}
              >
                {song.spotify_album_art ? (
                  <Image source={{ uri: song.spotify_album_art }} style={styles.albumArtThumb} />
                ) : (
                  <View style={[styles.albumArtThumb, { backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' }]}>
                    <View style={styles.spotifyDot} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileLabel}>Released</Text>
                  <Text style={[styles.fileName, song.spotify_preview_url && styles.fileNamePlayable]} numberOfLines={1}>
                    {song.spotify_preview_url ? '▶ ' : ''}{song.spotify_track_name}
                  </Text>
                  {song.spotify_release_date ? (
                    <Text style={styles.fileSubLabel}>
                      Released {new Date(song.spotify_release_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ) : (
              // Not linked
              <TouchableOpacity
                style={styles.fileInfo}
                onPress={!isWriter ? () => { setSpotifyQuery(song.title); setSpotifySearchVisible(true); handleSpotifySearch(song.title) } : undefined}
                activeOpacity={isWriter ? 1 : 0.7}
              >
                <View style={[styles.albumArtThumb, { backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' }]}>
                  <View style={[styles.spotifyDot, { opacity: 0.4 }]} />
                </View>
                <View>
                  <Text style={styles.fileLabel}>Released</Text>
                  <Text style={styles.fileNameEmpty}>Not linked</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Right action button */}
            {song.spotify_track_id ? (
              <View style={styles.spotifyLinkedActions}>
                {song.spotify_track_url && (
                  <TouchableOpacity
                    style={styles.uploadButton}
                    onPress={() => Linking.openURL(song.spotify_track_url!)}
                  >
                    <Ionicons name="open-outline" size={14} color={Colors.primary} />
                    <Text style={styles.uploadButtonText}>Spotify</Text>
                  </TouchableOpacity>
                )}
                {!isWriter && (
                  <TouchableOpacity
                    style={[styles.uploadButton, styles.uploadButtonDone]}
                    onPress={handleUnlinkTrack}
                  >
                    <Ionicons name="close-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.uploadButtonTextDone}>Unlink</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : !isWriter && (
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={() => { setSpotifyQuery(song.title); setSpotifySearchVisible(true); handleSpotifySearch(song.title) }}
              >
                <Ionicons name="search-outline" size={16} color={Colors.primary} />
                <Text style={styles.uploadButtonText}>Find</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Lyrics */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Lyrics</Text>
            {!isWriter && !editingLyrics && (
              <TouchableOpacity onPress={() => setEditingLyrics(true)}>
                <Text style={styles.editLink}>
                  {song.lyrics ? 'Edit' : '+ Add Lyrics'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {editingLyrics ? (
            <>
              <TextInput
                style={styles.lyricsInput}
                value={lyrics}
                onChangeText={setLyrics}
                multiline
                placeholder="Verse 1:&#10;&#10;Chorus:&#10;&#10;Verse 2:"
                placeholderTextColor={Colors.textMuted}
                textAlignVertical="top"
              />
              <View style={styles.lyricsActions}>
                <Button
                  title="Cancel"
                  onPress={() => { setEditingLyrics(false); setLyrics(song.lyrics ?? '') }}
                  variant="ghost"
                  fullWidth={false}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Save Lyrics"
                  onPress={handleSaveLyrics}
                  loading={savingLyrics}
                  fullWidth={false}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          ) : song.lyrics ? (
            <Text style={styles.lyricsText}>{song.lyrics}</Text>
          ) : (
            <Text style={styles.lyricsEmpty}>No lyrics added yet</Text>
          )}
        </View>

        {/* Notes */}
        {song.notes && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{song.notes}</Text>
          </View>
        )}


        {/* Inline error/success messages */}
        {actionError !== '' && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
            <Text style={styles.errorBannerText}>{actionError}</Text>
            <TouchableOpacity onPress={() => setActionError('')}>
              <Ionicons name="close" size={16} color={Colors.error} />
            </TouchableOpacity>
          </View>
        )}
        {successMsg !== '' && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.successBannerText}>{successMsg}</Text>
          </View>
        )}

        {/* Inline confirm dialog (not for delete_worktape — that's handled inline in the file row) */}
        {confirmAction !== null && confirmAction !== 'delete_worktape' && (
          <View style={[
            styles.confirmCard,
            confirmAction === 'delete_song' && { borderColor: Colors.error },
          ]}>
            <Text style={styles.confirmText}>
              {confirmAction === 'complete'
                ? 'Mark this song as complete and ready for submission?'
                : confirmAction === 'submit'
                ? 'Submit to the publisher? This will send an email and cannot be undone.'
                : confirmAction === 'delete_song'
                ? `Delete "${song?.title}"? This will permanently remove the song, all attached files, and cowriter data. This cannot be undone.`
                : ''}
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmAction(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmOk,
                  confirmAction === 'delete_song' && styles.confirmOkDestructive,
                ]}
                onPress={handleConfirm}
              >
                <Text style={styles.confirmOkText}>
                  {confirmAction === 'complete' ? 'Mark Complete'
                    : confirmAction === 'submit' ? 'Submit'
                    : confirmAction === 'delete_song' ? 'Delete Song'
                    : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Actions — available to managers and artists, not read-only writers */}
        {!isWriter && (
          <View style={styles.actions}>
            {song.status === 'demo_ready' && (
              <Button title="Mark as Complete" onPress={handleMarkComplete} variant="secondary" />
            )}
            {song.status === 'complete' && (
              <Button
                title="Submit to Publisher 🚀"
                onPress={handleSubmit}
                loading={submitting}
              />
            )}
          </View>
        )}

      </ScrollView>
      {/* ── Spotify Search Modal ──────────────────────────────────────── */}
      <Modal visible={spotifySearchVisible} transparent animationType="fade" onRequestClose={() => setSpotifySearchVisible(false)}>
        <View style={spotifyStyles.backdrop}>
          <View style={spotifyStyles.modal}>
            <View style={spotifyStyles.modalHeader}>
              <View style={[styles.spotifyDot, { width: 14, height: 14, borderRadius: 7 }]} />
              <Text style={spotifyStyles.modalTitle}>Find Released Version</Text>
              <TouchableOpacity onPress={() => setSpotifySearchVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={spotifyStyles.searchRow}>
              <TextInput
                style={spotifyStyles.searchInput}
                value={spotifyQuery}
                onChangeText={handleSpotifySearch}
                placeholder="Search Spotify..."
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />
              {spotifySearching && <ActivityIndicator size="small" color="#1DB954" style={{ marginLeft: 8 }} />}
            </View>
            <ScrollView style={spotifyStyles.results} keyboardShouldPersistTaps="handled">
              {spotifyResults.map((track) => (
                <TouchableOpacity
                  key={track.id}
                  style={spotifyStyles.result}
                  onPress={() => handleLinkTrack(track)}
                  disabled={savingSpotify}
                >
                  {track.albumArt && (
                    <Image source={{ uri: track.albumArt }} style={spotifyStyles.resultArt} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={spotifyStyles.resultName} numberOfLines={1}>{track.name}</Text>
                    <Text style={spotifyStyles.resultArtist} numberOfLines={1}>{track.artists} · {track.releaseDate?.split('-')[0]}</Text>
                  </View>
                  {track.previewUrl && (
                    <Ionicons name="musical-note" size={14} color={Colors.textMuted} style={{ marginLeft: 4 }} />
                  )}
                </TouchableOpacity>
              ))}
              {!spotifySearching && spotifyQuery.length > 0 && spotifyResults.length === 0 && (
                <Text style={spotifyStyles.noResults}>No results found</Text>
              )}
            </ScrollView>
            {savingSpotify && (
              <View style={spotifyStyles.saving}>
                <ActivityIndicator color="#1DB954" />
                <Text style={{ color: Colors.textMuted, marginLeft: 8 }}>Linking...</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Date Picker ───────────────────────────────────────────────── */}
      <DatePickerModal
        visible={datePickerVisible}
        value={song.date_written}
        onSelect={handleSaveDate}
        onClose={() => setDatePickerVisible(false)}
      />

      {/* ── Audio Player Modal ─────────────────────────────────────────── */}
      <Modal visible={playerVisible} transparent animationType="none" onRequestClose={closePlayer}>
        <View style={playerStyles.overlay}>
          <TouchableOpacity
            style={playerStyles.backdrop}
            activeOpacity={1}
            onPress={backdropActive ? closePlayer : undefined}
          />
          <Animated.View style={[playerStyles.sheet, { transform: [{ translateY: slideAnim }] }]}>

            {/* Handle bar */}
            <View style={playerStyles.handle} />

            {/* File type badge */}
            <View style={playerStyles.typeBadge}>
              <Ionicons
                name={playerFile?.file_type === 'work_tape' ? 'mic' : 'musical-note'}
                size={13}
                color={playerFile?.file_type === 'work_tape' ? Colors.statusWorkTape : Colors.statusDemoReady}
              />
              <Text style={[
                playerStyles.typeBadgeText,
                { color: playerFile?.file_type === 'work_tape' ? Colors.statusWorkTape : Colors.statusDemoReady }
              ]}>
                {playerFile?.file_type === 'work_tape' ? 'Work Tape' : 'Demo'}
              </Text>
            </View>

            {/* Song title */}
            <Text style={playerStyles.songTitle} numberOfLines={1}>{song?.title}</Text>
            <Text style={playerStyles.fileName} numberOfLines={1}>{playerFile?.file_name}</Text>

            {/* Scrubber */}
            <View style={playerStyles.scrubberContainer}>
              <Text style={playerStyles.timeLabel}>{formatTime(displayPosition)}</Text>
              <View
                ref={trackRef}
                style={playerStyles.track}
                onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width }}
                onStartShouldSetResponder={() => true}
                onResponderGrant={(e) => handleScrubStart(e.nativeEvent.locationX)}
                onResponderMove={(e) => handleScrubMove(e.nativeEvent.locationX)}
                onResponderRelease={handleScrubEnd}
              >
                <View style={[playerStyles.fill, { width: `${Math.min(100, progress * 100)}%` as any }]} />
                <View style={[playerStyles.thumb, { left: `${Math.min(100, progress * 100)}%` as any }]} />
              </View>
              <Text style={playerStyles.timeLabel}>{formatTime(duration)}</Text>
            </View>

            {/* Error state */}
            {playerError !== '' ? (
              <View style={playerStyles.errorState}>
                <Ionicons name="alert-circle-outline" size={32} color={Colors.error} />
                <Text style={playerStyles.errorText}>Playback failed:{'\n'}{playerError}</Text>
                <TouchableOpacity onPress={closePlayer} style={playerStyles.closeBtn}>
                  <Text style={playerStyles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Controls */
              <View style={playerStyles.controls}>
                <TouchableOpacity
                  onPress={async () => {
                    if (Platform.OS === 'web' && webAudioRef.current) {
                      webAudioRef.current.currentTime = Math.max(0, webAudioRef.current.currentTime - 15)
                    } else if (sound) {
                      await sound.setPositionAsync(Math.max(0, position - 15000))
                    }
                  }}
                  style={playerStyles.skipBtn}
                >
                  <Ionicons name="play-back" size={28} color={Colors.textSecondary} />
                  <Text style={playerStyles.skipLabel}>15</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={togglePlayPause} style={playerStyles.playBtn} disabled={isBuffering}>
                  {isBuffering ? (
                    <ActivityIndicator size="large" color="#fff" />
                  ) : (
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color="#fff" />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={async () => {
                    if (Platform.OS === 'web' && webAudioRef.current) {
                      webAudioRef.current.currentTime = Math.min(webAudioRef.current.duration || 0, webAudioRef.current.currentTime + 15)
                    } else if (sound) {
                      await sound.setPositionAsync(Math.min(duration, position + 15000))
                    }
                  }}
                  style={playerStyles.skipBtn}
                >
                  <Ionicons name="play-forward" size={28} color={Colors.textSecondary} />
                  <Text style={playerStyles.skipLabel}>15</Text>
                </TouchableOpacity>
              </View>
            )}

          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerDeleteBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: Fonts.sizes.xxxl, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5, marginBottom: Spacing.sm },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: Fonts.sizes.sm, color: Colors.textMuted },
  linkedWriteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 6, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  linkedWriteText: { fontSize: Fonts.sizes.xs, color: Colors.primary, fontWeight: '500', flex: 1 },
  progressSection: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  progressStep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  progressDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  progressDotDone: { backgroundColor: Colors.success },
  progressLabel: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontWeight: '500' },
  progressLabelDone: { color: Colors.textPrimary },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sectionTitle: { fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.md },
  cowriterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cowriterLeft: { flex: 1 },
  cowriterName: { fontSize: Fonts.sizes.md, fontWeight: '600', color: Colors.textPrimary },
  cowriterPublisher: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  cowriterSplit: { fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary, marginLeft: Spacing.md },
  splitsTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.sm, paddingTop: Spacing.sm },
  splitsTotalLabel: { fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.textSecondary },
  splitsTotalValue: { fontSize: Fonts.sizes.lg, fontWeight: '800' },
  splitsTotalOk: { color: Colors.success },
  splitsTotalBad: { color: Colors.error },
  fileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  fileActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  recordButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.sm, backgroundColor: `${Colors.error}15`, borderWidth: 1, borderColor: Colors.error },
  recordButtonText: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.error },
  stopButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.sm, backgroundColor: Colors.error, borderWidth: 1, borderColor: Colors.error },
  stopButtonText: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: '#fff' },
  fileInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  fileLabel: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary },
  fileName: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, maxWidth: 180 },
  fileSubLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1 },
  fileNamePlayable: { color: Colors.primary },
  fileNameEmpty: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontStyle: 'italic' },
  uploadButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.sm, backgroundColor: `${Colors.primary}15`, borderWidth: 1, borderColor: Colors.primary },
  uploadButtonDone: { backgroundColor: Colors.surfaceElevated, borderColor: Colors.border },
  uploadButtonText: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.primary },
  uploadButtonTextDone: { color: Colors.textMuted },
  editLink: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600' },
  lyricsInput: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, padding: Spacing.md, color: Colors.textPrimary, fontSize: Fonts.sizes.md, minHeight: 200, borderWidth: 1, borderColor: Colors.border, lineHeight: 22, marginBottom: Spacing.sm },
  lyricsActions: { flexDirection: 'row', gap: Spacing.sm },
  lyricsText: { fontSize: Fonts.sizes.md, color: Colors.textPrimary, lineHeight: 24, whiteSpace: 'pre-wrap' } as any,
  lyricsEmpty: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontStyle: 'italic' },
  notesText: { fontSize: Fonts.sizes.md, color: Colors.textSecondary, lineHeight: 22 },
  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
  cwEditBlock: { marginBottom: Spacing.sm },
  cwEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  cwSearchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 0 },
  cwDropdown: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.sm, marginTop: 2, overflow: 'hidden',
  },
  cwDropdownItem: { padding: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cwDropdownName: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary },
  cwDropdownMeta: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 1 },
  cwLinkedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  cwLinkedText: { fontSize: Fonts.sizes.xs, color: Colors.success, fontWeight: '500' },
  cwEditInput: {
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 8,
    color: Colors.textPrimary, fontSize: Fonts.sizes.sm,
  },
  cwSplitWrapper: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cwSplitInput: { flex: 1, textAlign: 'right' },
  cwSplitSign: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, marginLeft: 2 },
  cwRemoveBtn: { padding: 2 },
  cwTotalText: { fontSize: Fonts.sizes.xs, fontWeight: '700', textAlign: 'right', marginBottom: Spacing.sm },
  cwTotalOk: { color: Colors.success },
  cwTotalBad: { color: Colors.error },
  cwAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.xs, marginBottom: Spacing.sm },
  cwAddText: { fontSize: Fonts.sizes.sm, color: Colors.primary, fontWeight: '600' },
  cwEditFooter: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  cwCancelBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  cwCancelText: { color: Colors.textMuted, fontWeight: '600', fontSize: Fonts.sizes.sm },
  cwSaveBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  cwSaveText: { color: '#fff', fontWeight: '700', fontSize: Fonts.sizes.sm },
  spotifyDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#1DB954' },
  albumArtThumb: { width: 36, height: 36, borderRadius: Radius.sm },
  spotifyLinkedActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.error}15`, borderWidth: 1,
    borderColor: `${Colors.error}40`, borderRadius: Radius.md,
    padding: Spacing.sm, marginBottom: Spacing.sm,
  },
  errorBannerText: { flex: 1, color: Colors.error, fontSize: Fonts.sizes.sm },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: `${Colors.success}15`, borderWidth: 1,
    borderColor: `${Colors.success}40`, borderRadius: Radius.md,
    padding: Spacing.sm, marginBottom: Spacing.sm,
  },
  successBannerText: { flex: 1, color: Colors.success, fontSize: Fonts.sizes.sm },
  confirmCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.warning,
  },
  confirmText: { color: Colors.textPrimary, fontSize: Fonts.sizes.sm, lineHeight: 20, marginBottom: Spacing.md },
  confirmButtons: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  confirmCancel: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
  },
  confirmCancelText: { color: Colors.textMuted, fontSize: Fonts.sizes.sm, fontWeight: '600' },
  confirmOk: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: Colors.primary,
  },
  confirmOkDestructive: {
    backgroundColor: Colors.error,
  },
  confirmOkText: { color: '#fff', fontSize: Fonts.sizes.sm, fontWeight: '700' },
  deleteFileButton: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: `${Colors.error}12`, borderWidth: 1, borderColor: `${Colors.error}30`,
    alignItems: 'center', justifyContent: 'center',
  },
  fileRowDeleteConfirm: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: `${Colors.error}08`, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, marginBottom: 1,
  },
  fileDeleteText: { flex: 1, fontSize: Fonts.sizes.sm, color: Colors.error, fontWeight: '600' },
  fileDeleteCancel: {
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  fileDeleteCancelText: { fontSize: Fonts.sizes.xs, fontWeight: '600', color: Colors.textMuted },
  fileDeleteConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderRadius: Radius.sm, backgroundColor: Colors.error,
  },
  fileDeleteConfirmText: { fontSize: Fonts.sizes.xs, fontWeight: '700', color: '#fff' },
})

const spotifyStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', padding: Spacing.lg,
  },
  modal: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border, maxHeight: 480,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 16,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { flex: 1, fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.textPrimary },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  searchInput: {
    flex: 1, fontSize: Fonts.sizes.md, color: Colors.textPrimary,
    paddingVertical: 8,
  },
  results: { maxHeight: 320 },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  resultArt: { width: 44, height: 44, borderRadius: Radius.sm },
  resultName: { fontSize: Fonts.sizes.sm, fontWeight: '600', color: Colors.textPrimary },
  resultArtist: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, marginTop: 2 },
  noResults: { padding: Spacing.lg, textAlign: 'center', color: Colors.textMuted, fontSize: Fonts.sizes.sm },
  saving: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
})

const playerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.xl,
    paddingBottom: 48,
    paddingTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 20,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.lg,
  },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'center', marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.md, paddingVertical: 5,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
  },
  typeBadgeText: { fontSize: Fonts.sizes.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  songTitle: {
    fontSize: Fonts.sizes.xl, fontWeight: '800',
    color: Colors.textPrimary, textAlign: 'center',
    marginBottom: 4,
  },
  fileName: {
    fontSize: Fonts.sizes.xs, color: Colors.textMuted,
    textAlign: 'center', marginBottom: Spacing.xl,
  },
  scrubberContainer: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.sm, marginBottom: Spacing.xl,
  },
  timeLabel: { fontSize: Fonts.sizes.xs, color: Colors.textMuted, fontWeight: '600', minWidth: 36 },
  track: {
    flex: 1, height: 5, borderRadius: 3,
    backgroundColor: Colors.border,
    justifyContent: 'center',
    position: 'relative',
  },
  fill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: Colors.primary, borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.primary,
    marginLeft: -8,
    top: -5.5,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  controls: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: Spacing.xxl,
  },
  playBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  skipBtn: {
    alignItems: 'center', justifyContent: 'center',
    width: 48, height: 48,
  },
  skipLabel: {
    fontSize: 10, fontWeight: '700',
    color: Colors.textMuted, marginTop: -2,
  },
  errorState: {
    alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  errorText: {
    fontSize: Fonts.sizes.sm, color: Colors.error,
    textAlign: 'center', maxWidth: 260,
  },
  closeBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
  },
  closeBtnText: { fontSize: Fonts.sizes.sm, color: Colors.textMuted, fontWeight: '600' },
})
