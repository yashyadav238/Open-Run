import {
  CHANDIGARH_NIGHT_LIT_NODES,
  CHANDIGARH_PARK_AND_PASS_NODES,
  CHANDIGARH_WALK_NODES,
  VERIFIED_TRICITY_PLACES,
  clampToChandigarh,
  getNightSafetyStatsForPath,
  isInsideChandigarh,
  isNightHazardOrWildlifeZone,
  isWaterOrRestrictedChandigarhPoint,
} from '../data/tricityPlaces';
import {
  clampPointToSelectedCity,
  getCityBoundaryRadiusMeters,
  isInsideSelectedCity,
  isPathInsideSelectedCity,
  type ActiveRunningCity,
} from '../data/worldCities';
import {
  analyzeRouteStraightness,
  bearingDegrees,
  buildGeoJsonLineString,
  computeKmMarkers,
  computeLeastTurnsRouteCost,
  computeMaxSegmentGapMeters,
  destinationPoint,
  encodePolyline,
  haversineMeters,
  offsetMetersToLatLng,
  type RouteStraightnessStats,
} from '../lib/geo';
import {
  estimateDurationSecForWorkout,
  getWorkoutMeta,
  normalizeWorkoutType,
} from '../data/workouts';
import type {
  ElevationAnalysisResult,
  GeneratedRouteCandidate,
  LatLngLiteral,
  NamedLocation,
  RouteDifficulty,
  RoutePreference,
  RouteStepInstruction,
  RouteType,
  WorkoutType,
} from '../types/run';

export interface RouteGenerationRequest {
  start: NamedLocation;
  end?: NamedLocation;
  activeCity?: ActiveRunningCity;
  workoutType?: WorkoutType;
  distanceKm: number;
  routeType: RouteType;
  preferences: RoutePreference[];
  difficulty: RouteDifficulty;
  tolerancePct: number;
  seedOffset?: number;
  loopCount?: number;
  nightMode?: boolean;
}

export interface PedestrianRoutingResult {
  routes: GeneratedRouteCandidate[];
  warning?: string;
}

export interface ComputeRouteOutput {
  path: LatLngLiteral[];
  distanceMeters: number;
  durationSec: number;
  steps: RouteStepInstruction[];
  providerName?: string;
}

export interface PedestrianRoutingProvider {
  computeWalkRoute(
    origin: LatLngLiteral,
    destination: LatLngLiteral,
    intermediates?: LatLngLiteral[],
    preferences?: RoutePreference[],
    workoutType?: WorkoutType
  ): Promise<ComputeRouteOutput>;
  traceArtShape?(
    shape: LatLngLiteral[],
    preferences?: RoutePreference[],
    workoutType?: WorkoutType
  ): Promise<ComputeRouteOutput>;
}

const routeMemoryCache = new globalThis.Map<string, PedestrianRoutingResult>();

function createCacheKey(req: RouteGenerationRequest): string {
  const isNight = Boolean(req.nightMode || req.preferences.includes('well_lit'));
  return JSON.stringify({
    c: req.activeCity
      ? `${req.activeCity.name}_${req.activeCity.lat.toFixed(3)}_${req.activeCity.lng.toFixed(3)}`
      : null,
    w: normalizeWorkoutType(req.workoutType),
    s: [req.start.lat.toFixed(4), req.start.lng.toFixed(4)],
    e: req.end ? [req.end.lat.toFixed(4), req.end.lng.toFixed(4)] : null,
    d: req.distanceKm,
    t: req.routeType,
    p: [...req.preferences].sort(),
    diff: req.difficulty,
    tol: req.tolerancePct,
    seed: req.seedOffset || 0,
    loops: req.loopCount || 1,
    night: isNight,
  });
}

function toLatLng(pt: unknown): LatLngLiteral | null {
  if (!pt || typeof pt !== 'object') return null;
  const anyPt = pt as {
    lat?: number | (() => number);
    lng?: number | (() => number);
    latLng?: { lat?: number | (() => number); lng?: number | (() => number) };
    location?: unknown;
  };
  if (anyPt.latLng) return toLatLng(anyPt.latLng);
  if (anyPt.location) return toLatLng(anyPt.location);
  const lat = typeof anyPt.lat === 'function' ? anyPt.lat() : anyPt.lat;
  const lng = typeof anyPt.lng === 'function' ? anyPt.lng() : anyPt.lng;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

export async function computeViaServerWalkRouter(
  origin: LatLngLiteral,
  destination: LatLngLiteral,
  intermediates: LatLngLiteral[],
  preferences: RoutePreference[] = [],
  workoutType?: WorkoutType
): Promise<ComputeRouteOutput> {
  const meta = getWorkoutMeta(workoutType);
  const travelProfile = meta.routingProfile;
  const preferLeastTurns =
    preferences.includes('least_turns') || preferences.length === 0;
  const waypoints = [origin, ...intermediates, destination];
  const res = await fetch('/api/routing/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      waypoints,
      preferences,
      preferLeastTurns,
      workoutType: meta.id,
      travelProfile,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `${meta.routingProfile === 'bicycle' ? 'Cycling' : 'Pedestrian'} routing service could not connect these waypoints.`
    );
  }
  const data = (await res.json()) as ComputeRouteOutput & { provider?: string };
  if (!data.path || data.path.length < 2) {
    throw new Error('Computed route contained insufficient geometry.');
  }
  return {
    path: data.path,
    distanceMeters: data.distanceMeters,
    durationSec: data.durationSec,
    steps: data.steps || [],
    providerName: data.provider || (travelProfile === 'bicycle' ? 'osm-bike' : 'osm-foot'),
  };
}

