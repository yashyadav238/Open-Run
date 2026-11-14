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
  RotateCcw,
  Square,
  Unlock,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { TRICITY_CENTER } from '../data/tricityPlaces';
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
  encodePolyline,
  formatDistance,
  formatDuration,
  formatPace,
  haversineMeters,
  minDistanceToPathMeters,
} from '../lib/geo';
import type {
  CompletedKmCheckpoint,
  GeneratedRouteCandidate,
  GpsSample,
  LatLngLiteral,
  RouteStepInstruction,
  RunActivityDoc,
  SplitRecord,
} from '../types/run';
import { TricityMap } from './TricityMap';

const RECOVERY_KEY = 'tricity_active_run_recovery_v1';

type HudViewMode = 'stats' | 'split' | 'map';

interface LiveRunTrackerProps {
  route: GeneratedRouteCandidate | null;
  preferredUnit: 'km' | 'mi';
  onCancel: () => void;
  onFinishRun: (
    summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>,
    samples: GpsSample[]
  ) => void;
}

function TurnIcon({ maneuver, instruction }: { maneuver?: string; instruction: string }) {
  const txt = `${maneuver || ''} ${instruction}`.toLowerCase();
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
  preferredUnit,
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

  const [phase, setPhase] = useState<RunPhase>('ready');
  const [pauseReason, setPauseReason] = useState<PauseReason>(null);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [hudView, setHudView] = useState<HudViewMode>(() => (route ? 'split' : 'stats'));
  const [screenLocked, setScreenLocked] = useState(false);

  const [distanceMeters, setDistanceMeters] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [currentPaceSec, setCurrentPaceSec] = useState(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [offRouteMeters, setOffRouteMeters] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(true);
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
    paceSecPerKm: number;
  } | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);

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
  const distanceRef = useRef(0);
  const elapsedRef = useRef(0);
  const phaseRef = useRef<RunPhase>(phase);
  const pauseReasonRef = useRef<PauseReason>(pauseReason);
  const autoPauseEnabledRef = useRef<boolean>(autoPauseEnabled);
  phaseRef.current = phase;
  pauseReasonRef.current = pauseReason;
  autoPauseEnabledRef.current = autoPauseEnabled;

  const speak = (text: string) => {
    if (!audioEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.0;
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
        localStorage.setItem(
          RECOVERY_KEY,
          JSON.stringify({
            routeName: route?.name || 'Chandigarh Free Run',
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
  }, [phase, route]);

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

  const stopGpsWatch = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  useEffect(() => {
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
    };
  }, []);

  const startTracking = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }
    setGpsError(null);
    if (!startedAtRef.current) {
      startedAtRef.current = new Date().toISOString();
    }
    lastMotionAtRef.current = Date.now();
    firstFixReceivedRef.current = false;
    pauseAnchorPosRef.current = null;
    pauseReasonRef.current = null;
    phaseRef.current = 'running';
    setPauseReason(null);
    setPhase('running');
    setHudView(route ? 'split' : 'stats');
    setCameraMode('nav');
    setFollowCamera(true);
    acquireWakeLock();
    speak(
      route
        ? 'Workout started. Follow the blue pedestrian corridor.'
        : 'Workout started. Recording your Chandigarh run.'
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

        const instantSpeedMs =
          acc <= 100
            ? computeInstantaneousSpeedMs({
                reportedSpeedMs: pos.coords.speed,
                stepMeters: obsStepMeters,
                dtSec: obsDtSec,
                accuracyMeters: acc,
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
          if (segSpeed > 9.5 || stepMeters < 2) return;

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
            lastSplitDistRef.current = nextTotal;
            lastSplitTimeRef.current = elapsedRef.current;
            setSplits((prevSplits) => [...prevSplits, splitRec]);
            setKmMilestoneToast({
              km: completedKms,
              splitDurationSec,
              paceSecPerKm: splitDurationSec,
            });
            setTimeout(() => {
              setKmMilestoneToast((cur) => (cur?.km === completedKms ? null : cur));
            }, 5500);
            if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
            speak(`${completedKms} kilometre completed in ${formatDuration(splitDurationSec)}.`);
          }
        }

        if (route && route.path.length > 1) {
          setOffRouteMeters(Math.round(minDistanceToPathMeters(nextPt, route.path)));
        }

        samplesRef.current.push({
          lat: nextPt.lat,
          lng: nextPt.lng,
          t: now,
          acc: Math.round(acc),
        });
        traceRef.current.push(nextPt);
        setTrace((prev) => [...prev, nextPt]);
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

  const handleFinish = () => {
    stopGpsWatch();
    releaseWakeLock();
    localStorage.removeItem(RECOVERY_KEY);
    const totalSec = Math.max(1, elapsedRef.current);
    const dist = Math.round(distanceRef.current);
    const avgPace = dist >= 50 ? Math.round(totalSec / (dist / 1000)) : 0;
    const bestSplitPace =
      splits.length > 0 ? Math.min(...splits.map((s) => s.paceSecPerKm)) : avgPace;
    const avgSpeedKmh = dist > 0 ? dist / 1000 / (totalSec / 3600) : 0;

    onFinishRun(
      {
        routeId: route?.id,
        routeName: route?.name || 'Chandigarh Open Run',
        routeType: route?.routeType || 'free_run',
        distanceMeters: dist,
        durationSec: totalSec,
        avgPaceSecPerKm: avgPace,
        bestPaceSecPerKm: bestSplitPace,
        avgSpeedKmh: Number(avgSpeedKmh.toFixed(2)),
        elevationGainMeters: route?.elevationGainMeters ?? 0,
        splits,
        encodedPolyline:
          traceRef.current.length > 1
            ? encodePolyline(traceRef.current)
            : route?.encodedPolyline || '',
        startName: route?.start.name || 'Chandigarh',
        sampleCount: samplesRef.current.length,
        status: 'completed',
        startedAt: startedAtRef.current || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      samplesRef.current
    );
  };

  const upcomingTurn: { step: RouteStepInstruction | null; distMeters: number } = useMemo(() => {
    if (!route || route.steps.length === 0) {
      return { step: null, distMeters: 0 };
    }
    const refPos = userPos || route.start;
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < route.steps.length; i++) {
      const st = route.steps[i];
      if (!st.startLocation) continue;
      const d = haversineMeters(refPos, st.startLocation);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const nextIdx = bestDist < 22 && bestIdx + 1 < route.steps.length ? bestIdx + 1 : bestIdx;
    const targetStep = route.steps[nextIdx] || route.steps[0];
    const distToTurn = targetStep?.startLocation
      ? Math.round(haversineMeters(refPos, targetStep.startLocation))
      : targetStep?.distanceMeters || 0;

    return { step: targetStep, distMeters: distToTurn };
  }, [route, userPos]);

  const avgPace = distanceMeters >= 50 ? elapsedSec / (distanceMeters / 1000) : 0;
  const avgSpeedKmh = elapsedSec > 0 && distanceMeters > 0 ? (distanceMeters / 1000) / (elapsedSec / 3600) : 0;
  const plannedMeters = route?.distanceMeters || 0;
  const remainingMeters = plannedMeters > 0 ? Math.max(0, plannedMeters - distanceMeters) : 0;
  const progressPct = plannedMeters > 0 ? Math.min(100, Math.round((distanceMeters / plannedMeters) * 100)) : 0;
  const heroDist = formatHeroDistance(distanceMeters, preferredUnit);
  const navCenter = userPos || route?.start || TRICITY_CENTER;

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
            Finish & auto-save run?
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
              Keep Running
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
                    maneuver={upcomingTurn.step?.maneuver}
                    instruction={upcomingTurn.step?.instruction || ''}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-[#9AE62E] tabular-nums">
                    {gpsAccuracy !== null ? `GPS Ready · ±${gpsAccuracy}m` : 'Acquiring GPS Signal'}
                  </p>
                  <p className="truncate text-sm font-bold text-white sm:text-base">
                    {upcomingTurn.step?.instruction || route?.name || 'Chandigarh Open Run'}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label={audioEnabled ? 'Mute voice cues' : 'Enable voice cues'}
                  onClick={() => setAudioEnabled((v) => !v)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
                >
                  {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  aria-label="Close run navigation"
                  onClick={onCancel}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {renderMapControls()}
        </div>

        {/* Thumb-Zone Bottom Pre-Run Sheet */}
        <div className="z-20 shrink-0 rounded-t-3xl border-t border-[#E5E3DC] bg-white px-4 pt-3 pb-5 shadow-[0_-10px_30px_rgba(0,0,0,0.12)] sm:mx-auto sm:mb-4 sm:w-full sm:max-w-2xl sm:rounded-2xl sm:border sm:p-5 pb-safe">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#D9D7CE] sm:hidden" />

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#5B6B64]">
                {route ? 'Ready · Route Navigation' : 'Ready · Open GPS Run'}
              </p>
              <h2 className="mt-0.5 truncate font-display text-lg font-bold text-[#141F1B] sm:text-xl">
                {route?.name || 'Chandigarh Free Run'}
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

          {route && (
            <div className="mt-3 flex items-center gap-4 border-y border-[#F0EFEA] py-2.5 text-xs text-[#5B6B64] tabular-nums">
              <span>Est. {formatDuration(route.durationSec)}</span>
              <span aria-hidden="true">·</span>
              <span>{route.kmMarkers.length} KM splits</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{route.start.name}</span>
            </div>
          )}

          {/* Auto-Pause Setting in Pre-Run Sheet */}
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#F6F5F0] px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#141F1B]">Auto-Pause at 0 km/h</p>
              <p className="text-[11px] text-[#5B6B64]">
                Pauses clock when stopped & resumes when you run
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

          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={onCancel}
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
              Start Run
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Workout State (Running / Paused) — Adidas Running Responsive Cockpit
  const showTurnCue = Boolean(route && upcomingTurn.step);
  const speedPct = speedBarPercent(currentSpeedKmh);
  const livePaceDisplay =
    phase === 'paused' || currentSpeedKmh <= 0.1
      ? '--:--'
      : formatPace(currentPaceSec || avgPace, preferredUnit);

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
            {currentSpeedKmh.toFixed(1)} <span className="text-[11px] font-medium text-[#B8E8C7]">km/h</span>
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
          <span>6 km/h</span>
          <span>12 km/h</span>
          <span>18+ km/h</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#172D27] text-white">
      {/* Top Adidas-Style Workout Header + Segmented View Switcher */}
      <header className="z-30 shrink-0 border-b border-white/10 bg-[#172D27] px-3 py-2.5 sm:px-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-bold text-white sm:text-base">
              {route?.name || 'Chandigarh Free Run'}
            </p>
            <p className="text-[11px] font-medium text-[#B8E8C7] tabular-nums">
              {phase === 'paused'
                ? pauseReason === 'auto'
                  ? 'Auto-Paused'
                  : 'Paused'
                : 'Live Run'}
              {gpsAccuracy !== null ? ` · GPS ±${gpsAccuracy}m` : ' · Locating'}
              {splits.length > 0 ? ` · ${splits.length} KM done` : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
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
              onClick={() => setAudioEnabled((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#203A32] text-white hover:bg-[#30483E]"
            >
              {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Auto-Paused Status Strip */}
      {phase === 'paused' && pauseReason === 'auto' && (
        <div className="z-30 shrink-0 border-b border-amber-300/30 bg-[#203A32] px-4 py-2 text-xs font-semibold text-amber-200">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <span className="truncate">
              Auto-paused at 0.0 km/h — start running again to auto-resume
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

      {/* Adidas-Style 1 KM Split Celebration Strip */}
      {kmMilestoneToast && (
        <div className="z-30 shrink-0 border-b border-[#9AE62E]/40 bg-[#9AE62E] px-4 py-2 text-[#172D27]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 font-mono text-xs font-bold tabular-nums">
            <span className="flex items-center gap-2">
              <Flag className="h-3.5 w-3.5 fill-current" />
              KM {kmMilestoneToast.km} COMPLETED · {formatDuration(kmMilestoneToast.splitDurationSec)} ({formatPace(kmMilestoneToast.paceSecPerKm, preferredUnit)}/{preferredUnit})
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
            {showTurnCue && upcomingTurn.step && (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#203A32] px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#172D27]">
                  <TurnIcon
                    maneuver={upcomingTurn.step.maneuver}
                    instruction={upcomingTurn.step.instruction}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-bold text-[#9AE62E] tabular-nums">
                    {upcomingTurn.distMeters > 0 ? `Next turn in ${upcomingTurn.distMeters} m` : 'Next turn'}
                  </p>
                  <p className="truncate text-sm font-semibold text-white">
                    {upcomingTurn.step.instruction}
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
                <p className="text-xs font-medium text-[#B8E8C7]">Current Pace (/{preferredUnit})</p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-tight text-[#9AE62E] tabular-nums sm:text-4xl lg:text-5xl">
                  {livePaceDisplay}
                </p>
              </div>
              <div className="border-r border-white/10 py-4 pr-3 sm:py-5">
                <p className="text-xs font-medium text-[#B8E8C7]">Average Pace (/{preferredUnit})</p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                  {formatPace(avgPace, preferredUnit)}
                </p>
              </div>
              <div className="py-4 pl-4 sm:py-5">
                <p className="text-xs font-medium text-[#B8E8C7]">
                  {plannedMeters > 0 ? 'Remaining' : 'Avg Speed'}
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                  {plannedMeters > 0
                    ? formatDistance(remainingMeters, preferredUnit)
                    : `${avgSpeedKmh.toFixed(1)} km/h`}
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

            {showTurnCue && upcomingTurn.step && (
              <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 z-20">
                <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl bg-[#172D27]/92 px-3 py-2 text-white shadow-lg backdrop-blur-md">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#30483E]">
                    <TurnIcon
                      maneuver={upcomingTurn.step.maneuver}
                      instruction={upcomingTurn.step.instruction}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] font-bold text-[#9AE62E] tabular-nums">
                      {upcomingTurn.distMeters > 0 ? `In ${upcomingTurn.distMeters} m` : 'Next'}
                    </p>
                    <p className="truncate text-xs font-bold text-white sm:text-sm">
                      {upcomingTurn.step.instruction}
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
                  <p className="text-[11px] font-medium text-[#B8E8C7]">Live Pace</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#9AE62E] tabular-nums sm:text-2xl">
                    {livePaceDisplay}
                    <span className="ml-0.5 text-[11px] font-medium text-[#B8E8C7]">
                      /{preferredUnit}
                    </span>
                  </p>
                </div>
                <div className="border-x border-white/10 px-2.5 text-center">
                  <p className="text-[11px] font-medium text-[#B8E8C7]">Avg Pace</p>
                  <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums sm:text-2xl">
                    {formatPace(avgPace, preferredUnit)}
                    <span className="ml-0.5 text-[11px] font-medium text-[#B8E8C7]">
                      /{preferredUnit}
                    </span>
                  </p>
                </div>
                <div className="pl-2 text-right">
                  <p className="text-[11px] font-medium text-[#B8E8C7]">Avg Speed</p>
                  <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums sm:text-2xl">
                    {avgSpeedKmh.toFixed(1)}
                    <span className="ml-0.5 text-[11px] font-medium text-[#B8E8C7]">km/h</span>
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

          {showTurnCue && upcomingTurn.step && (
            <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 sm:right-4 sm:left-4">
              <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl bg-[#172D27]/95 px-4 py-3 text-white shadow-xl backdrop-blur-md">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#30483E]">
                  <TurnIcon
                    maneuver={upcomingTurn.step.maneuver}
                    instruction={upcomingTurn.step.instruction}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-[#9AE62E] tabular-nums">
                    {upcomingTurn.distMeters > 0 ? `In ${upcomingTurn.distMeters} m` : 'Next'}
                  </p>
                  <p className="truncate text-sm font-bold text-white sm:text-base">
                    {upcomingTurn.step.instruction}
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
                  <p className="text-[11px] font-medium text-[#B8E8C7]">Pace</p>
                  <p className="mt-0.5 font-mono text-2xl font-extrabold text-[#9AE62E] sm:text-3xl">
                    {livePaceDisplay}
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
