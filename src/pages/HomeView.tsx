import React, { useState } from 'react';
import {
  ArrowRight,
  Compass,
  LocateFixed,
  Palette,
  Play,
  Route as RouteIcon,
  Trophy,
  Type,
} from 'lucide-react';
import { isInsideChandigarh, TRICITY_START_PRESETS, VERIFIED_TRICITY_PLACES } from '../data/tricityPlaces';
import { formatDistance, formatDuration, formatPace } from '../lib/geo';
import { CHALLENGES } from '../services/challengesService';
import { recommendAlphabetKm, RUN_ART_TEMPLATES, sanitizeAlphabetInput } from '../services/runArtService';
import type {
  AppTab,
  NamedLocation,
  RouteMode,
  RouteType,
  RunActivityDoc,
  RunArtDesignDoc,
  RunArtShapeType,
  SavedRouteDoc,
  TricityPlace,
  UserProfileDoc,
} from '../types/run';

const DISTANCE_PRESETS = [1, 2, 3, 5, 7, 10];

interface HomeViewProps {
  profile: UserProfileDoc | null;
  runs: RunActivityDoc[];
  savedRoutes: SavedRouteDoc[];
  artDesigns: RunArtDesignDoc[];
  isAuthenticated: boolean;
  onNavigate: (tab: AppTab) => void;
  onQuickGenerate: (params: {
    mode: RouteMode;
    distanceKm: number;
    routeType: RouteType;
    shapeType?: RunArtShapeType;
    alphabetText?: string;
    start: NamedLocation;
  }) => void;
  onStartSavedRoute: (route: SavedRouteDoc) => void;
  onExplorePlace: (place: TricityPlace) => void;
  onOpenAuth: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  profile,
  runs,
  savedRoutes,
  artDesigns,
  isAuthenticated,
  onNavigate,
  onQuickGenerate,
  onStartSavedRoute,
  onExplorePlace,
  onOpenAuth,
}) => {
  const [mode, setMode] = useState<RouteMode>('normal');
  const [distanceKm, setDistanceKm] = useState<number>(5);
  const [customInput, setCustomInput] = useState<string>('');
  const [showCustom, setShowCustom] = useState(false);
  const [routeType, setRouteType] = useState<RouteType>('circular');
  const [shapeType, setShapeType] = useState<RunArtShapeType>('heart');
  const [alphabetWord, setAlphabetWord] = useState<string>('RUN');
  const [startLoc, setStartLoc] = useState<NamedLocation>(TRICITY_START_PRESETS[0]);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [failedImgs, setFailedImgs] = useState<Record<string, boolean>>({});

  const unit = profile?.preferredUnit || 'km';

  const weeklyKm = runs
    .filter((r) => Date.now() - new Date(r.finishedAt).getTime() <= 7 * 86400 * 1000)
    .reduce((sum, r) => sum + r.distanceMeters / 1000, 0);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocError('Geolocation is unavailable in this browser.');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!isInsideChandigarh(coords)) {
          setLocError(
            'Current GPS is outside Chandigarh UT. Pick a Chandigarh park preset below.'
          );
          setLocating(false);
          return;
        }
        setStartLoc({
          name: 'Current GPS Location',
          city: 'Chandigarh',
          ...coords,
        });
        setLocating(false);
      },
      () => {
        setLocError('Location access denied. Select a Chandigarh park or search in Plan Run.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const effectiveKm = showCustom && Number(customInput) > 0 ? Number(customInput) : distanceKm;

  return (
    <div className="space-y-8">
      {/* Hero & Unified Quick Route Generator */}
      <section className="relative overflow-hidden rounded-3xl bg-[#172D27] text-white shadow-sm">
        <div className="absolute inset-0">
          <img
            src="/images/hero_tricity_runner_1794574348576.jpg"
            alt="Runner at sunrise along Sukhna Lake Chandigarh"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            className="h-full w-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-[#172D27]/95 via-[#172D27]/85 to-[#30483E]/75" />
        </div>

        <div className="relative z-10 grid gap-6 p-5 sm:p-8 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-6">
            <p className="text-xs font-semibold tracking-wide text-[#B8E8C7]">
              Chandigarh · Sukhna Lake · Leisure Valley · Sector Green Belts
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-5xl text-balance">
              READY TO RUN?
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-[#E2ECE6] sm:text-base">
              Your City. Your Pace. Your Route. Generate connected Chandigarh pedestrian routes or snap Run Art shapes directly onto real footpaths.
            </p>

            <div className="mt-6 flex flex-wrap gap-6 border-t border-white/15 pt-5">
              <div>
                <p className="text-xs text-[#B8E8C7]/80">This Week</p>
                <p className="font-mono text-2xl font-bold text-[#9AE62E] tabular-nums">
                  {weeklyKm.toFixed(1)} km
                </p>
              </div>
              <div>
                <p className="text-xs text-[#B8E8C7]/80">Logged Runs</p>
                <p className="font-mono text-2xl font-bold text-white tabular-nums">
                  {runs.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#B8E8C7]/80">Saved Routes</p>
                <p className="font-mono text-2xl font-bold text-white tabular-nums">
                  {savedRoutes.length}
                </p>
              </div>
            </div>
          </div>

          {/* Unified Quick Planner Card (Normal Run + Run Art) */}
          <div className="rounded-2xl bg-white p-4 text-[#141F1B] shadow-lg sm:p-5 lg:col-span-6">
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#F6F5F0] p-1">
              <button
                type="button"
                onClick={() => setMode('normal')}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition ${
                  mode === 'normal'
                    ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                    : 'text-[#5B6B64] hover:text-[#141F1B]'
                }`}
              >
                <RouteIcon className="h-3.5 w-3.5" />
                Normal Run
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('run_art');
                  // Sector 17 is ideal default for crisp Run Art grids
                  if (startLoc.name === TRICITY_START_PRESETS[0].name) {
                    setStartLoc(TRICITY_START_PRESETS[1]);
                  }
                }}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition ${
                  mode === 'run_art'
                    ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                    : 'text-[#5B6B64] hover:text-[#141F1B]'
                }`}
              >
                <Palette className="h-3.5 w-3.5" />
                Run Art
              </button>
            </div>

            {/* Distance Selector */}
            <div className="mt-3.5">
              <p className="text-xs font-semibold text-[#5B6B64]">Distance (km)</p>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {DISTANCE_PRESETS.map((km) => {
                  const active = !showCustom && distanceKm === km;
                  return (
                    <button
                      key={km}
                      type="button"
                      onClick={() => {
                        setShowCustom(false);
                        setDistanceKm(km);
                      }}
                      className={`min-h-[40px] rounded-xl font-mono text-xs font-bold transition tabular-nums ${
                        active
                          ? 'bg-[#172D27] text-[#9AE62E]'
                          : 'bg-[#F6F5F0] text-[#141F1B] hover:bg-[#E7E5DC]'
                      }`}
                    >
                      {km}K
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowCustom(true)}
                  className={`min-h-[40px] rounded-xl text-xs font-semibold transition ${
                    showCustom
                      ? 'bg-[#172D27] text-[#9AE62E]'
                      : 'bg-[#F6F5F0] text-[#141F1B] hover:bg-[#E7E5DC]'
                  }`}
                >
                  Custom
                </button>
              </div>
              {showCustom && (
                <div className="mt-2">
                  <input
                    type="number"
                    min={0.5}
                    max={60}
                    step={0.5}
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="Enter km (e.g. 6.5)"
                    className="min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 font-mono text-sm focus:border-[#172D27] focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Start Location */}
            <div className="mt-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#5B6B64]">Chandigarh Start Point</p>
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#30483E] hover:underline"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                  {locating ? 'Locating...' : 'Use current GPS'}
                </button>
              </div>
              <select
                value={
                  TRICITY_START_PRESETS.some((p) => p.name === startLoc.name)
                    ? startLoc.name
                    : '__gps__'
                }
                onChange={(e) => {
                  const found = TRICITY_START_PRESETS.find((p) => p.name === e.target.value);
                  if (found) setStartLoc(found);
                }}
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-sm font-medium text-[#141F1B] focus:border-[#172D27] focus:outline-none"
              >
                {startLoc.name === 'Current GPS Location' && (
                  <option value="__gps__">Current GPS Location</option>
                )}
                {TRICITY_START_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              {locError && <p className="mt-1 text-xs text-red-700">{locError}</p>}
            </div>

            {/* Route Style (Normal Run) OR Art Template (Run Art) */}
            {mode === 'normal' ? (
              <div className="mt-3.5 grid grid-cols-3 gap-1.5 rounded-xl bg-[#F6F5F0] p-1">
                {[
                  { id: 'circular' as const, label: 'Circular Loop' },
                  { id: 'out_and_back' as const, label: 'Out & Back' },
                  { id: 'point_to_point' as const, label: 'Point-to-Point' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRouteType(opt.id)}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition ${
                      routeType === opt.id
                        ? 'bg-white text-[#172D27] shadow-sm'
                        : 'text-[#5B6B64] hover:text-[#141F1B]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-3.5">
                <p className="text-xs font-semibold text-[#5B6B64]">Shape or Alphabet Template</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                  {RUN_ART_TEMPLATES.map((tpl) => {
                    const active = shapeType === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setShapeType(tpl.id);
                          setDistanceKm(tpl.recommendedKm);
                          setShowCustom(false);
                        }}
                        className={`flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition ${
                          active
                            ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                            : 'border-[#E5E3DC] bg-[#F6F5F0] text-[#141F1B]'
                        }`}
                      >
                        <svg viewBox="-1.2 -1.2 2.4 2.4" className="h-4 w-4 shrink-0">
                          <polyline
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="0.22"
                            strokeLinejoin="round"
                            points={tpl.normalizedVertices.map((v) => `${v.x},${-v.y}`).join(' ')}
                          />
                        </svg>
                        <span className="truncate">{tpl.name.split(' ')[0]}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const clean = sanitizeAlphabetInput(alphabetWord || 'RUN') || 'RUN';
                      setAlphabetWord(clean);
                      setShapeType('alphabet');
                      setDistanceKm(recommendAlphabetKm(clean.length));
                      setShowCustom(false);
                    }}
                    className={`flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition ${
                      shapeType === 'alphabet'
                        ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                        : 'border-dashed border-[#30483E]/50 bg-[#F6F5F0] text-[#172D27]'
                    }`}
                  >
                    <Type className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Letters</span>
                  </button>
                </div>

                {shapeType === 'alphabet' && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] p-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={alphabetWord}
                      onChange={(e) => {
                        const clean = sanitizeAlphabetInput(e.target.value);
                        setAlphabetWord(clean);
                        if (clean.length > 0) setDistanceKm(recommendAlphabetKm(clean.length));
                      }}
                      placeholder="Letters / word (A-Z)"
                      className="min-h-[38px] flex-1 rounded-lg border border-[#D9D7CE] bg-white px-2.5 font-mono text-xs font-bold uppercase tracking-widest text-[#141F1B] focus:border-[#172D27] focus:outline-none"
                    />
                    <span className="font-mono text-[10px] font-semibold text-[#5B6B64]">A–Z / 0–9</span>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                const safeWord = sanitizeAlphabetInput(alphabetWord) || 'RUN';
                onQuickGenerate({
                  mode,
                  distanceKm: Math.min(60, Math.max(0.5, effectiveKm || 5)),
                  routeType: mode === 'run_art' ? 'run_art' : routeType,
                  shapeType: mode === 'run_art' ? shapeType : undefined,
                  alphabetText: mode === 'run_art' && shapeType === 'alphabet' ? safeWord : undefined,
                  start: startLoc,
                });
              }}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#172D27] px-5 text-sm font-semibold text-[#9AE62E] transition hover:bg-[#30483E]"
            >
              {mode === 'run_art' ? <Palette className="h-4 w-4" /> : <RouteIcon className="h-4 w-4" />}
              {mode === 'run_art'
                ? shapeType === 'alphabet'
                  ? `Generate "${sanitizeAlphabetInput(alphabetWord) || 'RUN'}" (${effectiveKm}K)`
                  : `Generate ${RUN_ART_TEMPLATES.find((t) => t.id === shapeType)?.name || 'Run Art'} (${effectiveKm}K)`
                : `Generate ${effectiveKm}K Route`}
            </button>
          </div>
        </div>
      </section>

      {/* Recent Activity & Saved Routes */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-[#141F1B]">Recent Running Activity</h2>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#30483E] hover:underline"
            >
              Run History <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {runs.length === 0 ? (
            <div className="mt-4 rounded-xl bg-[#F6F5F0] p-5">
              <p className="text-sm font-semibold text-[#141F1B]">
                {isAuthenticated ? 'No runs recorded yet' : 'Sign in to track your Chandigarh mileage'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#5B6B64]">
                {isAuthenticated
                  ? 'Generate a route above or start a live GPS run to see your splits, pace trends, and personal records.'
                  : 'Browse routes freely or sign in with Google to save routes, log runs, and unlock challenges.'}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('plan')}
                  className="min-h-[40px] rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
                >
                  Open Route Planner
                </button>
                {!isAuthenticated && (
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="min-h-[40px] rounded-xl border border-[#D9D7CE] bg-white px-4 text-xs font-semibold text-[#141F1B]"
                  >
                    Sign In
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-[#F0EFEA]">
              {runs.slice(0, 4).map((run) => (
                <div key={run.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#141F1B]">{run.routeName}</p>
                    <p className="mt-0.5 text-xs text-[#5B6B64]">
                      {new Date(run.finishedAt).toLocaleDateString()} · {run.startName}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-mono text-sm font-bold text-[#172D27]">
                      {formatDistance(run.distanceMeters, unit)}
                    </p>
                    <p className="font-mono text-xs text-[#5B6B64]">
                      {formatDuration(run.durationSec)} · {formatPace(run.avgPaceSecPerKm, unit)}/{unit}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Saved Routes & Run Art Studio Entry */}
        <section className="flex flex-col gap-5 lg:col-span-5">
          <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#141F1B]">My Routes</h2>
              <button
                type="button"
                onClick={() => onNavigate('routes')}
                className="text-xs font-semibold text-[#30483E] hover:underline"
              >
                All Saved
              </button>
            </div>

            {savedRoutes.length === 0 ? (
              <p className="mt-3 text-xs leading-relaxed text-[#5B6B64]">
                Save any generated Normal Run or Run Art route in Plan Run to build your Chandigarh loop library.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {savedRoutes.slice(0, 3).map((sr) => (
                  <div
                    key={sr.id}
                    className="flex items-center justify-between rounded-xl bg-[#F6F5F0] px-3 py-2.5"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="truncate text-sm font-semibold text-[#141F1B]">{sr.name}</p>
                      <p className="font-mono text-xs text-[#5B6B64] tabular-nums">
                        {formatDistance(sr.distanceMeters, unit)} · Chandigarh
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onStartSavedRoute(sr)}
                      className="flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E]"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Run
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-[#30483E] p-5 text-white">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#B8E8C7]">
              <Palette className="h-4 w-4" />
              <span>Signature Feature</span>
            </div>
            <h3 className="mt-2 font-display text-xl font-bold">RUN ART in Chandigarh</h3>
            <p className="mt-1 text-xs leading-relaxed text-[#E2ECE6]">
              Draw Hearts, Stars, Infinity loops, Diamonds, or Lightning bolts snapped strictly onto real Chandigarh footpaths.
            </p>
            <button
              type="button"
              onClick={() =>
                onQuickGenerate({
                  mode: 'run_art',
                  distanceKm: 5,
                  routeType: 'run_art',
                  shapeType: 'heart',
                  start: TRICITY_START_PRESETS[1],
                })
              }
              className="mt-4 inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#9AE62E] px-4 text-xs font-bold text-[#172D27]"
            >
              Try Run Art Now
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      </div>

      {/* Popular Chandigarh Running Areas */}
      <section>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-[#141F1B]">Explore Chandigarh Running Areas</h2>
            <p className="text-xs text-[#5B6B64]">Verified Chandigarh parks, Sukhna Lake paths, and sector green corridors</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#30483E] hover:underline"
          >
            <Compass className="h-3.5 w-3.5" />
            Explore All
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VERIFIED_TRICITY_PLACES.slice(0, 4).map((place) => (
            <button
              key={place.id}
              type="button"
              onClick={() => onExplorePlace(place)}
              className="group overflow-hidden rounded-2xl border border-[#E5E3DC] bg-white text-left transition hover:border-[#172D27]"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-[#E8ECE8]">
                {failedImgs[place.id] ? (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#172D27] to-[#30483E] p-4 text-center text-white">
                    <Compass className="h-7 w-7 text-[#9AE62E]" />
                    <span className="mt-2 text-xs font-semibold text-[#B8E8C7]">{place.area}</span>
                  </div>
                ) : (
                  <img
                    src={place.imageUrl}
                    alt={place.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => setFailedImgs((prev) => ({ ...prev, [place.id]: true }))}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                )}
              </div>
              <div className="p-4">
                <p className="text-xs font-medium text-[#5B6B64]">
                  {place.area} · {place.surface}
                </p>
                <h3 className="mt-1 font-display text-base font-bold text-[#141F1B]">{place.name}</h3>
                <p className="mt-1 font-mono text-xs font-semibold text-[#30483E] tabular-nums">
                  {place.suggestedDistancesKm.map((d) => `${d}K`).join(' · ')}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Active Challenges Snapshot */}
      <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[#172D27]" />
            <h2 className="font-display text-lg font-bold text-[#141F1B]">Chandigarh Challenges</h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('profile')}
            className="text-xs font-semibold text-[#30483E] hover:underline"
          >
            All Challenges
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CHALLENGES.slice(0, 4).map((ch) => {
            const val = ch.computeProgress(runs, artDesigns);
            const pct = Math.min(100, Math.round((val / ch.target) * 100));
            return (
              <div key={ch.key} className="rounded-xl bg-[#F6F5F0] p-4">
                <p className="text-xs font-medium text-[#5B6B64]">{ch.timeframe}</p>
                <h3 className="mt-0.5 font-display text-sm font-bold text-[#141F1B]">{ch.title}</h3>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E2E0D7]">
                  <div className="h-full bg-[#172D27] transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 font-mono text-xs font-semibold text-[#30483E] tabular-nums">
                  {val} / {ch.target} {ch.unit}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