export function createPedestrianRoutingProvider(
  routesLib?: typeof google.maps.routes | null
): PedestrianRoutingProvider {
  return {
    async computeWalkRoute(origin, destination, intermediates = [], preferences = [], workoutType) {
      const meta = getWorkoutMeta(workoutType);
      const isBike = meta.routingProfile === 'bicycle';
      const preferLeastTurns =
        preferences.includes('least_turns') || preferences.length === 0;
      const preferParksOrNarrowPasses =
        preferLeastTurns ||
        preferences.includes('parks_greenery') ||
        preferences.includes('pedestrian_paths') ||
        preferences.includes('quieter_roads') ||
        preferences.includes('well_lit');

      if (!routesLib || preferParksOrNarrowPasses) {
        return await computeViaServerWalkRouter(
          origin,
          destination,
          intermediates,
          preferences,
          meta.id
        );
      }

      const travelModeEnum = (routesLib as unknown as {
        TravelMode?: { WALKING?: string; BICYCLING?: string };
      }).TravelMode;
      const request: Record<string, unknown> = {
        origin,
        destination,
        travelMode: isBike
          ? travelModeEnum?.BICYCLING || 'BICYCLING'
          : travelModeEnum?.WALKING || 'WALKING',
        fields: ['path', 'distanceMeters', 'durationMillis', 'legs', 'viewport'],
      };
      if (intermediates.length > 0) {
        request.intermediates = intermediates.map((pt) => ({
          location: pt,
          via: true,
        }));
      } else {
        request.computeAlternativeRoutes = true;
      }

      try {
        const response = await (routesLib.Route as unknown as {
          computeRoutes: (req: Record<string, unknown>) => Promise<{ routes?: any[] }>;
        }).computeRoutes(request);

        const rawRoutes = response.routes || [];
        if (rawRoutes.length === 0) {
          return await computeViaServerWalkRouter(
            origin,
            destination,
            intermediates,
            preferences,
            meta.id
          );
        }

        const parsedGoogleRoutes: ComputeRouteOutput[] = [];
        for (const route of rawRoutes) {
          let rawPath: LatLngLiteral[] = (route.path || [])
            .map((pt: unknown) => toLatLng(pt))
            .filter((pt: LatLngLiteral | null): pt is LatLngLiteral => pt !== null);

          const steps: RouteStepInstruction[] = [];
          const legStepPath: LatLngLiteral[] = [];

          for (const leg of route.legs || []) {
            for (const step of leg.steps || []) {
              const inst =
                step.navigationInstruction?.instructions ||
                step.instructions ||
                (isBike ? 'Continue along bike route' : 'Continue along pedestrian path');
              const stepPoints: LatLngLiteral[] = (step.path || [])
                .map((pt: unknown) => toLatLng(pt))
                .filter((pt: LatLngLiteral | null): pt is LatLngLiteral => pt !== null);

              if (stepPoints.length > 0) {
                legStepPath.push(...stepPoints);
              }

              const startLoc = toLatLng(step.startLocation) || stepPoints[0];
              const endLoc = toLatLng(step.endLocation) || stepPoints[stepPoints.length - 1];

              steps.push({
                instruction: String(inst).replace(/<[^>]+>/g, ''),
                distanceMeters: step.distanceMeters ?? 0,
                durationSec: step.staticDurationMillis ? Math.round(step.staticDurationMillis / 1000) : 0,
                maneuver: step.navigationInstruction?.maneuver,
                startLocation: startLoc || undefined,
                endLocation: endLoc || undefined,
              });
            }
          }

          if (rawPath.length < 2 && legStepPath.length >= 2) {
            rawPath = legStepPath;
          }
          if (rawPath.length < 2) continue;

          const distanceMeters = route.distanceMeters ?? computePathLength(rawPath);
          if (!validatePedestrianRouteGeometry(rawPath, distanceMeters)) continue;

          const durationSec = route.durationMillis
            ? Math.round(route.durationMillis / 1000)
            : estimateDurationSecForWorkout(distanceMeters, meta.id, 'moderate');

          parsedGoogleRoutes.push({
            path: rawPath,
            distanceMeters,
            durationSec,
            steps,
            providerName: 'google-routes',
          });
        }

        if (parsedGoogleRoutes.length === 0) {
          return await computeViaServerWalkRouter(
            origin,
            destination,
            intermediates,
            preferences,
            meta.id
          );
        }

        if (parsedGoogleRoutes.length === 1) {
          return parsedGoogleRoutes[0];
        }

        const baselineDist = Math.min(...parsedGoogleRoutes.map((r) => r.distanceMeters));
        return [...parsedGoogleRoutes].sort((a, b) => {
          const sa = analyzeRouteStraightness(a.path);
          const sb = analyzeRouteStraightness(b.path);
          return (
            computeLeastTurnsRouteCost(sa, a.distanceMeters, baselineDist) -
            computeLeastTurnsRouteCost(sb, b.distanceMeters, baselineDist)
          );
        })[0];
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('Quota') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        return await computeViaServerWalkRouter(
          origin,
          destination,
          intermediates,
          preferences,
          meta.id
        );
      }
    },
    async traceArtShape(
      shape: LatLngLiteral[],
      preferences: RoutePreference[] = [],
      workoutType?: WorkoutType
    ): Promise<ComputeRouteOutput> {
      const meta = getWorkoutMeta(workoutType);
      const res = await fetch('/api/routing/trace-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shape,
          preferences,
          workoutType: meta.id,
          travelProfile: meta.routingProfile,
        }),
      });
      if (!res.ok) {
        throw new Error(`Unable to map-match ${meta.artNamePrefix} curve onto nearby paths.`);
      }
      const data = (await res.json()) as ComputeRouteOutput & { provider?: string };
      if (!data.path || data.path.length < 4) {
        throw new Error(`Map-matched ${meta.artNamePrefix} path contained insufficient geometry.`);
      }
      return {
        path: data.path,
        distanceMeters: data.distanceMeters,
        durationSec: data.durationSec,
        steps: data.steps || [],
        providerName: data.provider || 'valhalla-hmm-art',
      };
    },
  };
}

// Backwards-compatible alias
export const createGoogleRoutesProvider = createPedestrianRoutingProvider;

export function computePathLength(path: LatLngLiteral[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1], path[i]);
  }
  return Math.round(total);
}

export function validatePedestrianRouteGeometry(path: LatLngLiteral[], distanceMeters: number): boolean {
  if (path.length < 2 || distanceMeters < 150) return false;
  // Long avenues span 200-800m between intersections; reject only broken >1500m jumps
  if (computeMaxSegmentGapMeters(path) > 1500) return false;
  const geomLen = computePathLength(path);
  if (Math.abs(geomLen - distanceMeters) > Math.max(600, distanceMeters * 0.45)) return false;
  return true;
}

function computeLoopOverlapRatio(path: LatLngLiteral[]): number {
  if (path.length < 12) return 0;
  const targetSamples = 56;
  const step = Math.max(1, Math.floor(path.length / targetSamples));
  const pts = path.filter((_, idx) => idx % step === 0);
  if (pts.length < 10) return 0;

  const firstHalfEnd = Math.floor(pts.length * 0.45);
  const secondHalfStart = Math.ceil(pts.length * 0.55);
  const secondHalfEnd = Math.floor(pts.length * 0.9);
  if (secondHalfEnd <= secondHalfStart || firstHalfEnd < 3) return 0;

  let overlapped = 0;
  let checked = 0;
  for (let i = secondHalfStart; i < secondHalfEnd; i++) {
    checked += 1;
    const p = pts[i];
    let minD = Infinity;
    for (let j = Math.floor(pts.length * 0.1); j < firstHalfEnd; j++) {
      const d = haversineMeters(p, pts[j]);
      if (d < minD) minD = d;
    }
    if (minD < 42) overlapped += 1;
  }
  return checked > 0 ? overlapped / checked : 0;
}

function computeGreenProximityScore(path: LatLngLiteral[]): number {
  if (path.length === 0) return 0;
  let hits = 0;
  const sampleStep = Math.max(1, Math.floor(path.length / 26));
  for (let i = 0; i < path.length; i += sampleStep) {
    const pt = path[i];
    if (CHANDIGARH_PARK_AND_PASS_NODES.some((n) => haversineMeters(pt, n) < 260)) {
      hits += 2;
      continue;
    }
    for (const park of VERIFIED_TRICITY_PLACES) {
      if (haversineMeters(pt, { lat: park.lat, lng: park.lng }) < 650) {
        hits += 1;
        break;
      }
    }
  }
  return hits;
}

function sanitizeRouteWaypoint(
  pt: LatLngLiteral,
  start: LatLngLiteral,
  nightMode = false,
  inChandigarh = isInsideChandigarh(start),
  activeCity?: ActiveRunningCity
): LatLngLiteral {
  if (!inChandigarh) {
    return activeCity ? clampPointToSelectedCity(pt, activeCity) : pt;
  }
  let candidate = clampToChandigarh(pt);
  if (
    isWaterOrRestrictedChandigarhPoint(candidate) ||
    (nightMode && isNightHazardOrWildlifeZone(candidate).avoided)
  ) {
    if (nightMode) {
      // Steer straight to the nearest well-lit urban sector hub away from wildlife/unlit corridors
      const safeLitHub = [...CHANDIGARH_NIGHT_LIT_NODES].sort(
        (a, b) => haversineMeters(candidate, a) - haversineMeters(candidate, b)
      )[0];
      if (safeLitHub) {
        return { lat: safeLitHub.lat, lng: safeLitHub.lng };
      }
    }
    const bearingFromLake = bearingDegrees({ lat: 30.742, lng: 76.826 }, start);
    const dist = Math.max(400, haversineMeters(start, pt));
    candidate = clampToChandigarh(destinationPoint(start, dist * 0.85, (bearingFromLake + 25) % 360));
    if (isWaterOrRestrictedChandigarhPoint(candidate)) {
      candidate = clampToChandigarh(destinationPoint(start, dist * 0.8, 225));
    }
  }

  const pool = nightMode ? CHANDIGARH_NIGHT_LIT_NODES : CHANDIGARH_WALK_NODES;
  let bestNode: LatLngLiteral | null = null;
  let bestDist = nightMode ? 480 : 300;
  for (const node of pool) {
    const d = haversineMeters(candidate, node);
    if (d < bestDist) {
      bestDist = d;
      bestNode = { lat: node.lat, lng: node.lng };
    }
  }
  return bestNode || candidate;
}

