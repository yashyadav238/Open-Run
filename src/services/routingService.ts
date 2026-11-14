import {
  CHANDIGARH_NIGHT_LIT_NODES,
  CHANDIGARH_PARK_AND_PASS_NODES,
  CHANDIGARH_WALK_NODES,
  VERIFIED_TRICITY_PLACES,
  clampToChandigarh,
  getNightSafetyStatsForPath,
  isInsideChandigarh,
  isNightHazardOrWildlifeZone,
  isPathInsideChandigarh,
  isWaterOrRestrictedChandigarhPoint,
} from '../data/tricityPlaces';
import {
  bearingDegrees,
  buildGeoJsonLineString,
  computeKmMarkers,
  computeMaxSegmentGapMeters,
  destinationPoint,
  encodePolyline,
  haversineMeters,
} from '../lib/geo';
import type {
  GeneratedRouteCandidate,
  LatLngLiteral,
  NamedLocation,
  RouteDifficulty,
  RoutePreference,
  RouteStepInstruction,
  RouteType,
} from '../types/run';

export interface RouteGenerationRequest {
  start: NamedLocation;
  end?: NamedLocation;
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
    preferences?: RoutePreference[]
  ): Promise<ComputeRouteOutput>;
  traceArtShape?(shape: LatLngLiteral[], preferences?: RoutePreference[]): Promise<ComputeRouteOutput>;
}

const routeMemoryCache = new globalThis.Map<string, PedestrianRoutingResult>();

