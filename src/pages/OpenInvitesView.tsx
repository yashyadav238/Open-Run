import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  Clock,
  Copy,
  Flag,
  MapPin,
  Megaphone,
  Navigation,
  Play,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { PlaceSearchInput } from '../components/PlaceSearchInput';
import { WorkoutIcon, WorkoutSelector } from '../components/WorkoutIcon';
import { TRICITY_START_PRESETS } from '../data/tricityPlaces';
import {
  ALL_WORKOUT_TYPES,
  estimateDurationSecForWorkout,
  getWorkoutMeta,
  normalizeWorkoutType,
} from '../data/workouts';
import { isChandigarhCityName, type ActiveRunningCity } from '../data/worldCities';
import { computeKmMarkers, decodePolyline, formatDistance } from '../lib/geo';
import {
  cancelOpenRunInvite,
  checkUserJoinedEvents,
  createOpenRunInvite,
  deleteOpenRunInvite,
  joinOpenRunInvite,
  leaveOpenRunInvite,
  subscribeEventRsvps,
  subscribeOpenRunInvites,
} from '../services/firestoreService';
import type {
  GeneratedRouteCandidate,
  LatLngLiteral,
  OpenEventRsvpDoc,
  OpenEventType,
  OpenRunInviteDoc,
  SavedRouteDoc,
  WorkoutType,
} from '../types/run';

interface OpenInvitesViewProps {
  userId: string | null;
  userName: string;
  emailVerified: boolean;
  preferredUnit: 'km' | 'mi';
  defaultWorkoutType?: WorkoutType;
  activeCity: ActiveRunningCity;
  savedRoutes: SavedRouteDoc[];
  preselectedRoute?: SavedRouteDoc | null;
  onClearPreselectedRoute?: () => void;
  onStartRoute?: (route: GeneratedRouteCandidate) => void;
  onPlanAtLocation?: (loc: {
    name: string;
    lat: number;
    lng: number;
    distanceKm: number;
    workoutType?: WorkoutType;
  }) => void;
  onOpenAuth: () => void;
}

const FOOT_DISTANCE_CHIPS: Array<{ label: string; km: number; defaultType: OpenEventType }> = [
  { label: '3K Fun', km: 3, defaultType: 'fun_run' },
  { label: '5K Fun', km: 5, defaultType: 'fun_run' },
  { label: '10K', km: 10, defaultType: 'fun_run' },
  { label: '21.1K Half', km: 21.1, defaultType: 'marathon' },
  { label: '42.2K Full', km: 42.2, defaultType: 'marathon' },
];

const CYCLING_DISTANCE_CHIPS: Array<{ label: string; km: number; defaultType: OpenEventType }> = [
  { label: '15K Ride', km: 15, defaultType: 'fun_run' },
  { label: '25K Ride', km: 25, defaultType: 'fun_run' },
  { label: '40K', km: 40, defaultType: 'fun_run' },
  { label: '60K Fondo', km: 60, defaultType: 'marathon' },
  { label: '100K Century', km: 100, defaultType: 'marathon' },
];

const FOOT_PACE_OPTIONS = [
  'All Paces Welcome',
  '4:45 – 5:15 /km (Tempo)',
  '5:30 – 6:00 /km (Steady)',
  '6:00 – 6:45 /km (Social)',
  '7:00+ /km (Casual / Walk)',
];

const CYCLING_SPEED_OPTIONS = [
  'All Speeds Welcome',
  '28 – 34 km/h (Fast Peloton)',
  '22 – 27 km/h (Steady Endurance)',
  '16 – 21 km/h (Social Group Ride)',
  '12 – 16 km/h (Beginner Easy Spin)',
];