/**
 * Repeats a closed/out-and-back Chandigarh lap `loopCount` times cleanly in geometry & turn instructions.
 */
export function repeatRouteLaps(
  lapPath: LatLngLiteral[],
  lapSteps: RouteStepInstruction[],
  lapDistanceMeters: number,
  lapDurationSec: number,
  loopCount: number
): {
  path: LatLngLiteral[];
  steps: RouteStepInstruction[];
  distanceMeters: number;
  durationSec: number;
} {
  const safeLoops = Math.max(1, Math.min(8, Math.round(loopCount)));
  if (safeLoops === 1 || lapPath.length < 2) {
    return {
      path: lapPath,
      steps: lapSteps,
      distanceMeters: lapDistanceMeters,
      durationSec: lapDurationSec,
    };
  }

  const fullPath: LatLngLiteral[] = [...lapPath];
  for (let lap = 2; lap <= safeLoops; lap++) {
    // Ensure seamless closure if lap end is slightly offset from lap start before repeating
    const tail = fullPath[fullPath.length - 1];
    const head = lapPath[0];
    if (haversineMeters(tail, head) > 20) {
      fullPath.push(head);
    }
    fullPath.push(...lapPath.slice(1));
  }

  const repeatedSteps: RouteStepInstruction[] = [];
  for (let lap = 1; lap <= safeLoops; lap++) {
    lapSteps.forEach((st, idx) => {
      repeatedSteps.push({
        ...st,
        instruction:
          idx === 0
            ? `Lap ${lap} of ${safeLoops}: ${st.instruction}`
            : st.instruction,
      });
    });
  }

  return {
    path: fullPath,
    steps: repeatedSteps,
    distanceMeters: lapDistanceMeters * safeLoops,
    durationSec: lapDurationSec * safeLoops,
  };
}

function buildSectorGridLoopWaypoints(
  start: LatLngLiteral,
  targetMeters: number,
  sectorBearingDeg: number,
  clockwise: boolean,
  nightMode = false,
  inChandigarh = isInsideChandigarh(start),
  activeCity?: ActiveRunningCity,
  elongatedRatio = 1.0
): LatLngLiteral[] {
  // Perimeter = 2*(L + W); when elongatedRatio > 1, creates 2 ultra-long straight legs & 4 crisp turns
  const halfPerimeter = Math.max(320, targetMeters / (2 * 1.14));
  const lengthLeg = (halfPerimeter * elongatedRatio) / (1 + elongatedRatio);
  const widthLeg = halfPerimeter - lengthLeg;
  const sign = clockwise ? 1 : -1;

  const wp1 = sanitizeRouteWaypoint(
    destinationPoint(start, lengthLeg, sectorBearingDeg),
    start,
    nightMode,
    inChandigarh,
    activeCity
  );
  const wp2 = sanitizeRouteWaypoint(
    destinationPoint(wp1, widthLeg, (sectorBearingDeg + sign * 90 + 360) % 360),
    start,
    nightMode,
    inChandigarh,
    activeCity
  );
  const wp3 = sanitizeRouteWaypoint(
    destinationPoint(start, widthLeg, (sectorBearingDeg + sign * 90 + 360) % 360),
    start,
    nightMode,
    inChandigarh,
    activeCity
  );
  return [wp1, wp2, wp3];
}

function buildStraightCorridorCorners(
  start: LatLngLiteral,
  end: LatLngLiteral,
  gridAngleDeg: number,
  nightMode: boolean,
  inChandigarh: boolean,
  activeCity?: ActiveRunningCity
): LatLngLiteral[] {
  const cosLat = Math.cos((start.lat * Math.PI) / 180);
  const eastMeters = (end.lng - start.lng) * 111320 * cosLat;
  const northMeters = (end.lat - start.lat) * 111320;
  const rad = (gridAngleDeg * Math.PI) / 180;
  // Project (east, north) onto orthogonal grid axis u = (sin(a), cos(a)) and v = (cos(a), -sin(a))
  const ux = Math.sin(rad);
  const uy = Math.cos(rad);
  const vx = Math.cos(rad);
  const vy = -Math.sin(rad);
  const projU = eastMeters * ux + northMeters * uy;
  const projV = eastMeters * vx + northMeters * vy;

  const rawA = offsetMetersToLatLng(start, projU * ux, projU * uy);
  const rawB = offsetMetersToLatLng(start, projV * vx, projV * vy);
  return [
    sanitizeRouteWaypoint(rawA, start, nightMode, inChandigarh, activeCity),
    sanitizeRouteWaypoint(rawB, start, nightMode, inChandigarh, activeCity),
  ];
}

function buildNightLitLoopWaypoints(
  start: LatLngLiteral,
  targetMeters: number,
  clockwise = true
): LatLngLiteral[] | null {
  const minDist = Math.max(220, targetMeters * 0.12);
  const maxDist = Math.max(1150, targetMeters * 0.48);
  const idealLeg = targetMeters / 3.35;

  const nearby = CHANDIGARH_NIGHT_LIT_NODES.filter(
    (n) => !isNightHazardOrWildlifeZone(n).avoided
  )
    .map((n) => ({
      node: { lat: n.lat, lng: n.lng },
      dist: haversineMeters(start, n),
      bearing: bearingDegrees(start, n),
    }))
    .filter((c) => c.dist >= minDist && c.dist <= maxDist)
    .sort((a, b) => Math.abs(a.dist - idealLeg) - Math.abs(b.dist - idealLeg));

  if (nearby.length < 2) return null;

  const wp1 = nearby[0];
  const wp2 = nearby.find((c) => {
    const diff = (c.bearing - wp1.bearing + 360) % 360;
    const orientedDiff = clockwise ? diff : 360 - diff;
    return orientedDiff >= 42 && orientedDiff <= 155 && haversineMeters(c.node, wp1.node) > 260;
  });
  if (!wp2) return null;

  const wp3 = nearby.find((c) => {
    const diff = (c.bearing - wp2.bearing + 360) % 360;
    const orientedDiff = clockwise ? diff : 360 - diff;
    return (
      orientedDiff >= 40 &&
      orientedDiff <= 155 &&
      haversineMeters(c.node, wp1.node) > 260 &&
      haversineMeters(c.node, wp2.node) > 260
    );
  });

  return wp3 ? [wp1.node, wp2.node, wp3.node] : [wp1.node, wp2.node];
}

function buildParkAndPassLoopWaypoints(
  start: LatLngLiteral,
  targetMeters: number,
  clockwise = true
): LatLngLiteral[] | null {
  const minDist = Math.max(180, targetMeters * 0.11);
  const maxDist = Math.max(950, targetMeters * 0.44);
  const idealLeg = targetMeters / 3.4;

  const nearby = CHANDIGARH_PARK_AND_PASS_NODES.map((n) => ({
    node: { lat: n.lat, lng: n.lng },
    dist: haversineMeters(start, n),
    bearing: bearingDegrees(start, n),
  }))
    .filter((c) => c.dist >= minDist && c.dist <= maxDist)
    .sort((a, b) => Math.abs(a.dist - idealLeg) - Math.abs(b.dist - idealLeg));

  if (nearby.length < 2) return null;

  const wp1 = nearby[0];
  const wp2 = nearby.find((c) => {
    const diff = ((c.bearing - wp1.bearing + 360) % 360);
    const orientedDiff = clockwise ? diff : 360 - diff;
    return orientedDiff >= 40 && orientedDiff <= 150 && haversineMeters(c.node, wp1.node) > 220;
  });
  if (!wp2) return null;

  const wp3 = nearby.find((c) => {
    const diff = ((c.bearing - wp2.bearing + 360) % 360);
    const orientedDiff = clockwise ? diff : 360 - diff;
    return (
      orientedDiff >= 38 &&
      orientedDiff <= 155 &&
      haversineMeters(c.node, wp1.node) > 220 &&
      haversineMeters(c.node, wp2.node) > 220
    );
  });

  return wp3 ? [wp1.node, wp2.node, wp3.node] : [wp1.node, wp2.node];
}

