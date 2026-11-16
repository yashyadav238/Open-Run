import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { AlertTriangle, MapPin, Navigation, Search } from 'lucide-react';
import {
  MapPointDistanceCard,
  type MeasureOriginMode,
} from '../components/MapPointDistanceCard';
import { PlaceSearchInput } from '../components/PlaceSearchInput';
import { TricityMap } from '../components/TricityMap';
import { WorkoutSelector } from '../components/WorkoutIcon';
import { isInsideChandigarh, VERIFIED_TRICITY_PLACES } from '../data/tricityPlaces';
import {
  isChandigarhCityName,
  isInsideSelectedCity,
  type ActiveRunningCity,
} from '../data/worldCities';
import { getWorkoutMeta, normalizeWorkoutType } from '../data/workouts';
import { createPathReport, fetchActivePathReports } from '../services/firestoreService';
import {
  buildRouteCandidateFromPointPath,
  computeClickedPointPath,
  type PointToPointMeasureResult,
} from '../services/pointPathService';
import { createPedestrianRoutingProvider } from '../services/routingService';
import type {
  GeneratedRouteCandidate,
  LatLngLiteral,
  NamedLocation,
  PathReportDoc,
  TricityPlace,
  WorkoutType,
} from '../types/run';

const ZONES = ['All Sectors', 'Sector 1–10', 'Sector 16–23', 'Sector 33–36'] as const;
type ZoneFilter = (typeof ZONES)[number];

