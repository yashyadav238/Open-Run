import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AdvancedMarker, Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import { Globe2, Loader2, LocateFixed, ShieldCheck } from 'lucide-react';
import {
  getCityBoundaryRadiusMeters,
  WORLD_RUNNING_CITIES,
  type ActiveRunningCity,
} from '../data/worldCities';
import { destinationPoint } from '../lib/geo';
import { GOOGLE_MAPS_ATTRIBUTION_IDS, GOOGLE_MAPS_MAP_ID } from '../lib/mapsConfig';

interface WorldCityMapPickerProps {
  selectedCity: {
    name: string;
    country?: string;
    lat: number;
    lng: number;
  };
  onPickCity: (city: { name: string; lat: number; lng: number; country?: string }) => void;
  heightClass?: string;
}

const WORLD_VIEW_CENTER = { lat: 20, lng: 10 };
const WORLD_VIEW_ZOOM = 2;

const CityBoundaryRingOverlay: React.FC<{
  city: { lat: number; lng: number; name: string };
}> = ({ city }) => {
  const map = useMap();
  const ringRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps?.Polyline) return;

    if (ringRef.current) {
      ringRef.current.setMap(null);
      ringRef.current = null;
    }

    const radius = getCityBoundaryRadiusMeters(city as ActiveRunningCity);
    const pts: Array<{ lat: number; lng: number }> = [];
    for (let deg = 0; deg <= 360; deg += 10) {
      pts.push(destinationPoint(city, radius, deg % 360));
    }

    const ring = new google.maps.Polyline({
      path: pts,
      geodesic: true,
      strokeColor: '#172D27',
      strokeOpacity: 0.72,
      strokeWeight: 2,
      clickable: false,
    });
    ring.setMap(map);
    ringRef.current = ring;

    return () => {
      ring.setMap(null);
    };
  }, [map, city.lat, city.lng, city.name]);

  return null;
};

const CameraController: React.FC<{
  selectedCity: { lat: number; lng: number; name: string };
  viewMode: 'world' | 'city';
  viewTrigger: number;
}> = ({ selectedCity, viewMode, viewTrigger }) => {
  const map = useMap();

  useEffect(() => {
    if (!map || viewTrigger === 0) return;
    if (viewMode === 'world') {
      map.setCenter(WORLD_VIEW_CENTER);
      map.setZoom(WORLD_VIEW_ZOOM);
    } else {
      map.setCenter({ lat: selectedCity.lat, lng: selectedCity.lng });
      map.setZoom(11);
    }
  }, [map, viewMode, viewTrigger, selectedCity.lat, selectedCity.lng]);

  return null;
};

