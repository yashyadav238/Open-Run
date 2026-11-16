import type { CompletedKmCheckpoint, LatLngLiteral, SplitRecord, WorkoutType } from '../types/run';

const EARTH_RADIUS_M = 6371000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineMeters(a: LatLngLiteral, b: LatLngLiteral): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: LatLngLiteral, b: LatLngLiteral): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPoint(
  origin: LatLngLiteral,
  distanceMeters: number,
  bearingDeg: number
): LatLngLiteral {
  const angularDist = distanceMeters / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(angularDist);
  const cosAng = Math.cos(angularDist);

  const lat2 = Math.asin(sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(bearing));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * sinAng * cosLat1,
      cosAng - sinLat1 * Math.sin(lat2)
    );

  return {
    lat: Number(toDeg(lat2).toFixed(6)),
    lng: Number(toDeg(lng2).toFixed(6)),
  };
}

export function encodePolyline(points: LatLngLiteral[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';

  const encodeValue = (v: number) => {
    let val = v < 0 ? ~(v << 1) : v << 1;
    while (val >= 0x20) {
      result += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
      val >>= 5;
    }
    result += String.fromCharCode(val + 63);
  };

  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    encodeValue(lat - lastLat);
    encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

export function decodePolyline(encoded: string): LatLngLiteral[] {
  const points: LatLngLiteral[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function computeKmMarkers(path: LatLngLiteral[]): Array<{ km: number; position: LatLngLiteral }> {
  if (path.length < 2) return [];
  const markers: Array<{ km: number; position: LatLngLiteral }> = [];
  let accumulated = 0;
  let nextTarget = 1000;
  let kmIndex = 1;

  for (let i = 1; i < path.length; i++) {
    const seg = haversineMeters(path[i - 1], path[i]);
    while (accumulated + seg >= nextTarget && seg > 0) {
      const ratio = (nextTarget - accumulated) / seg;
      markers.push({
        km: kmIndex,
        position: {
          lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * ratio,
          lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * ratio,
        },
      });
      kmIndex += 1;
      nextTarget = kmIndex * 1000;
    }
    accumulated += seg;
  }
  return markers;
}

export function buildCompletedKmCheckpoints(
  path: LatLngLiteral[],
  splits: SplitRecord[] = []
): CompletedKmCheckpoint[] {
  const splitByKm = new Map<number, SplitRecord>();
  for (const s of splits) {
    splitByKm.set(s.km, s);
  }

  const fromPath = computeKmMarkers(path);
  const checkpoints: CompletedKmCheckpoint[] = fromPath.map((m) => {
    const matched = splitByKm.get(m.km);
    return {
      km: m.km,
      position:
        matched && Number.isFinite(matched.lat) && Number.isFinite(matched.lng)
          ? { lat: matched.lat as number, lng: matched.lng as number }
          : m.position,
      splitDurationSec: matched?.splitDurationSec,
      paceSecPerKm: matched?.paceSecPerKm,
    };
  });

  // Include any split that recorded explicit coordinates even if polyline is sparse
  const seen = new Set(checkpoints.map((c) => c.km));
  for (const s of splits) {
    if (!seen.has(s.km) && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
      checkpoints.push({
        km: s.km,
        position: { lat: s.lat as number, lng: s.lng as number },
        splitDurationSec: s.splitDurationSec,
        paceSecPerKm: s.paceSecPerKm,
      });
    }
  }

  return checkpoints.sort((a, b) => a.km - b.km);
}

export function minDistanceToPathMeters(point: LatLngLiteral, path: LatLngLiteral[]): number {
  if (path.length === 0) return Infinity;
  let min = Infinity;
  for (const p of path) {
    const d = haversineMeters(point, p);
    if (d < min) min = d;
  }
  return min;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatPace(secPerKm: number, unit: 'km' | 'mi' = 'km'): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '--:--';
  const scaled = unit === 'mi' ? secPerKm * 1.60934 : secPerKm;
  const mins = Math.floor(scaled / 60);
  const secs = Math.round(scaled % 60);
  if (secs === 60) {
    return `${mins + 1}:00`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatDistance(meters: number, unit: 'km' | 'mi' = 'km'): string {
  const km = meters / 1000;
  if (unit === 'mi') {
    return `${(km * 0.621371).toFixed(2)} mi`;
  }
  return `${km.toFixed(2)} km`;
}

/**
 * Converts local planar offsets in meters (east dx, north dy) around origin
 * accounting for cos(latitude) longitudinal compression at Chandigarh (~30.74°N).
 */
export function offsetMetersToLatLng(origin: LatLngLiteral, eastMeters: number, northMeters: number): LatLngLiteral {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(toRad(origin.lat));
  return {
    lat: Number((origin.lat + northMeters / metersPerDegLat).toFixed(6)),
    lng: Number((origin.lng + eastMeters / metersPerDegLng).toFixed(6)),
  };
}

export function computeMaxSegmentGapMeters(path: LatLngLiteral[]): number {
  let maxGap = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineMeters(path[i - 1], path[i]);
    if (d > maxGap) maxGap = d;
  }
  return maxGap;
}

export function buildGeoJsonLineString(
  path: LatLngLiteral[],
  props: {
    name: string;
    routeType: 'circular' | 'out_and_back' | 'point_to_point' | 'run_art';
    workoutType?: WorkoutType;
    distanceMeters: number;
    durationSec: number;
    city?: string;
    routingProvider?: string;
  }
) {
  return {
    type: 'Feature' as const,
    properties: {
      ...props,
      city: props.city || 'World',
    },
    geometry: {
      type: 'LineString' as const,
      coordinates: path.map((p): [number, number] => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]),
    },
  };
}

/**
 * Evenly resamples a 2D polyline to N points by arc length so HMM map matching
 * receives uniform spatial density along curves and straight edges.
 */
export function resample2DCurve(
  vertices: Array<{ x: number; y: number }>,
  targetCount = 32
): Array<{ x: number; y: number }> {
  if (vertices.length < 2 || targetCount < 2) return vertices;
  const cumLen: number[] = [0];
  for (let i = 1; i < vertices.length; i++) {
    const seg = Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].y - vertices[i - 1].y);
    cumLen.push(cumLen[i - 1] + seg);
  }
  const totalLen = cumLen[cumLen.length - 1];
  if (totalLen <= 1e-6) return vertices;

  const out: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < targetCount; k++) {
    const d = (k / (targetCount - 1)) * totalLen;
    let segIdx = 1;
    while (segIdx < cumLen.length - 1 && cumLen[segIdx] < d) segIdx++;
    const prevD = cumLen[segIdx - 1];
    const segSpan = Math.max(1e-6, cumLen[segIdx] - prevD);
    const t = Math.max(0, Math.min(1, (d - prevD) / segSpan));
    out.push({
      x: vertices[segIdx - 1].x + (vertices[segIdx].x - vertices[segIdx - 1].x) * t,
      y: vertices[segIdx - 1].y + (vertices[segIdx].y - vertices[segIdx - 1].y) * t,
    });
  }
  return out;
}

/**
 * Douglas-Peucker polyline simplification for freehand custom sketches.
 */
export function douglasPeucker2D(
  points: Array<{ x: number; y: number }>,
  epsilon: number
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const lenSq = dx * dx + dy * dy;

  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dist =
      lenSq === 0
        ? Math.hypot(p.x - first.x, p.y - first.y)
        : Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / Math.sqrt(lenSq);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker2D(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker2D(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * Discrete Frechet Distance in meters between two ordered trajectories.
 * Evaluates sequential curve alignment (the "leash" metric) rather than unordered nearest points.
 */
export function discreteFrechetMeters(a: LatLngLiteral[], b: LatLngLiteral[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  // Subsample cleanly so DP runs in < 1ms
  const maxN = 40;
  const stepA = Math.max(1, Math.floor(a.length / maxN));
  const stepB = Math.max(1, Math.floor(b.length / maxN));
  const p = a.filter((_, i) => i % stepA === 0 || i === a.length - 1);
  const q = b.filter((_, i) => i % stepB === 0 || i === b.length - 1);

  const n = p.length;
  const m = q.length;
  const dp = new Float64Array(n * m);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = haversineMeters(p[i], q[j]);
      if (i === 0 && j === 0) {
        dp[0] = d;
      } else if (i === 0) {
        dp[j] = Math.max(dp[j - 1], d);
      } else if (j === 0) {
        dp[i * m] = Math.max(dp[(i - 1) * m], d);
      } else {
        const prev = Math.min(dp[(i - 1) * m + j], dp[(i - 1) * m + (j - 1)], dp[i * m + (j - 1)]);
        dp[i * m + j] = Math.max(prev, d);
      }
    }
  }
  return dp[n * m - 1];
}

export interface RouteStraightnessStats {
  turnCount: number;
  longestStraightMeters: number;
  straightMeters: number;
  straightPathPct: number;
  totalMeters: number;
}

export function angleDiffDegrees(bearingA: number, bearingB: number): number {
  return Math.abs(((bearingB - bearingA + 540) % 360) - 180);
}

/**
 * Resamples a polyline by minimum chord distance so subtle sidewalk curves
 * do not count as road turns while genuine corners (>= 34 deg) are counted accurately.
 */
function samplePathByChord(path: LatLngLiteral[], minChordMeters: number): LatLngLiteral[] {
  if (path.length <= 2) return path;
  const sampled: LatLngLiteral[] = [path[0]];
  let last = path[0];
  for (let i = 1; i < path.length - 1; i++) {
    if (haversineMeters(last, path[i]) >= minChordMeters) {
      sampled.push(path[i]);
      last = path[i];
    }
  }
  const end = path[path.length - 1];
  if (haversineMeters(last, end) >= 6 || sampled.length === 1) {
    sampled.push(end);
  } else {
    sampled[sampled.length - 1] = end;
  }
  return sampled;
}

/**
 * Evaluates how straight and low-turn a route geometry is:
 * - turnCount: number of significant heading changes (>= 34 deg)
 * - longestStraightMeters: longest continuous straight stretch without a turn
 * - straightPathPct: % of total distance covered along straight segments (>= 120m)
 */
export function analyzeRouteStraightness(
  path: LatLngLiteral[]
): RouteStraightnessStats {
  if (path.length < 2) {
    return {
      turnCount: 0,
      longestStraightMeters: 0,
      straightMeters: 0,
      straightPathPct: 100,
      totalMeters: 0,
    };
  }

  let totalMeters = 0;
  for (let i = 1; i < path.length; i++) {
    totalMeters += haversineMeters(path[i - 1], path[i]);
  }
  if (totalMeters < 20) {
    return {
      turnCount: 0,
      longestStraightMeters: Math.round(totalMeters),
      straightMeters: Math.round(totalMeters),
      straightPathPct: 100,
      totalMeters: Math.round(totalMeters),
    };
  }

  const minChord = totalMeters < 350 ? 18 : 34;
  const simplified = samplePathByChord(path, minChord);
  if (simplified.length < 2) {
    return {
      turnCount: 0,
      longestStraightMeters: Math.round(totalMeters),
      straightMeters: Math.round(totalMeters),
      straightPathPct: 100,
      totalMeters: Math.round(totalMeters),
    };
  }

  const straightThresholdMeters = Math.min(120, totalMeters * 0.35);
  let turnCount = 0;
  let longestStraight = 0;
  let straightTotal = 0;
  let currentRun = 0;
  let anchorBearing: number | null = null;

  for (let i = 1; i < simplified.length; i++) {
    const segLen = haversineMeters(simplified[i - 1], simplified[i]);
    if (segLen < 8) continue;
    const segBearing = bearingDegrees(simplified[i - 1], simplified[i]);

    if (anchorBearing === null) {
      anchorBearing = segBearing;
      currentRun = segLen;
      continue;
    }

    const delta = angleDiffDegrees(anchorBearing, segBearing);
    if (delta >= 34) {
      turnCount += 1;
      if (currentRun > longestStraight) longestStraight = currentRun;
      if (currentRun >= straightThresholdMeters) straightTotal += currentRun;
      anchorBearing = segBearing;
      currentRun = segLen;
    } else {
      currentRun += segLen;
      if (currentRun > longestStraight) longestStraight = currentRun;
    }
  }

  if (currentRun > longestStraight) longestStraight = currentRun;
  if (currentRun >= straightThresholdMeters) straightTotal += currentRun;

  const roundedTotal = Math.round(totalMeters);
  const roundedStraight = Math.min(roundedTotal, Math.round(straightTotal));
  const roundedLongest = Math.min(roundedTotal, Math.round(longestStraight));

  return {
    turnCount,
    longestStraightMeters: roundedLongest,
    straightMeters: roundedStraight,
    straightPathPct: roundedTotal > 0 ? Math.min(100, Math.round((roundedStraight / roundedTotal) * 100)) : 100,
    totalMeters: roundedTotal,
  };
}

/**
 * Lower cost = better least-turns / longest-straight route.
 * Accepts reasonable detours (up to ~35%) when that yields significantly fewer turns
 * and longer uninterrupted straight stretches, while guarding against extreme (>45%) detours.
 */
export function computeLeastTurnsRouteCost(
  stats: RouteStraightnessStats,
  routeDistanceMeters: number,
  baselineDistanceMeters: number
): number {
  const base = Math.max(100, baselineDistanceMeters);
  const detourRatio = Math.max(0, (routeDistanceMeters - base) / base);
  const detourPenalty =
    detourRatio <= 0.35
      ? detourRatio * 24
      : 0.35 * 24 + (detourRatio - 0.35) * 150;
  const turnPenalty = stats.turnCount * 12;
  const straightBonus =
    (stats.longestStraightMeters / 1000) * 20 + stats.straightPathPct * 0.45;
  return turnPenalty + detourPenalty - straightBonus;
}

export function formatElevationGain(
  meters: number | null | undefined,
  unit: 'km' | 'mi' = 'km'
): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) {
    return unit === 'mi' ? '-- ft' : '-- m';
  }
  const clean = Math.max(0, Math.round(meters));
  if (unit === 'mi') {
    const feet = Math.round(clean * 3.28084);
    return feet > 0 ? `+${feet.toLocaleString()} ft` : '0 ft';
  }
  return clean > 0 ? `+${clean.toLocaleString()} m` : '0 m';
}

export function formatElevationLoss(
  meters: number | null | undefined,
  unit: 'km' | 'mi' = 'km'
): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) {
    return unit === 'mi' ? '-- ft' : '-- m';
  }
  const clean = Math.max(0, Math.round(meters));
  if (unit === 'mi') {
    const feet = Math.round(clean * 3.28084);
    return feet > 0 ? `-${feet.toLocaleString()} ft` : '0 ft';
  }
  return clean > 0 ? `-${clean.toLocaleString()} m` : '0 m';
}

