import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  AlertCircle,
  Bookmark,
  Check,
  Code2,
  Download,
  Eraser,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Moon,
  Navigation,
  Palette,
  PenTool,
  Play,
  RefreshCw,
  Route as RouteIcon,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Type,
} from 'lucide-react';
import {
  MapPointDistanceCard,
  type MeasureOriginMode,
} from '../components/MapPointDistanceCard';
import { PlaceSearchInput } from '../components/PlaceSearchInput';
import { ShareCardModal } from '../components/ShareCardModal';
import { TricityMap } from '../components/TricityMap';
import {
  CHANDIGARH_NIGHT_LIT_NODES,
  isInsideChandigarh,
  isNightHazardOrWildlifeZone,
  TRICITY_START_PRESETS,
} from '../data/tricityPlaces';
import { douglasPeucker2D, formatDistance, formatDuration } from '../lib/geo';
import { saveRouteToLibrary, saveRunArtDesign } from '../services/firestoreService';
import {
  buildRouteCandidateFromPointPath,
  computeClickedPointPath,
  type PointToPointMeasureResult,
} from '../services/pointPathService';
import {
  createPedestrianRoutingProvider,
  generatePedestrianRoutes,
} from '../services/routingService';
import { sharePngCard, type PreparedShareCard } from '../services/shareCardService';
import {
  buildAlphabetRunArtVertices,
  exportRunArtPng,
  generateRunArtCandidates,
  normalizeCustomSketch,
  recommendAlphabetKm,
  RUN_ART_TEMPLATES,
  sanitizeAlphabetInput,
  type RunArtTemplate,
} from '../services/runArtService';
import type {
  GeneratedRouteCandidate,
  LatLngLiteral,
  NamedLocation,
  RouteDifficulty,
  RouteMode,
  RoutePreference,
  RouteType,
  RunArtShapeType,
  RunArtSize,
} from '../types/run';

const DISTANCE_OPTIONS = [1, 2, 3, 5, 7, 10];

const PREFERENCE_OPTIONS: Array<{ id: RoutePreference; label: string }> = [
  { id: 'parks_greenery', label: 'Parks & Inter-Sector Green Belts' },
  { id: 'pedestrian_paths', label: 'Footpaths & Narrow Sector Passes' },
  { id: 'quieter_roads', label: 'Quieter Roads' },
  { id: 'avoid_stairs', label: 'Avoid Stairs' },
  { id: 'avoid_restricted', label: 'Avoid Restricted Paths' },
  { id: 'fewer_crossings', label: 'Fewer Road Crossings' },
  { id: 'well_connected', label: 'Well-Connected Paths' },
  { id: 'well_lit', label: 'Night Safe (Well-Lit Avenues)' },
];

export interface PlannerInitialRequest {
  mode: RouteMode;
  distanceKm: number;
  routeType: RouteType;
  shapeType?: RunArtShapeType;
  alphabetText?: string;
  start: NamedLocation;
  triggerKey: number;
}

interface PlanRunViewProps {
  initialRequest: PlannerInitialRequest | null;
  preferredUnit: 'km' | 'mi';
  userId: string | null;
  emailVerified: boolean;
  onStartRun: (route: GeneratedRouteCandidate) => void;
  onOpenAuth: () => void;
}