function findBestChandigarhWalkLoop(start: LatLngLiteral, targetMeters: number): LatLngLiteral[] | null {
  const idealLeg = targetMeters / 3.4;
  const candidates = CHANDIGARH_WALK_NODES.map((n) => ({
    node: { lat: n.lat, lng: n.lng },
    dist: haversineMeters(start, n),
    bearing: bearingDegrees(start, n),
  })).filter((c) => c.dist >= Math.max(250, idealLeg * 0.45) && c.dist <= Math.max(900, idealLeg * 1.65));

  if (candidates.length < 3) return null;

  candidates.sort((a, b) => Math.abs(a.dist - idealLeg) - Math.abs(b.dist - idealLeg));
  const wp1 = candidates[0];
  const wp2 = candidates.find((c) => {
    const angleDiff = Math.abs(((c.bearing - wp1.bearing + 540) % 360) - 180);
    return angleDiff >= 38 && angleDiff <= 115 && haversineMeters(c.node, wp1.node) > 320;
  });
  if (!wp2) return null;

  const wp3 = candidates.find((c) => {
    const d1 = haversineMeters(c.node, wp1.node);
    const d2 = haversineMeters(c.node, wp2.node);
    return d1 > 320 && d2 > 320 && c.node.lat !== wp1.node.lat && c.node.lat !== wp2.node.lat;
  });

  return wp3 ? [wp1.node, wp2.node, wp3.node] : [wp1.node, wp2.node];
}

