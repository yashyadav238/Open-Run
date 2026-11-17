import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  LocateFixed,
  Lock,
  Map as MapIcon,
  Pause,
  PauseCircle,
  Play,
  Radio,
  RotateCcw,
  Square,
  Unlock,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ActiveRunningCity } from '../data/worldCities';
import {
  estimateCaloriesKcal,
  formatSpeed,
  getWorkoutMeta,
  normalizeWorkoutType,
} from '../data/workouts';
import {
  AUTO_PAUSE_DELAY_MS,
  computeInstantaneousSpeedMs,
  evaluateAutoPauseTransition,
  speedBarPercent,
  ZERO_SPEED_THRESHOLD_MS,
  type PauseReason,
  type RunPhase,
} from '../lib/autoPause';
import {
  bearingDegrees,
  computeElevationStats,
  encodePolyline,
  formatDistance,
  formatDuration,
  formatPace,
  haversineMeters,
  minDistanceToPathMeters,
} from '../lib/geo';
import {
  buildRouteTurnCues,
  computeCumulativePathMeters,
  evaluateTurnVoiceCue,
  type TurnCuePoint,
  type TurnVoiceState,
} from '../lib/turnNavigation';
import { sendDmMessage, stopLiveBeacon, upsertLiveBeacon } from '../services/firestoreService';
import type {
  CompletedKmCheckpoint,
  FriendRequestDoc,
  GeneratedRouteCandidate,
  GpsSample,
  LatLngLiteral,
  LiveBeaconDoc,
  LiveBeaconStatus,
  RunActivityDoc,
  SplitRecord,
  WorkoutType,
} from '../types/run';
import { TricityMap } from './TricityMap';
import { WorkoutIcon, WorkoutSelector } from './WorkoutIcon';

const RECOVERY_KEY = 'tricity_active_run_recovery_v1';

type HudViewMode = 'stats' | 'split' | 'map';
type LiveShareMode = 'off' | 'friends' | 'selected';

interface LiveRunTrackerProps {
  route: GeneratedRouteCandidate | null;
  defaultWorkoutType?: WorkoutType;
  preferredUnit: 'km' | 'mi';
  activeCity: ActiveRunningCity;
  userId?: string | null;
  userName?: string;
  userPhotoUrl?: string | null;
  emailVerified?: boolean;
  acceptedFriends?: FriendRequestDoc[];
  liveFriends?: LiveBeaconDoc[];
  onCancel: () => void;
  onFinishRun: (
    summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>,
    samples: GpsSample[]
  ) => void;
}

function TurnIcon({ maneuver, instruction }: { maneuver?: string; instruction: string }) {
  const txt = `${maneuver || ''} ${instruction}`.toLowerCase();
  if (txt.includes('finish') || txt.includes('arrive') || txt.includes('destination')) {
    return <Flag className="h-5 w-5 text-[#9AE62E]" />;
  }
  if (txt.includes('u-turn') || txt.includes('uturn')) {
    return <RotateCcw className="h-5 w-5 text-[#9AE62E]" />;
  }
  if (txt.includes('left')) {
    return <CornerUpLeft className="h-5 w-5 text-[#9AE62E]" />;
  }
  if (txt.includes('right')) {
    return <CornerUpRight className="h-5 w-5 text-[#9AE62E]" />;
  }
  return <ArrowUp className="h-5 w-5 text-[#9AE62E]" />;
}

function formatHeroDistance(meters: number, unit: 'km' | 'mi'): { value: string; unitLabel: string } {
  if (unit === 'mi') {
    return { value: (meters / 1609.344).toFixed(2), unitLabel: 'mi' };
  }
  return { value: (meters / 1000).toFixed(2), unitLabel: 'km' };
}

