import React, { useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  useMap,
} from '@vis.gl/react-google-maps';
import { Crosshair, Flag } from 'lucide-react';
import { TRICITY_CENTER, VERIFIED_TRICITY_PLACES } from '../data/tricityPlaces';
import { getWorkoutMeta } from '../data/workouts';
import { formatDistance, formatPace } from '../lib/geo';
import { GOOGLE_MAPS_ATTRIBUTION_IDS, GOOGLE_MAPS_MAP_ID } from '../lib/mapsConfig';
import type {
  CompletedKmCheckpoint,
  GeneratedRouteCandidate,
  LatLngLiteral,
  LiveBeaconDoc,
  TricityPlace,
} from '../types/run';

interface TricityMapProps {
  routes?: GeneratedRouteCandidate[];
  selectedRouteId?: string;
  onSelectRoute?: (id: string) => void;
  startLocation?: LatLngLiteral;
  endLocation?: LatLngLiteral;
  liveTrace?: LatLngLiteral[];
  completedKmMarkers?: CompletedKmCheckpoint[];
  preferredUnit?: 'km' | 'mi';
  userPosition?: LatLngLiteral | null;
  liveFriends?: LiveBeaconDoc[];
  showVerifiedParks?: boolean;
  onSelectPark?: (park: TricityPlace) => void;
  onMapPick?: (coords: LatLngLiteral) => void;
  onMapClick?: (coords: LatLngLiteral) => void;
  pickMode?: boolean;
  measureOrigin?: LatLngLiteral | null;
  measureTarget?: LatLngLiteral | null;
  measurePath?: LatLngLiteral[];
  heightClass?: string;
  fallbackCenter?: LatLngLiteral;
  focusCenter?: LatLngLiteral;
  focusZoom?: number;
  // Navigation-mode camera props
  navigationMode?: boolean;
  followCamera?: boolean;
  navCenter?: LatLngLiteral;
  navHeading?: number;
  navTilt?: number;
  navZoom?: number;
  overviewTrigger?: number;
  onUserPan?: () => void;
  hideRecenterButton?: boolean;
}