export async function fetchDetailedElevation(
  path: LatLngLiteral[],
  altitudes?: Array<number | null>,
  timeoutMs = 4500
): Promise<ElevationAnalysisResult> {
  const unavailable: ElevationAnalysisResult = {
    available: false,
    elevationGainMeters: null,
    elevationLossMeters: null,
    minElevationMeters: null,
    maxElevationMeters: null,
  };
  if (!Array.isArray(path) || path.length < 2) {
    return unavailable;
  }

  try {
    const MAX_SAMPLES = 48;
    const sampledPoints: LatLngLiteral[] = [];
    const sampledAltitudes: Array<number | null> = [];
    const hasAlignedAltitudes = Array.isArray(altitudes) && altitudes.length === path.length;

    if (path.length <= MAX_SAMPLES) {
      for (let i = 0; i < path.length; i++) {
        sampledPoints.push(path[i]);
        if (hasAlignedAltitudes) sampledAltitudes.push(altitudes![i]);
      }
    } else {
      let lastIdx = -1;
      for (let i = 0; i < MAX_SAMPLES; i++) {
        const idx = Math.round((i * (path.length - 1)) / (MAX_SAMPLES - 1));
        if (idx !== lastIdx) {
          sampledPoints.push(path[idx]);
          if (hasAlignedAltitudes) sampledAltitudes.push(altitudes![idx]);
          lastIdx = idx;
        }
      }
    }

    const bodyPayload: Record<string, unknown> = { points: sampledPoints };
    if (hasAlignedAltitudes && sampledAltitudes.length === sampledPoints.length) {
      bodyPayload.altitudes = sampledAltitudes;
    }

    const res = await fetch('/api/elevation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return unavailable;
    const data = (await res.json()) as ElevationAnalysisResult;
    if (!data?.available) return unavailable;
    return {
      available: true,
      provider: data.provider,
      elevationGainMeters: data.elevationGainMeters ?? 0,
      elevationLossMeters: data.elevationLossMeters ?? 0,
      minElevationMeters: data.minElevationMeters ?? 0,
      maxElevationMeters: data.maxElevationMeters ?? 0,
      avgGradePct: data.avgGradePct ?? 0,
      profile: Array.isArray(data.profile) ? data.profile : [],
    };
  } catch {
    return unavailable;
  }
}

export async function fetchOptionalElevation(path: LatLngLiteral[]): Promise<number | null> {
  const res = await fetchDetailedElevation(path, undefined, 3200);
  return res.available ? res.elevationGainMeters : null;
}

function buildCharacteristics(
  req: RouteGenerationRequest,
  label: string,
  overlapRatio: number,
  straightness?: RouteStraightnessStats
): string[] {
  const isNightMode = Boolean(req.nightMode || req.preferences.includes('well_lit'));
  const isBike = getWorkoutMeta(req.workoutType).routingProfile === 'bicycle';
  const chars: string[] = [];
  if (isNightMode) {
    chars.push('Night Safe · Well-Lit Avenues');
    chars.push('Avoids Wildlife & Deserted Zones');
  }
  if (straightness) {
    const longestTxt =
      straightness.longestStraightMeters >= 1000
        ? `${(straightness.longestStraightMeters / 1000).toFixed(1)} km straight`
        : `${straightness.longestStraightMeters} m straight`;
    chars.push(`${straightness.turnCount} turns · max ${longestTxt}`);
  }
  if (overlapRatio < 0.18 && req.routeType === 'circular') chars.push('Clean no-backtrack loop');
  if (!isNightMode && (label === 'Scenic' || req.preferences.includes('parks_greenery'))) {
    chars.push(isBike ? 'Greenways & parks priority' : 'Parks & greenery priority');
  }
  if (!isNightMode && req.preferences.includes('pedestrian_paths')) {
    chars.push(isBike ? 'Dedicated bikeways' : 'Pedestrian footpaths');
  }
  if (req.preferences.includes('quieter_roads')) chars.push('Quiet sector avenues');
  if (req.preferences.includes('avoid_stairs')) chars.push(isBike ? 'Step-free bikeable' : 'Step-free bias');
  if (req.preferences.includes('avoid_restricted')) chars.push('Public paths only');
  if (req.preferences.includes('fewer_crossings')) chars.push(isBike ? 'Continuous bike corridors' : 'Continuous walkways');
  if (req.routeType === 'out_and_back') chars.push('Mirrored straight corridor');
  if (chars.length === 0) chars.push(isBike ? 'Bicycle road & path network' : 'Pedestrian network');
  return chars.slice(0, 3);
}

function finalizeCandidate(params: {
  id: string;
  label: string;
  name: string;
  routeType: RouteType;
  distanceMeters: number;
  targetDistanceMeters: number;
  start: NamedLocation;
  end: NamedLocation;
  path: LatLngLiteral[];
  steps: RouteStepInstruction[];
  surfaceSummary: string;
  routingProvider?: string;
  req: RouteGenerationRequest;
  overlapRatio: number;
  loopCount?: number;
  straightness?: RouteStraightnessStats;
}): GeneratedRouteCandidate {
  const workoutType = normalizeWorkoutType(params.req.workoutType);
  const durationSec = estimateDurationSecForWorkout(
    params.distanceMeters,
    workoutType,
    params.req.difficulty
  );
  const diffPct =
    params.targetDistanceMeters > 0
      ? Math.round((Math.abs(params.distanceMeters - params.targetDistanceMeters) / params.targetDistanceMeters) * 100)
      : 0;
  const loops = params.loopCount && params.loopCount > 1 ? params.loopCount : undefined;
  const straightness = params.straightness || analyzeRouteStraightness(params.path);
  const chars = buildCharacteristics(params.req, params.label, params.overlapRatio, straightness);
  if (loops) {
    chars.unshift(`${loops}× Laps`);
  }
  const routeCity = params.start.city || (isInsideChandigarh(params.start) ? 'Chandigarh' : 'World');

  return {
    id: params.id,
    label: params.label,
    name: params.name,
    workoutType,
    routeType: params.routeType,
    distanceMeters: params.distanceMeters,
    targetDistanceMeters: params.targetDistanceMeters,
    durationSec,
    elevationGainMeters: null,
    start: params.start,
    end: params.end,
    encodedPolyline: encodePolyline(params.path),
    path: params.path,
    geoJson: buildGeoJsonLineString(params.path, {
      name: params.name,
      routeType: params.routeType,
      workoutType,
      distanceMeters: params.distanceMeters,
      durationSec,
      city: routeCity,
      routingProvider: params.routingProvider,
    }),
    steps: params.steps,
    kmMarkers: computeKmMarkers(params.path),
    characteristics: chars.slice(0, 3),
    surfaceSummary: params.surfaceSummary,
    routingProvider: params.routingProvider,
    preferences: params.req.preferences,
    difficulty: params.req.difficulty,
    toleranceDiffPct: diffPct,
    turnCount: straightness.turnCount,
    longestStraightMeters: straightness.longestStraightMeters,
    straightPathPct: straightness.straightPathPct,
    loopCount: loops,
  };
}

export async function generatePedestrianRoutes(
  provider: PedestrianRoutingProvider,
  req: RouteGenerationRequest
): Promise<PedestrianRoutingResult> {
  if (req.activeCity && !isInsideSelectedCity(req.start, req.activeCity)) {
    throw new Error(
      `Start location "${req.start.name}" is outside your selected Running City (${req.activeCity.name}). Choose a starting point inside ${req.activeCity.name} or change Running City in Profile.`
    );
  }
  if (req.routeType === 'point_to_point' && req.end && req.activeCity && !isInsideSelectedCity(req.end, req.activeCity)) {
    throw new Error(
      `Destination "${req.end.name}" is outside your selected Running City (${req.activeCity.name}). Pick a destination inside ${req.activeCity.name}.`
    );
  }

  const inChandigarh = isInsideChandigarh(req.start);
  const cityLabel = req.activeCity?.name || req.start.city || (inChandigarh ? 'Chandigarh' : 'Local');

  const cacheKey = createCacheKey(req);
  const cached = routeMemoryCache.get(cacheKey);
  if (cached) return cached;

  const isNightMode = Boolean(req.nightMode || req.preferences.includes('well_lit'));
  const effectivePrefs: RoutePreference[] = isNightMode
    ? Array.from(new Set([...req.preferences.filter((p) => p !== 'parks_greenery'), 'well_lit']))
    : req.preferences;
  const effectiveReq: RouteGenerationRequest = {
    ...req,
    preferences: effectivePrefs,
    nightMode: isNightMode,
  };

  const targetMeters = Math.max(500, Math.round(req.distanceKm * 1000));
  const requestedLoops = Math.max(1, Math.min(8, Math.round(req.loopCount || 1)));
  const seedRot = ((req.seedOffset || 0) * 45) % 360;
  const candidates: GeneratedRouteCandidate[] = [];
  let effectiveLoopCount = requestedLoops;

  const workoutType = normalizeWorkoutType(req.workoutType);
  const workoutMeta = getWorkoutMeta(workoutType);
  const isBike = workoutMeta.routingProfile === 'bicycle';

  const preferLeastTurns =
    effectivePrefs.includes('least_turns') || effectivePrefs.length === 0;

  if (req.routeType === 'point_to_point') {
    if (!req.end) {
      throw new Error('Please choose a destination for point-to-point routing.');
    }
    const directCrowMeters = haversineMeters(req.start, req.end);
    const p2pConfigs: Array<{ intermediates: LatLngLiteral[]; tag: string }> = [
      { intermediates: [], tag: 'Direct Straight-Optimized' },
    ];
    if (preferLeastTurns && directCrowMeters >= 350) {
      const gridAngle = inChandigarh ? 34 : 0;
      const corners = buildStraightCorridorCorners(
        req.start,
        req.end,
        gridAngle,
        isNightMode,
        inChandigarh,
        req.activeCity
      );
      for (const [idx, c] of corners.entries()) {
        if (
          haversineMeters(req.start, c) > 120 &&
          haversineMeters(c, req.end) > 120 &&
          (!req.activeCity || isInsideSelectedCity(c, req.activeCity))
        ) {
          p2pConfigs.push({
            intermediates: [c],
            tag: idx === 0 ? 'Straight Corridor A' : 'Straight Corridor B',
          });
        }
      }
    }

    const p2pSettled = await Promise.allSettled(
      p2pConfigs.map(async (cfg) => {
        const res = await provider.computeWalkRoute(
          req.start,
          req.end!,
          cfg.intermediates,
          effectivePrefs,
          workoutType
        );
        if (!validatePedestrianRouteGeometry(res.path, res.distanceMeters)) {
          throw new Error(`Invalid geometry for ${cfg.tag}`);
        }
        if (req.activeCity && !isPathInsideSelectedCity(res.path, req.activeCity)) {
          throw new Error(`Path exits ${req.activeCity.name}`);
        }
        return {
          ...res,
          tag: cfg.tag,
          straightness: analyzeRouteStraightness(res.path),
        };
      })
    );

    const validP2p = p2pSettled
      .filter(
        (r): r is PromiseFulfilledResult<ComputeRouteOutput & { tag: string; straightness: RouteStraightnessStats }> =>
          r.status === 'fulfilled'
      )
      .map((r) => r.value);

    if (validP2p.length === 0) {
      throw new Error(
        req.activeCity
          ? `No continuous ${isBike ? 'cycling' : 'pedestrian'} connection found inside ${req.activeCity.name} between these two points.`
          : `No continuous ${isBike ? 'cycling' : 'pedestrian'} connection found between these two points.`
      );
    }

    const minP2pDist = Math.min(...validP2p.map((r) => r.distanceMeters));
    const filteredP2p = validP2p.filter((r) => r.distanceMeters <= minP2pDist * 1.48);
    const rankedP2p = (filteredP2p.length > 0 ? filteredP2p : validP2p).sort((a, b) => {
      if (preferLeastTurns) {
        return (
          computeLeastTurnsRouteCost(a.straightness, a.distanceMeters, minP2pDist) -
          computeLeastTurnsRouteCost(b.straightness, b.distanceMeters, minP2pDist)
        );
      }
      return a.distanceMeters - b.distanceMeters;
    });

    const dedupedP2p: typeof rankedP2p = [];
    for (const item of rankedP2p) {
      const dup = dedupedP2p.some(
        (ex) =>
          Math.abs(ex.distanceMeters - item.distanceMeters) < 40 &&
          ex.straightness.turnCount === item.straightness.turnCount &&
          ex.path.length > 2 &&
          item.path.length > 2 &&
          haversineMeters(
            ex.path[Math.floor(ex.path.length / 2)],
            item.path[Math.floor(item.path.length / 2)]
          ) < 80
      );
      if (!dup) dedupedP2p.push(item);
      if (dedupedP2p.length >= 3) break;
    }

    const p2pLabels = isNightMode
      ? ['Night Safe · Least Turns', 'Well-Lit Corridor', 'Alternative']
      : preferLeastTurns
      ? ['Least Turns', 'Straight Corridor', 'Alternative']
      : ['Best Match', 'Straight Corridor', 'Alternative'];

    dedupedP2p.forEach((item, idx) => {
      candidates.push(
        finalizeCandidate({
          id: `p2p-${idx}-${Date.now()}`,
          label: p2pLabels[idx] || 'Alternative',
          name: `${req.start.name} to ${req.end!.name}${idx > 0 ? ` (${item.straightness.turnCount} turns)` : ''}`,
          routeType: 'point_to_point',
          distanceMeters: item.distanceMeters,
          targetDistanceMeters: targetMeters,
          start: req.start,
          end: req.end!,
          path: item.path,
          steps: item.steps,
          surfaceSummary: isNightMode
            ? `Well-lit ${cityLabel} avenues & active ${isBike ? 'bikeways' : 'sidewalks'}`
            : preferLeastTurns
            ? `${cityLabel} straight ${isBike ? 'bikeways & boulevards' : 'avenues & minimal-turn paths'}`
            : `${cityLabel} ${isBike ? 'bikeways & quiet sector roads' : 'pedestrian walkways & crossings'}`,
          routingProvider: item.providerName,
          req: effectiveReq,
          overlapRatio: 0,
          straightness: item.straightness,
        })
      );
    });
  } else if (req.routeType === 'out_and_back') {
    const attemptOabPass = async (loopsToRun: number) => {
      const nearLake = inChandigarh && req.start.lng > 76.808;
      const baseBearings = inChandigarh
        ? nearLake
          ? [214, 304, 259, 169, 124]
          : [34, 124, 214, 304, 79, 259]
        : [0, 90, 180, 270, 45, 225];
      const bearings = baseBearings.map((b) => (b + seedRot) % 360);
      const lapTarget = Math.max(500, Math.round(targetMeters / loopsToRun));
      const halfTarget = lapTarget / 2;
      const maxCityLeg = req.activeCity ? getCityBoundaryRadiusMeters(req.activeCity) * 0.65 : Infinity;

      const preferParksOrPasses =
        !isNightMode &&
        (effectivePrefs.includes('parks_greenery') || effectivePrefs.includes('pedestrian_paths'));
      const nightLitTurnaround =
        inChandigarh && isNightMode
          ? CHANDIGARH_NIGHT_LIT_NODES.filter((n) => !isNightHazardOrWildlifeZone(n).avoided)
              .map((n) => ({
                node: { lat: n.lat, lng: n.lng },
                dist: haversineMeters(req.start, n),
              }))
              .filter((c) => c.dist >= Math.max(250, halfTarget * 0.45) && c.dist <= Math.max(950, halfTarget * 1.45))
              .sort((a, b) => Math.abs(a.dist - halfTarget) - Math.abs(b.dist - halfTarget))[0]?.node || null
          : null;
      const parkPassTurnaround =
        inChandigarh && preferParksOrPasses && !preferLeastTurns
          ? CHANDIGARH_PARK_AND_PASS_NODES.map((n) => ({
              node: { lat: n.lat, lng: n.lng },
              dist: haversineMeters(req.start, n),
            }))
              .filter((c) => c.dist >= Math.max(220, halfTarget * 0.48) && c.dist <= Math.max(850, halfTarget * 1.45))
              .sort((a, b) => Math.abs(a.dist - halfTarget) - Math.abs(b.dist - halfTarget))[0]?.node || null
          : null;

      const settled = await Promise.allSettled(
        bearings.map(async (b, i) => {
          let legRadius = Math.min(halfTarget * 0.85, maxCityLeg);
          let turnaround =
            i === 0 && nightLitTurnaround
              ? nightLitTurnaround
              : i === 1 && parkPassTurnaround
              ? parkPassTurnaround
              : sanitizeRouteWaypoint(
                  destinationPoint(req.start, legRadius, b),
                  req.start,
                  isNightMode,
                  inChandigarh,
                  req.activeCity
                );
          let outward = await provider.computeWalkRoute(
            req.start,
            turnaround,
            [],
            effectivePrefs,
            workoutType
          );

          const relErr = Math.abs(outward.distanceMeters * 2 - lapTarget) / lapTarget;
          if (
            !(i === 0 && nightLitTurnaround) &&
            !(i === 1 && parkPassTurnaround) &&
            relErr > req.tolerancePct / 100 &&
            outward.distanceMeters > 150
          ) {
            legRadius = Math.min(legRadius * (halfTarget / outward.distanceMeters), maxCityLeg);
            turnaround = sanitizeRouteWaypoint(
              destinationPoint(req.start, legRadius, b),
              req.start,
              isNightMode,
              inChandigarh,
              req.activeCity
            );
            outward = await provider.computeWalkRoute(
              req.start,
              turnaround,
              [],
              effectivePrefs,
              workoutType
            );
          }

          if (!validatePedestrianRouteGeometry(outward.path, outward.distanceMeters)) {
            throw new Error(`Outward ${isBike ? 'cycling' : 'pedestrian'} path disconnected or too short`);
          }
          if (req.activeCity && !isPathInsideSelectedCity(outward.path, req.activeCity)) {
            throw new Error(`Out-and-back leg extends outside ${req.activeCity.name}.`);
          }

          const outwardStraightness = analyzeRouteStraightness(outward.path);
          const reversedPath = [...outward.path].slice(0, -1).reverse();
          const singleLapPath = [...outward.path, ...reversedPath];
          const returnStep: RouteStepInstruction = {
            instruction: `Turn around and follow ${outward.steps[0]?.instruction || 'the same path'} back to ${req.start.name}`,
            distanceMeters: outward.distanceMeters,
            durationSec: outward.durationSec,
            maneuver: 'uturn',
            startLocation: outward.path[outward.path.length - 1],
            endLocation: req.start,
          };
          const repeated = repeatRouteLaps(
            singleLapPath,
            [...outward.steps, returnStep],
            outward.distanceMeters * 2,
            outward.durationSec * 2,
            loopsToRun
          );
          const fullStraightness = analyzeRouteStraightness(repeated.path);
          const diffPct = Math.round((Math.abs(repeated.distanceMeters - targetMeters) / targetMeters) * 100);
          const nightStats = inChandigarh
            ? getNightSafetyStatsForPath(repeated.path)
            : { wildlifeHits: 0, desertedHits: 0, unlitHits: 0, litHits: 0, avoidedNames: [] };
          const nightPenalty =
            isNightMode && inChandigarh
              ? nightStats.wildlifeHits * 200 +
                nightStats.desertedHits * 150 +
                nightStats.unlitHits * 60 -
                nightStats.litHits * 4
              : 0;
          const rankScore =
            diffPct * 1.1 +
            outwardStraightness.turnCount * (preferLeastTurns ? 14 : 4) -
            (outwardStraightness.longestStraightMeters / 1000) * (preferLeastTurns ? 24 : 6) -
            outwardStraightness.straightPathPct * (preferLeastTurns ? 0.55 : 0.15) +
            nightPenalty;

          return {
            i,
            turnaround,
            fullPath: repeated.path,
            totalDist: repeated.distanceMeters,
            steps: repeated.steps,
            providerName: outward.providerName,
            nightStats,
            straightness: fullStraightness,
            rankScore,
          };
        })
      );

      const fulfilledOab = settled.flatMap((item) =>
        item.status === 'fulfilled' ? [item.value] : []
      );

      if (isNightMode && inChandigarh) {
        return fulfilledOab
          .sort((a, b) => a.rankScore - b.rankScore)
          .filter((v, _idx, arr) => {
            const hasClean = arr.some((x) => x.nightStats.wildlifeHits === 0 && x.nightStats.desertedHits === 0);
            return hasClean ? v.nightStats.wildlifeHits === 0 && v.nightStats.desertedHits === 0 : true;
          });
      }
      return fulfilledOab.sort((a, b) => a.rankScore - b.rankScore);
    };

    let safeOab = await attemptOabPass(requestedLoops);
    if (safeOab.length === 0 && requestedLoops === 1 && targetMeters >= 3000) {
      for (const autoLoops of [2, 3, 4]) {
        safeOab = await attemptOabPass(autoLoops);
        if (safeOab.length > 0) {
          effectiveLoopCount = autoLoops;
          break;
        }
      }
    }

    const dedupedOab: typeof safeOab = [];
    for (const ev of safeOab) {
      if (dedupedOab.length >= 3) break;
      const dup = dedupedOab.some(
        (c) =>
          Math.abs(c.totalDist - ev.totalDist) < 80 &&
          haversineMeters(c.turnaround, ev.turnaround) < 160
      );
      if (!dup) dedupedOab.push(ev);
    }

    const labels = isNightMode
      ? (['Night Safe · Least Turns', 'Well-Lit Avenue', 'Alternative'] as const)
      : preferLeastTurns
      ? (['Least Turns', 'Straight Corridor', 'Alternative'] as const)
      : (['Best Match', 'Scenic', 'Alternative'] as const);

    dedupedOab.forEach((val, idx) => {
      const lapSuffix = effectiveLoopCount > 1 ? ` (${effectiveLoopCount}× Laps)` : '';
      candidates.push(
        finalizeCandidate({
          id: `oab-${idx}-${Date.now()}`,
          label: labels[idx] || 'Alternative',
          name: `${req.start.name} ${(val.totalDist / 1000).toFixed(1)}K ${isNightMode ? 'Lit Out & Back' : 'Straight Out & Back'}${lapSuffix}`,
          routeType: 'out_and_back',
          distanceMeters: val.totalDist,
          targetDistanceMeters: targetMeters,
          start: req.start,
          end: req.start,
          path: val.fullPath,
          steps: val.steps,
          surfaceSummary: isNightMode
            ? `Well-lit ${cityLabel} avenues reversed safely to start`
            : effectiveLoopCount > 1
            ? `${effectiveLoopCount} repeated ${cityLabel} straight out-and-back laps`
            : `Long straight ${cityLabel} ${isBike ? 'corridor' : 'avenue'} reversed to start`,
          routingProvider: val.providerName,
          req: effectiveReq,
          overlapRatio: 1,
          loopCount: effectiveLoopCount,
          straightness: val.straightness,
        })
      );
    });
  } else {
    // Circular Loop: builds minimal-turn rectangular corridors and repeats `loopsToRun` times
    const attemptLoopPass = async (loopsToRun: number) => {
      const lapTargetMeters = Math.max(700, Math.round(targetMeters / loopsToRun));
      const nearLakeEast = inChandigarh && req.start.lng > 76.808;
      const baseBearings = inChandigarh
        ? nearLakeEast
          ? [
              { bearing: (214 + seedRot) % 360, clockwise: true, aspect: 1.85 },
              { bearing: (304 + seedRot) % 360, clockwise: false, aspect: 1.65 },
              { bearing: (252 + seedRot) % 360, clockwise: false, aspect: 1.0 },
              { bearing: (192 + seedRot) % 360, clockwise: true, aspect: 1.75 },
            ]
          : [
              { bearing: (34 + seedRot) % 360, clockwise: true, aspect: 1.85 },
              { bearing: (124 + seedRot) % 360, clockwise: true, aspect: 1.75 },
              { bearing: (214 + seedRot) % 360, clockwise: true, aspect: 1.85 },
              { bearing: (304 + seedRot) % 360, clockwise: false, aspect: 1.15 },
            ]
        : [
            { bearing: (0 + seedRot) % 360, clockwise: true, aspect: 1.85 },
            { bearing: (90 + seedRot) % 360, clockwise: true, aspect: 1.85 },
            { bearing: (180 + seedRot) % 360, clockwise: true, aspect: 1.15 },
            { bearing: (270 + seedRot) % 360, clockwise: false, aspect: 1.75 },
          ];

      const preferParksOrPasses =
        !isNightMode &&
        (effectivePrefs.includes('parks_greenery') || effectivePrefs.includes('pedestrian_paths'));
      const nightLitLoop =
        inChandigarh && isNightMode
          ? buildNightLitLoopWaypoints(req.start, lapTargetMeters, (req.seedOffset || 0) % 2 === 0)
          : null;
      const parkPassLoop =
        inChandigarh && preferParksOrPasses && !preferLeastTurns
          ? buildParkAndPassLoopWaypoints(req.start, lapTargetMeters, (req.seedOffset || 0) % 2 === 0)
          : null;
      const parkAnchorLoop =
        inChandigarh && !isNightMode && !preferLeastTurns
          ? findBestChandigarhWalkLoop(req.start, lapTargetMeters)
          : null;

      type RawLoopEval = {
        computed: ComputeRouteOutput;
        overlap: number;
        greenHits: number;
        nightStats: ReturnType<typeof getNightSafetyStatsForPath>;
        straightness: RouteStraightnessStats;
        diffPct: number;
        score: number;
        bearing?: number;
        clockwise?: boolean;
        aspect?: number;
        isAnchorLoop?: boolean;
      };

      const sectorSpecs: Array<{
        waypoints: LatLngLiteral[];
        bearing?: number;
        clockwise?: boolean;
        aspect?: number;
        isAnchorLoop?: boolean;
      }> = baseBearings.map((cfg) => ({
        waypoints: buildSectorGridLoopWaypoints(
          req.start,
          lapTargetMeters,
          cfg.bearing,
          cfg.clockwise,
          isNightMode,
          inChandigarh,
          req.activeCity,
          preferLeastTurns ? cfg.aspect : 1.0
        ),
        bearing: cfg.bearing,
        clockwise: cfg.clockwise,
        aspect: preferLeastTurns ? cfg.aspect : 1.0,
      }));

      const specs: Array<{
        waypoints: LatLngLiteral[];
        bearing?: number;
        clockwise?: boolean;
        aspect?: number;
        isAnchorLoop?: boolean;
      }> = [];
      if (nightLitLoop) {
        specs.push({ waypoints: nightLitLoop, isAnchorLoop: true });
      }
      if (parkPassLoop) {
        specs.push({ waypoints: parkPassLoop, isAnchorLoop: true });
      }
      specs.push(...sectorSpecs);
      if (parkAnchorLoop) {
        specs.push({ waypoints: parkAnchorLoop, isAnchorLoop: true });
      }

      const preferGreenWeight = !isNightMode && effectivePrefs.includes('parks_greenery') ? 4.5 : 2.5;
      const specsToQuery = specs.slice(0, 4);

      const firstPass = await Promise.allSettled(
        specsToQuery.map(async (sp): Promise<RawLoopEval> => {
          let computed = await provider.computeWalkRoute(
            req.start,
            req.start,
            sp.waypoints,
            effectivePrefs,
            workoutType
          );
          const relErr = Math.abs(computed.distanceMeters - lapTargetMeters) / lapTargetMeters;

          if (
            !sp.isAnchorLoop &&
            sp.bearing !== undefined &&
            relErr > Math.max(req.tolerancePct, 12) / 100 &&
            computed.distanceMeters > 250
          ) {
            const calibratedTarget = lapTargetMeters * (lapTargetMeters / computed.distanceMeters);
            const calibratedWps = buildSectorGridLoopWaypoints(
              req.start,
              calibratedTarget,
              sp.bearing,
              Boolean(sp.clockwise),
              isNightMode,
              inChandigarh,
              req.activeCity,
              sp.aspect ?? 1.0
            );
            try {
              const recomputed = await provider.computeWalkRoute(
                req.start,
                req.start,
                calibratedWps,
                effectivePrefs,
                workoutType
              );
              const newErr = Math.abs(recomputed.distanceMeters - lapTargetMeters) / lapTargetMeters;
              const withinCity =
                !req.activeCity || isPathInsideSelectedCity(recomputed.path, req.activeCity);
              if (
                newErr < relErr &&
                withinCity &&
                validatePedestrianRouteGeometry(recomputed.path, recomputed.distanceMeters)
              ) {
                computed = recomputed;
              }
            } catch {
              // Keep first pass geometry
            }
          }

          if (!validatePedestrianRouteGeometry(computed.path, computed.distanceMeters)) {
            throw new Error(
              `Candidate loop failed ${isBike ? 'cycling' : 'pedestrian'} connectivity validation`
            );
          }
          if (req.activeCity && !isPathInsideSelectedCity(computed.path, req.activeCity)) {
            throw new Error(`Candidate loop crosses outside ${req.activeCity.name}.`);
          }

          const overlap = computeLoopOverlapRatio(computed.path);
          const lapStraightness = analyzeRouteStraightness(computed.path);
          const greenHits = !isNightMode && inChandigarh ? computeGreenProximityScore(computed.path) : 0;
          const nightStats = inChandigarh
            ? getNightSafetyStatsForPath(computed.path)
            : { wildlifeHits: 0, desertedHits: 0, unlitHits: 0, litHits: 0, avoidedNames: [] };
          const repeated = repeatRouteLaps(
            computed.path,
            computed.steps,
            computed.distanceMeters,
            computed.durationSec,
            loopsToRun
          );
          const fullStraightness =
            loopsToRun === 1 ? lapStraightness : analyzeRouteStraightness(repeated.path);
          const diffPct = Math.round((Math.abs(repeated.distanceMeters - targetMeters) / targetMeters) * 100);
          const nightPenalty =
            isNightMode && inChandigarh
              ? nightStats.wildlifeHits * 260 +
                nightStats.desertedHits * 180 +
                nightStats.unlitHits * 80 -
                nightStats.litHits * 4.5
              : 0;
          const turnCost = lapStraightness.turnCount * (preferLeastTurns ? 8.5 : 3.0);
          const straightGain =
            (lapStraightness.longestStraightMeters / 1000) * (preferLeastTurns ? 22 : 6) +
            lapStraightness.straightPathPct * (preferLeastTurns ? 0.55 : 0.15);
          const score =
            diffPct * 1.3 +
            overlap * 115 +
            turnCost -
            straightGain -
            greenHits * preferGreenWeight +
            nightPenalty;
          return {
            computed: {
              ...computed,
              path: repeated.path,
              steps: repeated.steps,
              distanceMeters: repeated.distanceMeters,
              durationSec: repeated.durationSec,
            },
            overlap,
            greenHits,
            nightStats,
            straightness: fullStraightness,
            diffPct,
            score,
            bearing: sp.bearing,
            clockwise: sp.clockwise,
            aspect: sp.aspect,
            isAnchorLoop: sp.isAnchorLoop,
          };
        })
      );

      const fulfilled = firstPass
        .filter((r): r is PromiseFulfilledResult<RawLoopEval> => r.status === 'fulfilled')
        .map((r) => r.value)
        .sort((a, b) => a.score - b.score);

      if (isNightMode && inChandigarh) {
        const strictlySafe = fulfilled.filter(
          (ev) => ev.nightStats.wildlifeHits === 0 && ev.nightStats.desertedHits === 0
        );
        if (strictlySafe.length > 0) return strictlySafe;
      }
      return fulfilled;
    };

    let evaluated = await attemptLoopPass(requestedLoops);
    if (evaluated.length === 0 && requestedLoops === 1 && targetMeters >= 2500) {
      for (const autoLoops of [2, 3, 4]) {
        evaluated = await attemptLoopPass(autoLoops);
        if (evaluated.length > 0) {
          effectiveLoopCount = autoLoops;
          break;
        }
      }
    }

    const chosen: typeof evaluated = [];
    for (const ev of evaluated) {
      if (chosen.length >= 3) break;
      const isDuplicate = chosen.some(
        (c) =>
          Math.abs(c.computed.distanceMeters - ev.computed.distanceMeters) < 60 &&
          c.computed.path.length > 4 &&
          ev.computed.path.length > 4 &&
          haversineMeters(
            c.computed.path[Math.floor(c.computed.path.length / 2)],
            ev.computed.path[Math.floor(ev.computed.path.length / 2)]
          ) < 160
      );
      if (!isDuplicate) chosen.push(ev);
    }

    const labels = isNightMode
      ? ['Night Safe · Least Turns', 'Lit Avenue Loop', 'Alternative Safe Loop']
      : preferLeastTurns
      ? ['Least Turns', 'Straight Corridor Loop', 'Alternative Loop']
      : ['Best Match', 'Scenic', 'Alternative Loop'];
    const lapTag = effectiveLoopCount > 1 ? ` (${effectiveLoopCount}× Laps)` : '';
    const ordered =
      !isNightMode && !preferLeastTurns && chosen.length >= 2
        ? [chosen[0], ...chosen.slice(1).sort((a, b) => b.greenHits - a.greenHits)]
        : chosen;

    ordered.forEach((ev, idx) => {
      const lbl =
        ordered.length === 1
          ? isNightMode
            ? 'Night Safe · Least Turns'
            : preferLeastTurns
            ? 'Least Turns'
            : 'Best Match'
          : labels[idx] || 'Alternative Loop';
      candidates.push(
        finalizeCandidate({
          id: `loop-${idx}-${Date.now()}`,
          label: lbl,
          name: `${req.start.name} ${(ev.computed.distanceMeters / 1000).toFixed(1)}K ${
            isNightMode
              ? 'Night-Safe Loop'
              : preferLeastTurns
              ? 'Straight Loop'
              : lbl === 'Scenic'
              ? 'Green Loop'
              : 'City Loop'
          }${lapTag}`,
          routeType: 'circular',
          distanceMeters: ev.computed.distanceMeters,
          targetDistanceMeters: targetMeters,
          start: req.start,
          end: req.start,
          path: ev.computed.path,
          steps: ev.computed.steps,
          surfaceSummary: isNightMode
            ? effectiveLoopCount > 1
              ? `${effectiveLoopCount}× well-lit ${cityLabel} avenue laps`
              : `Well-lit ${cityLabel} avenues & active ${isBike ? 'bikeways' : 'sidewalks'}`
            : effectiveLoopCount > 1
            ? `${effectiveLoopCount}× repeated ${cityLabel} ${isBike ? 'cycling' : 'pedestrian'} laps`
            : `${cityLabel} straight ${isBike ? 'bikeways & avenues' : 'avenues & low-turn paths'}`,
          routingProvider: ev.computed.providerName,
          req: effectiveReq,
          overlapRatio: ev.overlap,
          loopCount: effectiveLoopCount,
          straightness: ev.straightness,
        })
      );
    });
  }

  if (candidates.length === 0) {
    throw new Error(
      req.activeCity
        ? `Unable to fit a connected route inside ${req.activeCity.name} from ${req.start.name}. Try moving your pin slightly toward the city center or increasing Laps (2×–4×).`
        : `Unable to find connected ${isBike ? 'bikeable roads' : 'pedestrian roads'} near ${req.start.name}. Try moving your pin slightly toward a street or increasing Laps (2×–3×).`
    );
  }

  if (candidates[0] && candidates[0].elevationGainMeters === null) {
    candidates[0].elevationGainMeters = await fetchOptionalElevation(candidates[0].path);
  }

  const bestTol = candidates[0].toleranceDiffPct;
  const autoLapNote =
    effectiveLoopCount > requestedLoops
      ? `Automatically built as ${effectiveLoopCount}× local laps to keep the route clean and connected. `
      : '';
  const startHaz = inChandigarh && isNightMode ? isNightHazardOrWildlifeZone(req.start) : { avoided: false };
  const topNightStats = inChandigarh && isNightMode ? getNightSafetyStatsForPath(candidates[0].path) : null;
  const nightNotice =
    inChandigarh && isNightMode && (startHaz.avoided || (topNightStats && topNightStats.avoidedNames.length > 0))
      ? `Night Run Mode steered away from wildlife/unlit zones${
          startHaz.avoided && startHaz.zoneName ? ` near ${startHaz.zoneName}` : ''
        }. Consider starting at Sector 17 Plaza, Sector 22, or Sukhna West Front for brightest lighting. `
      : '';
  const warningText = `${nightNotice}${autoLapNote}${
    bestTol > req.tolerancePct
      ? `Closest ${cityLabel} route differs by ${bestTol}% from your ${req.distanceKm} km target due to local street grid blocks.`
      : ''
  }`.trim();

  const result: PedestrianRoutingResult = {
    routes: candidates,
    warning: warningText || undefined,
  };
  routeMemoryCache.set(cacheKey, result);
  return result;
}