export function formatElevationValue(
  meters: number | null | undefined,
  unit: 'km' | 'mi' = 'km'
): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) {
    return unit === 'mi' ? '-- ft' : '-- m';
  }
  if (unit === 'mi') {
    return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
  }
  return `${Math.round(meters).toLocaleString()} m`;
}

export function computeElevationStats(
  elevations: number[],
  totalDistanceMeters = 0,
  hysteresisMeters = 0.8
): {
  elevationGainMeters: number;
  elevationLossMeters: number;
  minElevationMeters: number;
  maxElevationMeters: number;
  avgGradePct: number;
  smoothed: number[];
} {
  const valid = elevations.filter((e) => typeof e === 'number' && Number.isFinite(e));
  if (valid.length === 0) {
    return {
      elevationGainMeters: 0,
      elevationLossMeters: 0,
      minElevationMeters: 0,
      maxElevationMeters: 0,
      avgGradePct: 0,
      smoothed: [],
    };
  }
  if (valid.length === 1) {
    const single = Math.round(valid[0]);
    return {
      elevationGainMeters: 0,
      elevationLossMeters: 0,
      minElevationMeters: single,
      maxElevationMeters: single,
      avgGradePct: 0,
      smoothed: [Number(valid[0].toFixed(1))],
    };
  }

  // 3-point binomial smoothing [0.25, 0.5, 0.25] removes single-sample jitter without flattening climbs
  const smoothed = valid.map((val, idx) => {
    if (idx === 0 || idx === valid.length - 1) return Number(val.toFixed(1));
    return Number((0.25 * valid[idx - 1] + 0.5 * val + 0.25 * valid[idx + 1]).toFixed(1));
  });

  let minEl = Infinity;
  let maxEl = -Infinity;
  for (const e of smoothed) {
    if (e < minEl) minEl = e;
    if (e > maxEl) maxEl = e;
  }

  // Hysteresis anchor accumulation
  let anchor = smoothed[0];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const diff = smoothed[i] - anchor;
    if (diff >= hysteresisMeters) {
      gain += diff;
      anchor = smoothed[i];
    } else if (diff <= -hysteresisMeters) {
      loss += Math.abs(diff);
      anchor = smoothed[i];
    }
  }

  const roundedGain = Math.round(gain);
  const roundedLoss = Math.round(loss);
  const avgGradePct =
    totalDistanceMeters > 50
      ? Number(((roundedGain / totalDistanceMeters) * 100).toFixed(1))
      : 0;

  return {
    elevationGainMeters: roundedGain,
    elevationLossMeters: roundedLoss,
    minElevationMeters: Math.round(minEl),
    maxElevationMeters: Math.round(maxEl),
    avgGradePct,
    smoothed,
  };
}