function RouteOverlays({
  routes,
  selectedRouteId,
  liveTrace,
  measurePath,
  userPosition,
  fallbackCenter,
  focusCenter,
  focusZoom,
  navigationMode,
  followCamera,
  navCenter,
  navHeading,
  navTilt,
  navZoom,
  overviewTrigger,
  hideRecenterButton,
}: {
  routes: GeneratedRouteCandidate[];
  selectedRouteId?: string;
  liveTrace?: LatLngLiteral[];
  measurePath?: LatLngLiteral[];
  userPosition?: LatLngLiteral | null;
  fallbackCenter?: LatLngLiteral;
  focusCenter?: LatLngLiteral;
  focusZoom?: number;
  navigationMode?: boolean;
  followCamera?: boolean;
  navCenter?: LatLngLiteral;
  navHeading?: number;
  navTilt?: number;
  navZoom?: number;
  overviewTrigger?: number;
  hideRecenterButton?: boolean;
}) {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const lastRouteIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const selected = routes.find((r) => r.id === selectedRouteId) || routes[0];

    // Draw non-selected alternatives subtly underneath
    for (const r of routes) {
      if (selected && r.id === selected.id) continue;
      if (r.path.length < 2) continue;
      const altPoly = new google.maps.Polyline({
        path: r.path,
        geodesic: true,
        strokeColor: '#5B6B64',
        strokeOpacity: 0.45,
        strokeWeight: 4,
        zIndex: 1,
        map,
      });
      polylinesRef.current.push(altPoly);
    }

    // Draw intended Run Art guide if present
    if (selected?.intendedShapePath && selected.intendedShapePath.length > 1) {
      const guidePoly = new google.maps.Polyline({
        path: selected.intendedShapePath,
        geodesic: true,
        strokeOpacity: 0,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 0.55,
              strokeColor: '#30483E',
              scale: 3,
            },
            offset: '0',
            repeat: '16px',
          },
        ],
        zIndex: 2,
        map,
      });
      polylinesRef.current.push(guidePoly);
    }

    // Draw primary selected route
    if (selected && selected.path.length > 1) {
      if (navigationMode) {
        // Google Maps-style blue navigation ribbon with crisp dark border
        const borderPoly = new google.maps.Polyline({
          path: selected.path,
          geodesic: true,
          strokeColor: '#0F294A',
          strokeOpacity: 0.9,
          strokeWeight: 10,
          zIndex: 3,
          map,
        });
        const navPoly = new google.maps.Polyline({
          path: selected.path,
          geodesic: true,
          strokeColor: '#1A73E8',
          strokeOpacity: 0.96,
          strokeWeight: 6.5,
          icons: [
            {
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 2.3,
                strokeColor: '#FFFFFF',
                fillColor: '#FFFFFF',
                fillOpacity: 1,
              },
              offset: '30px',
              repeat: '95px',
            },
          ],
          zIndex: 4,
          map,
        });
        polylinesRef.current.push(borderPoly, navPoly);
      } else {
        const mainPoly = new google.maps.Polyline({
          path: selected.path,
          geodesic: true,
          strokeColor: '#172D27',
          strokeOpacity: 0.95,
          strokeWeight: 6,
          icons: [
            {
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 2.6,
                strokeColor: '#9AE62E',
                fillColor: '#9AE62E',
                fillOpacity: 1,
              },
              offset: '60px',
              repeat: '140px',
            },
          ],
          zIndex: 4,
          map,
        });
        polylinesRef.current.push(mainPoly);

        if (lastRouteIdRef.current !== selected.id) {
          lastRouteIdRef.current = selected.id;
          const bounds = new google.maps.LatLngBounds();
          selected.path.forEach((pt) => bounds.extend(pt));
          map.fitBounds(bounds, 48);
        }
      }
    }

    // Draw live GPS trace on top
    if (liveTrace && liveTrace.length > 1) {
      const tracePoly = new google.maps.Polyline({
        path: liveTrace,
        geodesic: true,
        strokeColor: '#9AE62E',
        strokeOpacity: 1,
        strokeWeight: navigationMode ? 6 : 5,
        zIndex: 6,
        map,
      });
      polylinesRef.current.push(tracePoly);
    }

    // Draw clicked-point pedestrian path overlay
    if (measurePath && measurePath.length > 1) {
      const measureCasing = new google.maps.Polyline({
        path: measurePath,
        geodesic: true,
        strokeColor: '#FFFFFF',
        strokeOpacity: 0.92,
        strokeWeight: 8,
        zIndex: 7,
        map,
      });
      const measureStroke = new google.maps.Polyline({
        path: measurePath,
        geodesic: true,
        strokeColor: '#0284C7',
        strokeOpacity: 0.96,
        strokeWeight: 5,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 2.2,
              strokeColor: '#FFFFFF',
              fillColor: '#FFFFFF',
              fillOpacity: 1,
            },
            offset: '24px',
            repeat: '85px',
          },
        ],
        zIndex: 8,
        map,
      });
      polylinesRef.current.push(measureCasing, measureStroke);
    }

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routes, selectedRouteId, liveTrace, measurePath, navigationMode]);

  // Smooth Google Maps 3D follow camera in navigation mode
  useEffect(() => {
    if (!map || !navigationMode || !followCamera || !navCenter) return;
    map.moveCamera({
      center: navCenter,
      zoom: navZoom ?? 18.2,
      tilt: navTilt ?? 45,
      heading: navHeading ?? 0,
    });
  }, [map, navigationMode, followCamera, navCenter, navZoom, navTilt, navHeading]);

  // Overview fitBounds trigger when switching out of follow mode to inspect full route
  useEffect(() => {
    if (!map || !overviewTrigger) return;
    const selected = routes.find((r) => r.id === selectedRouteId) || routes[0];
    map.moveCamera({ tilt: 0, heading: 0 });
    if (selected && selected.path.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      selected.path.forEach((pt) => bounds.extend(pt));
      if (userPosition) bounds.extend(userPosition);
      map.fitBounds(bounds, { top: 100, bottom: 190, left: 40, right: 40 });
    } else if (userPosition) {
      map.moveCamera({ center: userPosition, zoom: 16, tilt: 0, heading: 0 });
    }
  }, [map, overviewTrigger, routes, selectedRouteId, userPosition]);

  useEffect(() => {
    if (!map || navigationMode || !focusCenter) return;
    map.panTo(focusCenter);
    if (focusZoom) map.setZoom(focusZoom);
  }, [map, navigationMode, focusCenter, focusZoom]);

  const handleRecenter = () => {
    if (!map) return;
    const selected = routes.find((r) => r.id === selectedRouteId) || routes[0];
    if (userPosition) {
      map.panTo(userPosition);
      map.setZoom(17);
      return;
    }
    if (selected && selected.path.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      selected.path.forEach((pt) => bounds.extend(pt));
      map.fitBounds(bounds, 48);
      return;
    }
    map.panTo(focusCenter || fallbackCenter || TRICITY_CENTER);
    map.setZoom(focusZoom || 13);
  };

  if (hideRecenterButton) return null;

  return (
    <button
      type="button"
      onClick={handleRecenter}
      aria-label="Recenter map"
      className="absolute right-3 bottom-3 z-10 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E5E3DC] bg-white/95 px-3 text-xs font-semibold text-[#172D27] shadow-md backdrop-blur transition hover:bg-white active:scale-95"
    >
      <Crosshair className="mr-1.5 h-4 w-4 text-[#30483E]" />
      Recenter
    </button>
  );
}