export const LiveRunTracker: React.FC<LiveRunTrackerProps> = ({
  route,
  defaultWorkoutType = 'running',
  preferredUnit,
  activeCity,
  userId = null,
  userName = 'Runner',
  userPhotoUrl = null,
  emailVerified = false,
  acceptedFriends = [],
  liveFriends = [],
  onCancel,
  onFinishRun,
}) => {
  const initialHeading = useMemo(() => {
    if (route && route.path.length >= 2) {
      const lookAhead = route.path[Math.min(4, route.path.length - 1)];
      return bearingDegrees(route.path[0], lookAhead);
    }
    return 0;
  }, [route]);

  const [workoutType, setWorkoutType] = useState<WorkoutType>(() =>
    normalizeWorkoutType(route?.workoutType ?? defaultWorkoutType)
  );
  const [phase, setPhase] = useState<RunPhase>('ready');
  const [pauseReason, setPauseReason] = useState<PauseReason>(null);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [hudView, setHudView] = useState<HudViewMode>(() => (route ? 'split' : 'stats'));
  const [screenLocked, setScreenLocked] = useState(false);

  const workoutMeta = getWorkoutMeta(workoutType);
  const isSpeedPrimary = workoutMeta.primaryMetric === 'speed';

  useEffect(() => {
    if (phase === 'ready') {
      setWorkoutType(normalizeWorkoutType(route?.workoutType ?? defaultWorkoutType));
    }
  }, [route, defaultWorkoutType, phase]);

  const [distanceMeters, setDistanceMeters] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [currentPaceSec, setCurrentPaceSec] = useState(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [offRouteMeters, setOffRouteMeters] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [voiceTurnsEnabled, setVoiceTurnsEnabled] = useState(true);
  const [voiceBannerText, setVoiceBannerText] = useState<string | null>(null);
  const [activeTurnState, setActiveTurnState] = useState<{
    turn: TurnCuePoint | null;
    distMeters: number;
  } | null>(null);
  const [trace, setTrace] = useState<LatLngLiteral[]>([]);
  const [userPos, setUserPos] = useState<LatLngLiteral | null>(null);
  const [runnerHeading, setRunnerHeading] = useState<number>(initialHeading);
  const [cameraMode, setCameraMode] = useState<'nav' | 'overview'>('nav');
  const [followCamera, setFollowCamera] = useState(true);
  const [overviewTrigger, setOverviewTrigger] = useState(0);
  const [splits, setSplits] = useState<SplitRecord[]>([]);
  const [kmMilestoneToast, setKmMilestoneToast] = useState<{
    km: number;
    splitDurationSec: number;
    totalDurationSec: number;
    paceSecPerKm: number;
    avgPaceSecPerKm: number;
    caloriesKcal: number;
    totalCaloriesKcal: number;
  } | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);

  // Real-time live location sharing state
  const [liveShareMode, setLiveShareMode] = useState<LiveShareMode>('off');
  const [selectedFriendUids, setSelectedFriendUids] = useState<string[]>([]);
  const [notifyFriendsInDm, setNotifyFriendsInDm] = useState(true);
  const [showLiveShareSheet, setShowLiveShareSheet] = useState(false);

  const friendContacts = useMemo(() => {
    if (!userId || acceptedFriends.length === 0) return [];
    return acceptedFriends.map((fr) => {
      const isFrom = fr.fromUid === userId;
      return {
        threadId: fr.id,
        uid: isFrom ? fr.toUid : fr.fromUid,
        name: isFrom ? fr.toName : fr.fromName,
        friendRequest: fr,
      };
    });
  }, [acceptedFriends, userId]);

  const routeTurns = useMemo(
    () => (route ? buildRouteTurnCues(route.path, route.steps) : []),
    [route]
  );
  const cumPathMeters = useMemo(
    () => (route ? computeCumulativePathMeters(route.path) : []),
    [route]
  );

  const samplesRef = useRef<GpsSample[]>([]);
  const traceRef = useRef<LatLngLiteral[]>([]);
  const lastRawPosRef = useRef<LatLngLiteral | null>(null);
  const lastGpsObsRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const pauseAnchorPosRef = useRef<LatLngLiteral | null>(null);
  const lastMotionAtRef = useRef<number>(Date.now());
  const firstFixReceivedRef = useRef<boolean>(false);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const startedAtRef = useRef<string>('');
  const lastSplitDistRef = useRef(0);
  const lastSplitTimeRef = useRef(0);
  const lastSplitCaloriesRef = useRef(0);
  const distanceRef = useRef(0);
  const elapsedRef = useRef(0);
  const phaseRef = useRef<RunPhase>(phase);
  const pauseReasonRef = useRef<PauseReason>(pauseReason);
  const autoPauseEnabledRef = useRef<boolean>(autoPauseEnabled);
  const audioEnabledRef = useRef<boolean>(audioEnabled);
  const voiceTurnsEnabledRef = useRef<boolean>(voiceTurnsEnabled);
  const routeTurnsRef = useRef<TurnCuePoint[]>(routeTurns);
  const cumPathMetersRef = useRef<number[]>(cumPathMeters);
  const routeCursorIdxRef = useRef<number>(0);
  const spokenTurnMapRef = useRef<Map<number, TurnVoiceState>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const voiceBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStartSpokenAtRef = useRef<number>(0);

  // Live beacon refs
  const liveShareModeRef = useRef<LiveShareMode>(liveShareMode);
  const selectedFriendUidsRef = useRef<string[]>(selectedFriendUids);
  const friendContactsRef = useRef(friendContacts);
  const userIdRef = useRef(userId);
  const userNameRef = useRef(userName);
  const userPhotoUrlRef = useRef(userPhotoUrl);
  const emailVerifiedRef = useRef(emailVerified);
  const routeRef = useRef(route);
  const currentSpeedKmhRef = useRef(currentSpeedKmh);
  const runnerHeadingRef = useRef(runnerHeading);
  const userPosRef = useRef(userPos);
  const workoutTypeRef = useRef<WorkoutType>(workoutType);
  const lastBeaconSentAtRef = useRef<number>(0);
  const lastBeaconPosRef = useRef<LatLngLiteral | null>(null);
  const beaconActiveRef = useRef<boolean>(false);
  const dmNotifiedRunStartRef = useRef<boolean>(false);

  phaseRef.current = phase;
  pauseReasonRef.current = pauseReason;
  autoPauseEnabledRef.current = autoPauseEnabled;
  audioEnabledRef.current = audioEnabled;
  voiceTurnsEnabledRef.current = voiceTurnsEnabled;
  routeTurnsRef.current = routeTurns;
  cumPathMetersRef.current = cumPathMeters;
  liveShareModeRef.current = liveShareMode;
  selectedFriendUidsRef.current = selectedFriendUids;
  friendContactsRef.current = friendContacts;
  userIdRef.current = userId;
  userNameRef.current = userName;
  userPhotoUrlRef.current = userPhotoUrl;
  emailVerifiedRef.current = emailVerified;
  routeRef.current = route;
  currentSpeedKmhRef.current = currentSpeedKmh;
  runnerHeadingRef.current = runnerHeading;
  userPosRef.current = userPos;
  workoutTypeRef.current = workoutType;

  useEffect(() => {
    routeCursorIdxRef.current = 0;
    spokenTurnMapRef.current.clear();
    setActiveTurnState(null);
  }, [route]);

  const showVoiceBanner = (text: string) => {
    setVoiceBannerText(text);
    if (voiceBannerTimerRef.current) {
      clearTimeout(voiceBannerTimerRef.current);
    }
    voiceBannerTimerRef.current = setTimeout(() => {
      setVoiceBannerText(null);
    }, 5500);
  };

  const unlockAudio = () => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioCtx();
        }
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
      }
    } catch {
      // Ignore audio unlock errors
    }
  };

  const playTurnChime = (urgent = false) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const tones = urgent ? [987.77, 1318.51] : [783.99, 1046.5];
      tones.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.09, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.15);
      });
    } catch {
      // Ignore Web Audio errors
    }
  };

  const selectClearVoice = (): SpeechSynthesisVoice | null => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const preferredLocales = ['en-in', 'en-gb', 'en-us', 'en-au'];
    for (const locale of preferredLocales) {
      const natural = voices.find(
        (v) =>
          v.lang.toLowerCase().startsWith(locale) &&
          /natural|google|samantha|daniel|rishi|veena|karen|serena|enhanced/i.test(v.name)
      );
      if (natural) return natural;
      const anyLocale = voices.find((v) => v.lang.toLowerCase().startsWith(locale));
      if (anyLocale) return anyLocale;
    }
    return voices.find((v) => v.lang.toLowerCase().startsWith('en')) || voices[0];
  };

  const formatSpokenDuration = (totalSec: number): string => {
    const clean = Math.max(0, Math.round(totalSec));
    const hrs = Math.floor(clean / 3600);
    const mins = Math.floor((clean % 3600) / 60);
    const secs = clean % 60;
    const parts: string[] = [];
    if (hrs > 0) parts.push(`${hrs} ${hrs === 1 ? 'hour' : 'hours'}`);
    if (mins > 0) parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs} ${secs === 1 ? 'second' : 'seconds'}`);
    return parts.join(' ');
  };

  const speak = (
    text: string,
    options?: { chime?: boolean; chimeUrgent?: boolean; queueIfRecentStart?: boolean; force?: boolean }
  ) => {
    if (!options?.force && !audioEnabledRef.current) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      if (options?.chime) {
        playTurnChime(Boolean(options.chimeUrgent));
      }
      const recentStartPlaying =
        options?.queueIfRecentStart &&
        Date.now() - lastStartSpokenAtRef.current < 2600 &&
        window.speechSynthesis.speaking;

      if (!recentStartPlaying) {
        window.speechSynthesis.cancel();
      }
      const utter = new SpeechSynthesisUtterance(text);
      const voice = selectClearVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      } else {
        utter.lang = 'en-IN';
      }
      utter.rate = 0.96;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors
    }
  };

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 1;
        elapsedRef.current = next;
        return next;
      });

      const now = Date.now();
      if (firstFixReceivedRef.current && now - lastMotionAtRef.current >= AUTO_PAUSE_DELAY_MS) {
        setCurrentSpeedKmh(0);
        setCurrentPaceSec(0);

        if (autoPauseEnabledRef.current && phaseRef.current === 'running') {
          pauseAnchorPosRef.current =
            lastGpsObsRef.current || traceRef.current[traceRef.current.length - 1] || null;
          pauseReasonRef.current = 'auto';
          phaseRef.current = 'paused';
          setPauseReason('auto');
          setPhase('paused');
          speak('Auto paused.');
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'ready') return;
    const id = setInterval(() => {
      try {
        const meta = getWorkoutMeta(workoutTypeRef.current);
        localStorage.setItem(
          RECOVERY_KEY,
          JSON.stringify({
            workoutType: workoutTypeRef.current,
            routeName: route?.name || `${activeCity.name} Free ${meta.pastNoun}`,
            distanceMeters: distanceRef.current,
            elapsedSec: elapsedRef.current,
            trace: samplesRef.current.slice(-150),
            savedAt: Date.now(),
          })
        );
      } catch {
        // Ignore storage errors
      }
    }, 5000);
    return () => clearInterval(id);
  }, [phase, route, activeCity.name]);

  const acquireWakeLock = async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch {
      // Unsupported
    }
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  };

  const getAllowedBeaconUids = (): string[] => {
    if (!userIdRef.current || !emailVerifiedRef.current) return [];
    if (liveShareModeRef.current === 'friends') {
      return friendContactsRef.current.map((f) => f.uid);
    }
    if (liveShareModeRef.current === 'selected') {
      return selectedFriendUidsRef.current;
    }
    return [];
  };

  const broadcastLiveBeacon = (
    pos: LatLngLiteral | null,
    statusOverride?: LiveBeaconStatus,
    headingOverride?: number
  ) => {
    const uid = userIdRef.current;
    const allowedUids = getAllowedBeaconUids();
    if (!uid || !emailVerifiedRef.current || liveShareModeRef.current === 'off' || allowedUids.length === 0) {
      if (uid && beaconActiveRef.current) {
        beaconActiveRef.current = false;
        void stopLiveBeacon(uid);
      }
      return;
    }

    const coords =
      pos ||
      lastGpsObsRef.current ||
      userPosRef.current ||
      routeRef.current?.start ||
      { lat: activeCity.lat, lng: activeCity.lng };

    const activeMeta = getWorkoutMeta(workoutTypeRef.current);
    beaconActiveRef.current = true;
    lastBeaconSentAtRef.current = Date.now();
    lastBeaconPosRef.current = coords;

    void upsertLiveBeacon(uid, {
      displayName: userNameRef.current || 'Runner',
      photoURL: userPhotoUrlRef.current,
      workoutType: workoutTypeRef.current,
      lat: coords.lat,
      lng: coords.lng,
      heading: headingOverride ?? runnerHeadingRef.current,
      distanceMeters: distanceRef.current,
      elapsedSec: elapsedRef.current,
      currentSpeedKmh: statusOverride === 'paused' ? 0 : currentSpeedKmhRef.current,
      routeName: routeRef.current?.name || `${activeCity.name} Live ${activeMeta.pastNoun}`,
      status: statusOverride ?? (phaseRef.current === 'paused' ? 'paused' : 'active'),
      shareScope: liveShareModeRef.current === 'friends' ? 'friends' : 'selected',
      allowedUids,
    }).catch(() => {
      // Non-fatal so live telemetry never interrupts
    });
  };

  useEffect(() => {
    if (phase === 'ready') return;
    broadcastLiveBeacon(userPosRef.current || lastGpsObsRef.current);
  }, [liveShareMode, selectedFriendUids]);

  const stopGpsWatch = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsAccuracy(Math.round(pos.coords.accuracy));
          setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          // Wait until user taps Start
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
      );
    }
    return () => {
      stopGpsWatch();
      releaseWakeLock();
      if (beaconActiveRef.current && userIdRef.current) {
        beaconActiveRef.current = false;
        void stopLiveBeacon(userIdRef.current);
      }
      if (voiceBannerTimerRef.current) {
        clearTimeout(voiceBannerTimerRef.current);
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const startTracking = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }
    unlockAudio();
    setGpsError(null);
    if (!startedAtRef.current) {
      startedAtRef.current = new Date().toISOString();
    }
    lastMotionAtRef.current = Date.now();
    firstFixReceivedRef.current = false;
    pauseAnchorPosRef.current = null;
    pauseReasonRef.current = null;
    routeCursorIdxRef.current = 0;
    spokenTurnMapRef.current.clear();
    setActiveTurnState(
      routeTurnsRef.current[0]
        ? { turn: routeTurnsRef.current[0], distMeters: routeTurnsRef.current[0].cumRouteMeters }
        : null
    );
    phaseRef.current = 'running';
    setPauseReason(null);
    setPhase('running');
    setHudView(route ? 'split' : 'stats');
    setCameraMode('nav');
    setFollowCamera(true);
    acquireWakeLock();

    // Start live location broadcast immediately if enabled
    const initialLoc = userPosRef.current || route?.start || { lat: activeCity.lat, lng: activeCity.lng };
    broadcastLiveBeacon(initialLoc, 'active');

    const activeStartMeta = getWorkoutMeta(workoutTypeRef.current);
    const allowedUids = getAllowedBeaconUids();
    if (
      notifyFriendsInDm &&
      !dmNotifiedRunStartRef.current &&
      userIdRef.current &&
      emailVerifiedRef.current &&
      liveShareModeRef.current !== 'off' &&
      allowedUids.length > 0
    ) {
      dmNotifiedRunStartRef.current = true;
      const targets = friendContactsRef.current
        .filter((f) => allowedUids.includes(f.uid))
        .slice(0, 10);
      const runLabel = route?.name || `${activeCity.name} Open ${activeStartMeta.pastNoun}`;
      targets.forEach((contact) => {
        void sendDmMessage(
          contact.threadId,
          contact.friendRequest,
          { uid: userIdRef.current!, displayName: userNameRef.current || 'Runner' },
          {
            messageType: 'location',
            text: `Just started "${runLabel}" — watch my live location on the map!`,
            locationLat: initialLoc.lat,
            locationLng: initialLoc.lng,
            locationLabel: runLabel,
            locationIsLive: true,
          }
        ).catch(() => {});
      });
    }

    lastStartSpokenAtRef.current = Date.now();
    const corridorKind = activeStartMeta.routingProfile === 'bicycle' ? 'cycling corridor' : 'pedestrian corridor';
    speak(
      route
        ? voiceTurnsEnabledRef.current
          ? `${activeStartMeta.pastNoun} started. Voice turn alerts active 100 meters before each turn.`
          : `${activeStartMeta.pastNoun} started. Follow the blue ${corridorKind}.`
        : `${activeStartMeta.pastNoun} started. Recording your ${activeCity.name} GPS workout.`
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        setGpsAccuracy(Math.round(acc));
        const nextPt: LatLngLiteral = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserPos(nextPt);
        firstFixReceivedRef.current = true;

        if (
          typeof pos.coords.heading === 'number' &&
          Number.isFinite(pos.coords.heading) &&
          (pos.coords.speed ?? 0) > 0.6
        ) {
          setRunnerHeading(pos.coords.heading);
        } else if (lastRawPosRef.current && haversineMeters(lastRawPosRef.current, nextPt) >= 3) {
          setRunnerHeading(bearingDegrees(lastRawPosRef.current, nextPt));
          lastRawPosRef.current = nextPt;
        } else if (!lastRawPosRef.current) {
          lastRawPosRef.current = nextPt;
        }

        const now = Date.now();
        const prevObs = lastGpsObsRef.current;
        const obsDtSec = prevObs ? Math.max(0.5, (now - prevObs.t) / 1000) : 1;
        const obsStepMeters = prevObs ? haversineMeters(prevObs, nextPt) : 0;

        if (acc <= 100) {
          lastGpsObsRef.current = { lat: nextPt.lat, lng: nextPt.lng, t: now };
        }

        const activeSportMeta = getWorkoutMeta(workoutTypeRef.current);
        const instantSpeedMs =
          acc <= 100
            ? computeInstantaneousSpeedMs({
                reportedSpeedMs: pos.coords.speed,
                stepMeters: obsStepMeters,
                dtSec: obsDtSec,
                accuracyMeters: acc,
                maxValidSpeedMs: activeSportMeta.maxSpeedMs,
              })
            : 0;

        if (instantSpeedMs > ZERO_SPEED_THRESHOLD_MS) {
          lastMotionAtRef.current = now;
        }

        // Update live instantaneous speed/pace bar whenever running or auto-paused
        if (phaseRef.current === 'running') {
          setCurrentSpeedKmh(Number((instantSpeedMs * 3.6).toFixed(1)));
          if (instantSpeedMs > ZERO_SPEED_THRESHOLD_MS) {
            setCurrentPaceSec(1000 / instantSpeedMs);
          } else if (now - lastMotionAtRef.current >= 2500) {
            setCurrentPaceSec(0);
          }
        } else if (phaseRef.current === 'paused') {
          setCurrentSpeedKmh(0);
          setCurrentPaceSec(0);
        }

        // Evaluate auto-pause / auto-resume transitions
        const distFromAnchor = pauseAnchorPosRef.current
          ? haversineMeters(pauseAnchorPosRef.current, nextPt)
          : obsStepMeters;

        const transition = evaluateAutoPauseTransition({
          phase: phaseRef.current,
          pauseReason: pauseReasonRef.current,
          autoPauseEnabled: autoPauseEnabledRef.current,
          speedMs: instantSpeedMs,
          nowMs: now,
          lastMotionMs: lastMotionAtRef.current,
          firstFixReceived: firstFixReceivedRef.current,
          distFromPauseAnchorMeters: distFromAnchor,
          accuracyMeters: acc,
        });

        if (transition === 'auto_pause') {
          pauseAnchorPosRef.current = nextPt;
          pauseReasonRef.current = 'auto';
          phaseRef.current = 'paused';
          setPauseReason('auto');
          setPhase('paused');
          setCurrentSpeedKmh(0);
          setCurrentPaceSec(0);
          broadcastLiveBeacon(nextPt, 'paused');
          speak('Auto paused.');
          return;
        }

        if (transition === 'auto_resume') {
          pauseAnchorPosRef.current = null;
          pauseReasonRef.current = null;
          phaseRef.current = 'running';
          lastMotionAtRef.current = now;
          setPauseReason(null);
          setPhase('running');
          setConfirmFinish(false);
          setCurrentSpeedKmh(Number((instantSpeedMs * 3.6).toFixed(1)));
          if (instantSpeedMs > ZERO_SPEED_THRESHOLD_MS) {
            setCurrentPaceSec(1000 / instantSpeedMs);
          }
          acquireWakeLock();
          broadcastLiveBeacon(nextPt, 'active');
          speak('Auto resumed.');
        }

        if (phaseRef.current !== 'running') return;
        if (acc > 100) return;

        const prevSamples = samplesRef.current;
        if (prevSamples.length > 0) {
          const prev = prevSamples[prevSamples.length - 1];
          const dtSec = Math.max(0.5, (now - prev.t) / 1000);
          const stepMeters = haversineMeters(prev, nextPt);
          const segSpeed = stepMeters / dtSec;
          if (segSpeed > activeSportMeta.maxSpeedMs || stepMeters < 2) return;

          const prevTotal = distanceRef.current;
          const nextTotal = prevTotal + stepMeters;
          distanceRef.current = nextTotal;
          setDistanceMeters(nextTotal);

          const completedKms = Math.floor(nextTotal / 1000);
          if (completedKms > Math.floor(lastSplitDistRef.current / 1000)) {
            const targetMarkMeters = completedKms * 1000;
            const interpRatio =
              stepMeters > 0
                ? Math.max(0, Math.min(1, (targetMarkMeters - prevTotal) / stepMeters))
                : 1;
            const milestoneLat = Number(
              (prev.lat + (nextPt.lat - prev.lat) * interpRatio).toFixed(6)
            );
            const milestoneLng = Number(
              (prev.lng + (nextPt.lng - prev.lng) * interpRatio).toFixed(6)
            );
            const splitDurationSec = Math.max(1, elapsedRef.current - lastSplitTimeRef.current);
            const splitRec: SplitRecord = {
              km: completedKms,
              splitDurationSec,
              paceSecPerKm: splitDurationSec,
              cumulativeDistanceMeters: Math.round(nextTotal),
              lat: milestoneLat,
              lng: milestoneLng,
            };
            const totalDurationSec = Math.max(1, elapsedRef.current);
            const avgPaceSecPerKm = Math.max(
              1,
              Math.round(totalDurationSec / Math.max(0.001, nextTotal / 1000))
            );
            const totalCaloriesSoFar = estimateCaloriesKcal(
              workoutTypeRef.current,
              totalDurationSec,
              nextTotal
            );
            const splitCalories = Math.max(
              1,
              totalCaloriesSoFar - lastSplitCaloriesRef.current
            );
            lastSplitDistRef.current = nextTotal;
            lastSplitTimeRef.current = totalDurationSec;
            lastSplitCaloriesRef.current = totalCaloriesSoFar;
            setSplits((prevSplits) => [...prevSplits, splitRec]);
            setKmMilestoneToast({
              km: completedKms,
              splitDurationSec,
              totalDurationSec,
              paceSecPerKm: splitDurationSec,
              avgPaceSecPerKm,
              caloriesKcal: splitCalories,
              totalCaloriesKcal: totalCaloriesSoFar,
            });
            setTimeout(() => {
              setKmMilestoneToast((cur) => (cur?.km === completedKms ? null : cur));
            }, 7000);
            if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
            lastStartSpokenAtRef.current = Date.now();
            const kmWord = completedKms === 1 ? 'kilometre' : 'kilometres';
            const spokenSplitTime = formatSpokenDuration(splitDurationSec);
            const spokenTotalTime = formatSpokenDuration(totalDurationSec);
            const spokenAvgPace = formatSpokenDuration(avgPaceSecPerKm);
            speak(
              `Total distance ${completedKms} ${kmWord}. Latest kilometre in ${spokenSplitTime}. Total time ${spokenTotalTime}. Average pace ${spokenAvgPace} per kilometre. Calories burnt ${totalCaloriesSoFar}.`,
              { chime: true }
            );
          }
        }

        if (route && route.path.length > 1) {
          setOffRouteMeters(Math.round(minDistanceToPathMeters(nextPt, route.path)));
        }

        if (
          route &&
          routeTurnsRef.current.length > 0 &&
          cumPathMetersRef.current.length > 0
        ) {
          const evalRes = evaluateTurnVoiceCue({
            path: route.path,
            cumPathMeters: cumPathMetersRef.current,
            turns: routeTurnsRef.current,
            userPos: nextPt,
            cursorIdx: routeCursorIdxRef.current,
            spokenMap: spokenTurnMapRef.current,
          });
          routeCursorIdxRef.current = evalRes.nextCursorIdx;
          setActiveTurnState({
            turn: evalRes.upcomingTurn,
            distMeters: evalRes.distToTurnMeters,
          });

          if (evalRes.voicePrompt && voiceTurnsEnabledRef.current) {
            if (navigator.vibrate) {
              navigator.vibrate(evalRes.voiceStage === 'now' ? [100, 50, 100] : 85);
            }
            showVoiceBanner(evalRes.voicePrompt);
            speak(evalRes.voicePrompt, {
              chime: true,
              chimeUrgent: evalRes.voiceStage === 'now',
              queueIfRecentStart: true,
            });
          }
        }

        samplesRef.current.push({
          lat: nextPt.lat,
          lng: nextPt.lng,
          t: now,
          acc: Math.round(acc),
          ...(typeof pos.coords.altitude === 'number' && Number.isFinite(pos.coords.altitude)
            ? { alt: Number(pos.coords.altitude.toFixed(1)) }
            : {}),
        });
        traceRef.current.push(nextPt);
        setTrace((prev) => [...prev, nextPt]);

        if (liveShareModeRef.current !== 'off') {
          const msSinceBeacon = now - lastBeaconSentAtRef.current;
          const movedFromBeacon = lastBeaconPosRef.current
            ? haversineMeters(lastBeaconPosRef.current, nextPt)
            : 999;
          if (msSinceBeacon >= 4000 || (msSinceBeacon >= 2200 && movedFromBeacon >= 15)) {
            broadcastLiveBeacon(nextPt, 'active');
          }
        }
      },
      (err) => {
        setGpsError(
          err.code === 1
            ? 'Location permission denied. Allow location access in browser settings to track GPS.'
            : 'Searching for GPS satellites...'
        );
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  };

  const handlePause = () => {
    pauseReasonRef.current = 'manual';
    phaseRef.current = 'paused';
    setPauseReason('manual');
    setPhase('paused');
    setCurrentSpeedKmh(0);
    setCurrentPaceSec(0);
    releaseWakeLock();
    broadcastLiveBeacon(lastGpsObsRef.current || userPosRef.current, 'paused');
    speak('Workout paused.');
  };

  const handleResume = () => {
    lastMotionAtRef.current = Date.now();
    pauseAnchorPosRef.current = null;
    pauseReasonRef.current = null;
    phaseRef.current = 'running';
    setPauseReason(null);
    setPhase('running');
    setConfirmFinish(false);
    acquireWakeLock();
    broadcastLiveBeacon(lastGpsObsRef.current || userPosRef.current, 'active');
    speak('Workout resumed.');
  };

  const toggleAutoPause = () => {
    setAutoPauseEnabled((prev) => {
      const next = !prev;
      autoPauseEnabledRef.current = next;
      if (!next && phaseRef.current === 'paused' && pauseReasonRef.current === 'auto') {
        handleResume();
      }
      return next;
    });
  };

  const handleCancelTracking = () => {
    stopGpsWatch();
    releaseWakeLock();
    if (beaconActiveRef.current && userIdRef.current) {
      beaconActiveRef.current = false;
      void stopLiveBeacon(userIdRef.current);
    }
    onCancel();
  };

  const handleFinish = () => {
    stopGpsWatch();
    releaseWakeLock();
    if (beaconActiveRef.current && userIdRef.current) {
      beaconActiveRef.current = false;
      void stopLiveBeacon(userIdRef.current);
    }
    localStorage.removeItem(RECOVERY_KEY);
    const finalMeta = getWorkoutMeta(workoutTypeRef.current);
    const totalSec = Math.max(1, elapsedRef.current);
    const dist = Math.round(distanceRef.current);
    const avgPace = dist >= 50 ? Math.round(totalSec / (dist / 1000)) : 0;
    const bestSplitPace =
      splits.length > 0 ? Math.min(...splits.map((s) => s.paceSecPerKm)) : avgPace;
    const avgSpeedKmh = dist > 0 ? dist / 1000 / (totalSec / 3600) : 0;
    const caloriesKcal = estimateCaloriesKcal(workoutTypeRef.current, totalSec, dist);
    const gpsAltitudes = samplesRef.current
      .map((s) => s.alt)
      .filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
    const gpsElev =
      gpsAltitudes.length >= 4 ? computeElevationStats(gpsAltitudes, dist, 1.5) : null;

    onFinishRun(
      {
        routeId: route?.id,
        routeName: route?.name || `${activeCity.name} Open ${finalMeta.pastNoun}`,
        routeType: route?.routeType || 'free_run',
        workoutType: workoutTypeRef.current,
        caloriesKcal,
        distanceMeters: dist,
        durationSec: totalSec,
        avgPaceSecPerKm: avgPace,
        bestPaceSecPerKm: bestSplitPace,
        avgSpeedKmh: Number(avgSpeedKmh.toFixed(2)),
        elevationGainMeters:
          gpsElev?.elevationGainMeters ?? route?.elevationGainMeters ?? 0,
        ...(gpsElev
          ? {
              elevationLossMeters: gpsElev.elevationLossMeters,
              minElevationMeters: gpsElev.minElevationMeters,
              maxElevationMeters: gpsElev.maxElevationMeters,
            }
          : {}),
        splits,
        encodedPolyline:
          traceRef.current.length > 1
            ? encodePolyline(traceRef.current)
            : route?.encodedPolyline || '',
        startName: route?.start.name || activeCity.name,
        sampleCount: samplesRef.current.length,
        status: 'completed',
        startedAt: startedAtRef.current || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      samplesRef.current
    );
  };

  const upcomingTurn: { turn: TurnCuePoint | null; distMeters: number } = useMemo(() => {
    if (!route || routeTurns.length === 0) {
      return { turn: null, distMeters: 0 };
    }
    if (activeTurnState?.turn) {
      return {
        turn: activeTurnState.turn,
        distMeters: activeTurnState.distMeters,
      };
    }
    const firstTurn = routeTurns[0];
    return {
      turn: firstTurn,
      distMeters: Math.max(0, firstTurn.cumRouteMeters),
    };
  }, [route, routeTurns, activeTurnState]);

  const avgPace = distanceMeters >= 50 ? elapsedSec / (distanceMeters / 1000) : 0;
  const avgSpeedKmh = elapsedSec > 0 && distanceMeters > 0 ? (distanceMeters / 1000) / (elapsedSec / 3600) : 0;
  const plannedMeters = route?.distanceMeters || 0;
  const remainingMeters = plannedMeters > 0 ? Math.max(0, plannedMeters - distanceMeters) : 0;
  const progressPct = plannedMeters > 0 ? Math.min(100, Math.round((distanceMeters / plannedMeters) * 100)) : 0;
  const heroDist = formatHeroDistance(distanceMeters, preferredUnit);
  const navCenter = userPos || route?.start || { lat: activeCity.lat, lng: activeCity.lng };

  const liveKmCheckpoints: CompletedKmCheckpoint[] = useMemo(
    () =>
      splits
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map((s) => ({
          km: s.km,
          position: { lat: s.lat as number, lng: s.lng as number },
          splitDurationSec: s.splitDurationSec,
          paceSecPerKm: s.paceSecPerKm,
        })),
    [splits]
  );

  const renderMapControls = () => (
    <div className="absolute right-3 bottom-4 z-20 flex flex-col gap-2 sm:right-4">
      <button
        type="button"
        onClick={() => {
          if (cameraMode === 'nav') {
            setCameraMode('overview');
            setFollowCamera(false);
            setOverviewTrigger((n) => n + 1);
          } else {
            setCameraMode('nav');
            setFollowCamera(true);
          }
        }}
        className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E5E3DC] bg-white/95 px-3 text-xs font-bold text-[#172D27] shadow-lg backdrop-blur transition active:scale-95 whitespace-nowrap"
      >
        {cameraMode === 'nav' ? (
          <>
            <MapIcon className="h-4 w-4 text-[#30483E]" />
            <span>Overview</span>
          </>
        ) : (
          <>
            <Compass className="h-4 w-4 text-[#1A73E8]" />
            <span>3D Nav</span>
          </>
        )}
      </button>

      {(!followCamera || cameraMode === 'overview') && (
        <button
          type="button"
          onClick={() => {
            setCameraMode('nav');
            setFollowCamera(true);
          }}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3 text-xs font-bold text-[#9AE62E] shadow-lg transition active:scale-95 whitespace-nowrap"
        >
          <LocateFixed className="h-4 w-4" />
          <span>Re-center</span>
        </button>
      )}
    </div>
  );

  const renderWorkoutActions = (darkSurface: boolean) => {
    if (screenLocked) {
      return (
        <div className="flex items-center justify-between gap-3">
          <p className={`text-xs font-medium ${darkSurface ? 'text-[#B8E8C7]' : 'text-[#5B6B64]'}`}>
            Screen locked to prevent accidental taps
          </p>
          <button
            type="button"
            onClick={() => setScreenLocked(false)}
            className="flex min-h-[52px] shrink-0 items-center gap-2 rounded-2xl bg-[#9AE62E] px-5 text-sm font-bold text-[#172D27] shadow-sm active:scale-[0.98] transition-transform whitespace-nowrap"
          >
            <Unlock className="h-4 w-4" />
            Unlock
          </button>
        </div>
      );
    }

    if (confirmFinish) {
      return (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 ${
            darkSurface ? 'bg-[#203A32] border border-white/10' : 'bg-[#F6F5F0] border border-[#E5E3DC]'
          }`}
        >
          <span className={`text-sm font-semibold ${darkSurface ? 'text-white' : 'text-[#141F1B]'}`}>
            Finish &amp; auto-save {workoutMeta.pastNoun.toLowerCase()}?
          </span>
          <div className="flex flex-1 justify-end gap-2 sm:flex-initial">
            <button
              type="button"
              onClick={() => setConfirmFinish(false)}
              className={`min-h-[46px] flex-1 sm:flex-initial rounded-xl px-4 text-xs font-bold whitespace-nowrap ${
                darkSurface
                  ? 'border border-white/20 bg-transparent text-white'
                  : 'border border-[#D9D7CE] bg-white text-[#5B6B64]'
              }`}
            >
              Keep Going
            </button>
            <button
              type="button"
              onClick={handleFinish}
              className="flex min-h-[46px] flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl bg-[#9AE62E] px-4 text-xs font-bold text-[#172D27] whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4" />
              Finish
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-label="Lock workout controls"
          onClick={() => setScreenLocked(true)}
          className={`flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl transition active:scale-[0.97] ${
            darkSurface
              ? 'border border-white/15 bg-white/10 text-white hover:bg-white/15'
              : 'border border-[#D9D7CE] bg-white text-[#172D27] hover:bg-[#F6F5F0]'
          }`}
        >
          <Lock className="h-5 w-5" />
        </button>

        {phase === 'running' ? (
          <button
            type="button"
            onClick={handlePause}
            className="flex min-h-[54px] flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-[#9AE62E] px-5 text-base font-bold text-[#172D27] shadow-sm transition active:scale-[0.98] whitespace-nowrap"
          >
            <Pause className="h-5 w-5 fill-current" />
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={handleResume}
            className="flex min-h-[54px] flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-[#9AE62E] px-5 text-base font-bold text-[#172D27] shadow-sm transition active:scale-[0.98] whitespace-nowrap"
          >
            <Play className="h-5 w-5 fill-current" />
            Resume
          </button>
        )}

        <button
          type="button"
          onClick={() => setConfirmFinish(true)}
          className={`flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold transition active:scale-[0.98] whitespace-nowrap ${
            darkSurface
              ? 'border border-white/20 bg-white text-[#172D27] hover:bg-[#F6F5F0]'
              : 'bg-[#172D27] text-white hover:bg-[#30483E]'
          }`}
        >
          <Square className="h-4 w-4 fill-current" />
          Finish
        </button>
      </div>
    );
  };

  // Pre-Run Preview & Start State
  if (phase === 'ready') {
    return (
      <div className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#E8ECE8]">
        <div className="relative flex-1 min-h-0">
          <TricityMap
            routes={route ? [route] : []}
            selectedRouteId={route?.id}
            liveTrace={trace}
            userPosition={userPos}
            liveFriends={liveFriends}
            startLocation={route?.start}
            heightClass="h-full w-full"
            navigationMode={cameraMode === 'nav'}
            followCamera={cameraMode === 'nav' && followCamera}
            navCenter={navCenter}
            navHeading={runnerHeading}
            navTilt={45}
            navZoom={18.2}
            overviewTrigger={overviewTrigger}
            hideRecenterButton
            onUserPan={() => {
              if (cameraMode === 'nav' && followCamera) {
                setFollowCamera(false);
              }
            }}
          />

          {/* Compact Top Nav Preview Bar */}
          <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 flex flex-col gap-2 sm:left-4 sm:right-4">
            <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-2xl bg-[#172D27]/95 px-4 py-3 text-white shadow-xl backdrop-blur-md">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#30483E]">
                  <TurnIcon
                    maneuver={upcomingTurn.turn?.maneuver}
                    instruction={upcomingTurn.turn?.displayLabel || ''}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-[#9AE62E] tabular-nums">
                    {upcomingTurn.turn && upcomingTurn.distMeters > 0
                      ? `First turn in ${upcomingTurn.distMeters}m · Voice alert @ 100m`
                      : gpsAccuracy !== null
                      ? `GPS Ready · ±${gpsAccuracy}m`
                      : 'Acquiring GPS Signal'}
                  </p>
                  <p className="truncate text-sm font-bold text-white sm:text-base">
                    {upcomingTurn.turn?.displayLabel || route?.name || `${activeCity.name} Open ${workoutMeta.pastNoun}`}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label={audioEnabled ? 'Mute voice cues' : 'Enable voice cues'}
                  onClick={() => {
                    const next = !audioEnabled;
                    audioEnabledRef.current = next;
                    setAudioEnabled(next);
                    if (!next && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
                >
                  {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  aria-label="Close workout navigation"
                  onClick={handleCancelTracking}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {renderMapControls()}
        </div>

        {/* Thumb-Zone Bottom Pre-Workout Sheet */}
        <div className="z-20 shrink-0 rounded-t-3xl border-t border-[#E5E3DC] bg-white px-4 pt-3 pb-5 shadow-[0_-10px_30px_rgba(0,0,0,0.12)] sm:mx-auto sm:mb-4 sm:w-full sm:max-w-2xl sm:rounded-2xl sm:border sm:p-5 pb-safe">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#D9D7CE] sm:hidden" />

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5B6B64]">
                <WorkoutIcon type={workoutType} className="h-3.5 w-3.5 text-[#172D27]" />
                <span>
                  {route
                    ? `Ready · ${workoutMeta.fullLabel} Navigation`
                    : `Ready · Open GPS ${workoutMeta.pastNoun}`}
                </span>
              </p>
              <h2 className="mt-0.5 truncate font-display text-lg font-bold text-[#141F1B] sm:text-xl">
                {route?.name || `${activeCity.name} Free ${workoutMeta.pastNoun}`}
              </h2>
            </div>
            {plannedMeters > 0 && (
              <div className="shrink-0 text-right tabular-nums">
                <p className="text-[11px] font-medium text-[#5B6B64]">Target</p>
                <p className="font-mono text-xl font-bold text-[#172D27]">
                  {formatDistance(plannedMeters, preferredUnit)}
                </p>
              </div>
            )}
          </div>

          {!route && (
            <div className="mt-3">
              <WorkoutSelector
                value={workoutType}
                onChange={setWorkoutType}
                compact
              />
            </div>
          )}

          {route && (
            <div className="mt-3 flex items-center gap-4 border-y border-[#F0EFEA] py-2.5 text-xs text-[#5B6B64] tabular-nums">
              <span>Est. {formatDuration(route.durationSec)}</span>
              <span aria-hidden="true">·</span>
              <span>{route.kmMarkers.length} KM splits</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{route.start.name}</span>
            </div>
          )}

          {/* Auto-Pause & 100m Voice Turn Navigation Settings in Pre-Workout Sheet */}
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[#F6F5F0] px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#141F1B]">Auto-Pause at 0 km/h</p>
                <p className="text-[11px] text-[#5B6B64]">
                  Pauses clock when stopped &amp; resumes when you move
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoPauseEnabled}
                aria-label="Toggle Auto-Pause"
                onClick={toggleAutoPause}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  autoPauseEnabled ? 'bg-[#172D27]' : 'bg-[#D2CFC4]'
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full transition-transform ${
                    autoPauseEnabled ? 'translate-x-5 bg-[#9AE62E]' : 'translate-x-0 bg-white'
                  }`}
                />
              </button>
            </div>

            {route && (
              <div className="flex items-center justify-between gap-2.5 rounded-xl bg-[#F6F5F0] px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-[#141F1B]">
                    Voice Turn Alerts (100m Ahead)
                  </p>
                  <p className="truncate text-[11px] text-[#5B6B64]">
                    {routeTurns.length > 0
                      ? `Speaks right & left cues 100m early · ${routeTurns.length} route cues`
                      : 'Voice cues active for route'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    unlockAudio();
                    audioEnabledRef.current = true;
                    voiceTurnsEnabledRef.current = true;
                    setAudioEnabled(true);
                    setVoiceTurnsEnabled(true);
                    const sampleTurn = routeTurns[0];
                    const sampleMsg =
                      sampleTurn && sampleTurn.turnType !== 'finish'
                        ? `Voice turn navigation ready. In 100 meters, ${sampleTurn.spokenAction}.`
                        : 'Voice turn navigation ready. In 100 meters, turn right.';
                    speak(sampleMsg, { chime: true, force: true });
                  }}
                  className="min-h-[36px] shrink-0 rounded-lg border border-[#D9D7CE] bg-white px-2.5 text-[11px] font-bold text-[#172D27] hover:bg-[#E5E3DC]/40 active:scale-95 transition whitespace-nowrap"
                >
                  Test Voice
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={voiceTurnsEnabled && audioEnabled}
                  aria-label="Toggle 100m Voice Turn Alerts"
                  onClick={() => {
                    const next = !(voiceTurnsEnabled && audioEnabled);
                    voiceTurnsEnabledRef.current = next;
                    setVoiceTurnsEnabled(next);
                    if (next) {
                      audioEnabledRef.current = true;
                      setAudioEnabled(true);
                      unlockAudio();
                    }
                  }}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    voiceTurnsEnabled && audioEnabled ? 'bg-[#172D27]' : 'bg-[#D2CFC4]'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full transition-transform ${
                      voiceTurnsEnabled && audioEnabled
                        ? 'translate-x-5 bg-[#9AE62E]'
                        : 'translate-x-0 bg-white'
                    }`}
                  />
                </button>
              </div>
            )}
            {/* Live Run Location Sharing Panel */}
            <div className="rounded-xl bg-[#F6F5F0] px-3.5 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-[#141F1B]">
                    <Radio className={`h-3.5 w-3.5 ${liveShareMode !== 'off' ? 'text-emerald-600' : 'text-[#5B6B64]'}`} />
                    Share Live Location During Run
                  </p>
                  <p className="text-[11px] text-[#5B6B64]">
                    {!userId || !emailVerified
                      ? 'Sign in with a verified account to share live GPS with friends'
                      : friendContacts.length === 0
                      ? 'Add running friends in Social & DMs to share live location'
                      : liveShareMode === 'off'
                      ? 'Off — your location stays private'
                      : liveShareMode === 'friends'
                      ? `All ${friendContacts.length} friend${friendContacts.length > 1 ? 's' : ''} can watch you run live`
                      : `Sharing live with ${selectedFriendUids.length} selected friend${selectedFriendUids.length === 1 ? '' : 's'}`}
                  </p>
                </div>

                {userId && emailVerified && friendContacts.length > 0 && (
                  <div className="flex items-center gap-1 rounded-lg bg-white p-0.5 border border-[#D9D7CE]">
                    <button
                      type="button"
                      onClick={() => setLiveShareMode('off')}
                      className={`min-h-[30px] rounded-md px-2.5 text-[11px] font-bold transition ${
                        liveShareMode === 'off'
                          ? 'bg-[#172D27] text-[#9AE62E]'
                          : 'text-[#5B6B64]'
                      }`}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      onClick={() => setLiveShareMode('friends')}
                      className={`min-h-[30px] rounded-md px-2.5 text-[11px] font-bold transition ${
                        liveShareMode === 'friends'
                          ? 'bg-[#172D27] text-[#9AE62E]'
                          : 'text-[#5B6B64]'
                      }`}
                    >
                      All Friends
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLiveShareMode('selected');
                        if (selectedFriendUids.length === 0 && friendContacts[0]) {
                          setSelectedFriendUids([friendContacts[0].uid]);
                        }
                      }}
                      className={`min-h-[30px] rounded-md px-2.5 text-[11px] font-bold transition ${
                        liveShareMode === 'selected'
                          ? 'bg-[#172D27] text-[#9AE62E]'
                          : 'text-[#5B6B64]'
                      }`}
                    >
                      Pick Person
                    </button>
                  </div>
                )}
              </div>

              {userId && emailVerified && friendContacts.length > 0 && liveShareMode === 'selected' && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {friendContacts.map((fc) => {
                    const picked = selectedFriendUids.includes(fc.uid);
                    return (
                      <button
                        key={fc.uid}
                        type="button"
                        onClick={() =>
                          setSelectedFriendUids((prev) =>
                            prev.includes(fc.uid)
                              ? prev.filter((id) => id !== fc.uid)
                              : [...prev, fc.uid]
                          )
                        }
                        className={`min-h-[30px] rounded-lg border px-2.5 text-[11px] font-semibold transition ${
                          picked
                            ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                            : 'border-[#D9D7CE] bg-white text-[#141F1B]'
                        }`}
                      >
                        {fc.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {userId && emailVerified && friendContacts.length > 0 && liveShareMode !== 'off' && (
                <label className="flex items-center gap-2 pt-0.5 text-[11px] font-medium text-[#30483E] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyFriendsInDm}
                    onChange={(e) => setNotifyFriendsInDm(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#172D27]"
                  />
                  Also notify chosen friend(s) in DM when I start
                </label>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={handleCancelTracking}
              className="min-h-[52px] flex-1 rounded-2xl border border-[#D9D7CE] bg-white px-4 text-sm font-bold text-[#141F1B] active:scale-[0.98] transition-transform"
            >
              Back
            </button>
            <button
              type="button"
              onClick={startTracking}
              className="flex min-h-[52px] flex-[2.2] items-center justify-center gap-2 rounded-2xl bg-[#172D27] px-5 text-base font-bold text-[#9AE62E] shadow-sm transition hover:bg-[#30483E] active:scale-[0.98]"
            >
              <Play className="h-5 w-5 fill-current" />
              Start {workoutMeta.verb}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Workout State (Running / Cycling / Walking / Paused)
  const showTurnCue = Boolean(route && upcomingTurn.turn);
  const speedPct = speedBarPercent(currentSpeedKmh, workoutMeta.speedBarMaxKmh);
  const liveCalories = estimateCaloriesKcal(workoutType, elapsedSec, distanceMeters);
  const livePaceDisplay =
    phase === 'paused' || currentSpeedKmh <= 0.1
      ? '--:--'
      : formatPace(currentPaceSec || avgPace, preferredUnit);
  const speedUnitLabel = preferredUnit === 'mi' ? 'mph' : 'km/h';
  const liveSpeedNumeric =
    preferredUnit === 'mi' ? (currentSpeedKmh * 0.621371).toFixed(1) : currentSpeedKmh.toFixed(1);
  const avgSpeedDisplay = formatSpeed(avgSpeedKmh, preferredUnit);
  const scaleMid1 = Math.round(workoutMeta.speedBarMaxKmh * 0.33);
  const scaleMid2 = Math.round(workoutMeta.speedBarMaxKmh * 0.66);

  const renderInstantSpeedBar = (compact = false) => (
    <div
      className={`rounded-2xl border border-white/10 bg-[#203A32] ${
        compact ? 'px-3.5 py-2.5' : 'px-4 py-3'
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
        <span className="font-medium text-[#B8E8C7]">Instantaneous Speed</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-white sm:text-base">
            {liveSpeedNumeric}{' '}
            <span className="text-[11px] font-medium text-[#B8E8C7]">{speedUnitLabel}</span>
          </span>
          <span className="text-white/30" aria-hidden="true">·</span>
          <span
            className={`text-[11px] font-semibold ${
              phase === 'paused' && pauseReason === 'auto'
                ? 'text-amber-300'
                : currentSpeedKmh > 0.1
                ? 'text-[#9AE62E]'
                : 'text-[#B8E8C7]'
            }`}
          >
            {phase === 'paused' && pauseReason === 'auto'
              ? 'Auto-Paused'
              : phase === 'paused'
              ? 'Paused'
              : currentSpeedKmh > 0.1
              ? 'Moving'
              : 'Stopped'}
          </span>
        </div>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            phase === 'paused'
              ? 'bg-amber-300'
              : currentSpeedKmh > 0.1
              ? 'bg-[#9AE62E]'
              : 'bg-white/25'
          }`}
          style={{ width: `${speedPct}%` }}
        />
      </div>

      {!compact && (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-[#B8E8C7]/70 tabular-nums">
          <span>0</span>
          <span>{scaleMid1} km/h</span>
          <span>{scaleMid2} km/h</span>
          <span>{workoutMeta.speedBarMaxKmh}+ km/h</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#172D27] text-white">
      {/* Top Workout Header + Segmented View Switcher */}
      <header className="z-30 shrink-0 border-b border-white/10 bg-[#172D27] px-3 py-2.5 sm:px-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate font-display text-sm font-bold text-white sm:text-base">
              <WorkoutIcon type={workoutType} className="h-4 w-4 shrink-0 text-[#9AE62E]" />
              <span className="truncate">
                {route?.name || `${activeCity.name} Free ${workoutMeta.pastNoun}`}
              </span>
            </p>
            <p className="text-[11px] font-medium text-[#B8E8C7] tabular-nums">
              {phase === 'paused'
                ? pauseReason === 'auto'
                  ? 'Auto-Paused'
                  : 'Paused'
                : `Live ${workoutMeta.label}`}
              {gpsAccuracy !== null ? ` · GPS ±${gpsAccuracy}m` : ' · Locating'}
              {splits.length > 0 ? ` · ${splits.length} KM done` : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {userId && emailVerified && friendContacts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLiveShareSheet((v) => !v)}
                aria-pressed={liveShareMode !== 'off'}
                title="Live Run Location Sharing"
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold transition whitespace-nowrap ${
                  liveShareMode !== 'off'
                    ? 'bg-[#9AE62E] text-[#172D27]'
                    : 'bg-[#203A32] text-[#B8E8C7] border border-white/10 hover:text-white'
                }`}
              >
                <Radio className={`h-3.5 w-3.5 ${liveShareMode !== 'off' ? 'animate-pulse' : ''}`} />
                <span className="hidden sm:inline">
                  {liveShareMode === 'off'
                    ? 'Share Live'
                    : `Live · ${
                        liveShareMode === 'friends'
                          ? friendContacts.length
                          : selectedFriendUids.length
                      }`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleAutoPause}
              aria-pressed={autoPauseEnabled}
              title="Toggle Auto-Pause at 0 km/h"
              className={`hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition whitespace-nowrap ${
                autoPauseEnabled
                  ? 'bg-[#203A32] text-[#9AE62E] border border-[#9AE62E]/35'
                  : 'bg-[#203A32] text-[#B8E8C7]/70 border border-white/10'
              }`}
            >
              <PauseCircle className="h-3.5 w-3.5" />
              {autoPauseEnabled ? 'Auto-Pause On' : 'Auto-Pause Off'}
            </button>

            <div className="flex items-center rounded-xl bg-[#203A32] p-1">
              {(['stats', 'split', 'map'] as const).map((modeOption) => (
                <button
                  key={modeOption}
                  type="button"
                  onClick={() => setHudView(modeOption)}
                  className={`min-h-[36px] rounded-lg px-2.5 text-xs font-bold capitalize transition whitespace-nowrap sm:px-3 ${
                    hudView === modeOption
                      ? 'bg-[#9AE62E] text-[#172D27] shadow-sm'
                      : 'text-[#B8E8C7] hover:text-white'
                  }`}
                >
                  {modeOption}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-label={autoPauseEnabled ? 'Disable auto-pause' : 'Enable auto-pause'}
              onClick={toggleAutoPause}
              className={`flex sm:hidden h-11 w-11 items-center justify-center rounded-xl transition ${
                autoPauseEnabled
                  ? 'bg-[#203A32] text-[#9AE62E] border border-[#9AE62E]/35'
                  : 'bg-[#203A32] text-[#B8E8C7]/60'
              }`}
            >
              <PauseCircle className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label={audioEnabled ? 'Mute voice cues' : 'Enable voice cues'}
              onClick={() => {
                const next = !audioEnabled;
                audioEnabledRef.current = next;
                setAudioEnabled(next);
                if (!next && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                  window.speechSynthesis.cancel();
                } else if (next) {
                  unlockAudio();
                }
              }}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#203A32] text-white hover:bg-[#30483E]"
            >
              {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mid-Run Live Location Share Drawer */}
      {showLiveShareSheet && userId && emailVerified && friendContacts.length > 0 && (
        <div className="z-30 shrink-0 border-b border-[#9AE62E]/30 bg-[#203A32] px-4 py-3 text-white">
          <div className="mx-auto max-w-6xl space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Users className="h-4 w-4 text-[#9AE62E]" />
                <span>Live Location Sharing</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setLiveShareMode('off')}
                  className={`min-h-[32px] rounded-lg px-2.5 text-xs font-bold ${
                    liveShareMode === 'off' ? 'bg-[#9AE62E] text-[#172D27]' : 'bg-white/10 text-white'
                  }`}
                >
                  Stop Sharing
                </button>
                <button
                  type="button"
                  onClick={() => setLiveShareMode('friends')}
                  className={`min-h-[32px] rounded-lg px-2.5 text-xs font-bold ${
                    liveShareMode === 'friends' ? 'bg-[#9AE62E] text-[#172D27]' : 'bg-white/10 text-white'
                  }`}
                >
                  All Friends ({friendContacts.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLiveShareMode('selected');
                    if (selectedFriendUids.length === 0 && friendContacts[0]) {
                      setSelectedFriendUids([friendContacts[0].uid]);
                    }
                  }}
                  className={`min-h-[32px] rounded-lg px-2.5 text-xs font-bold ${
                    liveShareMode === 'selected' ? 'bg-[#9AE62E] text-[#172D27]' : 'bg-white/10 text-white'
                  }`}
                >
                  Pick Friends
                </button>
                <button
                  type="button"
                  onClick={() => setShowLiveShareSheet(false)}
                  aria-label="Close live sharing controls"
                  className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {liveShareMode === 'selected' && (
              <div className="flex flex-wrap gap-1.5">
                {friendContacts.map((fc) => {
                  const picked = selectedFriendUids.includes(fc.uid);
                  return (
                    <button
                      key={fc.uid}
                      type="button"
                      onClick={() =>
                        setSelectedFriendUids((prev) =>
                          prev.includes(fc.uid)
                            ? prev.filter((id) => id !== fc.uid)
                            : [...prev, fc.uid]
                        )
                      }
                      className={`min-h-[32px] rounded-lg px-2.5 text-xs font-semibold ${
                        picked ? 'bg-[#9AE62E] text-[#172D27]' : 'bg-white/10 text-[#B8E8C7]'
                      }`}
                    >
                      {fc.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auto-Paused Status Strip */}
      {phase === 'paused' && pauseReason === 'auto' && (
        <div className="z-30 shrink-0 border-b border-amber-300/30 bg-[#203A32] px-4 py-2 text-xs font-semibold text-amber-200">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <span className="truncate">
              Auto-paused at 0.0 km/h — resume moving to auto-resume
            </span>
            <button
              type="button"
              onClick={handleResume}
              className="shrink-0 font-bold text-[#9AE62E] underline whitespace-nowrap"
            >
              Resume Now
            </button>
          </div>
        </div>
      )}

      {/* Alerts / Turn Navigation Strip when relevant */}
      {(offRouteMeters > 55 || gpsError) && (
        <div className="z-30 shrink-0 border-b border-amber-300/40 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
            <span className="truncate">
              {gpsError || `Off route by ${offRouteMeters}m — follow blue corridor back on track.`}
            </span>
          </div>
        </div>
      )}

      {/* Spoken Turn Voice Cue Banner */}
      {voiceBannerText && (
        <div className="z-30 shrink-0 border-b border-[#9AE62E]/40 bg-[#203A32] px-4 py-2 text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 text-xs font-bold">
            <span className="flex items-center gap-2 truncate text-[#9AE62E]">
              <Volume2 className="h-4 w-4 shrink-0" />
              <span className="truncate text-white">{voiceBannerText}</span>
            </span>
            <button
              type="button"
              onClick={() => setVoiceBannerText(null)}
              className="shrink-0 text-[11px] font-semibold text-[#B8E8C7] underline"
            >
              Hide
            </button>
          </div>
        </div>
      )}

      {/* Adidas-Style 1 KM Split Celebration Strip */}
      {kmMilestoneToast && (
        <div className="z-30 shrink-0 border-b border-[#9AE62E]/40 bg-[#9AE62E] px-4 py-2 text-[#172D27]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 font-mono text-xs font-bold tabular-nums">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Flag className="h-3.5 w-3.5 shrink-0 fill-current" />
              <span>{kmMilestoneToast.km} KM TOTAL</span>
              <span>· Split {formatDuration(kmMilestoneToast.splitDurationSec)}</span>
              <span>· Total {formatDuration(kmMilestoneToast.totalDurationSec)}</span>
              <span>· Avg {formatPace(kmMilestoneToast.avgPaceSecPerKm, preferredUnit)}/{preferredUnit}</span>
              <span>· {kmMilestoneToast.totalCaloriesKcal} kcal</span>
            </span>
            <button
              type="button"
              onClick={() => setKmMilestoneToast(null)}
              className="text-[11px] font-extrabold underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Responsive Body: Stats Cockpit / Split (Vertical Mobile, 2-Col Desktop) / Full Map */}
      {hudView === 'stats' && (
        <div className="flex flex-1 min-h-0 flex-col justify-between px-4 py-4 sm:px-6 sm:py-6 pb-safe">
          <div className="mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col justify-evenly gap-3 overflow-y-auto">
            {showTurnCue && upcomingTurn.turn && (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#203A32] px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#172D27]">
                  <TurnIcon
                    maneuver={upcomingTurn.turn.maneuver}
                    instruction={upcomingTurn.turn.displayLabel}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-bold text-[#9AE62E] tabular-nums">
                      {upcomingTurn.distMeters > 0 ? `Next turn in ${upcomingTurn.distMeters} m` : 'Next turn'}
                    </p>
                    {voiceTurnsEnabled && audioEnabled && (
                      <span className="text-[10px] font-semibold text-[#B8E8C7]">
                        Voice @ 100m
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm font-semibold text-white">
                    {upcomingTurn.turn.displayLabel}
                  </p>
                </div>
              </div>
            )}

            {/* Hero Distance Display */}
            <div className="py-2 text-center">
              <p className="text-xs font-semibold tracking-wide text-[#B8E8C7]">
                Distance ({preferredUnit})
              </p>
              <div className="mt-1 flex items-baseline justify-center gap-2">
                <span className="font-mono text-6xl font-extrabold leading-none tracking-tight text-white tabular-nums sm:text-7xl lg:text-8xl">
                  {heroDist.value}
                </span>
                <span className="font-mono text-xl font-bold text-[#9AE62E] sm:text-2xl">
                  {heroDist.unitLabel}
                </span>
              </div>

              {plannedMeters > 0 && (
                <div className="mx-auto mt-4 max-w-md space-y-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#9AE62E] transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between font-mono text-xs text-[#B8E8C7] tabular-nums">
                    <span>{progressPct}% complete</span>
                    <span>{formatDistance(remainingMeters, preferredUnit)} left</span>
                  </div>
                </div>
              )}
            </div>

            {/* Spacious 2x2 Workout Telemetry Grid */}
            <div className="grid grid-cols-2 border-y border-white/10">
              <div className="border-r border-b border-white/10 py-4 pr-3 sm:py-5">
                <p className="text-xs font-medium text-[#B8E8C7]">Duration</p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-tight text-white tabular-nums sm:text-4xl lg:text-5xl">
                  {formatDuration(elapsedSec)}
                </p>
              </div>
              <div className="border-b border-white/10 py-4 pl-4 sm:py-5">
                <p className="text-xs font-medium text-[#B8E8C7]">
                  {isSpeedPrimary ? `Live Speed (${speedUnitLabel})` : `Current Pace (/${preferredUnit})`}
                </p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-tight text-[#9AE62E] tabular-nums sm:text-4xl lg:text-5xl">
                  {isSpeedPrimary ? liveSpeedNumeric : livePaceDisplay}
                </p>
              </div>
              <div className="border-r border-white/10 py-4 pr-3 sm:py-5">
                <p className="text-xs font-medium text-[#B8E8C7]">
                  {isSpeedPrimary ? 'Avg Speed' : `Average Pace (/${preferredUnit})`}
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                  {isSpeedPrimary ? avgSpeedDisplay : formatPace(avgPace, preferredUnit)}
                </p>
              </div>
              <div className="py-4 pl-4 sm:py-5">
                <p className="text-xs font-medium text-[#B8E8C7]">
                  {plannedMeters > 0 ? 'Remaining' : 'Est. Burn'}
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                  {plannedMeters > 0
                    ? formatDistance(remainingMeters, preferredUnit)
                    : `${liveCalories} kcal`}
                </p>
              </div>
            </div>

            {renderInstantSpeedBar(false)}

            {/* Recent Completed Splits */}
            {splits.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {splits.slice(-4).map((s) => (
                  <div
                    key={s.km}
                    className="shrink-0 rounded-xl border border-white/10 bg-[#203A32] px-3 py-2 font-mono text-xs tabular-nums"
                  >
                    <span className="font-bold text-[#9AE62E]">KM {s.km}</span>
                    <span className="mx-1.5 text-white/40">·</span>
                    <span className="font-semibold text-white">
                      {formatPace(s.paceSecPerKm, preferredUnit)}/{preferredUnit}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mx-auto mt-3 w-full max-w-2xl shrink-0">
            {renderWorkoutActions(true)}
          </div>
        </div>
      )}

      {hudView === 'split' && (
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          {/* Interactive Map Half (Top on Mobile, Right on Desktop) */}
          <div className="relative h-[38%] min-h-[200px] w-full shrink-0 lg:order-2 lg:h-full lg:flex-1">
            <TricityMap
              routes={route ? [route] : []}
              selectedRouteId={route?.id}
              liveTrace={trace}
              completedKmMarkers={liveKmCheckpoints}
              preferredUnit={preferredUnit}
              userPosition={userPos}
              liveFriends={liveFriends}
              startLocation={route?.start}
              fallbackCenter={{ lat: activeCity.lat, lng: activeCity.lng }}
              heightClass="h-full w-full"
              navigationMode={cameraMode === 'nav'}
              followCamera={cameraMode === 'nav' && followCamera}
              navCenter={navCenter}
              navHeading={runnerHeading}
              navTilt={45}
              navZoom={18.2}
              overviewTrigger={overviewTrigger}
              hideRecenterButton
              onUserPan={() => {
                if (cameraMode === 'nav' && followCamera) {
                  setFollowCamera(false);
                }
              }}
            />

            {showTurnCue && upcomingTurn.turn && (
              <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 z-20">
                <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl bg-[#172D27]/92 px-3 py-2 text-white shadow-lg backdrop-blur-md">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#30483E]">
                    <TurnIcon
                      maneuver={upcomingTurn.turn.maneuver}
                      instruction={upcomingTurn.turn.displayLabel}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-[11px] font-bold text-[#9AE62E] tabular-nums">
                        {upcomingTurn.distMeters > 0 ? `In ${upcomingTurn.distMeters} m` : 'Now'}
                      </p>
                      {voiceTurnsEnabled && audioEnabled && (
                        <span className="text-[10px] font-semibold text-[#B8E8C7]">
                          Voice @ 100m
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs font-bold text-white sm:text-sm">
                      {upcomingTurn.turn.displayLabel}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {renderMapControls()}
          </div>

          {/* Spacious Adidas Running Telemetry Deck (Bottom on Mobile, Left Console on Desktop) */}
          <div className="relative z-20 -mt-3 flex flex-1 min-h-0 flex-col justify-between rounded-t-3xl border-t border-white/10 bg-[#172D27] px-4 pt-3.5 pb-4 shadow-[0_-10px_28px_rgba(0,0,0,0.3)] sm:px-6 lg:order-1 lg:mt-0 lg:w-[440px] lg:flex-none lg:rounded-none lg:border-t-0 lg:border-r lg:py-6 xl:w-[480px] pb-safe">
            <div className="flex flex-1 min-h-0 flex-col justify-evenly gap-2.5 overflow-y-auto">
              {/* Primary Distance & Duration Spotlight */}
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#B8E8C7]">Distance ({preferredUnit})</p>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="font-mono text-5xl font-extrabold leading-none tracking-tight text-white tabular-nums sm:text-6xl">
                      {heroDist.value}
                    </span>
                    <span className="font-mono text-base font-bold text-[#9AE62E]">
                      {heroDist.unitLabel}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-xs font-semibold text-[#B8E8C7]">Duration</p>
                  <p className="mt-0.5 font-mono text-3xl font-bold leading-none text-white tabular-nums sm:text-4xl">
                    {formatDuration(elapsedSec)}
                  </p>
                </div>
              </div>

              {plannedMeters > 0 && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#9AE62E] transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between font-mono text-[11px] text-[#B8E8C7] tabular-nums">
                    <span>{progressPct}% complete</span>
                    <span>{formatDistance(remainingMeters, preferredUnit)} remaining</span>
                  </div>
                </div>
              )}

              {/* Clear 3-Metric Row on Generous Surfaces */}
              <div className="grid grid-cols-3 border-y border-white/10 py-3">
                <div className="pr-2">
                  <p className="text-[11px] font-medium text-[#B8E8C7]">
                    {isSpeedPrimary ? 'Live Speed' : 'Live Pace'}
                  </p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#9AE62E] tabular-nums sm:text-2xl">
                    {isSpeedPrimary ? liveSpeedNumeric : livePaceDisplay}
                    <span className="ml-0.5 text-[11px] font-medium text-[#B8E8C7]">
                      {isSpeedPrimary ? ` ${speedUnitLabel}` : `/${preferredUnit}`}
                    </span>
                  </p>
                </div>
                <div className="border-x border-white/10 px-2.5 text-center">
                  <p className="text-[11px] font-medium text-[#B8E8C7]">
                    {isSpeedPrimary ? 'Avg Speed' : 'Avg Pace'}
                  </p>
                  <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums sm:text-2xl">
                    {isSpeedPrimary ? avgSpeedDisplay.split(' ')[0] : formatPace(avgPace, preferredUnit)}
                    <span className="ml-0.5 text-[11px] font-medium text-[#B8E8C7]">
                      {isSpeedPrimary ? ` ${speedUnitLabel}` : `/${preferredUnit}`}
                    </span>
                  </p>
                </div>
                <div className="pl-2 text-right">
                  <p className="text-[11px] font-medium text-[#B8E8C7]">Calories</p>
                  <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums sm:text-2xl">
                    {liveCalories}
                    <span className="ml-0.5 text-[11px] font-medium text-[#B8E8C7]">kcal</span>
                  </p>
                </div>
              </div>

              {renderInstantSpeedBar(true)}
            </div>

            <div className="mt-3 shrink-0">{renderWorkoutActions(true)}</div>
          </div>
        </div>
      )}

      {hudView === 'map' && (
        <div className="relative flex-1 min-h-0">
          <TricityMap
            routes={route ? [route] : []}
            selectedRouteId={route?.id}
            liveTrace={trace}
            completedKmMarkers={liveKmCheckpoints}
            preferredUnit={preferredUnit}
            userPosition={userPos}
            liveFriends={liveFriends}
            startLocation={route?.start}
            fallbackCenter={{ lat: activeCity.lat, lng: activeCity.lng }}
            heightClass="h-full w-full"
            navigationMode={cameraMode === 'nav'}
            followCamera={cameraMode === 'nav' && followCamera}
            navCenter={navCenter}
            navHeading={runnerHeading}
            navTilt={45}
            navZoom={18.2}
            overviewTrigger={overviewTrigger}
            hideRecenterButton
            onUserPan={() => {
              if (cameraMode === 'nav' && followCamera) {
                setFollowCamera(false);
              }
            }}
          />

          {showTurnCue && upcomingTurn.turn && (
            <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 sm:right-4 sm:left-4">
              <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl bg-[#172D27]/95 px-4 py-3 text-white shadow-xl backdrop-blur-md">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#30483E]">
                  <TurnIcon
                    maneuver={upcomingTurn.turn.maneuver}
                    instruction={upcomingTurn.turn.displayLabel}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-bold text-[#9AE62E] tabular-nums">
                      {upcomingTurn.distMeters > 0 ? `In ${upcomingTurn.distMeters} m` : 'Now'}
                    </p>
                    {voiceTurnsEnabled && audioEnabled && (
                      <span className="text-[11px] font-semibold text-[#B8E8C7]">
                        Voice cue @ 100m
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm font-bold text-white sm:text-base">
                    {upcomingTurn.turn.displayLabel}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Right Map Controls */}
          <div className="absolute right-3 top-24 z-20 flex flex-col gap-2 sm:right-4">
            <button
              type="button"
              onClick={() => {
                if (cameraMode === 'nav') {
                  setCameraMode('overview');
                  setFollowCamera(false);
                  setOverviewTrigger((n) => n + 1);
                } else {
                  setCameraMode('nav');
                  setFollowCamera(true);
                }
              }}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E5E3DC] bg-white/95 px-3 text-xs font-bold text-[#172D27] shadow-lg backdrop-blur transition active:scale-95 whitespace-nowrap"
            >
              {cameraMode === 'nav' ? (
                <>
                  <MapIcon className="h-4 w-4 text-[#30483E]" />
                  <span>Overview</span>
                </>
              ) : (
                <>
                  <Compass className="h-4 w-4 text-[#1A73E8]" />
                  <span>3D Nav</span>
                </>
              )}
            </button>

            {(!followCamera || cameraMode === 'overview') && (
              <button
                type="button"
                onClick={() => {
                  setCameraMode('nav');
                  setFollowCamera(true);
                }}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3 text-xs font-bold text-[#9AE62E] shadow-lg transition active:scale-95 whitespace-nowrap"
              >
                <LocateFixed className="h-4 w-4" />
                <span>Re-center</span>
              </button>
            )}
          </div>

          {/* Spacious 3-Column Bottom Map Overlay Sheet */}
          <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 sm:right-4 sm:bottom-4 sm:left-4">
            <div className="pointer-events-auto mx-auto w-full max-w-2xl rounded-t-3xl border-t border-white/10 bg-[#172D27]/96 px-4 pt-3.5 pb-4 text-white shadow-2xl backdrop-blur-md sm:rounded-2xl sm:border sm:p-5 pb-safe">
              <div className="grid grid-cols-3 gap-2 pb-3 text-center tabular-nums">
                <div>
                  <p className="text-[11px] font-medium text-[#B8E8C7]">Distance</p>
                  <p className="mt-0.5 font-mono text-2xl font-extrabold text-white sm:text-3xl">
                    {heroDist.value}
                    <span className="ml-1 text-xs font-semibold text-[#9AE62E]">{heroDist.unitLabel}</span>
                  </p>
                </div>
                <div className="border-x border-white/10 px-1">
                  <p className="text-[11px] font-medium text-[#B8E8C7]">Duration</p>
                  <p className="mt-0.5 font-mono text-2xl font-extrabold text-white sm:text-3xl">
                    {formatDuration(elapsedSec)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#B8E8C7]">
                    {isSpeedPrimary ? `Speed (${speedUnitLabel})` : 'Pace'}
                  </p>
                  <p className="mt-0.5 font-mono text-2xl font-extrabold text-[#9AE62E] sm:text-3xl">
                    {isSpeedPrimary ? liveSpeedNumeric : livePaceDisplay}
                  </p>
                </div>
              </div>

              <div className="mb-3">{renderInstantSpeedBar(true)}</div>

              {renderWorkoutActions(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