export function classifyTerrainByElevation(
  elevationGainMeters: number | null | undefined,
  distanceMeters: number
): { label: string; detail: string } {
  if (typeof elevationGainMeters !== 'number' || !Number.isFinite(elevationGainMeters)) {
    return { label: 'Elevation pending', detail: 'Analyzing route terrain slope' };
  }
  const km = Math.max(0.2, distanceMeters / 1000);
  const gainPerKm = elevationGainMeters / km;
  if (elevationGainMeters <= 3 || gainPerKm < 4) {
    return { label: 'Flat & fast', detail: 'Minimal gradient for steady rhythm' };
  }
  if (gainPerKm < 12) {
    return { label: 'Gently rolling', detail: 'Gradual rises along the course' };
  }
  if (gainPerKm < 25) {
    return { label: 'Rolling hills', detail: 'Steady climbs and descents' };
  }
  return { label: 'Hilly climb', detail: 'Challenging vertical gain throughout' };
}

export function buildPostRunDescription(params: {
  workoutLabel: string;
  routeName: string;
  startName?: string;
  distanceMeters: number;
  durationSec: number;
  rateText: string;
  caloriesKcal?: number;
  elevationGainMeters?: number | null;
  elevationLossMeters?: number | null;
  minElevationMeters?: number | null;
  maxElevationMeters?: number | null;
  unit?: 'km' | 'mi';
}): string {
  const unit = params.unit || 'km';
  const distText = formatDistance(params.distanceMeters, unit);
  const durText = formatDuration(params.durationSec);
  const terrain = classifyTerrainByElevation(params.elevationGainMeters, params.distanceMeters);

  const areaPhrase =
    params.startName && !params.routeName.toLowerCase().includes(params.startName.toLowerCase())
      ? ` from ${params.startName}`
      : '';

  const parts: string[] = [
    `Completed a ${distText} ${params.workoutLabel.toLowerCase()} on ${params.routeName}${areaPhrase} in ${durText} (${params.rateText}).`,
  ];

  if (typeof params.elevationGainMeters === 'number' && Number.isFinite(params.elevationGainMeters)) {
    const gainTxt = formatElevationGain(params.elevationGainMeters, unit);
    const hasLoss =
      typeof params.elevationLossMeters === 'number' &&
      Number.isFinite(params.elevationLossMeters) &&
      params.elevationLossMeters > 0;
    const hasRange =
      typeof params.minElevationMeters === 'number' &&
      typeof params.maxElevationMeters === 'number' &&
      Number.isFinite(params.minElevationMeters) &&
      Number.isFinite(params.maxElevationMeters) &&
      params.maxElevationMeters !== 0;

    let elevSentence = `Elevation gain: ${gainTxt}`;
    if (hasLoss) {
      elevSentence += ` (${formatElevationLoss(params.elevationLossMeters, unit)} descent)`;
    }
    elevSentence += ` · ${terrain.label}`;
    if (hasRange) {
      elevSentence += ` (${formatElevationValue(params.minElevationMeters, unit)}–${formatElevationValue(params.maxElevationMeters, unit)})`;
    }
    elevSentence += '.';
    parts.push(elevSentence);
  }

  if (typeof params.caloriesKcal === 'number' && Number.isFinite(params.caloriesKcal) && params.caloriesKcal >= 0) {
    parts.push(`Calories burnt: ${Math.round(params.caloriesKcal).toLocaleString()} kcal.`);
  }

  return parts.join(' ');
}