export const WorldCityMapPicker: React.FC<WorldCityMapPickerProps> = ({
  selectedCity,
  onPickCity,
  heightClass = 'h-[260px] sm:h-[310px]',
}) => {
  const [viewMode, setViewMode] = useState<'world' | 'city'>('world');
  const [viewTrigger, setViewTrigger] = useState(0);
  const [resolvingClick, setResolvingClick] = useState(false);
  const [clickStatus, setClickStatus] = useState<string | null>(null);

  const handleGlobeClick = useCallback(
    async (e: { detail?: { latLng?: { lat: number; lng: number } | null } }) => {
      const ll = e.detail?.latLng;
      if (!ll) return;
      const lat = ll.lat;
      const lng = ll.lng;
      setResolvingClick(true);
      setClickStatus(null);
      try {
        const res = await fetch(
          `/api/cities/resolve?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(
            String(lng)
          )}`
        );
        if (!res.ok) {
          throw new Error('Could not resolve clicked location.');
        }
        const data = (await res.json()) as {
          name?: string;
          country?: string;
          lat?: number;
          lng?: number;
        };
        const resolvedName =
          (data.name || '').trim() || `City (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
        onPickCity({
          name: resolvedName,
          country: data.country || undefined,
          lat: typeof data.lat === 'number' ? data.lat : lat,
          lng: typeof data.lng === 'number' ? data.lng : lng,
        });
        setClickStatus(
          `Selected ${resolvedName}${data.country ? `, ${data.country}` : ''} — routes locked inside city.`
        );
      } catch {
        const fallbackName = `Custom (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
        onPickCity({ name: fallbackName, lat, lng });
        setClickStatus(`Selected ${fallbackName} on the world map.`);
      } finally {
        setResolvingClick(false);
      }
    },
    [onPickCity]
  );

  const selectedMatchesPreset = WORLD_RUNNING_CITIES.some(
    (c) =>
      c.name.toLowerCase() === selectedCity.name.toLowerCase() &&
      Math.abs(c.lat - selectedCity.lat) < 0.2 &&
      Math.abs(c.lng - selectedCity.lng) < 0.2
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#172D27]">
          <Globe2 className="h-4 w-4 text-[#30483E]" />
          <span>Interactive Whole World Map</span>
          <span className="hidden text-[11px] font-normal text-[#5B6B64] sm:inline">
            · Tap any pin or click anywhere on Earth
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setViewMode('world');
              setViewTrigger((n) => n + 1);
            }}
            className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold transition ${
              viewMode === 'world'
                ? 'bg-[#172D27] text-[#9AE62E]'
                : 'border border-[#D9D7CE] bg-white text-[#141F1B] hover:bg-[#F6F5F0]'
            }`}
          >
            <Globe2 className="h-3.5 w-3.5" />
            Whole World
          </button>

          <button
            type="button"
            onClick={() => {
              setViewMode('city');
              setViewTrigger((n) => n + 1);
            }}
            className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold transition ${
              viewMode === 'city'
                ? 'bg-[#172D27] text-[#9AE62E]'
                : 'border border-[#D9D7CE] bg-white text-[#141F1B] hover:bg-[#F6F5F0]'
            }`}
          >
            <LocateFixed className="h-3.5 w-3.5" />
            Focus {selectedCity.name}
          </button>
        </div>
      </div>

      <div className={`relative w-full overflow-hidden rounded-2xl border border-[#D9D7CE] bg-[#E8ECE8] ${heightClass}`}>
        <GoogleMap
          mapId={GOOGLE_MAPS_MAP_ID}
          internalUsageAttributionIds={GOOGLE_MAPS_ATTRIBUTION_IDS}
          defaultCenter={WORLD_VIEW_CENTER}
          defaultZoom={WORLD_VIEW_ZOOM}
          minZoom={1}
          maxZoom={15}
          gestureHandling="greedy"
          streetViewControl={false}
          mapTypeControl={false}
          fullscreenControl={false}
          onClick={handleGlobeClick}
          className="h-full w-full"
        >
          <CameraController
            selectedCity={selectedCity}
            viewMode={viewMode}
            viewTrigger={viewTrigger}
          />
          <CityBoundaryRingOverlay city={selectedCity} />

          {WORLD_RUNNING_CITIES.map((preset) => {
            const isSelected =
              preset.name.toLowerCase() === selectedCity.name.toLowerCase() &&
              Math.abs(preset.lat - selectedCity.lat) < 0.25 &&
              Math.abs(preset.lng - selectedCity.lng) < 0.25;
            return (
              <AdvancedMarker
                key={preset.name}
                position={{ lat: preset.lat, lng: preset.lng }}
                title={`${preset.name}, ${preset.country}`}
                onClick={() => {
                  onPickCity({
                    name: preset.name,
                    country: preset.country,
                    lat: preset.lat,
                    lng: preset.lng,
                  });
                  setClickStatus(
                    `Selected ${preset.name}, ${preset.country} — routes locked inside city.`
                  );
                }}
              >
                <button
                  type="button"
                  aria-label={`Select ${preset.name}, ${preset.country}`}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shadow transition ${
                    isSelected
                      ? 'border-white bg-[#172D27] text-[#9AE62E] scale-110 ring-2 ring-[#9AE62E]/70'
                      : 'border-[#172D27]/25 bg-white/95 text-[#172D27] hover:bg-[#EBF5EE]'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isSelected ? 'bg-[#9AE62E]' : 'bg-[#30483E]'
                    }`}
                  />
                  <span>{preset.name}</span>
                </button>
              </AdvancedMarker>
            );
          })}

          {!selectedMatchesPreset && (
            <AdvancedMarker
              position={{ lat: selectedCity.lat, lng: selectedCity.lng }}
              title={`Selected city: ${selectedCity.name}`}
            >
              <div className="flex items-center gap-1 rounded-full border-2 border-white bg-[#172D27] px-2.5 py-0.5 text-[11px] font-bold text-[#9AE62E] shadow-lg ring-2 ring-[#9AE62E]/70">
                <span className="h-2 w-2 rounded-full bg-[#9AE62E]" />
                <span>{selectedCity.name}</span>
              </div>
            </AdvancedMarker>
          )}
        </GoogleMap>

        {resolvingClick && (
          <div className="pointer-events-none absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-xl bg-[#172D27]/95 px-3 py-1.5 text-xs font-semibold text-[#9AE62E] shadow-lg">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Identifying city...
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F6F5F0] px-3 py-2 text-[11px] text-[#30483E]">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#172D27]" />
          {clickStatus || (
            <>
              Routes stay strictly inside <strong className="text-[#172D27]">{selectedCity.name}</strong>{' '}
              (~{Math.round(getCityBoundaryRadiusMeters(selectedCity as ActiveRunningCity) / 1000)} km city zone).
            </>
          )}
        </span>
      </div>
    </div>
  );
};
