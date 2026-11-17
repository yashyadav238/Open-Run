import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Copy,
  Download,
  Edit3,
  Film,
  Megaphone,
  Play,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  ElevationProfileCard,
  type ElevationFetchStatus,
} from '../components/ElevationProfileCard';
import { HydrationLossCard } from '../components/HydrationLossCard';
import { RunVideoModal } from '../components/RunVideoModal';
import { ShareCardModal } from '../components/ShareCardModal';
import { TricityMap } from '../components/TricityMap';
import { WorkoutIcon } from '../components/WorkoutIcon';
import {
  ALL_WORKOUT_TYPES,
  estimateCaloriesKcal,
  formatSpeed,
  formatWorkoutPrimaryRate,
  getWorkoutMeta,
  normalizeWorkoutType,
} from '../data/workouts';
import {
  buildCompletedKmCheckpoints,
  computeKmMarkers,
  decodePolyline,
  formatDistance,
  formatDuration,
  formatElevationGain,
  formatPace,
} from '../lib/geo';
import { fetchDetailedElevation } from '../services/routingService';
import { buildVideoPayloadFromRun, type RunVideoPayload } from '../services/runVideoService';
import {
  deleteRunRecord,
  deleteSavedRoute,
  saveRouteToLibrary,
  updateSavedRoute,
} from '../services/firestoreService';
import {
  buildSplitShareSummary,
  formatRunDateSafe,
  prepareShareCardSync,
  renderRunShareCardSync,
  sharePngCard,
  triggerPngDownload,
  type PreparedShareCard,
  type ShareCardStyle,
} from '../services/shareCardService';
import type {
  ElevationAnalysisResult,
  GeneratedRouteCandidate,
  RunActivityDoc,
  SavedRouteDoc,
  UserProfileDoc,
  WorkoutType,
} from '../types/run';

interface MyRunsViewProps {
  mode?: 'routes' | 'history';
  profile: UserProfileDoc | null;
  runs: RunActivityDoc[];
  savedRoutes: SavedRouteDoc[];
  userId: string | null;
  onStartSavedRoute: (route: SavedRouteDoc) => void;
  onCreateOpenInvite?: (route: SavedRouteDoc) => void;
  onShareRunToSocial?: (run: RunActivityDoc, mode: 'post' | 'story') => void;
  onDeleteRun?: (runId: string) => Promise<void>;
  onOpenAuth: () => void;
}