function createCacheKey(req: RouteGenerationRequest): string {
  const isNight = Boolean(req.nightMode || req.preferences.includes('well_lit'));
  return JSON.stringify({
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
  preferences: RoutePreference[] = []
): Promise<ComputeRouteOutput> {
  const waypoints = [origin, ...intermediates, destination];
  const res = await fetch('/api/routing/walk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints, preferences }),
  });
  if (!res.ok) {
    throw new Error('Pedestrian routing service could not connect these Chandigarh waypoints.');
  }
  const data = (await res.json()) as ComputeRouteOutput & { provider?: string };
  if (!data.path || data.path.length < 2) {
    throw new Error('Pedestrian route contained insufficient geometry.');
  }
  return {
    path: data.path,
    distanceMeters: data.distanceMeters,
    durationSec: data.durationSec,
    steps: data.steps || [],
    providerName: data.provider || 'osm-foot',
  };
}

export function createPedestrianRoutingProvider(
  routesLib?: typeof google.maps.routes | null
): PedestrianRoutingProvider {
  return {
    async computeWalkRoute(origin, destination, intermediates = [], preferences = []) {
      const preferParksOrNarrowPasses =
        preferences.includes('parks_greenery') ||
        preferences.includes('pedestrian_paths') ||
        preferences.includes('quieter_roads') ||
        preferences.includes('well_lit');

      if (!routesLib || preferParksOrNarrowPasses) {
        return await computeViaServerWalkRouter(origin, destination, intermediates, preferences);
      }

      const request: Record<string, unknown> = {
        origin,
        destination,
        travelMode:
          (routesLib as unknown as { TravelMode?: { WALKING?: string } }).TravelMode?.WALKING ||
          'WALKING',
        fields: ['path', 'distanceMeters', 'durationMillis', 'legs', 'viewport'],
      };
      if (intermediates.length > 0) {
        request.intermediates = intermediates.map((pt) => ({
          location: pt,
          via: true,
        }));
      }

      try {
        const response = await (routesLib.Route as unknown as {
          computeRoutes: (req: Record<string, unknown>) => Promise<{ routes?: any[] }>;
        }).computeRoutes(request);

        const route = response.routes?.[0];
        if (!route) {
          return await computeViaServerWalkRouter(origin, destination, intermediates, preferences);
        }

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
              'Continue along pedestrian path';
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

        if (rawPath.length < 2) {
          return await computeViaServerWalkRouter(origin, destination, intermediates, preferences);
        }

        const distanceMeters = route.distanceMeters ?? computePathLength(rawPath);
        if (!validatePedestrianRouteGeometry(rawPath, distanceMeters)) {
          return await computeViaServerWalkRouter(origin, destination, intermediates, preferences);
        }
        const durationSec = route.durationMillis
          ? Math.round(route.durationMillis / 1000)
          : Math.round((distanceMeters / 1000) * 360);

        return {
          path: rawPath,
          distanceMeters,
          durationSec,
          steps,
          providerName: 'google-routes',
        };
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
        return await computeViaServerWalkRouter(origin, destination, intermediates, preferences);
      }
    },
    async traceArtShape(
      shape: LatLngLiteral[],
      preferences: RoutePreference[] = []
    ): Promise<ComputeRouteOutput> {
      const res = await fetch('/api/routing/trace-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shape, preferences }),
      });
      if (!res.ok) {
        throw new Error('Unable to map-match Run Art curve onto Chandigarh paths.');
      }
      const data = (await res.json()) as ComputeRouteOutput & { provider?: string };
      if (!data.path || data.path.length < 4) {
        throw new Error('Map-matched Run Art path contained insufficient geometry.');
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
  // Straight Chandigarh sector avenues span 200-800m between intersections; reject only broken >1500m jumps
  if (computeMaxSegmentGapMeters(path) > 1500) return false;
  const geomLen = computePathLength(path);
  if (Math.abs(geomLen - distanceMeters) > Math.max(600, distanceMeters * 0.45)) return false;
  // Strictly keep routes inside Chandigarh UT (never spill into Mohali, Panchkula, Zirakpur, or Kharar)
  if (!isPathInsideChandigarh(path)) return false;
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

function sanitizeChandigarhWaypoint(
  pt: LatLngLiteral,
  start: LatLngLiteral,
  nightMode = false
): LatLngLiteral {
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
  nightMode = false
): LatLngLiteral[] {
  const side = Math.max(170, targetMeters / (4 * 1.18));
  const diag = side * 1.38;
  const sign = clockwise ? 1 : -1;

  const wp1 = sanitizeChandigarhWaypoint(destinationPoint(start, side, sectorBearingDeg), start, nightMode);
  const wp2 = sanitizeChandigarhWaypoint(
    destinationPoint(start, diag, (sectorBearingDeg + sign * 48 + 360) % 360),
    start,
    nightMode
  );
  const wp3 = sanitizeChandigarhWaypoint(
    destinationPoint(start, side, (sectorBearingDeg + sign * 92 + 360) % 360),
    start,
    nightMode
  );
  return [wp1, wp2, wp3];
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

export async function fetchOptionalElevation(path: LatLngLiteral[]): Promise<number | null> {
  try {
    const step = Math.max(1, Math.floor(path.length / 18));
    const sampled = path.filter((_, i) => i % step === 0).slice(0, 18);
    const res = await fetch('/api/elevation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: sampled }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { available?: boolean; elevationGainMeters?: number | null };
    return data.available ? (data.elevationGainMeters ?? null) : null;
  } catch {
    return null;
  }
}

function estimateRunningDurationSec(distanceMeters: number, difficulty: RouteDifficulty): number {
  const paceSecPerKm = difficulty === 'challenging' ? 320 : difficulty === 'moderate' ? 355 : 385;
  return Math.round((distanceMeters / 1000) * paceSecPerKm);
}

function buildCharacteristics(
  req: RouteGenerationRequest,
  label: string,
  overlapRatio: number
): string[] {
  const isNightMode = Boolean(req.nightMode || req.preferences.includes('well_lit'));
  const chars: string[] = [];
  if (isNightMode) {
    chars.push('Night Safe · Well-Lit Avenues');
    chars.push('Avoids Wildlife & Deserted Zones');
  }
  if (overlapRatio < 0.18 && req.routeType === 'circular') chars.push('Clean no-backtrack loop');
  if (!isNightMode && (label === 'Scenic' || req.preferences.includes('parks_greenery'))) {
    chars.push('Parks & greenery priority');
  }
  if (!isNightMode && req.preferences.includes('pedestrian_paths')) chars.push('Pedestrian footpaths');
  if (req.preferences.includes('quieter_roads')) chars.push('Quiet sector avenues');
  if (req.preferences.includes('avoid_stairs')) chars.push('Step-free bias');
  if (req.preferences.includes('avoid_restricted')) chars.push('Public paths only');
  if (req.preferences.includes('fewer_crossings')) chars.push('Continuous walkways');
  if (req.routeType === 'out_and_back') chars.push('Mirrored turnaround route');
  if (chars.length === 0) chars.push('Chandigarh pedestrian network');
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
}): GeneratedRouteCandidate {
  const durationSec = estimateRunningDurationSec(params.distanceMeters, params.req.difficulty);
  const diffPct =
    params.targetDistanceMeters > 0
      ? Math.round((Math.abs(params.distanceMeters - params.targetDistanceMeters) / params.targetDistanceMeters) * 100)
      : 0;
  const loops = params.loopCount && params.loopCount > 1 ? params.loopCount : undefined;
  const chars = buildCharacteristics(params.req, params.label, params.overlapRatio);
  if (loops) {
    chars.unshift(`${loops}× Chandigarh Laps`);
  }

  return {
    id: params.id,
    label: params.label,
    name: params.name,
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
      distanceMeters: params.distanceMeters,
      durationSec,
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
    loopCount: loops,
  };
}

export async function generatePedestrianRoutes(
  provider: PedestrianRoutingProvider,
  req: RouteGenerationRequest
): Promise<PedestrianRoutingResult> {
  if (!isInsideChandigarh(req.start)) {
    throw new Error(
      'Starting location is outside Chandigarh UT. TRICITY RUN supports routes exclusively inside Chandigarh (Mohali, Panchkula, Zirakpur & Kharar are excluded).'
    );
  }
  if (req.routeType === 'point_to_point' && req.end && !isInsideChandigarh(req.end)) {
    throw new Error(
      'Destination is outside Chandigarh UT. Please choose a destination inside Chandigarh.'
    );
  }

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

  if (req.routeType === 'point_to_point') {
    if (!req.end) {
      throw new Error('Please choose a destination in Chandigarh for point-to-point routing.');
    }
    const base = await provider.computeWalkRoute(req.start, req.end, [], effectivePrefs);
    if (!validatePedestrianRouteGeometry(base.path, base.distanceMeters)) {
      throw new Error('No continuous Chandigarh pedestrian connection found between these two points.');
    }
    const cand = finalizeCandidate({
      id: `p2p-${Date.now()}`,
      label: isNightMode ? 'Night Safe Match' : 'Best Match',
      name: `${req.start.name} to ${req.end.name}`,
      routeType: 'point_to_point',
      distanceMeters: base.distanceMeters,
      targetDistanceMeters: targetMeters,
      start: req.start,
      end: req.end,
      path: base.path,
      steps: base.steps,
      surfaceSummary: isNightMode
        ? 'Well-lit Chandigarh sector avenues & active sidewalks (avoids wildlife & unlit zones)'
        : 'Chandigarh pedestrian walkways & sector crossings',
      routingProvider: base.providerName,
      req: effectiveReq,
      overlapRatio: 0,
    });
    candidates.push(cand);
  } else if (req.routeType === 'out_and_back') {
    // Out-and-back: supports `requestedLoops` repeated laps so long distances stay inside Chandigarh
    const nearLake = req.start.lng > 76.808;
    const baseBearings = nearLake ? [216, 258, 285] : [36, 126, 216];
    const bearings = baseBearings.map((b) => (b + seedRot) % 360);
    const labels = isNightMode
      ? (['Night Safe', 'Well-Lit Avenue', 'Alternative'] as const)
      : (['Best Match', 'Scenic', 'Alternative'] as const);
    const lapTarget = Math.max(500, Math.round(targetMeters / requestedLoops));
    const halfTarget = lapTarget / 2;

    const preferParksOrPasses =
      !isNightMode &&
      (effectivePrefs.includes('parks_greenery') || effectivePrefs.includes('pedestrian_paths'));
    const nightLitTurnaround = isNightMode
      ? CHANDIGARH_NIGHT_LIT_NODES.filter((n) => !isNightHazardOrWildlifeZone(n).avoided)
          .map((n) => ({
            node: { lat: n.lat, lng: n.lng },
            dist: haversineMeters(req.start, n),
          }))
          .filter((c) => c.dist >= Math.max(250, halfTarget * 0.45) && c.dist <= Math.max(950, halfTarget * 1.45))
          .sort((a, b) => Math.abs(a.dist - halfTarget) - Math.abs(b.dist - halfTarget))[0]?.node || null
      : null;
    const parkPassTurnaround = preferParksOrPasses
      ? CHANDIGARH_PARK_AND_PASS_NODES.map((n) => ({
          node: { lat: n.lat, lng: n.lng },
          dist: haversineMeters(req.start, n),
        }))
          .filter((c) => c.dist >= Math.max(220, halfTarget * 0.48) && c.dist <= Math.max(850, halfTarget * 1.45))
          .sort((a, b) => Math.abs(a.dist - halfTarget) - Math.abs(b.dist - halfTarget))[0]?.node || null
      : null;

    const settled = await Promise.allSettled(
      bearings.map(async (b, i) => {
        let legRadius = halfTarget * 0.78;
        let turnaround =
          i === 0 && nightLitTurnaround
            ? nightLitTurnaround
            : i === 1 && parkPassTurnaround
            ? parkPassTurnaround
            : sanitizeChandigarhWaypoint(destinationPoint(req.start, legRadius, b), req.start, isNightMode);
        let outward = await provider.computeWalkRoute(req.start, turnaround, [], effectivePrefs);

        const relErr = Math.abs(outward.distanceMeters * 2 - lapTarget) / lapTarget;
        if (
          !(i === 0 && nightLitTurnaround) &&
          !(i === 1 && parkPassTurnaround) &&
          relErr > req.tolerancePct / 100 &&
          outward.distanceMeters > 150
        ) {
          legRadius = legRadius * (halfTarget / outward.distanceMeters);
          turnaround = sanitizeChandigarhWaypoint(destinationPoint(req.start, legRadius, b), req.start, isNightMode);
          outward = await provider.computeWalkRoute(req.start, turnaround, [], effectivePrefs);
        }

        if (!validatePedestrianRouteGeometry(outward.path, outward.distanceMeters)) {
          throw new Error('Outward pedestrian path exited Chandigarh or disconnected');
        }

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
          requestedLoops
        );

        return {
          i,
          turnaround,
          fullPath: repeated.path,
          totalDist: repeated.distanceMeters,
          steps: repeated.steps,
          providerName: outward.providerName,
          nightStats: getNightSafetyStatsForPath(repeated.path),
        };
      })
    );

    const fulfilledOab = settled.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : []
    );

    const safeOab = isNightMode
      ? fulfilledOab
          .sort(
            (a, b) =>
              a.nightStats.wildlifeHits * 200 +
              a.nightStats.desertedHits * 150 +
              a.nightStats.unlitHits * 60 -
              a.nightStats.litHits * 4 -
              (b.nightStats.wildlifeHits * 200 +
                b.nightStats.desertedHits * 150 +
                b.nightStats.unlitHits * 60 -
                b.nightStats.litHits * 4)
          )
          .filter((v, _idx, arr) => {
            const hasClean = arr.some((x) => x.nightStats.wildlifeHits === 0 && x.nightStats.desertedHits === 0);
            return hasClean ? v.nightStats.wildlifeHits === 0 && v.nightStats.desertedHits === 0 : true;
          })
      : fulfilledOab;

    for (const val of safeOab) {
      const lapSuffix = requestedLoops > 1 ? ` (${requestedLoops}× Laps)` : '';
      candidates.push(
        finalizeCandidate({
          id: `oab-${val.i}-${Date.now()}`,
          label: labels[val.i] || 'Night Safe',
          name: `${req.start.name} ${(val.totalDist / 1000).toFixed(1)}K ${isNightMode ? 'Lit Out & Back' : 'Out & Back'}${lapSuffix}`,
          routeType: 'out_and_back',
          distanceMeters: val.totalDist,
          targetDistanceMeters: targetMeters,
          start: req.start,
          end: req.start,
          path: val.fullPath,
          steps: val.steps,
          surfaceSummary: isNightMode
            ? 'Well-lit Chandigarh avenues reversed safely to start (avoids wildlife & unlit zones)'
            : requestedLoops > 1
            ? `${requestedLoops} repeated Chandigarh out-and-back laps`
            : 'Outward pedestrian path reversed to start',
          routingProvider: val.providerName,
          req: effectiveReq,
          overlapRatio: 1,
          loopCount: requestedLoops,
        })
      );
    }
  } else {
    // Circular Loop: computes a Chandigarh-contained lap and repeats `loopsToRun` times
    const attemptLoopPass = async (loopsToRun: number) => {
      const lapTargetMeters = Math.max(700, Math.round(targetMeters / loopsToRun));
      const nearLakeEast = req.start.lng > 76.808;
      const baseBearings = nearLakeEast
        ? [
            { bearing: (216 + seedRot) % 360, clockwise: true },
            { bearing: (252 + seedRot) % 360, clockwise: false },
            { bearing: (286 + seedRot) % 360, clockwise: false },
            { bearing: (192 + seedRot) % 360, clockwise: true },
          ]
        : [
            { bearing: (36 + seedRot) % 360, clockwise: true },
            { bearing: (126 + seedRot) % 360, clockwise: true },
            { bearing: (216 + seedRot) % 360, clockwise: true },
            { bearing: (306 + seedRot) % 360, clockwise: false },
          ];

      const preferParksOrPasses =
        !isNightMode &&
        (effectivePrefs.includes('parks_greenery') || effectivePrefs.includes('pedestrian_paths'));
      const nightLitLoop = isNightMode
        ? buildNightLitLoopWaypoints(req.start, lapTargetMeters, (req.seedOffset || 0) % 2 === 0)
        : null;
      const parkPassLoop = preferParksOrPasses
        ? buildParkAndPassLoopWaypoints(req.start, lapTargetMeters, (req.seedOffset || 0) % 2 === 0)
        : null;
      const parkAnchorLoop = !isNightMode ? findBestChandigarhWalkLoop(req.start, lapTargetMeters) : null;

      type RawLoopEval = {
        computed: ComputeRouteOutput;
        overlap: number;
        greenHits: number;
        nightStats: ReturnType<typeof getNightSafetyStatsForPath>;
        diffPct: number;
        score: number;
        bearing?: number;
        clockwise?: boolean;
        isAnchorLoop?: boolean;
      };

      const sectorSpecs: Array<{
        waypoints: LatLngLiteral[];
        bearing?: number;
        clockwise?: boolean;
        isAnchorLoop?: boolean;
      }> = baseBearings.map((cfg) => ({
        waypoints: buildSectorGridLoopWaypoints(req.start, lapTargetMeters, cfg.bearing, cfg.clockwise, isNightMode),
        bearing: cfg.bearing,
        clockwise: cfg.clockwise,
      }));

      const specs: Array<{
        waypoints: LatLngLiteral[];
        bearing?: number;
        clockwise?: boolean;
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
          let computed = await provider.computeWalkRoute(req.start, req.start, sp.waypoints, effectivePrefs);
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
              isNightMode
            );
            try {
              const recomputed = await provider.computeWalkRoute(
                req.start,
                req.start,
                calibratedWps,
                effectivePrefs
              );
              const newErr = Math.abs(recomputed.distanceMeters - lapTargetMeters) / lapTargetMeters;
              if (newErr < relErr && validatePedestrianRouteGeometry(recomputed.path, recomputed.distanceMeters)) {
                computed = recomputed;
              }
            } catch {
              // Keep first pass geometry
            }
          }

          if (!validatePedestrianRouteGeometry(computed.path, computed.distanceMeters)) {
            throw new Error('Candidate loop exited Chandigarh or failed connectivity');
          }

          const overlap = computeLoopOverlapRatio(computed.path);
          const greenHits = isNightMode ? 0 : computeGreenProximityScore(computed.path);
          const nightStats = getNightSafetyStatsForPath(computed.path);
          const repeated = repeatRouteLaps(
            computed.path,
            computed.steps,
            computed.distanceMeters,
            computed.durationSec,
            loopsToRun
          );
          const diffPct = Math.round((Math.abs(repeated.distanceMeters - targetMeters) / targetMeters) * 100);
          const nightPenalty = isNightMode
            ? nightStats.wildlifeHits * 260 +
              nightStats.desertedHits * 180 +
              nightStats.unlitHits * 80 -
              nightStats.litHits * 4.5
            : 0;
          const score = diffPct * 1.4 + overlap * 120 - greenHits * preferGreenWeight + nightPenalty;
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
            diffPct,
            score,
            bearing: sp.bearing,
            clockwise: sp.clockwise,
            isAnchorLoop: sp.isAnchorLoop,
          };
        })
      );

      const fulfilled = firstPass
        .filter((r): r is PromiseFulfilledResult<RawLoopEval> => r.status === 'fulfilled')
        .map((r) => r.value)
        .sort((a, b) => a.score - b.score);

      if (isNightMode) {
        const strictlySafe = fulfilled.filter(
          (ev) => ev.nightStats.wildlifeHits === 0 && ev.nightStats.desertedHits === 0
        );
        if (strictlySafe.length > 0) return strictlySafe;
      }
      return fulfilled;
    };

    let evaluated = await attemptLoopPass(requestedLoops);
    if (evaluated.length === 0 && requestedLoops === 1 && targetMeters >= 6000) {
      // Automatically switch to 2× (or 3×) inner loops so long runs fit 100% inside Chandigarh
      for (const autoLoops of [2, 3]) {
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
      ? ['Night Safe Match', 'Lit Avenue Loop', 'Alternative Safe Loop']
      : ['Best Match', 'Scenic', 'Alternative Loop'];
    const lapTag = effectiveLoopCount > 1 ? ` (${effectiveLoopCount}× Laps)` : '';
    const ordered =
      !isNightMode && chosen.length >= 2
        ? [chosen[0], ...chosen.slice(1).sort((a, b) => b.greenHits - a.greenHits)]
        : chosen;

    ordered.forEach((ev, idx) => {
      const lbl = ordered.length === 1 ? (isNightMode ? 'Night Safe Match' : 'Best Match') : labels[idx] || 'Alternative Loop';
      candidates.push(
        finalizeCandidate({
          id: `loop-${idx}-${Date.now()}`,
          label: lbl,
          name: `${req.start.name} ${(ev.computed.distanceMeters / 1000).toFixed(1)}K ${
            isNightMode
              ? 'Night-Safe Loop'
              : lbl === 'Scenic'
              ? 'Green Loop'
              : 'Sector Loop'
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
              ? `${effectiveLoopCount}× well-lit Chandigarh avenue laps (avoids wildlife & unlit areas)`
              : 'Well-lit Chandigarh sector avenues & active sidewalks (avoids wildlife & unlit areas)'
            : effectiveLoopCount > 1
            ? `${effectiveLoopCount}× repeated Chandigarh park & sector laps`
            : 'Chandigarh paved footpaths & sector green belts',
          routingProvider: ev.computed.providerName,
          req: effectiveReq,
          overlapRatio: ev.overlap,
          loopCount: effectiveLoopCount,
        })
      );
    });
  }

  if (candidates.length === 0) {
    throw new Error(
      'Unable to find connected pedestrian roads inside Chandigarh from this starting point. Try shifting your pin inward onto Sector 17, Leisure Valley, Sukhna Lake, or increase Laps (2×–3×).'
    );
  }

  if (candidates[0] && candidates[0].elevationGainMeters === null) {
    candidates[0].elevationGainMeters = await fetchOptionalElevation(candidates[0].path);
  }

  const bestTol = candidates[0].toleranceDiffPct;
  const autoLapNote =
    effectiveLoopCount > requestedLoops
      ? `Automatically built as ${effectiveLoopCount}× Chandigarh laps so your route stays strictly inside Chandigarh UT. `
      : '';
  const startHaz = isNightMode ? isNightHazardOrWildlifeZone(req.start) : { avoided: false };
  const topNightStats = isNightMode ? getNightSafetyStatsForPath(candidates[0].path) : null;
  const nightNotice =
    isNightMode && (startHaz.avoided || (topNightStats && topNightStats.avoidedNames.length > 0))
      ? `Night Run Mode steered away from wildlife/unlit zones${
          startHaz.avoided && startHaz.zoneName ? ` near ${startHaz.zoneName}` : ''
        }. Consider starting at Sector 17 Plaza, Sector 22, or Sukhna West Front for brightest lighting. `
      : '';
  const warningText = `${nightNotice}${autoLapNote}${
    bestTol > req.tolerancePct
      ? `Closest Chandigarh route differs by ${bestTol}% from your ${req.distanceKm} km target due to local sector block connections.`
      : ''
  }`.trim();

  const result: PedestrianRoutingResult = {
    routes: candidates,
    warning: warningText || undefined,
  };
  routeMemoryCache.set(cacheKey, result);
  return result;
}