export const PlanRunView: React.FC<PlanRunViewProps> = ({
  initialRequest,
  preferredUnit,
  userId,
  emailVerified,
  onStartRun,
  onOpenAuth,
}) => {
  const routesLib = useMapsLibrary('routes');

  const [mode, setMode] = useState<RouteMode>(initialRequest?.mode || 'normal');
  const [distanceKm, setDistanceKm] = useState<number>(initialRequest?.distanceKm || 5);
  const [customKm, setCustomKm] = useState<string>('');
  const [shareModalCard, setShareModalCard] = useState<PreparedShareCard | null>(null);
  const [routeType, setRouteType] = useState<RouteType>(
    initialRequest?.routeType && initialRequest.routeType !== 'run_art'
      ? initialRequest.routeType
      : 'circular'
  );
  const [selectedTemplate, setSelectedTemplate] = useState<RunArtTemplate>(
    RUN_ART_TEMPLATES.find((t) => t.id === initialRequest?.shapeType) || RUN_ART_TEMPLATES[0]
  );
  const [artSize, setArtSize] = useState<RunArtSize>('standard');
  const [startLoc, setStartLoc] = useState<NamedLocation>(
    initialRequest?.start || TRICITY_START_PRESETS[0]
  );
  const [endLoc, setEndLoc] = useState<NamedLocation>(TRICITY_START_PRESETS[2]);
  const [preferences, setPreferences] = useState<RoutePreference[]>([
    'parks_greenery',
    'pedestrian_paths',
    'quieter_roads',
    'avoid_restricted',
  ]);
  const [difficulty, setDifficulty] = useState<RouteDifficulty>('moderate');
  const [tolerancePct, setTolerancePct] = useState<number>(5);
  const [pickStartOnMap, setPickStartOnMap] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [fullScreenMap, setFullScreenMap] = useState(false);

  const [candidates, setCandidates] = useState<GeneratedRouteCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [customPoints, setCustomPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [alphabetText, setAlphabetText] = useState<string>(initialRequest?.alphabetText || 'RUN');
  const [artAnyStartEnd, setArtAnyStartEnd] = useState<boolean>(false);
  const [loopCount, setLoopCount] = useState<number>(1);
  const [nightMode, setNightMode] = useState<boolean>(false);

  // Map click point-to-point path & distance state
  const [measureOriginMode, setMeasureOriginMode] = useState<MeasureOriginMode>('start');
  const [currentGpsLoc, setCurrentGpsLoc] = useState<NamedLocation | null>(null);
  const [gpsLocating, setGpsLocating] = useState(false);
  const [gpsMeasureError, setGpsMeasureError] = useState<string | null>(null);
  const [clickedTarget, setClickedTarget] = useState<LatLngLiteral | null>(null);
  const [measuringPoint, setMeasuringPoint] = useState(false);
  const [measureResult, setMeasureResult] = useState<PointToPointMeasureResult | null>(null);
  const measureSeqRef = useRef(0);

  const requestCurrentGpsForMeasure = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsMeasureError('Browser geolocation is unavailable.');
      return;
    }
    setGpsLocating(true);
    setGpsMeasureError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLocating(false);
        setCurrentGpsLoc({
          name: 'Current GPS Location',
          city: 'Chandigarh',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setGpsLocating(false);
        setGpsMeasureError('Location permission denied. Switch to Starting Point or allow location access.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
    );
  }, []);

  const activeMeasureOrigin: NamedLocation =
    measureOriginMode === 'current' && currentGpsLoc ? currentGpsLoc : startLoc;

  useEffect(() => {
    if (!clickedTarget) {
      setMeasureResult(null);
      setMeasuringPoint(false);
      return;
    }
    if (measureOriginMode === 'current' && !currentGpsLoc) {
      return;
    }

    const seq = ++measureSeqRef.current;
    setMeasuringPoint(true);
    const provider = createPedestrianRoutingProvider(routesLib);
    const activePrefs: RoutePreference[] = nightMode
      ? Array.from(new Set([...preferences.filter((p) => p !== 'parks_greenery'), 'well_lit']))
      : preferences;

    computeClickedPointPath(provider, activeMeasureOrigin, clickedTarget, activePrefs)
      .then((res) => {
        if (measureSeqRef.current !== seq) return;
        setMeasureResult(res);
      })
      .finally(() => {
        if (measureSeqRef.current === seq) {
          setMeasuringPoint(false);
        }
      });
  }, [
    clickedTarget,
    measureOriginMode,
    currentGpsLoc,
    activeMeasureOrigin,
    routesLib,
    nightMode,
    preferences,
  ]);

  const runGeneration = async (params: {
    activeMode: RouteMode;
    targetKm: number;
    type: RouteType;
    tpl: RunArtTemplate;
    size: RunArtSize;
    origin: NamedLocation;
    dest?: NamedLocation;
    seed: number;
    anyStartAnyEnd?: boolean;
    loops?: number;
    night?: boolean;
  }) => {
    setGenerating(true);
    setError(null);
    setWarning(null);
    setPickStartOnMap(false);

    const activeLoops = params.loops ?? loopCount;
    const isNight = params.night ?? nightMode;
    const effectivePrefs: RoutePreference[] = isNight
      ? Array.from(new Set([...preferences.filter((p) => p !== 'parks_greenery'), 'well_lit']))
      : preferences.filter((p) => p !== 'well_lit');

    try {
      const provider = createPedestrianRoutingProvider(routesLib);
      if (params.activeMode === 'run_art') {
        const res = await generateRunArtCandidates(provider, params.tpl, params.origin, params.targetKm, {
          size: params.size,
          seedOffset: params.seed,
          anyStartAnyEnd: params.anyStartAnyEnd ?? artAnyStartEnd,
          loopCount: activeLoops,
          nightMode: isNight,
        });
        setCandidates(res.routes);
        setSelectedId(res.routes[0]?.id || '');
        if (res.warning) setWarning(res.warning);
      } else {
        const res = await generatePedestrianRoutes(provider, {
          start: params.origin,
          end: params.type === 'point_to_point' ? params.dest || endLoc : undefined,
          distanceKm: params.targetKm,
          routeType: params.type,
          preferences: effectivePrefs,
          difficulty,
          tolerancePct,
          seedOffset: params.seed,
          loopCount: activeLoops,
          nightMode: isNight,
        });
        setCandidates(res.routes);
        setSelectedId(res.routes[0]?.id || '');
        if (res.warning) setWarning(res.warning);
      }
    } catch (err) {
      setCandidates([]);
      setError(
        err instanceof Error
          ? err.message
          : 'Could not compute a connected Chandigarh pedestrian route here. Try moving your start point onto a sector street or park.'
      );
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!initialRequest) return;
    setMode(initialRequest.mode);
    setDistanceKm(initialRequest.distanceKm);
    setStartLoc(initialRequest.start);

    let tpl = selectedTemplate;
    let useAnyStart = artAnyStartEnd;
    if (initialRequest.shapeType === 'alphabet') {
      const nextWord = sanitizeAlphabetInput(initialRequest.alphabetText || alphabetText || 'RUN') || 'RUN';
      setAlphabetText(nextWord);
      const built = buildAlphabetRunArtVertices(nextWord);
      tpl = {
        id: 'alphabet',
        name: `Letters "${built.text}"`,
        subtitle: 'Single-stroke A–Z / 0–9 letters joined cleanly along Chandigarh street blocks',
        recommendedKm: initialRequest.distanceKm || recommendAlphabetKm(built.charCount),
        normalizedVertices: built.vertices,
      };
      setSelectedTemplate(tpl);
      setArtAnyStartEnd(true);
      useAnyStart = true;
    } else if (initialRequest.shapeType) {
      const found = RUN_ART_TEMPLATES.find((t) => t.id === initialRequest.shapeType);
      if (found) {
        tpl = found;
        setSelectedTemplate(found);
      }
    }

    if (initialRequest.routeType !== 'run_art') setRouteType(initialRequest.routeType);

    if (initialRequest.routeType !== 'point_to_point') {
      runGeneration({
        activeMode: initialRequest.mode,
        targetKm: initialRequest.distanceKm,
        type: initialRequest.routeType,
        tpl,
        size: artSize,
        origin: initialRequest.start,
        seed: 0,
        anyStartAnyEnd: useAnyStart,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest?.triggerKey]);

  const selectedRoute = candidates.find((c) => c.id === selectedId) || candidates[0] || null;
  const effectiveKm = Number(customKm) > 0 ? Number(customKm) : distanceKm;

  const toggleNightMode = (force?: boolean) => {
    const next = typeof force === 'boolean' ? force : !nightMode;
    setNightMode(next);
    setPreferences((prev) => {
      if (next) {
        return Array.from(new Set([...prev.filter((p) => p !== 'parks_greenery'), 'well_lit']));
      }
      return prev.filter((p) => p !== 'well_lit');
    });
  };

  const togglePref = (pref: RoutePreference) => {
    if (pref === 'well_lit') {
      toggleNightMode();
      return;
    }
    setPreferences((prev) =>
      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref]
    );
  };

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      setError('Browser geolocation unavailable.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!isInsideChandigarh(coords)) {
          setError(
            'Your current GPS position is outside Chandigarh UT. Pick a Chandigarh park or tap inside Chandigarh on the map.'
          );
          return;
        }
        setError(null);
        setStartLoc({
          name: 'Current GPS Location',
          city: 'Chandigarh',
          ...coords,
        });
      },
      () => setError('Location permission denied. Select a Chandigarh park or tap the map.'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSaveRoute = async (route: GeneratedRouteCandidate) => {
    if (!userId) {
      onOpenAuth();
      return;
    }
    if (!emailVerified) {
      setError('Please verify your email address (or use Google Sign-In) before saving routes.');
      return;
    }
    setSavingId(route.id);
    try {
      await saveRouteToLibrary(userId, {
        name: route.name,
        notes: `${route.surfaceSummary} · ${route.characteristics.join(', ')}`,
        city: 'Chandigarh',
        routeType: route.routeType,
        distanceMeters: route.distanceMeters,
        durationSec: route.durationSec,
        elevationGainMeters: route.elevationGainMeters ?? 0,
        startLat: route.start.lat,
        startLng: route.start.lng,
        startName: route.start.name,
        endLat: route.end.lat,
        endLng: route.end.lng,
        endName: route.end.name,
        encodedPolyline: route.encodedPolyline,
        preferences: route.preferences,
        isPublic: false,
      });

      if (route.routeType === 'run_art') {
        await saveRunArtDesign(userId, {
          shapeType: selectedTemplate.id,
          title: route.name.slice(0, 100),
          city: 'Chandigarh',
          startLat: route.start.lat,
          startLng: route.start.lng,
          targetDistanceKm: effectiveKm,
          actualDistanceKm: route.distanceMeters / 1000,
          encodedPolyline: route.encodedPolyline,
          matchScore: route.matchScore || 0,
          status: 'planned',
        });
      }

      setSavedIds((prev) => ({ ...prev, [route.id]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save route.');
    } finally {
      setSavingId(null);
    }
  };

  const handleDownloadGeoJson = (route: GeneratedRouteCandidate) => {
    if (!route.geoJson) return;
    const blob = new Blob([JSON.stringify(route.geoJson, null, 2)], {
      type: 'application/geo+json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${route.id}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    setShareFeedback('Exported GeoJSON LineString file.');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  const handleDownloadArtwork = (route: GeneratedRouteCandidate) => {
    const url = exportRunArtPng(
      route.name,
      route.distanceMeters / 1000,
      route.matchScore || 0,
      route.intendedShapePath || [],
      route.path
    );
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `tricity-run-art-${selectedTemplate.id}.png`;
    a.click();
  };

  const handleShareRoute = async (route: GeneratedRouteCandidate) => {
    const summaryText = `${route.name} — ${formatDistance(route.distanceMeters, preferredUnit)} (${route.routeType.replace('_', ' ')}) on TRICITY RUN Chandigarh.`;
    const { outcome, prepared } = await sharePngCard({
      filename: `${route.id}.png`,
      shareTitle: route.name,
      shareText: summaryText,
      card: {
        title: route.name,
        subtitle:
          route.routeType === 'run_art'
            ? 'TRICITY RUN  ·  CHANDIGARH RUN ART'
            : 'TRICITY RUN  ·  CHANDIGARH ROUTE',
        path: route.path,
        intendedPath: route.intendedShapePath,
        badgeText:
          route.matchScore !== undefined ? `SHAPE MATCH ${route.matchScore}%` : undefined,
        primaryStatValue: formatDistance(route.distanceMeters, preferredUnit),
        secondaryLine: `EST. TIME ${formatDuration(route.durationSec)}   ·   ${route.kmMarkers.length} KM SPLITS`,
        footerText: `${route.start.name} · ${route.surfaceSummary}`,
      },
    });
    if (outcome === 'shared_file') {
      setShareFeedback('Route card shared!');
      setTimeout(() => setShareFeedback(null), 4000);
    } else if (outcome === 'unsupported' || outcome === 'downloaded_fallback') {
      if (prepared) setShareModalCard(prepared);
    }
  };

  const handleTriggerGenerate = (nextSeed = 0) => {
    let activeTpl = selectedTemplate;
    if (mode === 'run_art' && selectedTemplate.id === 'alphabet') {
      const built = buildAlphabetRunArtVertices(alphabetText);
      if (built.vertices.length < 2) {
        setError('Enter 1–6 letters or digits (A–Z, 0–9) to generate Alphabet Run Art.');
        return;
      }
      activeTpl = {
        id: 'alphabet',
        name: `Letters "${built.text}"`,
        subtitle: artAnyStartEnd
          ? 'Single-stroke letters auto-placed along Chandigarh’s clearest street blocks'
          : 'Single-stroke letters anchored at your Chandigarh starting point',
        recommendedKm: effectiveKm || recommendAlphabetKm(built.charCount),
        normalizedVertices: built.vertices,
      };
      setSelectedTemplate(activeTpl);
    } else if (mode === 'run_art' && selectedTemplate.id === 'custom') {
      const simplified = douglasPeucker2D(customPoints, 3.5);
      const normalized = normalizeCustomSketch(simplified, { autoClose: !artAnyStartEnd });
      if (normalized.length < 3) {
        setError('Draw a shape on the Run Art sketch pad first, or choose one of the preset/alphabet templates.');
        return;
      }
      activeTpl = {
        id: 'custom',
        name: 'Custom Sketch',
        subtitle: artAnyStartEnd
          ? 'Open or closed drawing auto-placed anywhere in Chandigarh (no loop needed)'
          : 'Freehand drawing snapped onto Chandigarh pedestrian paths via HMM',
        recommendedKm: effectiveKm || 5,
        normalizedVertices: normalized,
      };
      setSelectedTemplate(activeTpl);
    }

    setSeedOffset(nextSeed);
    runGeneration({
      activeMode: mode,
      targetKm: Math.min(60, Math.max(0.5, effectiveKm || 5)),
      type: routeType,
      tpl: activeTpl,
      size: artSize,
      origin: startLoc,
      dest: endLoc,
      seed: nextSeed,
      anyStartAnyEnd: artAnyStartEnd,
      loops: loopCount,
      night: nightMode,
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left Unified Planner Controls */}
      <div className="space-y-4 lg:col-span-5">
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-xl font-bold text-[#141F1B]">Chandigarh Route Engine</h1>
            {mode === 'normal' && (
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#172D27] hover:bg-[#F6F5F0]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Preferences
              </button>
            )}
          </div>

          {/* Unified Mode Switch: Normal Run vs Run Art */}
          <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-xl bg-[#F6F5F0] p-1">
            <button
              type="button"
              onClick={() => setMode('normal')}
              className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition ${
                mode === 'normal'
                  ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                  : 'text-[#5B6B64] hover:text-[#141F1B]'
              }`}
            >
              <RouteIcon className="h-4 w-4" />
              Normal Run
            </button>
            <button
              type="button"
              onClick={() => setMode('run_art')}
              className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition ${
                mode === 'run_art'
                  ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                  : 'text-[#5B6B64] hover:text-[#141F1B]'
              }`}
            >
              <Palette className="h-4 w-4" />
              Run Art
            </button>
          </div>

          {/* Night Run Mode Toggle (Normal Run & Run Art) */}
          <div
            className={`mt-3 rounded-xl border p-3 transition-colors ${
              nightMode
                ? 'border-[#172D27] bg-[#172D27] text-white'
                : 'border-[#E5E3DC] bg-[#F6F5F0] text-[#141F1B]'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    nightMode ? 'bg-[#30483E] text-[#9AE62E]' : 'bg-white text-[#172D27]'
                  }`}
                >
                  <Moon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold">Night Run Mode</span>
                    {nightMode && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#9AE62E]" />}
                  </div>
                  <p className={`text-[11px] leading-snug ${nightMode ? 'text-[#B8E8C7]' : 'text-[#5B6B64]'}`}>
                    Well-lit avenues · avoids wildlife & deserted areas
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={nightMode}
                aria-label="Toggle Night Run Mode"
                onClick={() => toggleNightMode()}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9AE62E] ${
                  nightMode ? 'bg-[#9AE62E]' : 'bg-[#D2CFC4]'
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                    nightMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {nightMode &&
              !(mode === 'run_art' && artAnyStartEnd) &&
              (() => {
                const haz = isNightHazardOrWildlifeZone(startLoc);
                if (!haz.avoided) return null;
                const sec17 = CHANDIGARH_NIGHT_LIT_NODES[0];
                const sukhnaLit = CHANDIGARH_NIGHT_LIT_NODES[CHANDIGARH_NIGHT_LIT_NODES.length - 1];
                return (
                  <div className="mt-2.5 border-t border-white/15 pt-2.5 text-[11px] text-[#B8E8C7]">
                    <p className="font-semibold text-[#9AE62E]">
                      Start pin is near {haz.zoneName} ({haz.reason}).
                    </p>
                    <p className="mt-0.5">
                      Switch to a well-lit corridor or route will auto-steer away from dark trails:
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setStartLoc({ name: sec17.name, city: 'Chandigarh', lat: sec17.lat, lng: sec17.lng })
                        }
                        className="min-h-[34px] rounded-lg bg-[#9AE62E] px-2.5 text-[11px] font-bold text-[#172D27] hover:bg-[#b5f257]"
                      >
                        Use Sector 17 Plaza
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setStartLoc({
                            name: sukhnaLit.name,
                            city: 'Chandigarh',
                            lat: sukhnaLit.lat,
                            lng: sukhnaLit.lng,
                          })
                        }
                        className="min-h-[34px] rounded-lg border border-white/25 px-2.5 text-[11px] font-semibold text-white hover:bg-white/10"
                      >
                        Use Sukhna Lit West
                      </button>
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* Mode-Specific Style Controls */}
          {mode === 'normal' ? (
            <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-xl bg-[#F6F5F0] p-1">
              {[
                { id: 'circular' as const, label: 'Circular' },
                { id: 'out_and_back' as const, label: 'Out & Back' },
                { id: 'point_to_point' as const, label: 'Point-to-Point' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRouteType(item.id)}
                  className={`min-h-[38px] rounded-lg text-xs font-semibold transition ${
                    routeType === item.id
                      ? 'bg-white text-[#172D27] shadow-sm'
                      : 'text-[#5B6B64] hover:text-[#141F1B]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[#5B6B64]">Select Run Art Drawing (8 Shapes + A–Z + Draw)</p>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                  {RUN_ART_TEMPLATES.map((tpl) => {
                    const active = selectedTemplate.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplate(tpl);
                          setDistanceKm(tpl.recommendedKm);
                          setCustomKm('');
                        }}
                        className={`flex min-h-[58px] flex-col items-center justify-center rounded-xl border p-1.5 text-center transition ${
                          active
                            ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                            : 'border-[#E5E3DC] bg-[#F6F5F0] text-[#141F1B]'
                        }`}
                      >
                        <svg viewBox="-1.2 -1.2 2.4 2.4" className="h-5 w-5">
                          <polyline
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="0.18"
                            strokeLinejoin="round"
                            points={tpl.normalizedVertices.map((v) => `${v.x},${-v.y}`).join(' ')}
                          />
                        </svg>
                        <span className="mt-1 text-[10px] font-semibold leading-none">{tpl.name.split(' ')[0]}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const clean = sanitizeAlphabetInput(alphabetText || 'RUN') || 'RUN';
                      setAlphabetText(clean);
                      const built = buildAlphabetRunArtVertices(clean);
                      const recKm = recommendAlphabetKm(built.charCount);
                      setArtAnyStartEnd(true);
                      setDistanceKm(recKm);
                      setCustomKm('');
                      setSelectedTemplate({
                        id: 'alphabet',
                        name: `Letters "${built.text}"`,
                        subtitle: 'Run single letters (A–Z) or short words along upright Chandigarh streets',
                        recommendedKm: recKm,
                        normalizedVertices: built.vertices,
                      });
                    }}
                    className={`flex min-h-[58px] flex-col items-center justify-center rounded-xl border p-1.5 text-center transition ${
                      selectedTemplate.id === 'alphabet'
                        ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                        : 'border-dashed border-[#30483E]/50 bg-[#F6F5F0] text-[#172D27]'
                    }`}
                  >
                    <Type className="h-4 w-4" />
                    <span className="mt-1 text-[10px] font-semibold leading-none">Letters</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setArtAnyStartEnd(true);
                      setSelectedTemplate({
                        id: 'custom',
                        name: 'Custom Sketch',
                        subtitle: 'Any Start · Any End enabled — draw any open or closed shape without picking a start',
                        recommendedKm: effectiveKm || 5,
                        normalizedVertices: [],
                      });
                    }}
                    className={`flex min-h-[58px] flex-col items-center justify-center rounded-xl border p-1.5 text-center transition ${
                      selectedTemplate.id === 'custom'
                        ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                        : 'border-dashed border-[#30483E]/50 bg-[#F6F5F0] text-[#172D27]'
                    }`}
                  >
                    <PenTool className="h-4 w-4" />
                    <span className="mt-1 text-[10px] font-semibold leading-none">Draw</span>
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-[#5B6B64]">{selectedTemplate.subtitle}</p>
              </div>

              {/* Placement Freedom Mode: My Start Loop vs Any Start · Any End */}
              <div className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-2">
                <p className="px-1 text-[11px] font-semibold text-[#5B6B64]">Start & End Placement Mode</p>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setArtAnyStartEnd(false)}
                    className={`min-h-[38px] rounded-lg px-2 text-xs font-semibold transition ${
                      !artAnyStartEnd
                        ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                        : 'bg-white text-[#5B6B64]'
                    }`}
                  >
                    My Start Loop
                  </button>
                  <button
                    type="button"
                    onClick={() => setArtAnyStartEnd(true)}
                    className={`min-h-[38px] rounded-lg px-2 text-xs font-semibold transition ${
                      artAnyStartEnd
                        ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                        : 'bg-white text-[#5B6B64]'
                    }`}
                  >
                    Any Start · Any End
                  </button>
                </div>
                <p className="mt-1 px-1 text-[10px] text-[#5B6B64]">
                  {artAnyStartEnd
                    ? 'Auto-places your drawing or letters on the best Chandigarh streets — open ends & any start allowed.'
                    : 'Starts and finishes anchored at your chosen Start Location.'}
                </p>
              </div>

              {selectedTemplate.id === 'alphabet' && (() => {
                const preview = buildAlphabetRunArtVertices(alphabetText);
                const previewPts = preview.vertices.map((v) => `${(v.x * 1).toFixed(3)},${(-v.y).toFixed(3)}`).join(' ');
                const applyWord = (raw: string, autoKm = true) => {
                  const clean = sanitizeAlphabetInput(raw);
                  setAlphabetText(clean);
                  const nextBuilt = buildAlphabetRunArtVertices(clean);
                  const recKm = recommendAlphabetKm(nextBuilt.charCount);
                  if (autoKm && nextBuilt.charCount > 0) {
                    setDistanceKm(recKm);
                    setCustomKm('');
                  }
                  setSelectedTemplate({
                    id: 'alphabet',
                    name: nextBuilt.text ? `Letters "${nextBuilt.text}"` : 'Letters',
                    subtitle: 'Run single letters (A–Z) or short words along upright Chandigarh streets',
                    recommendedKm: recKm,
                    normalizedVertices: nextBuilt.vertices,
                  });
                };

                return (
                  <div className="rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[#172D27]">
                        Alphabet Letter / Word (1–6 chars)
                      </span>
                      <span className="font-mono text-[10px] font-semibold text-[#5B6B64]">
                        {preview.charCount > 0
                          ? `Rec: ${recommendAlphabetKm(preview.charCount)} km`
                          : 'A–Z or 0–9'}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        value={alphabetText}
                        onChange={(e) => applyWord(e.target.value, true)}
                        placeholder="Type A, M, RUN, CHD..."
                        className="min-h-[42px] flex-1 rounded-xl border border-[#D9D7CE] bg-white px-3 font-mono text-sm font-bold uppercase tracking-widest text-[#141F1B] focus:border-[#172D27] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => applyWord('', false)}
                        className="inline-flex min-h-[42px] items-center gap-1 rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs font-semibold text-[#5B6B64]"
                      >
                        <Eraser className="h-3.5 w-3.5" />
                        Clear
                      </button>
                    </div>

                    {/* Quick word presets + A-Z single-letter tap grid */}
                    <div className="flex flex-wrap gap-1.5">
                      {['RUN', 'CHD', 'LOVE', 'A', 'M', 'R', 'S'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => applyWord(preset, true)}
                          className={`min-h-[28px] rounded-lg border px-2 font-mono text-[11px] font-bold transition ${
                            alphabetText === preset
                              ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                              : 'border-[#D9D7CE] bg-white text-[#141F1B] hover:border-[#172D27]'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9 md:grid-cols-13">
                      {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => applyWord(`${alphabetText}${ch}`.slice(0, 6), true)}
                          className="min-h-[34px] rounded-md border border-[#E5E3DC] bg-white font-mono text-xs font-bold text-[#141F1B] hover:border-[#172D27] hover:bg-[#172D27] hover:text-[#9AE62E]"
                        >
                          {ch}
                        </button>
                      ))}
                    </div>

                    {/* Live dark-green single-stroke path preview */}
                    <div className="rounded-xl border border-[#D9D7CE] bg-[#172D27] p-2">
                      <svg viewBox="-1.2 -1.2 2.4 2.4" className="h-28 w-full">
                        {preview.vertices.length > 1 && (
                          <>
                            <polyline
                              fill="none"
                              stroke="#9AE62E"
                              strokeWidth="0.08"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={previewPts}
                            />
                            <circle
                              cx={preview.vertices[0].x}
                              cy={-preview.vertices[0].y}
                              r="0.09"
                              fill="#FFFFFF"
                              stroke="#172D27"
                              strokeWidth="0.03"
                            />
                            <circle
                              cx={preview.vertices[preview.vertices.length - 1].x}
                              cy={-preview.vertices[preview.vertices.length - 1].y}
                              r="0.08"
                              fill="#B8E8C7"
                              stroke="#172D27"
                              strokeWidth="0.03"
                            />
                          </>
                        )}
                      </svg>
                      <p className="mt-1 text-center text-[10px] text-[#B8E8C7]">
                        White dot = Start · Mint dot = Finish · Joined cleanly on street baseline
                      </p>
                    </div>
                  </div>
                );
              })()}

              {selectedTemplate.id === 'custom' && (
                <div className="rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#172D27]">
                      {artAnyStartEnd
                        ? `Draw any open or closed shape (${customPoints.length} pts)`
                        : `Sketch one continuous loop (${customPoints.length} pts)`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCustomPoints([])}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#D9D7CE] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#5B6B64]"
                    >
                      <Eraser className="h-3 w-3" />
                      Clear
                    </button>
                  </div>
                  <svg
                    viewBox="0 0 240 180"
                    className="h-44 w-full touch-none rounded-xl border border-[#D9D7CE] bg-[#172D27] cursor-crosshair"
                    onPointerDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = ((e.clientX - rect.left) / rect.width) * 240;
                      const y = ((e.clientY - rect.top) / rect.height) * 180;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setIsDrawing(true);
                      setCustomPoints([{ x, y }]);
                    }}
                    onPointerMove={(e) => {
                      if (!isDrawing) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = ((e.clientX - rect.left) / rect.width) * 240;
                      const y = ((e.clientY - rect.top) / rect.height) * 180;
                      setCustomPoints((prev) => {
                        const last = prev[prev.length - 1];
                        if (last && Math.hypot(x - last.x, y - last.y) < 4) return prev;
                        return [...prev, { x, y }];
                      });
                    }}
                    onPointerUp={() => setIsDrawing(false)}
                    onPointerCancel={() => setIsDrawing(false)}
                  >
                    <rect x="0" y="0" width="240" height="180" fill="none" />
                    {customPoints.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#9AE62E"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={customPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                      />
                    )}
                    {customPoints.length > 0 && (
                      <circle cx={customPoints[0].x} cy={customPoints[0].y} r="5" fill="#FFFFFF" stroke="#172D27" strokeWidth="1.5" />
                    )}
                    {artAnyStartEnd && customPoints.length > 2 && (
                      <circle
                        cx={customPoints[customPoints.length - 1].x}
                        cy={customPoints[customPoints.length - 1].y}
                        r="4.5"
                        fill="#B8E8C7"
                        stroke="#172D27"
                        strokeWidth="1.5"
                      />
                    )}
                  </svg>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-[#5B6B64]">Shape Size</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'compact' as const, label: 'Compact (0.85×)' },
                    { id: 'standard' as const, label: 'Standard (1×)' },
                    { id: 'large' as const, label: 'Large (1.15×)' },
                  ].map((sz) => (
                    <button
                      key={sz.id}
                      type="button"
                      onClick={() => setArtSize(sz.id)}
                      className={`min-h-[38px] rounded-xl text-[11px] font-semibold ${
                        artSize === sz.id ? 'bg-[#30483E] text-white' : 'bg-[#F6F5F0] text-[#5B6B64]'
                      }`}
                    >
                      {sz.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Distance Selector (Normal Circular/OAB & Run Art) */}
          {(mode === 'run_art' || routeType !== 'point_to_point') && (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#5B6B64]">
                  {mode === 'run_art' ? 'Approximate Route Distance' : 'Target Distance'}
                </span>
                <span className="font-mono text-xs font-bold text-[#172D27] tabular-nums">
                  {effectiveKm} km (±{tolerancePct}%)
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {DISTANCE_OPTIONS.map((km) => (
                  <button
                    key={km}
                    type="button"
                    onClick={() => {
                      setCustomKm('');
                      setDistanceKm(km);
                    }}
                    className={`min-h-[40px] rounded-xl font-mono text-xs font-bold transition tabular-nums ${
                      !customKm && distanceKm === km
                        ? 'bg-[#172D27] text-[#9AE62E]'
                        : 'bg-[#F6F5F0] text-[#141F1B] hover:bg-[#E7E5DC]'
                    }`}
                  >
                    {km}K
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0.5}
                max={60}
                step={0.5}
                value={customKm}
                onChange={(e) => setCustomKm(e.target.value)}
                placeholder="Or enter custom km (0.5 – 60)"
                className="mt-2 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 font-mono text-sm focus:border-[#172D27] focus:outline-none"
              />

              {/* Multi-Lap Path Repetition Selector (keeps longer runs inside Chandigarh) */}
              <div className="mt-3 rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-2.5">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[11px] font-semibold text-[#5B6B64]">
                    Loops (Repeat Same Path)
                  </span>
                  <span className="font-mono text-[11px] font-bold text-[#172D27] tabular-nums">
                    {loopCount === 1
                      ? '1× single lap'
                      : `${loopCount}× laps · ${(effectiveKm / loopCount).toFixed(1)} km/lap`}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setLoopCount(cnt)}
                      className={`min-h-[36px] rounded-lg font-mono text-xs font-bold transition ${
                        loopCount === cnt
                          ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                          : 'bg-white text-[#5B6B64] hover:text-[#141F1B]'
                      }`}
                    >
                      {cnt}×
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Start Point (Auto-placed across Chandigarh when Any Start · Any End is active) */}
          {mode === 'run_art' && artAnyStartEnd ? (
            <div className="mt-4 rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] px-3.5 py-2.5 text-xs text-[#30483E]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#172D27]">Start & Finish: Auto Chandigarh Best-Fit</span>
                <button
                  type="button"
                  onClick={() => setArtAnyStartEnd(false)}
                  className="font-semibold text-[#30483E] underline"
                >
                  Pick Start Instead
                </button>
              </div>
              <p className="mt-0.5 text-[11px] text-[#5B6B64]">
                No start or end pin required — the engine scans Sector 17, 22, 16, 33, 35 & 10 to find the cleanest street fit.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#5B6B64]">Start Location</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleUseGps}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#30483E] hover:underline"
                  >
                    <LocateFixed className="h-3.5 w-3.5" />
                    GPS
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickStartOnMap((v) => !v)}
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${
                      pickStartOnMap ? 'text-[#172D27] underline' : 'text-[#30483E] hover:underline'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {pickStartOnMap ? 'Tap Map Active' : 'Pick on Map'}
                  </button>
                </div>
              </div>

              <PlaceSearchInput
                value={startLoc.name}
                placeholder="Search Chandigarh sectors, Sukhna Lake, Rose Garden..."
                onSelect={(loc) => setStartLoc({ ...loc, city: 'Chandigarh' })}
              />

              <select
                value={
                  TRICITY_START_PRESETS.some((p) => p.name === startLoc.name)
                    ? startLoc.name
                    : ''
                }
                onChange={(e) => {
                  const found = TRICITY_START_PRESETS.find((p) => p.name === e.target.value);
                  if (found) setStartLoc(found);
                }}
                className="min-h-[42px] w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-xs font-medium text-[#141F1B]"
              >
                <option value="" disabled>
                  Or choose verified Chandigarh park...
                </option>
                {TRICITY_START_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Destination for Point-to-Point */}
          {mode === 'normal' && routeType === 'point_to_point' && (
            <div className="mt-4 space-y-2">
              <span className="text-xs font-semibold text-[#5B6B64]">Destination Location</span>
              <PlaceSearchInput
                value={endLoc.name}
                placeholder="Search destination in Chandigarh..."
                onSelect={(loc) => setEndLoc({ ...loc, city: 'Chandigarh' })}
              />
            </div>
          )}

          {/* Preferences Drawer */}
          {mode === 'normal' && showFilters && (
            <div className="mt-4 space-y-3 border-t border-[#E5E3DC] pt-4">
              <div>
                <p className="text-xs font-semibold text-[#5B6B64]">Pedestrian Preferences</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PREFERENCE_OPTIONS.map((p) => {
                    const active = preferences.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePref(p.id)}
                        className={`min-h-[34px] rounded-xl border px-2.5 text-[11px] font-medium transition ${
                          active
                            ? 'border-[#172D27] bg-[#172D27] text-white'
                            : 'border-[#D9D7CE] bg-white text-[#5B6B64]'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {(['easy', 'moderate', 'challenging'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={`min-h-[38px] rounded-xl text-xs font-semibold capitalize ${
                      difficulty === d
                        ? 'bg-[#30483E] text-white'
                        : 'bg-[#F6F5F0] text-[#5B6B64]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex justify-between text-xs text-[#5B6B64]">
                  <span>Distance Tolerance</span>
                  <span className="font-mono font-semibold text-[#141F1B]">±{tolerancePct}%</span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={15}
                  value={tolerancePct}
                  onChange={(e) => setTolerancePct(Number(e.target.value))}
                  className="mt-1 w-full accent-[#172D27]"
                />
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              disabled={generating}
              onClick={() => handleTriggerGenerate(0)}
              className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#172D27] px-4 text-sm font-semibold text-[#9AE62E] transition hover:bg-[#30483E] disabled:opacity-60"
            >
              {mode === 'run_art' ? <Palette className="h-4 w-4" /> : <Navigation className="h-4 w-4" />}
              {generating
                ? mode === 'run_art'
                  ? 'Matching Shape to Roads...'
                  : 'Computing Routes...'
                : mode === 'run_art'
                ? `Generate ${selectedTemplate.name}`
                : 'Generate Route'}
            </button>

            {candidates.length > 0 && (
              <button
                type="button"
                disabled={generating}
                title="Regenerate alternative variations"
                onClick={() => handleTriggerGenerate(seedOffset + 1)}
                className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-white px-3.5 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0] disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            )}
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {warning && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </div>
          )}
        </div>

        {/* Run Art Intended Drawing vs Real Street-Snapped Silhouette Comparison */}
        {mode === 'run_art' && selectedRoute && selectedRoute.routeType === 'run_art' && (() => {
          const intended = selectedRoute.intendedShapePath || [];
          const actual = selectedRoute.path || [];
          const allPts = [...intended, ...actual];
          let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
          for (const p of allPts) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
          }
          const midLat = (minLat + maxLat) / 2 || 30.74;
          const cosLat = Math.cos((midLat * Math.PI) / 180);
          const spanLat = Math.max(0.001, maxLat - minLat);
          const spanLng = Math.max(0.001, (maxLng - minLng) * cosLat);
          const scale = Math.min(76 / spanLng, 76 / spanLat);
          const toXY = (p: { lat: number; lng: number }) => ({
            x: Number((50 + (p.lng - (minLng + maxLng) / 2) * cosLat * scale).toFixed(1)),
            y: Number((50 - (p.lat - midLat) * scale).toFixed(1)),
          });
          const intendedSvg = intended.map((p) => { const xy = toXY(p); return `${xy.x},${xy.y}`; }).join(' ');
          const actualSvg = actual.map((p) => { const xy = toXY(p); return `${xy.x},${xy.y}`; }).join(' ');
          const startXY = actual.length > 0 ? toXY(actual[0]) : { x: 50, y: 50 };
          const endXY = actual.length > 1 ? toXY(actual[actual.length - 1]) : startXY;
          const isOpenPreview = Math.hypot(startXY.x - endXY.x, startXY.y - endXY.y) > 9;

          return (
            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-[#172D27] p-1">
                    <svg viewBox="0 0 100 100" className="h-full w-full">
                      {intendedSvg && (
                        <polyline
                          fill="none"
                          stroke="#B8E8C7"
                          strokeOpacity="0.45"
                          strokeWidth="2"
                          strokeDasharray="4 3"
                          strokeLinejoin="round"
                          points={intendedSvg}
                        />
                      )}
                      {actualSvg && (
                        <polyline
                          fill="none"
                          stroke="#9AE62E"
                          strokeWidth="3.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={actualSvg}
                        />
                      )}
                      <circle cx={startXY.x} cy={startXY.y} r="4.2" fill="#FFFFFF" stroke="#172D27" strokeWidth="1.5" />
                      {isOpenPreview && (
                        <circle cx={endXY.x} cy={endXY.y} r="4" fill="#B8E8C7" stroke="#172D27" strokeWidth="1.5" />
                      )}
                    </svg>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#5B6B64]">Target (dashed) vs Road Path (lime)</p>
                    <p className="font-display text-sm font-bold text-[#141F1B]">{selectedTemplate.name}</p>
                    <p className="mt-0.5 font-mono text-xs font-bold text-[#172D27]">
                      HMM/Fréchet Score: {selectedRoute.matchScore}%
                    </p>
                  </div>
                </div>
                <div className="text-right font-mono text-[11px] text-[#5B6B64] tabular-nums">
                  <p>Shape (60%): {Math.round((selectedRoute.shapeSimilarityNorm || 0) * 100)}%</p>
                  <p>Dist (25%): {Math.round((selectedRoute.distanceMatchNorm || 0) * 100)}%</p>
                  <p>Complete (15%): {Math.round((selectedRoute.routeCompletenessNorm || 0) * 100)}%</p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Route Alternatives List */}
        {candidates.length > 0 && (
          <div className="space-y-2.5">
            {candidates.map((c) => {
              const active = selectedRoute?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    active
                      ? 'border-[#172D27] bg-white shadow-sm ring-1 ring-[#172D27]'
                      : 'border-[#E5E3DC] bg-white/80 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#30483E]">
                      {c.label} · {c.matchScore !== undefined ? `${c.matchScore}% match` : `${c.toleranceDiffPct}% delta`}
                      {c.preferences.includes('well_lit') ? ' · Night Safe' : ''}
                    </span>
                    <span className="font-mono text-base font-bold text-[#172D27] tabular-nums">
                      {formatDistance(c.distanceMeters, preferredUnit)}
                    </span>
                  </div>
                  <p className="mt-1 font-display text-sm font-bold text-[#141F1B]">{c.name}</p>
                  <p className="mt-1 text-xs text-[#5B6B64]">
                    Est. {formatDuration(c.durationSec)} · {c.characteristics.join(' · ')}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Interactive Map & Route Details */}
      <div className="space-y-4 lg:col-span-7">
        <div
          className={
            fullScreenMap
              ? 'fixed inset-0 z-50 bg-[#F6F5F0] p-3 flex flex-col'
              : 'relative'
          }
        >
          <div className="relative flex-1">
            <TricityMap
              routes={candidates}
              selectedRouteId={selectedRoute?.id}
              startLocation={mode === 'run_art' && artAnyStartEnd ? undefined : startLoc}
              endLocation={mode === 'normal' && routeType === 'point_to_point' ? endLoc : undefined}
              pickMode={pickStartOnMap}
              onMapPick={(coords) => {
                if (!isInsideChandigarh(coords)) {
                  setError('Please tap inside Chandigarh UT boundaries (Mohali, Panchkula, Zirakpur & Kharar are excluded).');
                  return;
                }
                setError(null);
                setStartLoc({
                  name: `Pinned Start (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`,
                  city: 'Chandigarh',
                  ...coords,
                });
                setPickStartOnMap(false);
              }}
              onMapClick={(coords) => {
                setClickedTarget(coords);
                if (measureOriginMode === 'current' && !currentGpsLoc) {
                  requestCurrentGpsForMeasure();
                }
              }}
              measureOrigin={clickedTarget ? activeMeasureOrigin : null}
              measureTarget={clickedTarget}
              measurePath={measureResult?.path}
              heightClass={fullScreenMap ? 'h-full' : 'h-[360px] sm:h-[430px] lg:h-[500px]'}
            />

            <button
              type="button"
              onClick={() => setFullScreenMap((v) => !v)}
              aria-label={fullScreenMap ? 'Exit full screen map' : 'Full screen map'}
              className="absolute top-3 right-3 z-10 flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E5E3DC] bg-white/95 px-3 text-xs font-semibold text-[#172D27] shadow-md backdrop-blur"
            >
              {fullScreenMap ? (
                <>
                  <Minimize2 className="h-4 w-4" />
                  Exit Fullscreen
                </>
              ) : (
                <>
                  <Maximize2 className="h-4 w-4" />
                  Fullscreen
                </>
              )}
            </button>
          </div>

          {fullScreenMap && (
            <div className="mt-2.5 shrink-0">
              <MapPointDistanceCard
                originMode={measureOriginMode}
                startLabel={startLoc.name}
                onChangeOriginMode={(nextMode) => {
                  setMeasureOriginMode(nextMode);
                  if (nextMode === 'current' && !currentGpsLoc) {
                    requestCurrentGpsForMeasure();
                  }
                }}
                gpsLocating={gpsLocating}
                gpsError={gpsMeasureError}
                hasGpsPosition={Boolean(currentGpsLoc)}
                targetPoint={clickedTarget}
                measuring={measuringPoint}
                result={measureResult}
                preferredUnit={preferredUnit}
                onStartPathRun={
                  measureResult
                    ? () => {
                        setFullScreenMap(false);
                        const activePrefs: RoutePreference[] = nightMode
                          ? Array.from(new Set([...preferences.filter((p) => p !== 'parks_greenery'), 'well_lit']))
                          : preferences;
                        onStartRun(buildRouteCandidateFromPointPath(measureResult, activePrefs));
                      }
                    : undefined
                }
                onSetTargetAsStart={(pt) => {
                  if (!isInsideChandigarh(pt)) {
                    setError('Please pick a Chandigarh UT location inside city limits for route generation.');
                    return;
                  }
                  setError(null);
                  setStartLoc({
                    name: `Pinned Start (${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})`,
                    city: 'Chandigarh',
                    ...pt,
                  });
                }}
                onClear={() => {
                  measureSeqRef.current += 1;
                  setClickedTarget(null);
                  setMeasureResult(null);
                  setMeasuringPoint(false);
                }}
              />
            </div>
          )}
        </div>

        {!fullScreenMap && (
          <MapPointDistanceCard
            originMode={measureOriginMode}
            startLabel={startLoc.name}
            onChangeOriginMode={(nextMode) => {
              setMeasureOriginMode(nextMode);
              if (nextMode === 'current' && !currentGpsLoc) {
                requestCurrentGpsForMeasure();
              }
            }}
            gpsLocating={gpsLocating}
            gpsError={gpsMeasureError}
            hasGpsPosition={Boolean(currentGpsLoc)}
            targetPoint={clickedTarget}
            measuring={measuringPoint}
            result={measureResult}
            preferredUnit={preferredUnit}
            onStartPathRun={
              measureResult
                ? () => {
                    const activePrefs: RoutePreference[] = nightMode
                      ? Array.from(new Set([...preferences.filter((p) => p !== 'parks_greenery'), 'well_lit']))
                      : preferences;
                    onStartRun(buildRouteCandidateFromPointPath(measureResult, activePrefs));
                  }
                : undefined
            }
            onSetTargetAsStart={(pt) => {
              if (!isInsideChandigarh(pt)) {
                setError('Please pick a Chandigarh UT location inside city limits for route generation.');
                return;
              }
              setError(null);
              setStartLoc({
                name: `Pinned Start (${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})`,
                city: 'Chandigarh',
                ...pt,
              });
            }}
            onClear={() => {
              measureSeqRef.current += 1;
              setClickedTarget(null);
              setMeasureResult(null);
              setMeasuringPoint(false);
            }}
          />
        )}

        {selectedRoute && (
          <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-[#5B6B64]">
                  {selectedRoute.routeType.replace('_', ' ')} · {selectedRoute.surfaceSummary}
                  {selectedRoute.routingProvider ? ` · ${selectedRoute.routingProvider}` : ''}
                </p>
                <h2 className="mt-0.5 font-display text-xl font-bold text-[#141F1B]">
                  {selectedRoute.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => onStartRun(selectedRoute)}
                className="flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[#172D27] px-6 text-sm font-semibold text-[#9AE62E] shadow-sm transition hover:bg-[#30483E]"
              >
                <Play className="h-4 w-4" />
                Start Live Nav Run
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 border-y border-[#F0EFEA] py-3.5 sm:grid-cols-4">
              <div>
                <p className="text-xs text-[#5B6B64]">Actual Distance</p>
                <p className="font-mono text-lg font-bold text-[#141F1B] tabular-nums">
                  {formatDistance(selectedRoute.distanceMeters, preferredUnit)}
                </p>
                <p className="text-[11px] text-[#5B6B64]">
                  Req: {formatDistance(selectedRoute.targetDistanceMeters, preferredUnit)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#5B6B64]">Est. Running Time</p>
                <p className="font-mono text-lg font-bold text-[#141F1B] tabular-nums">
                  {formatDuration(selectedRoute.durationSec)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#5B6B64]">
                  {selectedRoute.routeType === 'run_art' ? 'Shape Match' : 'Elevation Gain'}
                </p>
                <p className="font-mono text-lg font-bold text-[#141F1B] tabular-nums">
                  {selectedRoute.routeType === 'run_art'
                    ? `${selectedRoute.matchScore}%`
                    : selectedRoute.elevationGainMeters !== null
                    ? `${selectedRoute.elevationGainMeters} m`
                    : 'Flat / N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#5B6B64]">KM Splits</p>
                <p className="font-mono text-lg font-bold text-[#141F1B] tabular-nums">
                  {selectedRoute.kmMarkers.length} splits
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingId === selectedRoute.id || savedIds[selectedRoute.id]}
                onClick={() => handleSaveRoute(selectedRoute)}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-3.5 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
              >
                {savedIds[selectedRoute.id] ? (
                  <Check className="h-4 w-4 text-[#172D27]" />
                ) : (
                  <Bookmark className="h-4 w-4" />
                )}
                {savedIds[selectedRoute.id] ? 'Saved' : 'Save Route'}
              </button>

              <button
                type="button"
                onClick={() => handleTriggerGenerate(seedOffset + 1)}
                disabled={generating}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-3.5 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </button>

              <button
                type="button"
                onClick={() => handleDownloadGeoJson(selectedRoute)}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-3.5 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
              >
                <Code2 className="h-4 w-4" />
                GeoJSON
              </button>

              {selectedRoute.routeType === 'run_art' && (
                <button
                  type="button"
                  onClick={() => handleDownloadArtwork(selectedRoute)}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-3.5 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
                >
                  <Download className="h-4 w-4" />
                  Art Card PNG
                </button>
              )}

              <button
                type="button"
                onClick={() => handleShareRoute(selectedRoute)}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-3.5 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
              >
                <Share2 className="h-4 w-4" />
                Share
              </button>

              <button
                type="button"
                onClick={() => setShowSteps((v) => !v)}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#F6F5F0] px-3.5 text-xs font-semibold text-[#172D27]"
              >
                {showSteps ? 'Hide Turns' : `Turns (${selectedRoute.steps.length})`}
              </button>
            </div>

            {shareFeedback && (
              <p className="mt-2 text-xs font-medium text-[#30483E]">{shareFeedback}</p>
            )}

            {showSteps && selectedRoute.steps.length > 0 && (
              <ol className="mt-4 max-h-64 space-y-2 overflow-y-auto border-t border-[#F0EFEA] pt-3 text-xs">
                {selectedRoute.steps.map((st, idx) => (
                  <li key={idx} className="flex items-start justify-between gap-3 py-1">
                    <span className="text-[#141F1B]">
                      <strong className="font-mono text-[#30483E]">{idx + 1}.</strong> {st.instruction}
                    </span>
                    <span className="shrink-0 font-mono text-[#5B6B64] tabular-nums">
                      {st.distanceMeters} m
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      <ShareCardModal card={shareModalCard} onClose={() => setShareModalCard(null)} />
    </div>
  );
};