function RouteSnapshotThumb({ encodedPolyline }: { encodedPolyline?: string }) {
  const pts = useMemo(() => (encodedPolyline ? decodePolyline(encodedPolyline) : []), [encodedPolyline]);
  if (pts.length < 2) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[#172D27] text-center font-mono text-[9px] font-semibold text-[#B8E8C7]/70 shadow-inner">
        NO GPS
      </div>
    );
  }

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const spanLat = Math.max(0.0008, maxLat - minLat);
  const spanLngScaled = Math.max(0.0008, (maxLng - minLng) * cosLat);
  const scale = Math.min(50 / spanLngScaled, 50 / spanLat);
  const toXY = (p: { lat: number; lng: number }) => ({
    x: Number((36 + (p.lng - (minLng + maxLng) / 2) * cosLat * scale).toFixed(1)),
    y: Number((36 - (p.lat - midLat) * scale).toFixed(1)),
  });
  const svgPts = pts.map((p) => {
    const xy = toXY(p);
    return `${xy.x},${xy.y}`;
  });
  const startXY = toXY(pts[0]);
  const endXY = toXY(pts[pts.length - 1]);
  const isLoop = Math.hypot(startXY.x - endXY.x, startXY.y - endXY.y) <= 8;

  return (
    <div className="h-16 w-16 shrink-0 rounded-xl bg-[#172D27] p-1 shadow-inner">
      <svg viewBox="0 0 72 72" className="h-full w-full">
        <polyline
          fill="none"
          stroke="#9AE62E"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={svgPts.join(' ')}
        />
        <circle cx={startXY.x} cy={startXY.y} r="6.5" fill="#FFFFFF" stroke="#172D27" strokeWidth="1.4" />
        <text
          x={startXY.x}
          y={startXY.y + 2.4}
          textAnchor="middle"
          fontSize="6.5"
          fontWeight="800"
          fill="#172D27"
        >
          {isLoop ? 'S/F' : 'S'}
        </text>
        {!isLoop && (
          <>
            <circle cx={endXY.x} cy={endXY.y} r="6" fill="#30483E" stroke="#FFFFFF" strokeWidth="1.4" />
            <text
              x={endXY.x}
              y={endXY.y + 2.4}
              textAnchor="middle"
              fontSize="6.5"
              fontWeight="800"
              fill="#FFFFFF"
            >
              F
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

export const MyRunsView: React.FC<MyRunsViewProps> = ({
  mode = 'history',
  profile,
  runs,
  savedRoutes,
  userId,
  onStartSavedRoute,
  onCreateOpenInvite,
  onShareRunToSocial,
  onDeleteRun,
  onOpenAuth,
}) => {
  const [subTab, setSubTab] = useState<'history' | 'saved'>(mode === 'routes' ? 'saved' : 'history');
  React.useEffect(() => {
    setSubTab(mode === 'routes' ? 'saved' : 'history');
  }, [mode]);
  const [search, setSearch] = useState('');
  const [sportFilter, setSportFilter] = useState<'all' | WorkoutType>('all');
  const [selectedRun, setSelectedRun] = useState<RunActivityDoc | null>(null);
  const [editingRoute, setEditingRoute] = useState<SavedRouteDoc | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [confirmDeleteRunId, setConfirmDeleteRunId] = useState<string | null>(null);
  const [confirmDeleteRouteId, setConfirmDeleteRouteId] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [shareModalCard, setShareModalCard] = useState<PreparedShareCard | null>(null);
  const [videoRunPayload, setVideoRunPayload] = useState<RunVideoPayload | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const elevCacheRef = useRef<Map<string, ElevationAnalysisResult>>(new Map());
  const [selectedRunElev, setSelectedRunElev] = useState<{
    status: ElevationFetchStatus;
    data: ElevationAnalysisResult | null;
  }>({ status: 'idle', data: null });

  useEffect(() => {
    if (!selectedRun) {
      setSelectedRunElev({ status: 'idle', data: null });
      return;
    }
    const pts = selectedRun.encodedPolyline ? decodePolyline(selectedRun.encodedPolyline) : [];
    if (pts.length < 2) {
      setSelectedRunElev({ status: 'unavailable', data: null });
      return;
    }
    const cached = elevCacheRef.current.get(selectedRun.id);
    if (cached) {
      setSelectedRunElev({ status: cached.available ? 'ready' : 'unavailable', data: cached });
      return;
    }
    let cancelled = false;
    setSelectedRunElev({ status: 'loading', data: null });
    void fetchDetailedElevation(pts, undefined, 4500).then((res) => {
      if (cancelled) return;
      elevCacheRef.current.set(selectedRun.id, res);
      setSelectedRunElev({ status: res.available ? 'ready' : 'unavailable', data: res });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRun]);

  const unit = profile?.preferredUnit || 'km';
  const defaultCityLabel = profile?.city || 'World';

  const buildRunCard = (run: RunActivityDoc, style: ShareCardStyle = 'route') => {
    const meta = getWorkoutMeta(run.workoutType);
    const routeTitle = run.routeName || `GPS ${meta.pastNoun}`;
    const startArea = run.startName || defaultCityLabel;
    const pts = run.encodedPolyline ? decodePolyline(run.encodedPolyline) : [];
    const primaryRate = formatWorkoutPrimaryRate({
      workoutType: meta.id,
      avgPaceSecPerKm: run.avgPaceSecPerKm || 0,
      avgSpeedKmh: run.avgSpeedKmh,
      unit,
    });
    const kcal =
      typeof run.caloriesKcal === 'number' && run.caloriesKcal >= 0
        ? run.caloriesKcal
        : estimateCaloriesKcal(meta.id, run.durationSec || 0, run.distanceMeters || 0);
    return {
      style,
      workoutType: meta.id,
      title: routeTitle,
      subtitle: `OPEN RUN  ·  ${meta.fullLabel.toUpperCase()}  ·  ${defaultCityLabel.toUpperCase()}`,
      path: pts,
      primaryStatValue: formatDistance(run.distanceMeters || 0, unit),
      secondaryLine: `TIME ${formatDuration(run.durationSec || 0)}   ·   ${meta.primaryMetric === 'speed' ? 'SPEED' : 'PACE'} ${primaryRate}`,
      footerText: `${formatRunDateSafe(run.finishedAt)} · ${startArea}`,
      unit,
      distanceMeters: run.distanceMeters || 0,
      durationSec: run.durationSec || 0,
      avgPaceSecPerKm: run.avgPaceSecPerKm || 0,
      avgSpeedKmh: run.avgSpeedKmh || 0,
      caloriesKcal: kcal,
      elevationGainMeters: run.elevationGainMeters ?? null,
      splits: run.splits || [],
    };
  };

  const handleShareRun = (run: RunActivityDoc, initialStyle: ShareCardStyle = 'route') => {
    const meta = getWorkoutMeta(run.workoutType);
    const routeTitle = run.routeName || `GPS ${meta.pastNoun}`;
    const rateLabel = formatWorkoutPrimaryRate({
      workoutType: meta.id,
      avgPaceSecPerKm: run.avgPaceSecPerKm || 0,
      avgSpeedKmh: run.avgSpeedKmh,
      unit,
    });
    const kcal =
      typeof run.caloriesKcal === 'number' && run.caloriesKcal >= 0
        ? run.caloriesKcal
        : estimateCaloriesKcal(meta.id, run.durationSec || 0, run.distanceMeters || 0);
    const shareText = `${meta.fullLabel}: ${formatDistance(run.distanceMeters || 0, unit)} in ${formatDuration(run.durationSec || 0)} (${rateLabel}, ${kcal} kcal burnt) on ${routeTitle} — OPEN RUN.`;
    const prepared = prepareShareCardSync({
      filename: `open-run-${run.id}.png`,
      shareTitle: `OPEN RUN: ${routeTitle}`,
      shareText,
      card: buildRunCard(run, initialStyle),
    });
    if (!prepared) {
      setShareFeedback('Could not generate the activity PNG card for this workout.');
      setTimeout(() => setShareFeedback(null), 4500);
      return;
    }
    setShareModalCard(prepared);
  };

  const handleDownloadRunPng = (run: RunActivityDoc) => {
    const rendered = renderRunShareCardSync(buildRunCard(run));
    if (!rendered) return;
    triggerPngDownload(rendered.dataUrl, `open-run-${run.id}.png`);
    setShareFeedback('Activity PNG saved to your device.');
    setTimeout(() => setShareFeedback(null), 3500);
  };

  const handleShareSavedRoute = async (route: SavedRouteDoc) => {
    const meta = getWorkoutMeta(route.workoutType);
    const routeCity = route.city || defaultCityLabel;
    const shareText = `${route.name} (${meta.fullLabel}, ${formatDistance(route.distanceMeters, unit)}, est. ${formatDuration(route.durationSec)}) — OPEN RUN ${routeCity}.`;
    const { outcome, prepared } = await sharePngCard({
      filename: `open-run-route-${route.id}.png`,
      shareTitle: route.name,
      shareText,
      card: {
        workoutType: meta.id,
        title: route.name,
        subtitle: `OPEN RUN  ·  ${meta.fullLabel.toUpperCase()}  ·  ${routeCity.toUpperCase()}`,
        path: route.encodedPolyline ? decodePolyline(route.encodedPolyline) : [],
        primaryStatValue: formatDistance(route.distanceMeters, unit),
        secondaryLine: `EST. TIME ${formatDuration(route.durationSec)}   ·   ${route.routeType.replace('_', ' ').toUpperCase()}`,
        footerText: `${route.startName} · ${routeCity}`,
      },
    });
    if (outcome === 'shared_file') {
      setShareFeedback('Route card shared!');
      setTimeout(() => setShareFeedback(null), 4000);
    } else if (outcome === 'unsupported' || outcome === 'downloaded_fallback') {
      if (prepared) setShareModalCard(prepared);
    }
  };

  const sportFilteredRuns = useMemo(
    () =>
      sportFilter === 'all'
        ? runs
        : runs.filter((r) => normalizeWorkoutType(r.workoutType) === sportFilter),
    [runs, sportFilter]
  );

  const stats = useMemo(() => {
    const totalMeters = sportFilteredRuns.reduce((s, r) => s + r.distanceMeters, 0);
    const totalSec = sportFilteredRuns.reduce((s, r) => s + r.durationSec, 0);
    const longestMeters = sportFilteredRuns.reduce((m, r) => Math.max(m, r.distanceMeters), 0);
    const weeklyMeters = sportFilteredRuns
      .filter((r) => Date.now() - new Date(r.finishedAt).getTime() <= 7 * 86400 * 1000)
      .reduce((s, r) => s + r.distanceMeters, 0);
    const totalCalories = sportFilteredRuns.reduce(
      (s, r) =>
        s +
        (typeof r.caloriesKcal === 'number' && r.caloriesKcal >= 0
          ? r.caloriesKcal
          : estimateCaloriesKcal(r.workoutType, r.durationSec, r.distanceMeters)),
      0
    );
    const avgPace = totalMeters >= 100 ? totalSec / (totalMeters / 1000) : 0;
    const avgSpeedKmh = totalSec > 0 && totalMeters > 0 ? (totalMeters / 1000) / (totalSec / 3600) : 0;

    // Last 7 days bar buckets
    const dailyKm: Array<{ label: string; km: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400 * 1000);
      const dayKey = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
      const km = sportFilteredRuns
        .filter((r) => r.finishedAt.slice(0, 10) === dayKey)
        .reduce((s, r) => s + r.distanceMeters / 1000, 0);
      dailyKm.push({ label, km: Number(km.toFixed(2)) });
    }

    return {
      totalKm: totalMeters / 1000,
      totalSec,
      longestKm: longestMeters / 1000,
      weeklyKm: weeklyMeters / 1000,
      totalCalories,
      avgPace,
      avgSpeedKmh,
      dailyKm,
    };
  }, [sportFilteredRuns]);

  const filteredRuns = sportFilteredRuns.filter((r) =>
    r.routeName.toLowerCase().includes(search.toLowerCase()) ||
    r.startName.toLowerCase().includes(search.toLowerCase())
  );

  const filteredRoutes = savedRoutes
    .filter((r) => sportFilter === 'all' || normalizeWorkoutType(r.workoutType) === sportFilter)
    .filter(
      (r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.city || '').toLowerCase().includes(search.toLowerCase())
    );

  const maxBarKm = Math.max(1, ...stats.dailyKm.map((d) => d.km));

  const selectedRunKmMarkers = useMemo(() => {
    if (!selectedRun) return [];
    const pts = selectedRun.encodedPolyline ? decodePolyline(selectedRun.encodedPolyline) : [];
    return buildCompletedKmCheckpoints(pts, selectedRun.splits || []);
  }, [selectedRun]);

  const selectedRunSplits = useMemo(
    () => buildSplitShareSummary(selectedRun?.splits || []),
    [selectedRun]
  );

  const selectedRunPreview: GeneratedRouteCandidate | null = useMemo(() => {
    if (!selectedRun || !selectedRun.encodedPolyline) return null;
    const pts = decodePolyline(selectedRun.encodedPolyline);
    if (pts.length < 2) return null;
    return {
      id: selectedRun.id,
      workoutType: normalizeWorkoutType(selectedRun.workoutType),
      label: 'Best Match',
      name: selectedRun.routeName,
      routeType: selectedRun.routeType === 'free_run' ? 'circular' : selectedRun.routeType,
      distanceMeters: selectedRun.distanceMeters,
      targetDistanceMeters: selectedRun.distanceMeters,
      durationSec: selectedRun.durationSec,
      elevationGainMeters: selectedRun.elevationGainMeters ?? null,
      start: { name: selectedRun.startName, ...pts[0] },
      end: { name: selectedRun.startName, ...pts[pts.length - 1] },
      encodedPolyline: selectedRun.encodedPolyline,
      path: pts,
      steps: [],
      kmMarkers: computeKmMarkers(pts),
      characteristics: [],
      surfaceSummary: '',
      preferences: [],
      difficulty: 'moderate',
      toleranceDiffPct: 0,
    };
  }, [selectedRun]);

  if (!userId && runs.length === 0 && subTab === 'saved') {
    return (
      <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
        <h1 className="font-display text-2xl font-bold text-[#141F1B]">My Runs & Route Library</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-[#5B6B64]">
          Sign in to sync your Open Run log, weekly mileage charts, personal records, and saved routes across devices.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-5 min-h-[48px] rounded-xl bg-[#172D27] px-6 text-sm font-semibold text-[#9AE62E]"
        >
          Sign In to View History
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141F1B]">Activities &amp; Route Library</h1>
          <p className="text-sm text-[#5B6B64]">
            Real GPS running, cycling, walking, hiking, and trail sessions
          </p>
        </div>

        <div className="flex gap-1 rounded-xl border border-[#E5E3DC] bg-white p-1">
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`min-h-[40px] rounded-lg px-4 text-xs font-semibold ${
              subTab === 'history' ? 'bg-[#172D27] text-[#9AE62E]' : 'text-[#5B6B64]'
            }`}
          >
            Activity Log ({runs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('saved')}
            className={`min-h-[40px] rounded-lg px-4 text-xs font-semibold ${
              subTab === 'saved' ? 'bg-[#172D27] text-[#9AE62E]' : 'text-[#5B6B64]'
            }`}
          >
            Saved Routes ({savedRoutes.length})
          </button>
        </div>
      </div>

      {/* Sport Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSportFilter('all')}
          className={`min-h-[36px] rounded-xl px-3 text-xs font-semibold transition ${
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
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition ${
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

      {!userId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          <span>
            Completed workouts are auto-saved on this device so they are never lost. Sign in to sync them to your cloud account.
          </span>
          <button
            type="button"
            onClick={onOpenAuth}
            className="min-h-[34px] rounded-lg bg-[#172D27] px-3.5 text-xs font-semibold text-[#9AE62E]"
          >
            Sign In &amp; Sync
          </button>
        </div>
      )}

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total Distance', val: `${stats.totalKm.toFixed(1)} km` },
          {
            label: sportFilter === 'all' ? 'Workouts' : `${getWorkoutMeta(sportFilter).label}s`,
            val: `${sportFilteredRuns.length}`,
          },
          {
            label: sportFilter === 'all' ? 'Active Time' : `${getWorkoutMeta(sportFilter).label} Time`,
            val: formatDuration(stats.totalSec),
          },
          sportFilter === 'cycling'
            ? { label: 'Average Speed', val: formatSpeed(stats.avgSpeedKmh, unit) }
            : { label: 'Average Pace', val: `${formatPace(stats.avgPace, unit)}/${unit}` },
          { label: 'Longest Session', val: `${stats.longestKm.toFixed(1)} km` },
          { label: 'Calories Burned', val: `${stats.totalCalories.toLocaleString()} kcal` },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
            <p className="text-xs text-[#5B6B64]">{k.label}</p>
            <p className="mt-1 font-mono text-xl font-bold text-[#172D27] tabular-nums">{k.val}</p>
          </div>
        ))}
      </div>

      {/* 7-Day Distance Chart & Pace/Speed Progression */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[#141F1B]">7-Day Distance</h2>
            <span className="font-mono text-xs font-semibold text-[#30483E] tabular-nums">
              {stats.weeklyKm.toFixed(1)} km this week
            </span>
          </div>
          <div className="mt-5 flex h-36 items-end justify-between gap-2">
            {stats.dailyKm.map((d, idx) => {
              const heightPct = Math.max(6, Math.round((d.km / maxBarKm) * 100));
              return (
                <div key={idx} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="font-mono text-[10px] text-[#5B6B64] tabular-nums">
                    {d.km > 0 ? d.km.toFixed(1) : ''}
                  </span>
                  <div className="flex h-24 w-full items-end justify-center">
                    <div
                      className={`w-full max-w-[34px] rounded-t-lg transition-all ${
                        d.km > 0 ? 'bg-[#172D27]' : 'bg-[#F0EFEA]'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-[#5B6B64]">{d.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5 lg:col-span-5">
          <h2 className="font-display text-base font-bold text-[#141F1B]">
            {sportFilter === 'cycling' ? 'Recent Speed Trend' : 'Recent Pace & Speed'}
          </h2>
          {sportFilteredRuns.length < 2 ? (
            <p className="mt-4 text-xs leading-relaxed text-[#5B6B64]">
              Complete at least 2 GPS workouts to visualize your pace and speed progression over recent sessions.
            </p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {sportFilteredRuns.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-xs tabular-nums">
                  <span className="flex min-w-0 items-center gap-1.5 text-[#5B6B64]">
                    <WorkoutIcon type={r.workoutType} className="h-3.5 w-3.5 shrink-0 text-[#30483E]" />
                    <span className="truncate">{r.routeName}</span>
                  </span>
                  <span className="shrink-0 font-mono font-semibold text-[#172D27]">
                    {formatWorkoutPrimaryRate({
                      workoutType: r.workoutType,
                      avgPaceSecPerKm: r.avgPaceSecPerKm,
                      avgSpeedKmh: r.avgSpeedKmh,
                      unit,
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex min-h-[44px] items-center rounded-xl border border-[#D9D7CE] bg-white px-3.5">
        <Search className="mr-2 h-4 w-4 text-[#5B6B64]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={subTab === 'history' ? 'Search workouts by route or area...' : 'Search saved routes...'}
          className="w-full bg-transparent text-sm focus:outline-none"
        />
      </div>

      {shareFeedback && !selectedRun && (
        <div className="rounded-xl border border-[#30483E]/30 bg-[#EBF5EE] px-4 py-2.5 text-xs font-medium text-[#172D27]">
          {shareFeedback}
        </div>
      )}

      {/* Content List */}
      {subTab === 'history' ? (
        filteredRuns.length === 0 ? (
          <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center text-sm text-[#5B6B64]">
            No completed workouts found for this filter. Start a run, ride, or walk from Home or Plan Route.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRuns.map((run) => {
              const meta = getWorkoutMeta(run.workoutType);
              const kcal =
                typeof run.caloriesKcal === 'number' && run.caloriesKcal >= 0
                  ? run.caloriesKcal
                  : estimateCaloriesKcal(meta.id, run.durationSec, run.distanceMeters);
              const primaryRate = formatWorkoutPrimaryRate({
                workoutType: meta.id,
                avgPaceSecPerKm: run.avgPaceSecPerKm,
                avgSpeedKmh: run.avgSpeedKmh,
                unit,
              });
              return (
                <div
                  key={run.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[#E5E3DC] bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <RouteSnapshotThumb encodedPolyline={run.encodedPolyline} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-[#5B6B64]">
                        <span className="inline-flex items-center gap-1 font-semibold text-[#172D27]">
                          <WorkoutIcon type={meta.id} className="h-3.5 w-3.5 text-[#30483E]" />
                          {meta.label}
                        </span>
                        <span>· {formatRunDateSafe(run.finishedAt)} · {run.startName || defaultCityLabel}</span>
                        {run.id.startsWith('local_run_') && <span>· Saved on device</span>}
                      </p>
                      <h3 className="mt-0.5 truncate font-display text-base font-bold text-[#141F1B]">
                        {run.routeName || `GPS ${meta.pastNoun}`}
                      </h3>
                      <p className="mt-1 font-mono text-xs font-semibold text-[#30483E] tabular-nums">
                        {formatDistance(run.distanceMeters, unit)} · {formatDuration(run.durationSec)} ·{' '}
                        {primaryRate}
                        {typeof run.elevationGainMeters === 'number' && run.elevationGainMeters > 0
                          ? ` · ${formatElevationGain(run.elevationGainMeters, unit)} elev`
                          : ''}{' '}
                        · {kcal} kcal
                        {run.photos && run.photos.length > 0
                          ? ` · ${run.photos.length} ${run.photos.length === 1 ? 'photo' : 'photos'}`
                          : ''}
                      </p>
                      {run.notes && (
                        <p className="mt-1 line-clamp-1 text-xs text-[#5B6B64]">
                          {run.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRun(run)}
                      className="min-h-[40px] rounded-xl border border-[#D9D7CE] px-3.5 text-xs font-semibold text-[#141F1B]"
                    >
                      View Map
                    </button>
                    <button
                      type="button"
                      aria-label="Play journey video"
                      onClick={() => setVideoRunPayload(buildVideoPayloadFromRun(run))}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E]"
                    >
                      <Film className="h-3.5 w-3.5" />
                      Video
                    </button>
                    <button
                      type="button"
                      aria-label="Share activity image"
                      onClick={() => void handleShareRun(run)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Share
                    </button>
                    {onShareRunToSocial && (
                      <button
                        type="button"
                        onClick={() => onShareRunToSocial(run, 'post')}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#172D27]/30 bg-[#EBF5EE] px-3 text-xs font-semibold text-[#172D27]"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Post {meta.label}
                      </button>
                    )}
                    {confirmDeleteRunId === run.id ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (onDeleteRun) {
                            await onDeleteRun(run.id);
                          } else if (!run.id.startsWith('local_run_')) {
                            await deleteRunRecord(run.id);
                          }
                          setConfirmDeleteRunId(null);
                        }}
                        className="min-h-[40px] rounded-xl bg-red-600 px-3 text-xs font-semibold text-white"
                      >
                        Confirm Delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label="Delete workout"
                        onClick={() => setConfirmDeleteRunId(run.id)}
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-[#D9D7CE] text-[#5B6B64] hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : !userId ? (
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
          <p className="text-sm text-[#5B6B64]">
            Sign in to save, edit, and sync custom routes across devices.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-4 min-h-[44px] rounded-xl bg-[#172D27] px-5 text-xs font-semibold text-[#9AE62E]"
          >
            Sign In for Saved Routes
          </button>
        </div>
      ) : filteredRoutes.length === 0 ? (
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center text-sm text-[#5B6B64]">
          No saved routes found for this filter. Generate a route in Plan Route and click Save Route.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredRoutes.map((route) => {
            const srMeta = getWorkoutMeta(route.workoutType);
            return (
              <div key={route.id} className="rounded-2xl border border-[#E5E3DC] bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <RouteSnapshotThumb encodedPolyline={route.encodedPolyline} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs text-[#5B6B64]">
                        <span className="inline-flex items-center gap-1 font-semibold text-[#172D27]">
                          <WorkoutIcon type={srMeta.id} className="h-3.5 w-3.5 text-[#30483E]" />
                          {srMeta.label}
                        </span>
                        <span>· {route.city || defaultCityLabel} · {route.routeType.replace('_', ' ')}</span>
                      </p>
                      <h3 className="mt-0.5 truncate font-display text-base font-bold text-[#141F1B]">
                        {route.name}
                      </h3>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-bold text-[#172D27] tabular-nums">
                    {formatDistance(route.distanceMeters, unit)}
                  </span>
                </div>
                {route.notes && <p className="text-xs text-[#5B6B64]">{route.notes}</p>}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onStartSavedRoute(route)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3.5 text-xs font-semibold text-[#9AE62E]"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Start {srMeta.verb}
                  </button>
                  {onCreateOpenInvite && (
                    <button
                      type="button"
                      onClick={() => onCreateOpenInvite(route)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#172D27]/30 bg-[#EBF5EE] px-3 text-xs font-semibold text-[#172D27]"
                    >
                      <Megaphone className="h-3.5 w-3.5" />
                      Open Invite
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRoute(route);
                      setEditName(route.name);
                      setEditNotes(route.notes || '');
                    }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#141F1B]"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!userId) return;
                      await saveRouteToLibrary(userId, {
                        ...route,
                        workoutType: srMeta.id,
                        name: `${route.name} (Copy)`,
                      });
                    }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#141F1B]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShareSavedRoute(route)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#141F1B]"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </button>
                  {confirmDeleteRouteId === route.id ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteSavedRoute(route.id);
                        setConfirmDeleteRouteId(null);
                      }}
                      className="min-h-[40px] rounded-xl bg-red-600 px-3 text-xs font-semibold text-white"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Delete saved route"
                      onClick={() => setConfirmDeleteRouteId(route.id)}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-[#D9D7CE] text-[#5B6B64] hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Workout Map Modal */}
      {selectedRun && (() => {
        const selMeta = getWorkoutMeta(selectedRun.workoutType);
        const selKcal =
          typeof selectedRun.caloriesKcal === 'number' && selectedRun.caloriesKcal >= 0
            ? selectedRun.caloriesKcal
            : estimateCaloriesKcal(selMeta.id, selectedRun.durationSec, selectedRun.distanceMeters);
        const selRate = formatWorkoutPrimaryRate({
          workoutType: selMeta.id,
          avgPaceSecPerKm: selectedRun.avgPaceSecPerKm,
          avgSpeedKmh: selectedRun.avgSpeedKmh,
          unit,
        });
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="flex items-center gap-1.5 text-xs text-[#5B6B64]">
                    <span className="inline-flex items-center gap-1 font-semibold text-[#172D27]">
                      <WorkoutIcon type={selMeta.id} className="h-3.5 w-3.5 text-[#30483E]" />
                      {selMeta.fullLabel}
                    </span>
                    <span>· {formatRunDateSafe(selectedRun.finishedAt)}</span>
                  </p>
                  <h3 className="font-display text-lg font-bold text-[#141F1B]">{selectedRun.routeName}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRun(null)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-[#5B6B64] hover:bg-[#F6F5F0]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {selectedRunPreview ? (
                <TricityMap
                  routes={[selectedRunPreview]}
                  completedKmMarkers={selectedRunKmMarkers}
                  preferredUnit={unit}
                  heightClass="h-[260px]"
                />
              ) : (
                <div className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] px-4 py-6 text-center text-xs text-[#5B6B64]">
                  No GPS polyline was recorded for this session, but you can still share or save its activity PNG cards below.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#F6F5F0] p-3 text-center tabular-nums sm:grid-cols-5">
                <div>
                  <p className="text-[11px] text-[#5B6B64]">Distance</p>
                  <p className="font-mono text-sm font-bold">{formatDistance(selectedRun.distanceMeters, unit)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#5B6B64]">Time</p>
                  <p className="font-mono text-sm font-bold">{formatDuration(selectedRun.durationSec)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#5B6B64]">
                    {selMeta.primaryMetric === 'speed' ? 'Avg Speed' : 'Avg Pace'}
                  </p>
                  <p className="font-mono text-sm font-bold">{selRate}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#5B6B64]">Elev Gain</p>
                  <p className="font-mono text-sm font-bold text-[#172D27]">
                    {formatElevationGain(
                      selectedRunElev.data?.available
                        ? selectedRunElev.data.elevationGainMeters ?? selectedRun.elevationGainMeters
                        : selectedRun.elevationGainMeters,
                      unit
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#5B6B64]">Calories</p>
                  <p className="font-mono text-sm font-bold">{selKcal} kcal</p>
                </div>
              </div>

              <ElevationProfileCard
                compact
                workoutLabel={selMeta.fullLabel}
                routeName={selectedRun.routeName || selMeta.fullLabel}
                startName={selectedRun.startName}
                distanceMeters={selectedRun.distanceMeters}
                durationSec={selectedRun.durationSec}
                rateText={selRate}
                caloriesKcal={selKcal}
                elevationGainMeters={
                  selectedRunElev.data?.available
                    ? selectedRunElev.data.elevationGainMeters ?? selectedRun.elevationGainMeters
                    : selectedRun.elevationGainMeters
                }
                elevationLossMeters={
                  selectedRun.elevationLossMeters ?? selectedRunElev.data?.elevationLossMeters
                }
                minElevationMeters={
                  selectedRun.minElevationMeters ?? selectedRunElev.data?.minElevationMeters
                }
                maxElevationMeters={
                  selectedRun.maxElevationMeters ?? selectedRunElev.data?.maxElevationMeters
                }
                avgGradePct={selectedRunElev.data?.avgGradePct}
                profile={selectedRunElev.data?.profile}
                status={selectedRunElev.status}
                unit={unit}
              />

              <HydrationLossCard
                compact
                durationSec={selectedRun.durationSec}
                caloriesKcal={selKcal}
                avgPaceSecPerKm={selectedRun.avgPaceSecPerKm}
                workoutType={selMeta.id}
                lat={selectedRunPreview?.start.lat}
                lng={selectedRunPreview?.start.lng}
              />

              {(selectedRun.notes || (selectedRun.photos && selectedRun.photos.length > 0)) && (
                <div className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#141F1B]">
                    <Camera className="h-3.5 w-3.5 text-[#30483E]" />
                    <span>{selMeta.pastNoun} Notes &amp; Photos</span>
                  </div>
                  {selectedRun.notes && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#141F1B]">
                      {selectedRun.notes}
                    </p>
                  )}
                  {selectedRun.photos && selectedRun.photos.length > 0 && (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {selectedRun.photos.map((photoSrc, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setLightboxPhoto(photoSrc)}
                          className="group aspect-[4/3] overflow-hidden rounded-xl border border-[#E5E3DC] bg-white focus:outline-none"
                        >
                          <img
                            src={photoSrc}
                            alt={`${selectedRun.routeName} photo ${idx + 1}`}
                            className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedRunSplits.bars.length > 0 && (
                <div className="rounded-xl border border-[#E5E3DC] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[#141F1B]">
                      KM Splits ({selMeta.primaryMetric === 'speed' ? 'Speed' : 'Pace'})
                    </p>
                    <button
                      type="button"
                      onClick={() => handleShareRun(selectedRun, 'splits')}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-[#172D27] px-2.5 text-[11px] font-semibold text-[#9AE62E]"
                    >
                      <Share2 className="h-3 w-3" />
                      Splits PNG
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {selectedRunSplits.bars.slice(0, 8).map((b) => (
                      <div key={b.km} className="grid grid-cols-[44px_1fr_auto] items-center gap-2.5 text-xs tabular-nums">
                        <span className={`font-mono font-bold ${b.isFastest ? 'text-[#172D27]' : 'text-[#5B6B64]'}`}>
                          {b.km}K
                        </span>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[#F0EFEA]">
                          <div
                            className={`h-full rounded-full ${b.isFastest ? 'bg-[#9AE62E]' : 'bg-[#30483E]'}`}
                            style={{ width: `${Math.round(b.speedRatio * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono font-semibold text-[#141F1B]">
                          {selMeta.primaryMetric === 'speed' && b.paceSecPerKm > 0
                            ? formatSpeed(3600 / b.paceSecPerKm, unit)
                            : `${formatPace(b.paceSecPerKm, unit)}/${unit}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {shareFeedback && (
                <p className="rounded-xl bg-[#EBF5EE] px-3 py-2 text-xs font-medium text-[#172D27]">
                  {shareFeedback}
                </p>
              )}
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setVideoRunPayload(buildVideoPayloadFromRun(selectedRun))}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E]"
                >
                  <Film className="h-4 w-4" />
                  Journey Video
                </button>
                <button
                  type="button"
                  onClick={() => handleShareRun(selectedRun, 'route')}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-4 text-xs font-semibold text-[#141F1B]"
                >
                  <Share2 className="h-4 w-4" />
                  Share PNG Types
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadRunPng(selectedRun)}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-4 text-xs font-semibold text-[#141F1B]"
                >
                  <Download className="h-4 w-4" />
                  Save PNG
                </button>
                {onShareRunToSocial && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedRun;
                        setSelectedRun(null);
                        onShareRunToSocial(target, 'post');
                      }}
                      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#172D27]/30 bg-[#EBF5EE] px-4 text-xs font-semibold text-[#172D27]"
                    >
                      <Sparkles className="h-4 w-4" />
                      Post {selMeta.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedRun;
                        setSelectedRun(null);
                        onShareRunToSocial(target, 'story');
                      }}
                      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-white px-4 text-xs font-semibold text-[#141F1B]"
                    >
                      <Plus className="h-4 w-4" />
                      Add Story
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Saved Route Modal */}
      {editingRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <h3 className="font-display text-lg font-bold text-[#141F1B]">Edit Saved Route</h3>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
            />
            <textarea
              rows={3}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Add route surface or water-stop notes..."
              className="w-full rounded-xl border border-[#D9D7CE] p-3 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingRoute(null)}
                className="min-h-[40px] rounded-xl border border-[#D9D7CE] px-4 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!editName.trim()) return;
                  await updateSavedRoute(editingRoute.id, {
                    name: editName.trim(),
                    notes: editNotes.trim(),
                  });
                  setEditingRoute(null);
                }}
                className="min-h-[40px] rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <ShareCardModal card={shareModalCard} onClose={() => setShareModalCard(null)} />
      <RunVideoModal
        open={Boolean(videoRunPayload)}
        payload={videoRunPayload}
        preferredUnit={unit}
        onClose={() => setVideoRunPayload(null)}
      />

      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setLightboxPhoto(null)}
        >
          <button
            type="button"
            aria-label="Close photo preview"
            onClick={() => setLightboxPhoto(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxPhoto}
            alt="Full-size run view"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88dvh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