function buildCityHubPlace(city: ActiveRunningCity): TricityPlace {
  return {
    id: `city-hub-${city.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: `${city.name} Running Hub`,
    city: city.name,
    area: city.country || 'Selected Running City',
    lat: city.lat,
    lng: city.lng,
    suggestedDistancesKm: [3, 5, 10, 15],
    surface: 'Pedestrian sidewalks, city parks & waterfront paths',
    lighting: 'City street lighting on main avenues',
    description:
      city.tagline ||
      `Explore pedestrian routes anywhere in ${city.name}. Click any point on the map or search a park above to measure paths and launch a run.`,
    paths: ['Urban Parks', 'Pedestrian Promenades', 'Main Sidewalks'],
    imageUrl: '',
    lastVerified: '2026',
    tags: ['world', 'pedestrian', 'park'],
  };
}

interface ExploreViewProps {
  userId: string | null;
  userName: string;
  emailVerified: boolean;
  preferredUnit?: 'km' | 'mi';
  defaultWorkoutType?: WorkoutType;
  onWorkoutChange?: (workout: WorkoutType) => void;
  activeCity: ActiveRunningCity;
  onPlanAtPlace: (place: TricityPlace, distanceKm?: number, workoutType?: WorkoutType) => void;
  onStartRun?: (route: GeneratedRouteCandidate) => void;
  onOpenAuth: () => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  userId,
  userName,
  emailVerified,
  preferredUnit = 'km',
  defaultWorkoutType = 'running',
  onWorkoutChange,
  activeCity,
  onPlanAtPlace,
  onStartRun,
  onOpenAuth,
}) => {
  const routesLib = useMapsLibrary('routes');
  const [workoutType, setWorkoutType] = useState<WorkoutType>(() =>
    normalizeWorkoutType(defaultWorkoutType)
  );
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('All Sectors');
  const [distFilter, setDistFilter] = useState<'all' | 'short' | 'medium' | 'long'>('all');
  const [search, setSearch] = useState('');
  const [globalPlaceQuery, setGlobalPlaceQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<TricityPlace>(() =>
    isChandigarhCityName(activeCity.name)
      ? VERIFIED_TRICITY_PLACES[0]
      : buildCityHubPlace(activeCity)
  );
  const [reports, setReports] = useState<PathReportDoc[]>([]);
  const [showReportForm, setShowReportForm] = useState(false);
  const [issueType, setIssueType] = useState<PathReportDoc['issueType']>('construction');
  const [reportDesc, setReportDesc] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [failedImgs, setFailedImgs] = useState<Record<string, boolean>>({});
  const [measureOriginMode, setMeasureOriginMode] = useState<MeasureOriginMode>('start');
  const [currentGpsLoc, setCurrentGpsLoc] = useState<NamedLocation | null>(null);
  const [gpsLocating, setGpsLocating] = useState(false);
  const [gpsMeasureError, setGpsMeasureError] = useState<string | null>(null);
  const [clickedTarget, setClickedTarget] = useState<LatLngLiteral | null>(null);
  const [measuringPoint, setMeasuringPoint] = useState(false);
  const [measureResult, setMeasureResult] = useState<PointToPointMeasureResult | null>(null);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const measureSeqRef = useRef(0);
  const isChandigarhCity = isChandigarhCityName(activeCity.name);

  useEffect(() => {
    setWorkoutType(normalizeWorkoutType(defaultWorkoutType));
  }, [defaultWorkoutType]);

  const workoutMeta = getWorkoutMeta(workoutType);

  useEffect(() => {
    setSelectedPlace(
      isChandigarhCityName(activeCity.name)
        ? VERIFIED_TRICITY_PLACES[0]
        : buildCityHubPlace(activeCity)
    );
    setClickedTarget(null);
    setMeasureResult(null);
    setExploreError(null);
    setGlobalPlaceQuery('');
    setSearch('');
  }, [activeCity.name, activeCity.lat, activeCity.lng]);

  const requestCurrentGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsMeasureError('Browser geolocation is unavailable.');
      return;
    }
    setGpsLocating(true);
    setGpsMeasureError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLocating(false);
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!isInsideSelectedCity(coords, activeCity)) {
          setGpsMeasureError(
            `GPS position is outside ${activeCity.name} bounds. Change Running City in Profile or pick a start inside ${activeCity.name}.`
          );
          return;
        }
        setCurrentGpsLoc({
          name: 'Current GPS Location',
          city: activeCity.name,
          ...coords,
        });
      },
      () => {
        setGpsLocating(false);
        setGpsMeasureError('Location permission denied. Switch to Starting Point or allow location access.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
    );
  }, [activeCity]);

  const selectedOriginLoc: NamedLocation = useMemo(
    () =>
      measureOriginMode === 'current' && currentGpsLoc
        ? currentGpsLoc
        : {
            name: selectedPlace.name,
            city: selectedPlace.city,
            lat: selectedPlace.lat,
            lng: selectedPlace.lng,
          },
    [measureOriginMode, currentGpsLoc, selectedPlace]
  );

  useEffect(() => {
    if (!clickedTarget) {
      setMeasureResult(null);
      setMeasuringPoint(false);
      return;
    }
    if (measureOriginMode === 'current' && !currentGpsLoc) return;

    const seq = ++measureSeqRef.current;
    setMeasuringPoint(true);
    setExploreError(null);
    const provider = createPedestrianRoutingProvider(routesLib);
    computeClickedPointPath(
      provider,
      selectedOriginLoc,
      clickedTarget,
      ['least_turns', 'parks_greenery', 'pedestrian_paths'],
      activeCity,
      workoutType
    )
      .then((res) => {
        if (measureSeqRef.current !== seq) return;
        setMeasureResult(res);
      })
      .catch((err) => {
        if (measureSeqRef.current !== seq) return;
        setMeasureResult(null);
        setExploreError(
          err instanceof Error
            ? err.message
            : `Clicked point is outside ${activeCity.name}. Keep measurements inside your selected Running City.`
        );
      })
      .finally(() => {
        if (measureSeqRef.current === seq) {
          setMeasuringPoint(false);
        }
      });
  }, [clickedTarget, measureOriginMode, currentGpsLoc, selectedOriginLoc, routesLib, activeCity, workoutType]);

  useEffect(() => {
    fetchActivePathReports()
      .then(setReports)
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!isChandigarhCity) {
      const hub = buildCityHubPlace(activeCity);
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          hub.name.toLowerCase().includes(q) ||
          hub.city.toLowerCase().includes(q) ||
          hub.description.toLowerCase().includes(q);
        return matches ? [hub] : [];
      }
      return [hub];
    }
    return VERIFIED_TRICITY_PLACES.filter((p) => {
      if (zoneFilter === 'Sector 1–10' && !/Sector (1|3|4|10)/i.test(p.area)) return false;
      if (zoneFilter === 'Sector 16–23' && !/Sector (16|17|23)/i.test(p.area)) return false;
      if (zoneFilter === 'Sector 33–36' && !/Sector (33|34|35|36)/i.test(p.area)) return false;
      if (distFilter === 'short' && !p.suggestedDistancesKm.some((d) => d <= 3)) return false;
      if (distFilter === 'medium' && !p.suggestedDistancesKm.some((d) => d >= 5 && d <= 10)) return false;
      if (distFilter === 'long' && !p.suggestedDistancesKm.some((d) => d >= 10)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          p.area.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [isChandigarhCity, activeCity, search, zoneFilter, distFilter]);

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      onOpenAuth();
      return;
    }
    if (!emailVerified) {
      setReportError('Please verify your email address before submitting community path reports.');
      return;
    }
    if (reportDesc.trim().length < 5) {
      setReportError('Please enter at least 5 characters describing the path condition.');
      return;
    }
    setSubmittingReport(true);
    setReportError(null);
    try {
      await createPathReport(userId, {
        reporterName: userName,
        city: selectedPlace.city,
        areaName: selectedPlace.name,
        lat: selectedPlace.lat,
        lng: selectedPlace.lng,
        issueType,
        description: reportDesc.trim(),
      });
      setReportDesc('');
      setShowReportForm(false);
      const updated = await fetchActivePathReports();
      setReports(updated);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Unable to submit report.');
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141F1B]">
            Explore {activeCity.name} Running Areas
          </h1>
          <p className="mt-1 text-sm text-[#5B6B64]">
            Search parks, waterfronts, or neighborhoods inside {activeCity.name}, click the map to measure routes, or launch a run.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-full sm:w-72">
            <PlaceSearchInput
              value={globalPlaceQuery}
              biasCenter={activeCity}
              biasCityName={activeCity.name}
              strictCity={activeCity}
              placeholder={`Search parks & landmarks inside ${activeCity.name}...`}
              onSelect={(loc) => {
                setExploreError(null);
                setGlobalPlaceQuery(loc.name);
                setClickedTarget(null);
                setMeasureResult(null);
                setSelectedPlace({
                  id: `city-place-${Date.now()}`,
                  name: loc.name,
                  city: activeCity.name,
                  area: `${activeCity.name} Boundary`,
                  lat: loc.lat,
                  lng: loc.lng,
                  suggestedDistancesKm: [3, 5, 10, 15],
                  surface: 'Sidewalks, parks & pedestrian paths',
                  lighting: 'Check local street lighting',
                  description: `Selected point inside ${activeCity.name}. Click anywhere inside ${activeCity.name} on the map to measure pedestrian distance or launch a route loop from here.`,
                  paths: ['Pedestrian Corridors', 'Nearby Parks'],
                  imageUrl: '',
                  lastVerified: '2026',
                  tags: ['pedestrian'],
                });
              }}
            />
          </div>
          {isChandigarhCity && (
            <div className="flex min-h-[44px] w-full items-center rounded-xl border border-[#D9D7CE] bg-white px-3 sm:w-60">
              <Search className="mr-2 h-4 w-4 text-[#5B6B64]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter curated parks..."
                className="w-full bg-transparent text-sm focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {exploreError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
          {exploreError}
        </div>
      )}

      {/* City & Distance Filters (Chandigarh curated areas) */}
      {isChandigarhCity && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
          {ZONES.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoneFilter(z)}
              className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold transition ${
                zoneFilter === z
                  ? 'bg-[#172D27] text-[#9AE62E]'
                  : 'border border-[#E5E3DC] bg-white text-[#5B6B64] hover:text-[#141F1B]'
              }`}
            >
              {z}
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-xl bg-white p-1 border border-[#E5E3DC]">
          {[
            { id: 'all' as const, label: 'Any Distance' },
            { id: 'short' as const, label: '1–3K' },
            { id: 'medium' as const, label: '5–10K' },
            { id: 'long' as const, label: '10K+' },
          ].map((df) => (
            <button
              key={df.id}
              type="button"
              onClick={() => setDistFilter(df.id)}
              className={`min-h-[34px] rounded-lg px-2.5 text-xs font-semibold ${
                distFilter === df.id ? 'bg-[#172D27] text-white' : 'text-[#5B6B64]'
              }`}
            >
              {df.label}
            </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-auto sm:min-w-[360px]">
          <WorkoutSelector
            value={workoutType}
            onChange={(next) => {
              setWorkoutType(next);
              onWorkoutChange?.(next);
            }}
            compact
          />
        </div>
      </div>

      {/* Interactive Map + Active Place Card */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <TricityMap
            showVerifiedParks={isChandigarhCity && isInsideChandigarh(selectedPlace)}
            onSelectPark={(park) => setSelectedPlace(park)}
            onMapClick={(coords) => {
              if (!isInsideSelectedCity(coords, activeCity)) {
                setExploreError(
                  `Clicked point is outside ${activeCity.name}. Measurements stay inside your selected Running City.`
                );
                return;
              }
              setExploreError(null);
              setClickedTarget(coords);
              if (measureOriginMode === 'current' && !currentGpsLoc) {
                requestCurrentGps();
              }
            }}
            measureOrigin={selectedOriginLoc}
            measureTarget={clickedTarget}
            measurePath={measureResult?.path}
            fallbackCenter={{ lat: activeCity.lat, lng: activeCity.lng }}
            focusCenter={{ lat: selectedPlace.lat, lng: selectedPlace.lng }}
            focusZoom={13}
            heightClass="h-[320px] lg:h-[420px]"
          />

          <MapPointDistanceCard
            workoutType={workoutType}
            originMode={measureOriginMode}
            startLabel={selectedPlace.name}
            onChangeOriginMode={(nextMode) => {
              setMeasureOriginMode(nextMode);
              if (nextMode === 'current' && !currentGpsLoc) {
                requestCurrentGps();
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
              measureResult && onStartRun
                ? () =>
                    onStartRun(
                      buildRouteCandidateFromPointPath(
                        measureResult,
                        ['parks_greenery', 'pedestrian_paths'],
                        workoutType
                      )
                    )
                : undefined
            }
            onClear={() => {
              measureSeqRef.current += 1;
              setClickedTarget(null);
              setMeasureResult(null);
              setMeasuringPoint(false);
            }}
          />
        </div>

        <div className="rounded-2xl border border-[#E5E3DC] bg-white overflow-hidden lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="aspect-[16/9] w-full bg-[#E8ECE8]">
              {!selectedPlace.imageUrl || failedImgs[`hero_${selectedPlace.id}`] ? (
                <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#172D27] to-[#30483E] p-4 text-center text-white">
                  <MapPin className="h-8 w-8 text-[#9AE62E]" />
                  <span className="mt-2 font-display text-sm font-bold">{selectedPlace.name}</span>
                  <span className="text-xs text-[#B8E8C7]">{selectedPlace.area}</span>
                </div>
              ) : (
                <img
                  src={selectedPlace.imageUrl}
                  alt={selectedPlace.name}
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setFailedImgs((prev) => ({ ...prev, [`hero_${selectedPlace.id}`]: true }))
                  }
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="p-5">
              <p className="text-xs font-medium text-[#5B6B64]">
                {selectedPlace.city} · {selectedPlace.area} · Verified {selectedPlace.lastVerified}
              </p>
              <h2 className="mt-1 font-display text-xl font-bold text-[#141F1B]">{selectedPlace.name}</h2>
              <p className="mt-2 text-xs leading-relaxed text-[#5B6B64]">{selectedPlace.description}</p>

              <div className="mt-4 space-y-1.5 border-t border-[#F0EFEA] pt-3 text-xs">
                <p>
                  <strong className="text-[#141F1B]">Surface:</strong>{' '}
                  <span className="text-[#5B6B64]">{selectedPlace.surface}</span>
                </p>
                <p>
                  <strong className="text-[#141F1B]">Lighting:</strong>{' '}
                  <span className="text-[#5B6B64]">{selectedPlace.lighting}</span>
                </p>
                <p>
                  <strong className="text-[#141F1B]">Paths:</strong>{' '}
                  <span className="text-[#5B6B64]">{selectedPlace.paths.join(' · ')}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-[#F0EFEA] p-4 flex gap-2">
            <button
              type="button"
              onClick={() =>
                onPlanAtPlace(
                  selectedPlace,
                  workoutType === 'cycling'
                    ? workoutMeta.defaultDistanceKm
                    : selectedPlace.suggestedDistancesKm[1] || workoutMeta.defaultDistanceKm,
                  workoutType
                )
              }
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
            >
              <Navigation className="h-4 w-4" />
              Plan{' '}
              {workoutType === 'cycling'
                ? workoutMeta.defaultDistanceKm
                : selectedPlace.suggestedDistancesKm[1] || workoutMeta.defaultDistanceKm}
              K {workoutMeta.label} Here
            </button>
            <button
              type="button"
              onClick={() => setShowReportForm((v) => !v)}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#141F1B]"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Report Path
            </button>
          </div>
        </div>
      </div>

      {/* Optional Path Condition Form */}
      {showReportForm && (
        <form
          onSubmit={handleSubmitReport}
          className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-3"
        >
          <h3 className="font-display text-base font-bold text-[#141F1B]">
            Report Path Condition at {selectedPlace.name}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as PathReportDoc['issueType'])}
              className="min-h-[44px] rounded-xl border border-[#D9D7CE] px-3 text-sm"
            >
              <option value="construction">Construction / Maintenance</option>
              <option value="blocked">Blocked Gate or Path</option>
              <option value="lighting">Low Lighting</option>
              <option value="surface">Uneven Surface</option>
            </select>
            <input
              type="text"
              value={reportDesc}
              onChange={(e) => setReportDesc(e.target.value)}
              placeholder="Brief note for fellow runners..."
              className="min-h-[44px] rounded-xl border border-[#D9D7CE] px-3 text-sm sm:col-span-2"
            />
          </div>
          {reportError && <p className="text-xs text-red-700">{reportError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowReportForm(false)}
              className="min-h-[40px] rounded-xl border border-[#D9D7CE] px-4 text-xs font-semibold text-[#5B6B64]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingReport}
              className="min-h-[40px] rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
            >
              {submittingReport ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      )}

      {/* Grid of Verified Places */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
          <p className="text-sm font-semibold text-[#141F1B]">No verified areas match your filter.</p>
          <button
            type="button"
            onClick={() => {
              setZoneFilter('All Sectors');
              setDistFilter('all');
              setSearch('');
            }}
            className="mt-3 min-h-[40px] rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-white"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((place) => (
            <div
              key={place.id}
              className={`rounded-2xl border bg-white overflow-hidden transition ${
                selectedPlace.id === place.id ? 'border-[#172D27]' : 'border-[#E5E3DC]'
              }`}
            >
              <div className="aspect-[4/3] w-full bg-[#E8ECE8]">
                {failedImgs[place.id] ? (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#172D27] to-[#30483E] p-4 text-center text-white">
                    <MapPin className="h-7 w-7 text-[#9AE62E]" />
                    <span className="mt-2 text-xs font-semibold text-[#B8E8C7]">{place.area}</span>
                  </div>
                ) : (
                  <img
                    src={place.imageUrl}
                    alt={place.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => setFailedImgs((prev) => ({ ...prev, [place.id]: true }))}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="p-4">
                <p className="text-xs font-medium text-[#5B6B64]">
                  {place.city} · {place.area} · Verified {place.lastVerified}
                </p>
                <h3 className="mt-1 font-display text-base font-bold text-[#141F1B]">{place.name}</h3>
                <p className="mt-1.5 line-clamp-2 text-xs text-[#5B6B64]">{place.description}</p>
                <div className="mt-3 flex items-center justify-between border-t border-[#F0EFEA] pt-3">
                  <span className="font-mono text-xs font-semibold text-[#30483E] tabular-nums">
                    {place.suggestedDistancesKm.map((d) => `${d}K`).join(' · ')}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPlace(place)}
                      className="min-h-[36px] rounded-lg border border-[#D9D7CE] px-2.5 text-xs font-semibold text-[#141F1B]"
                    >
                      <MapPin className="inline h-3.5 w-3.5 mr-1" />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onPlanAtPlace(
                          place,
                          workoutType === 'cycling'
                            ? workoutMeta.defaultDistanceKm
                            : place.suggestedDistancesKm[0] || workoutMeta.defaultDistanceKm,
                          workoutType
                        )
                      }
                      className="min-h-[36px] rounded-lg bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E]"
                    >
                      {workoutMeta.verb} Here
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Community Path Alerts */}
      {(() => {
        const cityReports = reports.filter(
          (r) => !r.city || r.city.toLowerCase() === activeCity.name.toLowerCase()
        );
        if (cityReports.length === 0) return null;
        return (
          <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5">
            <h3 className="font-display text-base font-bold text-[#141F1B]">
              Recent {activeCity.name} Path Notices
            </h3>
            <div className="mt-3 divide-y divide-[#F0EFEA]">
              {cityReports.slice(0, 5).map((r) => (
                <div key={r.id} className="py-2.5 text-xs">
                  <p className="font-semibold text-[#141F1B]">
                    {r.areaName} ({r.city}) · {r.issueType}
                  </p>
                  <p className="mt-0.5 text-[#5B6B64]">
                    {r.description} — reported by {r.reporterName}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