function defaultNextSundayMorning(): string {
  const now = new Date();
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  const target = new Date(now.getTime() + daysUntilSunday * 86400 * 1000);
  target.setHours(6, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T06:00`;
}

function formatEventDateTime(raw: string): { dateLabel: string; timeLabel: string } {
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) {
    return { dateLabel: raw, timeLabel: '' };
  }
  return {
    dateLabel: dt.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
    timeLabel: dt.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
}

function MiniRoutePreview({ encodedPolyline }: { encodedPolyline: string }) {
  const pts = useMemo(() => decodePolyline(encodedPolyline), [encodedPolyline]);
  if (pts.length < 2) return null;

  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spanLat = Math.max(0.0008, maxLat - minLat);
  const spanLngScaled = Math.max(0.0008, (maxLng - minLng) * cosLat);
  const scale = Math.min(46 / spanLngScaled, 46 / spanLat);
  const svgPts = pts
    .map((p) => {
      const x = 32 + (p.lng - (minLng + maxLng) / 2) * cosLat * scale;
      const y = 32 - (p.lat - midLat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="h-14 w-14 shrink-0 rounded-xl bg-[#172D27] p-1">
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <polyline
          fill="none"
          stroke="#9AE62E"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={svgPts}
        />
      </svg>
    </div>
  );
}

export const OpenInvitesView: React.FC<OpenInvitesViewProps> = ({
  userId,
  userName,
  emailVerified,
  preferredUnit,
  defaultWorkoutType = 'running',
  activeCity,
  savedRoutes,
  preselectedRoute,
  onClearPreselectedRoute,
  onStartRoute,
  onPlanAtLocation,
  onOpenAuth,
}) => {
  const isChandigarhCity = isChandigarhCityName(activeCity.name);
  const [invites, setInvites] = useState<OpenRunInviteDoc[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [joinedEventIds, setJoinedEventIds] = useState<Set<string>>(new Set());

  const [filterType, setFilterType] = useState<'all' | OpenEventType | 'mine'>('all');
  const [sportFilter, setSportFilter] = useState<'all' | WorkoutType>('all');
  const [search, setSearch] = useState('');

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(Boolean(preselectedRoute));
  const [workoutType, setWorkoutType] = useState<WorkoutType>(
    normalizeWorkoutType(preselectedRoute?.workoutType ?? defaultWorkoutType)
  );
  const [eventType, setEventType] = useState<OpenEventType>('fun_run');
  const [title, setTitle] = useState('');
  const [distanceKm, setDistanceKm] = useState<number>(
    normalizeWorkoutType(defaultWorkoutType) === 'cycling' ? 25 : 5
  );
  const [eventDateTime, setEventDateTime] = useState<string>(defaultNextSundayMorning);
  const [selectedPresetName, setSelectedPresetName] = useState<string>(
    isChandigarhCity ? TRICITY_START_PRESETS[0].name : '__custom__'
  );
  const [customMeetingPoint, setCustomMeetingPoint] = useState(
    isChandigarhCity ? '' : `${activeCity.name} Center`
  );
  const [customMeetingCoords, setCustomMeetingCoords] = useState<LatLngLiteral | null>({
    lat: activeCity.lat,
    lng: activeCity.lng,
  });
  const [attachedRouteId, setAttachedRouteId] = useState<string>(preselectedRoute?.id || '');
  const [targetPace, setTargetPace] = useState<string>(
    normalizeWorkoutType(defaultWorkoutType) === 'cycling'
      ? CYCLING_SPEED_OPTIONS[0]
      : FOOT_PACE_OPTIONS[0]
  );
  const [maxParticipants, setMaxParticipants] = useState<number>(50);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!showCreateForm && !preselectedRoute) {
      const wt = normalizeWorkoutType(defaultWorkoutType);
      setWorkoutType(wt);
      setTargetPace(wt === 'cycling' ? CYCLING_SPEED_OPTIONS[0] : FOOT_PACE_OPTIONS[0]);
      setDistanceKm(wt === 'cycling' ? 25 : 5);
    }
  }, [defaultWorkoutType, showCreateForm, preselectedRoute]);

  useEffect(() => {
    if (preselectedRoute) return;
    if (isChandigarhCityName(activeCity.name)) {
      setSelectedPresetName(TRICITY_START_PRESETS[0].name);
    } else {
      setSelectedPresetName('__custom__');
      setCustomMeetingPoint(`${activeCity.name} Center`);
      setCustomMeetingCoords({ lat: activeCity.lat, lng: activeCity.lng });
    }
  }, [activeCity.name, activeCity.lat, activeCity.lng, preselectedRoute]);

  // Per-card actions
  const [joiningEventId, setJoiningEventId] = useState<string | null>(null);
  const [joinPaceDraft, setJoinPaceDraft] = useState('');
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [expandedRsvpEventId, setExpandedRsvpEventId] = useState<string | null>(null);
  const [expandedRsvps, setExpandedRsvps] = useState<OpenEventRsvpDoc[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sync preselected route if passed from Saved Routes
  useEffect(() => {
    if (!preselectedRoute) return;
    const km = Number((preselectedRoute.distanceMeters / 1000).toFixed(1));
    const wt = normalizeWorkoutType(preselectedRoute.workoutType);
    const meta = getWorkoutMeta(wt);
    setShowCreateForm(true);
    setWorkoutType(wt);
    setTargetPace(wt === 'cycling' ? CYCLING_SPEED_OPTIONS[0] : FOOT_PACE_OPTIONS[0]);
    setAttachedRouteId(preselectedRoute.id);
    setTitle(`${preselectedRoute.name} Open ${meta.label}`);
    setDistanceKm(Math.max(1, km));
    setEventType(km >= (wt === 'cycling' ? 50 : 18) ? 'marathon' : 'fun_run');
    setSelectedPresetName('__custom__');
    setCustomMeetingPoint(preselectedRoute.startName || activeCity.name);
    setCustomMeetingCoords({ lat: preselectedRoute.startLat, lng: preselectedRoute.startLng });
    setFormError(null);
  }, [preselectedRoute, activeCity.name]);

  // Subscribe to open invites globally
  useEffect(() => {
    setLoadingInvites(true);
    try {
      const unsub = subscribeOpenRunInvites((items) => {
        setInvites(items);
        setLoadingInvites(false);
        setFeedError(null);
      });
      return () => unsub();
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Unable to load open invites.');
      setLoadingInvites(false);
      return undefined;
    }
  }, []);

  // Check which open events the signed-in user has already joined
  useEffect(() => {
    if (!userId || invites.length === 0) {
      setJoinedEventIds(new Set());
      return;
    }
    let cancelled = false;
    checkUserJoinedEvents(
      invites.map((i) => i.id),
      userId
    )
      .then((joined) => {
        if (!cancelled) setJoinedEventIds(joined);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, invites]);

  // Subscribe to live participant roster for the expanded card
  useEffect(() => {
    if (!expandedRsvpEventId || !userId) {
      setExpandedRsvps([]);
      return;
    }
    const unsub = subscribeEventRsvps(expandedRsvpEventId, setExpandedRsvps);
    return () => unsub();
  }, [expandedRsvpEventId, userId]);

  const attachedSavedRoute = useMemo(
    () => savedRoutes.find((r) => r.id === attachedRouteId) || null,
    [savedRoutes, attachedRouteId]
  );

  const handleSelectSavedRoute = (routeId: string) => {
    setAttachedRouteId(routeId);
    const sr = savedRoutes.find((r) => r.id === routeId);
    if (!sr) return;
    const km = Number((sr.distanceMeters / 1000).toFixed(1));
    const wt = normalizeWorkoutType(sr.workoutType);
    const meta = getWorkoutMeta(wt);
    setWorkoutType(wt);
    setTargetPace(wt === 'cycling' ? CYCLING_SPEED_OPTIONS[0] : FOOT_PACE_OPTIONS[0]);
    setDistanceKm(Math.max(1, km));
    if (!title.trim()) {
      setTitle(`${sr.name} Open Group ${meta.label}`);
    }
    setEventType(km >= (wt === 'cycling' ? 50 : 18) ? 'marathon' : 'fun_run');
    setSelectedPresetName('__custom__');
    setCustomMeetingPoint(sr.startName || activeCity.name);
    setCustomMeetingCoords({ lat: sr.startLat, lng: sr.startLng });
  };

  const handleFormWorkoutChange = (next: WorkoutType) => {
    setWorkoutType(next);
    if (next === 'cycling') {
      if (distanceKm < 10) setDistanceKm(25);
      setTargetPace(CYCLING_SPEED_OPTIONS[0]);
    } else {
      if (distanceKm > 50) setDistanceKm(5);
      setTargetPace(FOOT_PACE_OPTIONS[0]);
    }
  };

  const handleSubmitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      onOpenAuth();
      return;
    }
    if (!emailVerified) {
      setFormError('Please verify your email address in Profile before posting an open invite.');
      return;
    }
    const cleanTitle = title.trim();
    if (cleanTitle.length < 3) {
      setFormError('Please enter a clear event title (at least 3 characters).');
      return;
    }
    const presetLoc = TRICITY_START_PRESETS.find((p) => p.name === selectedPresetName);
    const meetingPoint =
      selectedPresetName === '__custom__' ? customMeetingPoint.trim() : presetLoc?.name || '';
    if (meetingPoint.length < 2) {
      setFormError('Please select or enter a meeting point.');
      return;
    }
    if (!eventDateTime) {
      setFormError('Please choose a date and start time.');
      return;
    }

    const lat =
      attachedSavedRoute?.startLat ??
      (selectedPresetName === '__custom__' ? customMeetingCoords?.lat : presetLoc?.lat) ??
      activeCity.lat;
    const lng =
      attachedSavedRoute?.startLng ??
      (selectedPresetName === '__custom__' ? customMeetingCoords?.lng : presetLoc?.lng) ??
      activeCity.lng;

    setSubmitting(true);
    setFormError(null);
    try {
      const createdId = await createOpenRunInvite(userId, userName, {
        eventType,
        workoutType,
        title: cleanTitle,
        description: description.trim() || undefined,
        distanceKm,
        eventDateTime,
        meetingPoint,
        city: attachedSavedRoute?.city || activeCity.name,
        lat,
        lng,
        targetPace,
        maxParticipants,
        routeId: attachedSavedRoute?.id,
        routeName: attachedSavedRoute?.name,
        encodedPolyline: attachedSavedRoute?.encodedPolyline,
        paceNote: `Host · ${targetPace}`,
      });

      setJoinedEventIds((prev) => new Set([...prev, createdId]));
      setShowCreateForm(false);
      setTitle('');
      setDescription('');
      setAttachedRouteId('');
      onClearPreselectedRoute?.();
      setFeedbackMsg(
        'Open invite published! Other athletes can now discover and join this workout without needing a personal DM.'
      );
      setTimeout(() => setFeedbackMsg(null), 5500);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to publish open invite.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmJoin = async (evt: OpenRunInviteDoc) => {
    if (!userId) {
      onOpenAuth();
      return;
    }
    if (!emailVerified) {
      setFeedError('Please verify your email address in Profile before joining an open event.');
      return;
    }
    setBusyEventId(evt.id);
    setFeedError(null);
    try {
      await joinOpenRunInvite(evt.id, userId, userName, joinPaceDraft.trim() || undefined);
      setJoinedEventIds((prev) => new Set([...prev, evt.id]));
      setJoiningEventId(null);
      setJoinPaceDraft('');
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Unable to join event.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleLeave = async (evt: OpenRunInviteDoc) => {
    if (!userId) return;
    setBusyEventId(evt.id);
    setFeedError(null);
    try {
      await leaveOpenRunInvite(evt.id, userId);
      setJoinedEventIds((prev) => {
        const next = new Set(prev);
        next.delete(evt.id);
        return next;
      });
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Unable to leave event.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleShareInvite = async (evt: OpenRunInviteDoc) => {
    const { dateLabel, timeLabel } = formatEventDateTime(evt.eventDateTime);
    const sportMeta = getWorkoutMeta(evt.workoutType);
    const kindLabel = evt.eventType === 'marathon' ? 'Endurance' : 'Social';
    const text = `Open ${sportMeta.fullLabel} (${kindLabel}): ${evt.title} (${evt.distanceKm} km)\nWhen: ${dateLabel} ${timeLabel}\nMeet at: ${evt.meetingPoint}, ${evt.city}\nPace/Speed: ${evt.targetPace || 'All Levels Welcome'}\nHosted by ${evt.hostName} on OPEN RUN — open for everyone!`;

    if (navigator.share) {
      try {
        await navigator.share({ title: evt.title, text });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(evt.id);
      setTimeout(() => setCopiedId((cur) => (cur === evt.id ? null : cur)), 2500);
    } catch {
      setFeedbackMsg(text);
    }
  };

  const handleLaunchAttachedRoute = (evt: OpenRunInviteDoc) => {
    if (!evt.encodedPolyline || !onStartRoute) return;
    const path = decodePolyline(evt.encodedPolyline);
    if (path.length < 2) return;
    const wt = normalizeWorkoutType(evt.workoutType);
    const sportMeta = getWorkoutMeta(wt);
    const diff = evt.distanceKm >= (wt === 'cycling' ? 50 : 15) ? 'challenging' : 'moderate';
    const candidate: GeneratedRouteCandidate = {
      id: evt.routeId || evt.id,
      workoutType: wt,
      label: 'Event Route',
      name: evt.routeName || evt.title,
      routeType: 'circular',
      distanceMeters: Math.round(evt.distanceKm * 1000),
      targetDistanceMeters: Math.round(evt.distanceKm * 1000),
      durationSec: estimateDurationSecForWorkout(evt.distanceKm * 1000, wt, diff),
      elevationGainMeters: 0,
      start: { name: evt.meetingPoint, lat: evt.lat ?? path[0].lat, lng: evt.lng ?? path[0].lng },
      end: { name: evt.meetingPoint, lat: path[path.length - 1].lat, lng: path[path.length - 1].lng },
      encodedPolyline: evt.encodedPolyline,
      path,
      steps: [],
      kmMarkers: computeKmMarkers(path),
      characteristics: [`Open Group ${sportMeta.label} Route`],
      surfaceSummary: `Open ${sportMeta.fullLabel} · ${evt.meetingPoint}`,
      preferences: [],
      difficulty: diff,
      toleranceDiffPct: 0,
    };
    onStartRoute(candidate);
  };

  const filteredInvites = useMemo(() => {
    return invites.filter((evt) => {
      if (sportFilter !== 'all' && normalizeWorkoutType(evt.workoutType) !== sportFilter) {
        return false;
      }
      if (filterType === 'marathon' && evt.eventType !== 'marathon') return false;
      if (filterType === 'fun_run' && evt.eventType !== 'fun_run') return false;
      if (filterType === 'mine' && (!userId || (evt.hostUserId !== userId && !joinedEventIds.has(evt.id)))) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          evt.title.toLowerCase().includes(q) ||
          evt.meetingPoint.toLowerCase().includes(q) ||
          evt.hostName.toLowerCase().includes(q) ||
          (evt.description || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [invites, filterType, sportFilter, search, userId, joinedEventIds]);

  const formMeta = getWorkoutMeta(workoutType);
  const activeDistanceChips = workoutType === 'cycling' ? CYCLING_DISTANCE_CHIPS : FOOT_DISTANCE_CHIPS;
  const activePaceOptions = workoutType === 'cycling' ? CYCLING_SPEED_OPTIONS : FOOT_PACE_OPTIONS;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#30483E]">
            OPEN COMMUNITY INVITES
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#141F1B]">
            Group Workouts, Rides &amp; Open Requests
          </h1>
          <p className="mt-1 text-sm text-[#5B6B64]">
            Broadcast an open run, bike ride, walk, or hike invite to the community — no personal DM needed. Anyone can discover and join.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!userId) {
              onOpenAuth();
              return;
            }
            setShowCreateForm((v) => !v);
            setFormError(null);
          }}
          className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[#172D27] px-5 text-sm font-bold text-[#9AE62E] shadow-sm transition hover:bg-[#30483E]"
        >
          {showCreateForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showCreateForm ? 'Close Form' : 'Send Open Invite'}
        </button>
      </div>

      {feedbackMsg && (
        <div className="rounded-2xl border border-[#30483E]/30 bg-[#EBF5EE] px-4 py-3 text-xs font-semibold text-[#172D27]">
          {feedbackMsg}
        </div>
      )}

      {feedError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {feedError}
        </div>
      )}

      {/* Broadcast Open Invite Form */}
      {showCreateForm && (
        <form
          onSubmit={handleSubmitInvite}
          className="rounded-2xl border border-[#172D27]/25 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[#F0EFEA] pb-3">
            <div>
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[#141F1B]">
                <Megaphone className="h-5 w-5 text-[#172D27]" />
                Broadcast Open Workout Request
              </h2>
              <p className="mt-0.5 text-xs text-[#5B6B64]">
                Visible publicly to athletes looking for a group run, cycling ride, walk, or hike.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                onClearPreselectedRoute?.();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#5B6B64] hover:bg-[#F6F5F0]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#5B6B64]">Workout Sport</label>
            <WorkoutSelector compact value={workoutType} onChange={handleFormWorkoutChange} />
          </div>

          {/* Event Type + Distance Quick Chips */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#5B6B64]">Event Category</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-xl bg-[#F6F5F0] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setEventType('fun_run');
                    if (distanceKm >= (workoutType === 'cycling' ? 50 : 21)) {
                      setDistanceKm(workoutType === 'cycling' ? 25 : 5);
                    }
                  }}
                  className={`min-h-[42px] rounded-lg text-xs font-bold transition ${
                    eventType === 'fun_run'
                      ? 'bg-[#172D27] text-[#9AE62E]'
                      : 'text-[#5B6B64] hover:text-[#141F1B]'
                  }`}
                >
                  Social {formMeta.label}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEventType('marathon');
                    if (distanceKm < (workoutType === 'cycling' ? 40 : 15)) {
                      setDistanceKm(workoutType === 'cycling' ? 60 : 21.1);
                    }
                  }}
                  className={`min-h-[42px] rounded-lg text-xs font-bold transition ${
                    eventType === 'marathon'
                      ? 'bg-[#172D27] text-[#9AE62E]'
                      : 'text-[#5B6B64] hover:text-[#141F1B]'
                  }`}
                >
                  {workoutType === 'cycling' ? 'Gran Fondo / Century' : 'Marathon / Endurance'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#5B6B64]">Distance (km)</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {activeDistanceChips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => {
                      setDistanceKm(c.km);
                      setEventType(c.defaultType);
                    }}
                    className={`min-h-[40px] rounded-xl px-3 font-mono text-xs font-bold tabular-nums transition ${
                      Math.abs(distanceKm - c.km) < 0.05
                        ? 'bg-[#172D27] text-[#9AE62E]'
                        : 'bg-[#F6F5F0] text-[#141F1B] hover:bg-[#E7E5DC]'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={250}
                  step={0.5}
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(Number(e.target.value) || 5)}
                  aria-label="Custom distance km"
                  className="min-h-[40px] w-20 rounded-xl border border-[#D9D7CE] px-2.5 font-mono text-xs font-bold text-[#141F1B] tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Title & Schedule */}
          <div className="grid gap-4 md:grid-cols-12">
            <div className="md:col-span-7">
              <label className="block text-xs font-semibold text-[#5B6B64]">Event Title</label>
              <input
                type="text"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  workoutType === 'cycling'
                    ? `e.g. ${activeCity.name} Sunrise 40K Group Bike Ride`
                    : eventType === 'marathon'
                    ? `e.g. ${activeCity.name} Sunrise 21.1K Half Marathon Pacer Run`
                    : `e.g. Sunday Morning ${distanceKm}K ${activeCity.name} ${formMeta.fullLabel}`
                }
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3.5 text-sm focus:border-[#172D27] focus:outline-none"
              />
            </div>

            <div className="md:col-span-5">
              <label className="block text-xs font-semibold text-[#5B6B64]">Date &amp; Start Time</label>
              <input
                type="datetime-local"
                value={eventDateTime}
                onChange={(e) => setEventDateTime(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3.5 text-sm focus:border-[#172D27] focus:outline-none"
              />
            </div>
          </div>

          {/* Meeting Point & Optional Saved Route */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#5B6B64]">
                Meeting Point ({activeCity.name})
              </label>
              {isChandigarhCity && (
                <select
                  value={selectedPresetName}
                  onChange={(e) => setSelectedPresetName(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-sm font-medium text-[#141F1B]"
                >
                  {TRICITY_START_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                  <option value="__custom__">Search or Custom Spot...</option>
                </select>
              )}
              {(selectedPresetName === '__custom__' || !isChandigarhCity) && (
                <div className="mt-2 space-y-2">
                  <PlaceSearchInput
                    value={customMeetingPoint}
                    biasCenter={activeCity}
                    biasCityName={activeCity.name}
                    placeholder={`Search park or landmark in ${activeCity.name} or worldwide...`}
                    onSelect={(loc) => {
                      setCustomMeetingPoint(loc.name);
                      setCustomMeetingCoords({ lat: loc.lat, lng: loc.lng });
                    }}
                  />
                  <input
                    type="text"
                    maxLength={140}
                    value={customMeetingPoint}
                    onChange={(e) => setCustomMeetingPoint(e.target.value)}
                    placeholder="Or type exact gate, plaza, or park entrance"
                    className="min-h-[40px] w-full rounded-xl border border-[#D9D7CE] px-3.5 text-xs"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#5B6B64]">
                Attach Route (Optional — lets joiners run with voice navigation)
              </label>
              <select
                value={attachedRouteId}
                onChange={(e) => handleSelectSavedRoute(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-sm font-medium text-[#141F1B]"
              >
                <option value="">No route attached (meet at start point)</option>
                {savedRoutes.map((sr) => (
                  <option key={sr.id} value={sr.id}>
                    {sr.name} ({formatDistance(sr.distanceMeters, preferredUnit)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Pace / Speed & Max Capacity */}
          <div className="grid gap-4 md:grid-cols-12">
            <div className="md:col-span-8">
              <label className="block text-xs font-semibold text-[#5B6B64]">
                {workoutType === 'cycling' ? 'Target Speed / Group Level' : 'Target Pace / Level'}
              </label>
              <select
                value={targetPace}
                onChange={(e) => setTargetPace(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-sm"
              >
                {activePaceOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-semibold text-[#5B6B64]">Max Participants</label>
              <input
                type="number"
                min={2}
                max={1000}
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(Math.max(2, Number(e.target.value) || 50))}
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 font-mono text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#5B6B64]">
              Open Invite Details (Warm-up time, hydration, gear, vibe)
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`e.g. Open ${formMeta.fullLabel.toLowerCase()} around ${activeCity.name} — meeting 10 mins early, easy social pace.`}
              className="mt-1.5 w-full rounded-xl border border-[#D9D7CE] p-3 text-sm focus:border-[#172D27] focus:outline-none"
            />
          </div>

          {formError && <p className="text-xs font-medium text-red-700">{formError}</p>}

          <div className="flex flex-wrap justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                onClearPreselectedRoute?.();
              }}
              className="min-h-[44px] rounded-xl border border-[#D9D7CE] px-4 text-xs font-semibold text-[#5B6B64]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#172D27] px-5 text-xs font-bold text-[#9AE62E] disabled:opacity-60"
            >
              <Megaphone className="h-4 w-4" />
              {submitting ? 'Publishing Open Invite...' : 'Publish Open Invite'}
            </button>
          </div>
        </form>
      )}

      {/* Sport & Category Filters + Search */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSportFilter('all')}
            className={`min-h-[34px] rounded-xl px-3 text-xs font-semibold transition ${
              sportFilter === 'all'
                ? 'bg-[#172D27] text-[#9AE62E]'
                : 'border border-[#E5E3DC] bg-white text-[#5B6B64] hover:text-[#141F1B]'
            }`}
          >
            All Sports
          </button>
          {ALL_WORKOUT_TYPES.map((wType) => {
            const meta = getWorkoutMeta(wType);
            const active = sportFilter === wType;
            return (
              <button
                key={wType}
                type="button"
                onClick={() => setSportFilter(wType)}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition ${
                  active
                    ? 'bg-[#172D27] text-[#9AE62E]'
                    : 'border border-[#E5E3DC] bg-white text-[#5B6B64] hover:text-[#141F1B]'
                }`}
              >
                <WorkoutIcon type={wType} className="h-3.5 w-3.5" />
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all' as const, label: `All Open (${invites.length})` },
              { id: 'fun_run' as const, label: 'Social / Fun' },
              { id: 'marathon' as const, label: 'Long / Endurance' },
              ...(userId ? [{ id: 'mine' as const, label: 'Hosted / Joined' }] : []),
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold transition ${
                  filterType === tab.id
                    ? 'bg-[#172D27] text-[#9AE62E]'
                    : 'border border-[#E5E3DC] bg-white text-[#5B6B64] hover:text-[#141F1B]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex min-h-[42px] w-full items-center rounded-xl border border-[#D9D7CE] bg-white px-3 sm:w-72">
            <Search className="mr-2 h-4 w-4 text-[#5B6B64]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events, locations, hosts..."
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Open Invites List */}
      {loadingInvites ? (
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center text-sm text-[#5B6B64]">
          Loading open marathon and fun run invites...
        </div>
      ) : filteredInvites.length === 0 ? (
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center space-y-3">
          <p className="font-display text-lg font-bold text-[#141F1B]">
            {invites.length === 0
              ? 'No open marathon or fun run invites yet'
              : 'No open invites match your filter'}
          </p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-[#5B6B64]">
            Start the group! Send an open request for a 5K Fun Run or Half Marathon pacing session in {activeCity.name} so nearby runners can join in.
          </p>
          <button
            type="button"
            onClick={() => {
              if (!userId) {
                onOpenAuth();
                return;
              }
              setShowCreateForm(true);
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#172D27] px-5 text-xs font-bold text-[#9AE62E]"
          >
            <Megaphone className="h-4 w-4" />
            Post First Open Invite
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredInvites.map((evt) => {
            const { dateLabel, timeLabel } = formatEventDateTime(evt.eventDateTime);
            const sportMeta = getWorkoutMeta(evt.workoutType);
            const isHost = Boolean(userId && evt.hostUserId === userId);
            const hasJoined = joinedEventIds.has(evt.id);
            const isFull = evt.rsvpCount >= evt.maxParticipants;
            const fillPct = Math.min(
              100,
              Math.round((evt.rsvpCount / Math.max(1, evt.maxParticipants)) * 100)
            );
            const isExpanded = expandedRsvpEventId === evt.id;

            return (
              <article
                key={evt.id}
                className="flex flex-col justify-between rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4"
              >
                <div className="space-y-3">
                  {/* Top Meta Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase ${
                          evt.eventType === 'marathon'
                            ? 'bg-[#172D27] text-[#9AE62E]'
                            : 'bg-[#EBF5EE] text-[#172D27]'
                        }`}
                      >
                        <WorkoutIcon type={sportMeta.id} className="h-3.5 w-3.5" />
                        {sportMeta.label} · {evt.eventType === 'marathon' ? 'Endurance' : 'Social'}
                      </span>
                      <span className="font-mono text-sm font-extrabold text-[#172D27] tabular-nums">
                        {evt.distanceKm} km
                      </span>
                    </div>

                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#5B6B64] tabular-nums">
                      <Calendar className="h-3.5 w-3.5" />
                      {dateLabel}
                      {timeLabel ? ` · ${timeLabel}` : ''}
                    </span>
                  </div>

                  {/* Title + Route Thumb */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-bold text-[#141F1B]">
                        {evt.title}
                      </h2>
                      <p className="mt-0.5 text-xs text-[#5B6B64]">
                        Open invite by <strong className="text-[#141F1B]">{evt.hostName}</strong>
                        {isHost && ' (You)'}
                      </p>
                    </div>
                    {evt.encodedPolyline && (
                      <MiniRoutePreview encodedPolyline={evt.encodedPolyline} />
                    )}
                  </div>

                  {/* Details */}
                  <div className="grid gap-2 rounded-xl bg-[#F6F5F0] p-3 text-xs text-[#5B6B64]">
                    <p className="flex items-center gap-2 text-[#141F1B] font-medium">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-[#30483E]" />
                      <span className="truncate">
                        {evt.meetingPoint} ({evt.city})
                      </span>
                    </p>
                    {evt.targetPace && (
                      <p className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-[#30483E]" />
                        <span>{evt.targetPace}</span>
                      </p>
                    )}
                    {evt.routeName && (
                      <p className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 shrink-0 text-[#30483E]" />
                        <span className="truncate">Route: {evt.routeName}</span>
                      </p>
                    )}
                  </div>

                  {evt.description && (
                    <p className="text-xs leading-relaxed text-[#5B6B64]">{evt.description}</p>
                  )}

                  {/* Participant Capacity Bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-semibold text-[#141F1B]">
                        {evt.rsvpCount} / {evt.maxParticipants} runners going
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (!userId) {
                            onOpenAuth();
                            return;
                          }
                          setExpandedRsvpEventId(isExpanded ? null : evt.id);
                        }}
                        className="inline-flex items-center gap-1 font-semibold text-[#30483E] hover:underline"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {isExpanded ? 'Hide Roster' : 'View Runners'}
                      </button>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#F0EFEA]">
                      <div
                        className="h-full rounded-full bg-[#172D27] transition-all"
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Expanded Live RSVP Roster */}
                  {isExpanded && (
                    <div className="rounded-xl border border-[#E5E3DC] bg-[#FAFAF7] p-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-[#141F1B]">
                        Runners Joining ({expandedRsvps.length})
                      </p>
                      {expandedRsvps.length === 0 ? (
                        <p className="text-xs text-[#5B6B64]">Loading roster...</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {expandedRsvps.map((r) => (
                            <div
                              key={r.id}
                              className="rounded-lg border border-[#E5E3DC] bg-white px-2.5 py-1.5 text-xs"
                            >
                              <span className="font-semibold text-[#141F1B]">{r.runnerName}</span>
                              {r.paceNote && (
                                <span className="ml-1.5 text-[11px] text-[#5B6B64]">
                                  · {r.paceNote}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Optional Pace Note Join Box */}
                  {joiningEventId === evt.id && (
                    <div className="rounded-xl border border-[#172D27]/25 bg-[#F6F5F0] p-3 space-y-2">
                      <label className="block text-[11px] font-bold text-[#141F1B]">
                        Optional pace or group note for fellow runners
                      </label>
                      <input
                        type="text"
                        maxLength={60}
                        value={joinPaceDraft}
                        onChange={(e) => setJoinPaceDraft(e.target.value)}
                        placeholder="e.g. Aiming 5:45/km, bringing water!"
                        className="min-h-[38px] w-full rounded-lg border border-[#D9D7CE] bg-white px-3 text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setJoiningEventId(null);
                            setJoinPaceDraft('');
                          }}
                          className="min-h-[36px] rounded-lg border border-[#D9D7CE] bg-white px-3 text-xs font-semibold text-[#5B6B64]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busyEventId === evt.id}
                          onClick={() => void handleConfirmJoin(evt)}
                          className="min-h-[36px] rounded-lg bg-[#172D27] px-3.5 text-xs font-bold text-[#9AE62E]"
                        >
                          {busyEventId === evt.id ? 'Joining...' : 'Confirm Join'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Action Row */}
                <div className="flex flex-wrap items-center gap-2 border-t border-[#F0EFEA] pt-3">
                  {!isHost ? (
                    hasJoined ? (
                      <button
                        type="button"
                        disabled={busyEventId === evt.id}
                        onClick={() => void handleLeave(evt)}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#172D27] bg-[#EBF5EE] px-4 text-xs font-bold text-[#172D27]"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {busyEventId === evt.id ? 'Updating...' : 'Going (Leave)'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isFull || busyEventId === evt.id}
                        onClick={() => {
                          if (!userId) {
                            onOpenAuth();
                            return;
                          }
                          setJoiningEventId(evt.id);
                        }}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E] disabled:opacity-50"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {isFull ? 'Event Full' : `Join ${sportMeta.label}`}
                      </button>
                    )
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busyEventId === evt.id}
                        onClick={async () => {
                          setBusyEventId(evt.id);
                          try {
                            await cancelOpenRunInvite(evt.id);
                          } finally {
                            setBusyEventId(null);
                          }
                        }}
                        className="min-h-[42px] rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#5B6B64] hover:text-[#141F1B]"
                      >
                        Close Invite
                      </button>
                      {confirmDeleteId === evt.id ? (
                        <button
                          type="button"
                          disabled={busyEventId === evt.id}
                          onClick={async () => {
                            setBusyEventId(evt.id);
                            try {
                              await deleteOpenRunInvite(evt.id);
                              setConfirmDeleteId(null);
                            } finally {
                              setBusyEventId(null);
                            }
                          }}
                          className="min-h-[42px] rounded-xl bg-red-600 px-3 text-xs font-bold text-white"
                        >
                          Confirm Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label="Delete open invite"
                          onClick={() => setConfirmDeleteId(evt.id)}
                          className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl border border-[#D9D7CE] text-[#5B6B64] hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  )}

                  {evt.encodedPolyline && onStartRoute ? (
                    <button
                      type="button"
                      onClick={() => handleLaunchAttachedRoute(evt)}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#9AE62E] px-3.5 text-xs font-bold text-[#172D27]"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      {sportMeta.verb} Route
                    </button>
                  ) : (
                    onPlanAtLocation && (
                      <button
                        type="button"
                        onClick={() =>
                          onPlanAtLocation({
                            name: evt.meetingPoint,
                            lat: evt.lat ?? activeCity.lat,
                            lng: evt.lng ?? activeCity.lng,
                            distanceKm: evt.distanceKm,
                            workoutType: sportMeta.id,
                          })
                        }
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3.5 text-xs font-semibold text-[#141F1B]"
                      >
                        <Navigation className="h-3.5 w-3.5" />
                        Plan {sportMeta.verb}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => void handleShareInvite(evt)}
                    className="ml-auto inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#141F1B]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedId === evt.id ? 'Copied!' : 'Copy Invite'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
