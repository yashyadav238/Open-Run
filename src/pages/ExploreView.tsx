import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { AlertTriangle, MapPin, Navigation, Search } from 'lucide-react';
import {
  MapPointDistanceCard,
  type MeasureOriginMode,
} from '../components/MapPointDistanceCard';
import { TricityMap } from '../components/TricityMap';
import { VERIFIED_TRICITY_PLACES } from '../data/tricityPlaces';
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
} from '../types/run';

const ZONES = ['All Sectors', 'Sector 1–10', 'Sector 16–23', 'Sector 33–36'] as const;
type ZoneFilter = (typeof ZONES)[number];

interface ExploreViewProps {
  userId: string | null;
  userName: string;
  emailVerified: boolean;
  preferredUnit?: 'km' | 'mi';
  onPlanAtPlace: (place: TricityPlace, distanceKm?: number) => void;
  onStartRun?: (route: GeneratedRouteCandidate) => void;
  onOpenAuth: () => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  userId,
  userName,
  emailVerified,
  preferredUnit = 'km',
  onPlanAtPlace,
  onStartRun,
  onOpenAuth,
}) => {
  const routesLib = useMapsLibrary('routes');
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('All Sectors');
  const [distFilter, setDistFilter] = useState<'all' | 'short' | 'medium' | 'long'>('all');
  const [search, setSearch] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<TricityPlace>(VERIFIED_TRICITY_PLACES[0]);
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
  const measureSeqRef = useRef(0);

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
    const provider = createPedestrianRoutingProvider(routesLib);
    computeClickedPointPath(provider, selectedOriginLoc, clickedTarget, [
      'parks_greenery',
      'pedestrian_paths',
    ])
      .then((res) => {
        if (measureSeqRef.current !== seq) return;
        setMeasureResult(res);
      })
      .finally(() => {
        if (measureSeqRef.current === seq) {
          setMeasuringPoint(false);
        }
      });
  }, [clickedTarget, measureOriginMode, currentGpsLoc, selectedOriginLoc, routesLib]);

  useEffect(() => {
    fetchActivePathReports()
      .then(setReports)
      .catch(() => {});
  }, []);

  const filtered = VERIFIED_TRICITY_PLACES.filter((p) => {
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
          <h1 className="font-display text-2xl font-bold text-[#141F1B]">Explore Chandigarh Running Areas</h1>
          <p className="mt-1 text-sm text-[#5B6B64]">
            Verified Chandigarh parks, Sukhna Lake promenade, and shaded sector green corridors.
          </p>
        </div>

        <div className="flex min-h-[44px] w-full items-center rounded-xl border border-[#D9D7CE] bg-white px-3 lg:w-72">
          <Search className="mr-2 h-4 w-4 text-[#5B6B64]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parks or sectors..."
            className="w-full bg-transparent text-sm focus:outline-none"
          />
        </div>
      </div>

      {/* City & Distance Filters */}
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

      {/* Interactive Map + Active Place Card */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <TricityMap
            showVerifiedParks
            onSelectPark={(park) => setSelectedPlace(park)}
            onMapClick={(coords) => {
              setClickedTarget(coords);
              if (measureOriginMode === 'current' && !currentGpsLoc) {
                requestCurrentGps();
              }
            }}
            measureOrigin={selectedOriginLoc}
            measureTarget={clickedTarget}
            measurePath={measureResult?.path}
            focusCenter={{ lat: selectedPlace.lat, lng: selectedPlace.lng }}
            focusZoom={14}
            heightClass="h-[320px] lg:h-[420px]"
          />

          <MapPointDistanceCard
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
                      buildRouteCandidateFromPointPath(measureResult, [
                        'parks_greenery',
                        'pedestrian_paths',
                      ])
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
              {failedImgs[`hero_${selectedPlace.id}`] ? (
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
              onClick={() => onPlanAtPlace(selectedPlace, selectedPlace.suggestedDistancesKm[1] || 5)}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
            >
              <Navigation className="h-4 w-4" />
              Plan {selectedPlace.suggestedDistancesKm[1] || 5}K Route Here
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
                      onClick={() => onPlanAtPlace(place, place.suggestedDistancesKm[0] || 5)}
                      className="min-h-[36px] rounded-lg bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E]"
                    >
                      Run Here
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Community Path Alerts */}
      {reports.length > 0 && (
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5">
          <h3 className="font-display text-base font-bold text-[#141F1B]">Recent Community Path Notices</h3>
          <div className="mt-3 divide-y divide-[#F0EFEA]">
            {reports.slice(0, 5).map((r) => (
              <div key={r.id} className="py-2.5 text-xs">
                <p className="font-semibold text-[#141F1B]">
                  {r.areaName} ({r.city}) · {r.issueType}
                </p>
                <p className="mt-0.5 text-[#5B6B64]">{r.description} — reported by {r.reporterName}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
