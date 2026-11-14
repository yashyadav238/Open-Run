import {
  computeKmMarkers,
  encodePolyline,
  haversineMeters,
} from '../lib/geo';
import type { PedestrianRoutingProvider } from './routingService';
import type {
  GeneratedRouteCandidate,
  LatLngLiteral,
  NamedLocation,
  RoutePreference,
  RouteStepInstruction,
} from '../types/run';

export interface PointToPointMeasureResult {
  origin: NamedLocation;
  target: LatLngLiteral;
  path: LatLngLiteral[];
  distanceMeters: number;
  directMeters: number;
  durationSec: number;
  steps: RouteStepInstruction[];
  isDirectFallback: boolean;
  providerName: string;
}

export async function computeClickedPointPath(
  provider: PedestrianRoutingProvider,
  origin: NamedLocation,
  target: LatLngLiteral,
  preferences: RoutePreference[] = ['pedestrian_paths', 'parks_greenery']
): Promise<PointToPointMeasureResult> {
  const directMeters = Math.round(haversineMeters(origin, target));

  if (directMeters < 20) {
    return {
      origin,
      target,
      path: [
        { lat: origin.lat, lng: origin.lng },
        { lat: target.lat, lng: target.lng },
      ],
      distanceMeters: directMeters,
      directMeters,
      durationSec: Math.max(1, Math.round(directMeters / 2.4)),
      steps: [],
      isDirectFallback: true,
      providerName: 'direct-line',
    };
  }

  try {
    const routed = await provider.computeWalkRoute(
      { lat: origin.lat, lng: origin.lng },
      target,
      [],
      preferences
    );
    if (routed.path.length >= 2 && routed.distanceMeters > 0) {
      return {
        origin,
        target,
        path: routed.path,
        distanceMeters: Math.round(routed.distanceMeters),
        directMeters,
        durationSec: Math.max(1, Math.round(routed.durationSec || routed.distanceMeters / 2.75)),
        steps: routed.steps || [],
        isDirectFallback: false,
        providerName: routed.providerName || 'pedestrian-router',
      };
    }
  } catch {
    // Graceful direct-line distance fallback when target is off-network or outside coverage
  }

  return {
    origin,
    target,
    path: [
      { lat: origin.lat, lng: origin.lng },
      { lat: target.lat, lng: target.lng },
    ],
    distanceMeters: directMeters,
    directMeters,
    durationSec: Math.max(1, Math.round(directMeters / 2.5)),
    steps: [
      {
        instruction: `Head directly toward selected pin (${directMeters} m straight-line)`,
        distanceMeters: directMeters,
        durationSec: Math.max(1, Math.round(directMeters / 2.5)),
        startLocation: { lat: origin.lat, lng: origin.lng },
        endLocation: target,
      },
    ],
    isDirectFallback: true,
    providerName: 'direct-line',
  };
}

export function buildRouteCandidateFromPointPath(
  res: PointToPointMeasureResult,
  preferences: RoutePreference[] = []
): GeneratedRouteCandidate {
  const endLoc: NamedLocation = {
    name: `Map Pin (${res.target.lat.toFixed(4)}, ${res.target.lng.toFixed(4)})`,
    city: res.origin.city || 'Chandigarh',
    lat: res.target.lat,
    lng: res.target.lng,
  };
  const encodedPolyline = encodePolyline(res.path);
  const kmMarkers = computeKmMarkers(res.path);

  return {
    id: `map-pin-${Date.now()}`,
    label: res.isDirectFallback ? 'Direct Path' : 'Point Path',
    name: `${res.origin.name} to Map Pin`,
    routeType: 'point_to_point',
    distanceMeters: res.distanceMeters,
    targetDistanceMeters: res.distanceMeters,
    durationSec: res.durationSec,
    elevationGainMeters: 0,
    toleranceDiffPct: 0,
    start: res.origin,
    end: endLoc,
    path: res.path,
    encodedPolyline,
    steps: res.steps,
    kmMarkers,
    surfaceSummary: res.isDirectFallback
      ? 'Straight-line distance preview (off connected pedestrian paths)'
      : 'Connected pedestrian path to clicked map point',
    characteristics: [
      res.isDirectFallback ? 'Direct Line' : 'Pedestrian Path',
      ...(preferences.includes('well_lit') ? ['Night Safe · Well-Lit Avenues'] : []),
    ],
    preferences,
    difficulty: 'moderate',
    routingProvider: res.providerName,
    geoJson: {
      type: 'Feature',
      properties: {
        name: `${res.origin.name} to Map Pin`,
        routeType: 'point_to_point',
        distanceMeters: res.distanceMeters,
        durationSec: res.durationSec,
        city: 'Chandigarh',
        routingProvider: res.providerName,
      },
      geometry: {
        type: 'LineString',
        coordinates: res.path.map((pt) => [pt.lng, pt.lat]),
      },
    },
  };
}
