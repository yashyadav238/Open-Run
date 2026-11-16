import {
  isInsideSelectedCity,
  isPathInsideSelectedCity,
  type ActiveRunningCity,
} from '../data/worldCities';
import {
  estimateDurationSecForWorkout,
  getWorkoutMeta,
  normalizeWorkoutType,
} from '../data/workouts';
import {
  analyzeRouteStraightness,
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
  WorkoutType,
} from '../types/run';

export interface PointToPointMeasureResult {
  workoutType?: WorkoutType;
  origin: NamedLocation;
  target: LatLngLiteral;
  path: LatLngLiteral[];
  distanceMeters: number;
  directMeters: number;
  durationSec: number;
  steps: RouteStepInstruction[];
  isDirectFallback: boolean;
  providerName: string;
  turnCount?: number;
  longestStraightMeters?: number;
  straightPathPct?: number;
}

export async function computeClickedPointPath(
  provider: PedestrianRoutingProvider,
  origin: NamedLocation,
  target: LatLngLiteral,
  preferences: RoutePreference[] = ['least_turns', 'pedestrian_paths', 'parks_greenery'],
  activeCity?: ActiveRunningCity,
  workoutType: WorkoutType = 'running'
): Promise<PointToPointMeasureResult> {
  const activeWorkout = normalizeWorkoutType(workoutType);
  if (activeCity) {
    if (!isInsideSelectedCity(origin, activeCity)) {
      throw new Error(`Starting pin is outside your selected Running City (${activeCity.name}).`);
    }
    if (!isInsideSelectedCity(target, activeCity)) {
      throw new Error(`Clicked pin is outside your selected Running City (${activeCity.name}).`);
    }
  }

  const directMeters = Math.round(haversineMeters(origin, target));
  const directDuration = estimateDurationSecForWorkout(directMeters, activeWorkout, 'moderate');

  if (directMeters < 20) {
    return {
      workoutType: activeWorkout,
      origin,
      target,
      path: [
        { lat: origin.lat, lng: origin.lng },
        { lat: target.lat, lng: target.lng },
      ],
      distanceMeters: directMeters,
      directMeters,
      durationSec: Math.max(1, directDuration),
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
      preferences,
      activeWorkout
    );
    if (routed.path.length >= 2 && routed.distanceMeters > 0) {
      if (activeCity && !isPathInsideSelectedCity(routed.path, activeCity)) {
        throw new Error(`Path exits your selected Running City (${activeCity.name}).`);
      }
      const straightStats = analyzeRouteStraightness(routed.path);
      return {
        workoutType: activeWorkout,
        origin,
        target,
        path: routed.path,
        distanceMeters: Math.round(routed.distanceMeters),
        directMeters,
        durationSec: Math.max(
          1,
          Math.round(
            routed.durationSec ||
              estimateDurationSecForWorkout(routed.distanceMeters, activeWorkout, 'moderate')
          )
        ),
        steps: routed.steps || [],
        isDirectFallback: false,
        providerName: routed.providerName || (activeWorkout === 'cycling' ? 'bike-router' : 'pedestrian-router'),
        turnCount: straightStats.turnCount,
        longestStraightMeters: straightStats.longestStraightMeters,
        straightPathPct: straightStats.straightPathPct,
      };
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Running City')) {
      throw err;
    }
    // Graceful direct-line distance fallback when target is off-network or outside coverage
  }

  return {
    workoutType: activeWorkout,
    origin,
    target,
    path: [
      { lat: origin.lat, lng: origin.lng },
      { lat: target.lat, lng: target.lng },
    ],
    distanceMeters: directMeters,
    directMeters,
    durationSec: Math.max(1, directDuration),
    steps: [
      {
        instruction: `Head directly toward selected pin (${directMeters} m straight-line)`,
        distanceMeters: directMeters,
        durationSec: Math.max(1, directDuration),
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
  preferences: RoutePreference[] = [],
  workoutType?: WorkoutType
): GeneratedRouteCandidate {
  const activeWorkout = normalizeWorkoutType(workoutType ?? res.workoutType);
  const meta = getWorkoutMeta(activeWorkout);
  const cityLabel = res.origin.city || 'World';
  const endLoc: NamedLocation = {
    name: `Map Pin (${res.target.lat.toFixed(4)}, ${res.target.lng.toFixed(4)})`,
    city: cityLabel,
    lat: res.target.lat,
    lng: res.target.lng,
  };
  const encodedPolyline = encodePolyline(res.path);
  const kmMarkers = computeKmMarkers(res.path);
  const durationSec = estimateDurationSecForWorkout(res.distanceMeters, activeWorkout, 'moderate');

  const straightStats = analyzeRouteStraightness(res.path);

  return {
    id: `map-pin-${Date.now()}`,
    workoutType: activeWorkout,
    label: res.isDirectFallback ? 'Direct Path' : 'Least Turns Path',
    name: `${res.origin.name} to Map Pin`,
    routeType: 'point_to_point',
    distanceMeters: res.distanceMeters,
    targetDistanceMeters: res.distanceMeters,
    durationSec,
    elevationGainMeters: 0,
    toleranceDiffPct: 0,
    turnCount: res.turnCount ?? straightStats.turnCount,
    longestStraightMeters: res.longestStraightMeters ?? straightStats.longestStraightMeters,
    straightPathPct: res.straightPathPct ?? straightStats.straightPathPct,
    start: res.origin,
    end: endLoc,
    path: res.path,
    encodedPolyline,
    steps: res.steps,
    kmMarkers,
    surfaceSummary: res.isDirectFallback
      ? `Straight-line distance preview (off connected ${meta.routingProfile === 'bicycle' ? 'bikeway' : 'pedestrian'} paths)`
      : `Least-turns ${meta.routingProfile === 'bicycle' ? 'bikeway & road' : 'pedestrian'} path to clicked map point`,
    characteristics: [
      res.isDirectFallback
        ? 'Direct Line'
        : `${straightStats.turnCount} turns · ${straightStats.straightPathPct}% straight`,
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
        workoutType: activeWorkout,
        distanceMeters: res.distanceMeters,
        durationSec,
        city: cityLabel,
        routingProvider: res.providerName,
      },
      geometry: {
        type: 'LineString',
        coordinates: res.path.map((pt) => [pt.lng, pt.lat]),
      },
    },
  };
}