export const TricityMap: React.FC<TricityMapProps> = ({
  routes = [],
  selectedRouteId,
  startLocation,
  endLocation,
  liveTrace,
  completedKmMarkers,
  preferredUnit = 'km',
  userPosition,
  liveFriends = [],
  showVerifiedParks = false,
  onSelectPark,
  onMapPick,
  onMapClick,
  pickMode = false,
  measureOrigin,
  measureTarget,
  measurePath,
  heightClass = 'h-[360px] lg:h-[520px]',
  fallbackCenter,
  focusCenter,
  focusZoom,
  navigationMode = false,
  followCamera = false,
  navCenter,
  navHeading = 0,
  navTilt = 45,
  navZoom = 18.2,
  overviewTrigger,
  onUserPan,
  hideRecenterButton = false,
}) => {
  const [mapHeading, setMapHeading] = useState(0);
  const [activeKmPin, setActiveKmPin] = useState<number | null>(null);
  const selected = routes.find((r) => r.id === selectedRouteId) || routes[0];
  const activeStart =
    selected?.start || startLocation || (liveTrace && liveTrace.length > 0 ? liveTrace[0] : undefined);
  const activeEnd =
    selected?.end ||
    endLocation ||
    (!navigationMode && liveTrace && liveTrace.length > 1
      ? liveTrace[liveTrace.length - 1]
      : undefined);
  const isLoop =
    activeStart &&
    activeEnd &&
    Math.abs(activeStart.lat - activeEnd.lat) < 0.0004 &&
    Math.abs(activeStart.lng - activeEnd.lng) < 0.0004;

  const puckPos = userPosition || (navigationMode ? navCenter || activeStart : null);
  const puckRotationDeg = ((navHeading - mapHeading) % 360 + 360) % 360;

  return (
    <div
      className={`relative w-full overflow-hidden bg-[#E8ECE8] ${
        navigationMode ? '' : 'rounded-2xl border border-[#E5E3DC]'
      } ${heightClass} ${pickMode ? 'cursor-crosshair ring-2 ring-[#9AE62E]' : ''}`}
    >
      <GoogleMap
        mapId={GOOGLE_MAPS_MAP_ID}
        defaultCenter={navCenter || focusCenter || activeStart || fallbackCenter || TRICITY_CENTER}
        defaultZoom={navigationMode ? navZoom : focusZoom || 13}
        defaultTilt={navigationMode ? navTilt : 0}
        defaultHeading={navigationMode ? navHeading : 0}
        gestureHandling="greedy"
        disableDefaultUI={navigationMode}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
        rotateControl={navigationMode}
        internalUsageAttributionIds={GOOGLE_MAPS_ATTRIBUTION_IDS}
        onDragstart={() => {
          onUserPan?.();
        }}
        onCameraChanged={(ev) => {
          if (typeof ev.detail.heading === 'number') {
            setMapHeading(ev.detail.heading);
          }
        }}
        onClick={(ev) => {
          if (!ev.detail.latLng) return;
          const coords = { lat: ev.detail.latLng.lat, lng: ev.detail.latLng.lng };
          if (pickMode && onMapPick) {
            onMapPick(coords);
          } else if (onMapClick) {
            onMapClick(coords);
          }
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <RouteOverlays
          routes={routes}
          selectedRouteId={selectedRouteId}
          liveTrace={liveTrace}
          measurePath={measurePath}
          userPosition={userPosition}
          fallbackCenter={fallbackCenter}
          focusCenter={focusCenter}
          focusZoom={focusZoom}
          navigationMode={navigationMode}
          followCamera={followCamera}
          navCenter={navCenter}
          navHeading={navHeading}
          navTilt={navTilt}
          navZoom={navZoom}
          overviewTrigger={overviewTrigger}
          hideRecenterButton={hideRecenterButton}
        />

        {activeStart && (
          <AdvancedMarker position={activeStart} title="Start location">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#172D27] text-[11px] font-bold text-[#9AE62E] shadow-md">
              {isLoop ? 'S/F' : 'S'}
            </div>
          </AdvancedMarker>
        )}

        {activeEnd && !isLoop && (
          <AdvancedMarker position={activeEnd} title="Finish location">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#30483E] text-[11px] font-bold text-white shadow-md">
              F
            </div>
          </AdvancedMarker>
        )}

        {completedKmMarkers && completedKmMarkers.length > 0
          ? completedKmMarkers.map((ck) => {
              const isSelectedPin = activeKmPin === ck.km;
              return (
                <AdvancedMarker
                  key={`completed-km-${ck.km}`}
                  position={ck.position}
                  title={
                    ck.paceSecPerKm
                      ? `${ck.km} km completed · ${formatPace(ck.paceSecPerKm, preferredUnit)}/${preferredUnit}`
                      : `${ck.km} km completed`
                  }
                  onClick={() => setActiveKmPin((prev) => (prev === ck.km ? null : ck.km))}
                >
                  <div className="relative flex flex-col items-center">
                    {isSelectedPin && ck.paceSecPerKm && (
                      <div className="mb-1 whitespace-nowrap rounded-lg border border-[#9AE62E]/60 bg-[#172D27] px-2 py-0.5 font-mono text-[10px] font-bold text-[#9AE62E] shadow-lg tabular-nums">
                        {ck.km}K Done · {formatPace(ck.paceSecPerKm, preferredUnit)}/{preferredUnit}
                      </div>
                    )}
                    <div className="flex items-center gap-1 rounded-full border-2 border-[#9AE62E] bg-[#172D27] px-2 py-0.5 font-mono text-[10px] font-extrabold text-white shadow-md tabular-nums">
                      <Flag className="h-2.5 w-2.5 fill-[#9AE62E] text-[#9AE62E]" />
                      <span>{ck.km}K</span>
                    </div>
                  </div>
                </AdvancedMarker>
              );
            })
          : selected?.kmMarkers.map((km) => (
              <AdvancedMarker
                key={`km-${km.km}`}
                position={km.position}
                title={`${km.km} km checkpoint`}
              >
                <div className="flex items-center gap-1 rounded-full border border-[#172D27] bg-white/95 px-2 py-0.5 font-mono text-[10px] font-bold text-[#172D27] shadow-sm tabular-nums">
                  <Flag className="h-2.5 w-2.5 text-[#30483E]" />
                  <span>{km.km}K</span>
                </div>
              </AdvancedMarker>
            ))}

        {measureOrigin &&
          (!activeStart ||
            Math.abs(measureOrigin.lat - activeStart.lat) > 0.00025 ||
            Math.abs(measureOrigin.lng - activeStart.lng) > 0.00025) && (
            <AdvancedMarker position={measureOrigin} title="Path origin">
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#0284C7] text-[10px] font-bold text-white shadow-md">
                A
              </div>
            </AdvancedMarker>
          )}

        {measureTarget && (
          <AdvancedMarker position={measureTarget} title="Clicked target point">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#0284C7] text-[11px] font-bold text-white shadow-lg ring-2 ring-[#0284C7]/35">
              B
            </div>
          </AdvancedMarker>
        )}

        {showVerifiedParks &&
          VERIFIED_TRICITY_PLACES.map((park) => (
            <AdvancedMarker
              key={park.id}
              position={{ lat: park.lat, lng: park.lng }}
              title={park.name}
              onClick={() => onSelectPark?.(park)}
            >
              <button
                type="button"
                className="flex h-7 items-center rounded-lg border border-[#172D27]/20 bg-white/95 px-2 text-[11px] font-semibold text-[#172D27] shadow transition hover:bg-[#B8E8C7]"
              >
                {park.name.split(' ')[0]}
              </button>
            </AdvancedMarker>
          ))}

        {puckPos && navigationMode ? (
          <AdvancedMarker position={puckPos} title="Runner navigation puck">
            <div
              className="relative flex h-12 w-12 items-center justify-center transition-transform duration-300"
              style={{ transform: `rotate(${puckRotationDeg}deg)` }}
            >
              {/* Soft directional view cone */}
              <div
                className="absolute -top-2 h-8 w-8 rounded-full opacity-35"
                style={{
                  background: 'radial-gradient(circle at 50% 80%, #1A73E8 0%, transparent 72%)',
                }}
              />
              {/* Google Maps-style navigation chevron arrow */}
              <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#172D27] shadow-lg">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#9AE62E]" fill="currentColor">
                  <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                </svg>
              </div>
            </div>
          </AdvancedMarker>
        ) : (
          userPosition && (
            <AdvancedMarker position={userPosition} title="Your live GPS position">
              <div className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute h-5 w-5 rounded-full bg-[#9AE62E]/40" />
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white bg-[#172D27] shadow" />
              </div>
            </AdvancedMarker>
          )
        )}

        {liveFriends.map((friend) => {
          const friendSport = getWorkoutMeta(friend.workoutType);
          return (
          <AdvancedMarker
            key={`live-friend-${friend.uid}`}
            position={{ lat: friend.lat, lng: friend.lng }}
            title={`${friend.displayName} (${friendSport.fullLabel}) · ${formatDistance(friend.distanceMeters, preferredUnit)}`}
          >
            <div className="flex flex-col items-center">
              <div className="mb-1 whitespace-nowrap rounded-lg border border-[#9AE62E]/70 bg-[#172D27] px-2 py-0.5 text-[10px] font-bold text-white shadow-lg">
                <span>{friend.displayName.split(' ')[0]}</span>
                <span className="mx-1 text-[#B8E8C7]/80">· {friendSport.label}</span>
                <span className="font-mono text-[#9AE62E] tabular-nums">
                  {formatDistance(friend.distanceMeters, preferredUnit)}
                </span>
              </div>
              <div className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#10B981] font-display text-[11px] font-extrabold text-white shadow-lg">
                <span className="absolute -inset-1 animate-ping rounded-full bg-[#10B981]/45" />
                {friend.photoURL ? (
                  <img
                    src={friend.photoURL}
                    alt={friend.displayName}
                    referrerPolicy="no-referrer"
                    className="relative h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span className="relative">{friend.displayName.charAt(0).toUpperCase()}</span>
                )}
              </div>
            </div>
          </AdvancedMarker>
          );
        })}
      </GoogleMap>

      {pickMode && (
        <div className="pointer-events-none absolute top-3 left-3 z-10 rounded-xl bg-[#172D27]/90 px-3 py-2 text-xs font-medium text-white shadow">
          Tap anywhere on the map to set your starting pin
        </div>
      )}
    </div>
  );
};
