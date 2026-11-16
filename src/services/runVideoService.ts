import { formatSpeed, getWorkoutMeta } from '../data/workouts';
import { TRICITY_CENTER } from '../data/tricityPlaces';
import {
  bearingDegrees,
  computeKmMarkers,
  decodePolyline,
  formatDistance,
  formatDuration,
  formatElevationGain,
  formatPace,
  haversineMeters,
} from '../lib/geo';
import type { LatLngLiteral, RunActivityDoc, WorkoutType } from '../types/run';
import { formatRunDateSafe } from './shareCardService';

export interface RunVideoPayload {
  id?: string;
  workoutType?: WorkoutType;
  title: string;
  startName: string;
  finishedAt: unknown;
  distanceMeters: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  avgSpeedKmh?: number;
  elevationGainMeters?: number | null;
  routeType: string;
  path: LatLngLiteral[];
}

export interface JourneySample extends LatLngLiteral {
  cumDistMeters: number;
  progress: number;
}

export interface InterpolatedJourneyPoint extends LatLngLiteral {
  cumDistMeters: number;
  headingDeg: number;
  progress: number;
}

export interface JourneyOverviewCamera {
  center: LatLngLiteral;
  zoom: number;
}

export interface VideoMimeSupport {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

export type TileCacheEntry = HTMLImageElement | 'error';
export type TileCache = Map<string, TileCacheEntry>;

export interface JourneyKmPin {
  km: number;
  position: LatLngLiteral;
  progress: number;
}

export interface JourneyRenderState {
  payload: RunVideoPayload;
  preferredUnit: 'km' | 'mi';
  samples: JourneySample[];
  totalPathMeters: number;
  kmPins: JourneyKmPin[];
  overviewCamera: JourneyOverviewCamera;
  followZoom: number;
  tileCache: TileCache;
}

export interface RecordedRunVideo {
  blob: Blob;
  file: File;
  mimeType: string;
  extension: 'mp4' | 'webm';
  objectUrl: string;
  filename: string;
}

const MAX_MERCATOR_LAT = 85.05112878;

export function buildVideoPayloadFromRun(run: {
  id?: string;
  workoutType?: WorkoutType;
  routeName?: string;
  startName?: string;
  finishedAt?: unknown;
  distanceMeters: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  avgSpeedKmh?: number;
  elevationGainMeters?: number | null;
  routeType: string;
  encodedPolyline?: string;
}): RunVideoPayload {
  const path = run.encodedPolyline ? decodePolyline(run.encodedPolyline) : [];
  const meta = getWorkoutMeta(run.workoutType);
  return {
    id: run.id,
    workoutType: meta.id,
    title: run.routeName || `${meta.fullLabel}`,
    startName: run.startName || `GPS ${meta.label}`,
    finishedAt: run.finishedAt,
    distanceMeters: Math.max(0, run.distanceMeters || 0),
    durationSec: Math.max(0, run.durationSec || 0),
    avgPaceSecPerKm: Math.max(0, run.avgPaceSecPerKm || 0),
    avgSpeedKmh: typeof run.avgSpeedKmh === 'number' ? run.avgSpeedKmh : undefined,
    elevationGainMeters:
      typeof run.elevationGainMeters === 'number' && Number.isFinite(run.elevationGainMeters)
        ? Math.round(run.elevationGainMeters)
        : null,
    routeType: run.routeType || 'circular',
    path,
  };
}

export function buildVideoPayloadFromSummary(
  summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>
): RunVideoPayload {
  return buildVideoPayloadFromRun(summary);
}

export function latLngToWorldPx(pt: LatLngLiteral, zoom: number): { x: number; y: number } {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, pt.lat));
  const scale = 256 * Math.pow(2, zoom);
  const x = ((pt.lng + 180) / 360) * scale;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function worldPxToLatLng(px: { x: number; y: number }, zoom: number): LatLngLiteral {
  const scale = 256 * Math.pow(2, zoom);
  const lng = (px.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * px.y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

export function computeJourneyOverviewCamera(
  path: LatLngLiteral[],
  viewportW = 960,
  viewportH = 660,
  padding = 96
): JourneyOverviewCamera {
  const valid = path.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length === 0) {
    return { center: { ...TRICITY_CENTER }, zoom: 14.5 };
  }
  if (valid.length === 1) {
    return { center: { ...valid[0] }, zoom: 15.2 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of valid) {
    const wp = latLngToWorldPx(p, 0);
    if (wp.x < minX) minX = wp.x;
    if (wp.x > maxX) maxX = wp.x;
    if (wp.y < minY) minY = wp.y;
    if (wp.y > maxY) maxY = wp.y;
  }

  const center = worldPxToLatLng({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  if (spanX < 1e-6 && spanY < 1e-6) {
    return { center, zoom: 15.4 };
  }

  const availW = Math.max(120, viewportW - padding * 2);
  const availH = Math.max(120, viewportH - padding * 2);

  const zoomX = spanX > 0 ? Math.log2(availW / spanX) : 16;
  const zoomY = spanY > 0 ? Math.log2(availH / spanY) : 16;
  const zoom = Math.max(11.5, Math.min(16.0, Math.min(zoomX, zoomY)));

  return {
    center,
    zoom: Number(zoom.toFixed(3)),
  };
}

export function resampleJourneyPath(
  path: LatLngLiteral[],
  sampleCount = 240
): { samples: JourneySample[]; totalPathMeters: number } {
  const valid = path.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length === 0) {
    return { samples: [], totalPathMeters: 0 };
  }
  if (valid.length === 1) {
    return {
      samples: [{ lat: valid[0].lat, lng: valid[0].lng, cumDistMeters: 0, progress: 0 }],
      totalPathMeters: 0,
    };
  }

  const cumDist: number[] = [0];
  for (let i = 1; i < valid.length; i++) {
    const seg = haversineMeters(valid[i - 1], valid[i]);
    cumDist.push(cumDist[i - 1] + seg);
  }
  const totalPathMeters = cumDist[cumDist.length - 1];
  if (totalPathMeters <= 0.5) {
    return {
      samples: [
        { lat: valid[0].lat, lng: valid[0].lng, cumDistMeters: 0, progress: 0 },
        { lat: valid[valid.length - 1].lat, lng: valid[valid.length - 1].lng, cumDistMeters: 0, progress: 1 },
      ],
      totalPathMeters: 0,
    };
  }

  const count = Math.max(16, sampleCount);
  const samples: JourneySample[] = [];
  let segIdx = 1;

  for (let k = 0; k < count; k++) {
    const progress = k / (count - 1);
    const targetDist = progress * totalPathMeters;
    while (segIdx < cumDist.length - 1 && cumDist[segIdx] < targetDist) {
      segIdx += 1;
    }
    const prevD = cumDist[segIdx - 1];
    const nextD = cumDist[segIdx];
    const span = Math.max(1e-6, nextD - prevD);
    const ratio = Math.max(0, Math.min(1, (targetDist - prevD) / span));
    const a = valid[segIdx - 1];
    const b = valid[segIdx];
    samples.push({
      lat: a.lat + (b.lat - a.lat) * ratio,
      lng: a.lng + (b.lng - a.lng) * ratio,
      cumDistMeters: targetDist,
      progress,
    });
  }

  return { samples, totalPathMeters };
}

export function interpolateJourneyAtProgress(
  samples: JourneySample[],
  progress: number
): InterpolatedJourneyPoint {
  if (samples.length === 0) {
    return {
      lat: TRICITY_CENTER.lat,
      lng: TRICITY_CENTER.lng,
      cumDistMeters: 0,
      headingDeg: 0,
      progress: 0,
    };
  }
  if (samples.length === 1) {
    return {
      lat: samples[0].lat,
      lng: samples[0].lng,
      cumDistMeters: samples[0].cumDistMeters,
      headingDeg: 0,
      progress: Math.max(0, Math.min(1, progress)),
    };
  }

  const clamped = Math.max(0, Math.min(1, progress));
  const scaledIdx = clamped * (samples.length - 1);
  const i0 = Math.min(samples.length - 2, Math.floor(scaledIdx));
  const i1 = i0 + 1;
  const frac = scaledIdx - i0;

  const a = samples[i0];
  const b = samples[i1];
  const lat = a.lat + (b.lat - a.lat) * frac;
  const lng = a.lng + (b.lng - a.lng) * frac;
  const cumDistMeters = a.cumDistMeters + (b.cumDistMeters - a.cumDistMeters) * frac;

  // Look slightly ahead/behind to avoid zero-length segment jitter
  const lookBack = samples[Math.max(0, i0 - 2)];
  const lookAhead = samples[Math.min(samples.length - 1, i1 + 2)];
  const headingDeg =
    haversineMeters(lookBack, lookAhead) > 0.5
      ? bearingDegrees(lookBack, lookAhead)
      : 0;

  return {
    lat,
    lng,
    cumDistMeters,
    headingDeg,
    progress: clamped,
  };
}

export function pickSupportedVideoMimeType(): VideoMimeSupport | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: VideoMimeSupport[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return { mimeType: 'video/webm', extension: 'webm' };
  }

  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mimeType)) {
        return c;
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

export function sanitizeVideoFilename(title: string, extension: 'mp4' | 'webm'): string {
  const base = (title || 'open-run')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const stem = base || 'open-run';
  return `open-run-journey-${stem}.${extension}`;
}

export function triggerVideoDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 200);
}

export function createJourneyRenderState(
  payload: RunVideoPayload,
  preferredUnit: 'km' | 'mi',
  tileCache: TileCache = new Map()
): JourneyRenderState {
  const { samples, totalPathMeters } = resampleJourneyPath(payload.path, 260);
  const overviewCamera = computeJourneyOverviewCamera(payload.path, 960, 620, 96);
  const followZoom = Math.max(13.8, Math.min(16.3, overviewCamera.zoom + 1.35));

  const rawMarkers = computeKmMarkers(payload.path);
  const kmPins: JourneyKmPin[] = rawMarkers.map((m) => ({
    km: m.km,
    position: m.position,
    progress:
      totalPathMeters > 0
        ? Math.min(0.99, Math.max(0.01, (m.km * 1000) / totalPathMeters))
        : 0.5,
  }));

  return {
    payload,
    preferredUnit,
    samples,
    totalPathMeters,
    kmPins,
    overviewCamera,
    followZoom,
    tileCache,
  };
}

function latLngToTileXY(pt: LatLngLiteral, zoom: number): { x: number; y: number } {
  const wp = latLngToWorldPx(pt, zoom);
  return {
    x: Math.floor(wp.x / 256),
    y: Math.floor(wp.y / 256),
  };
}

function loadTileImage(
  z: number,
  x: number,
  y: number,
  cache: TileCache
): Promise<void> {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return Promise.resolve();

  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      cache.set(key, 'error');
      resolve();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cache.set(key, 'error');
      resolve();
    }, 5500);

    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cache.set(key, img);
      resolve();
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cache.set(key, 'error');
      resolve();
    };

    img.src = `/api/map-tile/${z}/${x}/${y}.png`;
  });
}

export async function preloadJourneyTiles(
  state: JourneyRenderState,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const { payload, overviewCamera, followZoom, tileCache } = state;
  const overviewZ = Math.max(10, Math.min(18, Math.round(overviewCamera.zoom)));
  const followZ = Math.max(10, Math.min(18, Math.round(followZoom)));

  const requestedKeys = new Map<string, { z: number; x: number; y: number }>();
  const addNeighborhood = (pt: LatLngLiteral, z: number, radius: number) => {
    const maxTile = (1 << z) - 1;
    const center = latLngToTileXY(pt, z);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const tx = center.x + dx;
        const ty = center.y + dy;
        if (tx < 0 || ty < 0 || tx > maxTile || ty > maxTile) continue;
        const k = `${z}/${tx}/${ty}`;
        if (!tileCache.has(k) && !requestedKeys.has(k)) {
          requestedKeys.set(k, { z, x: tx, y: ty });
        }
      }
    }
  };

  // Overview map grid (3x3 around overview center covers 960x960 comfortably)
  addNeighborhood(overviewCamera.center, overviewZ, 2);

  // Follow zoom corridor tiles along the route
  const pathPts = payload.path.length > 0 ? payload.path : [overviewCamera.center];
  const sampleStep = Math.max(1, Math.floor(pathPts.length / 12));
  for (let i = 0; i < pathPts.length; i += sampleStep) {
    addNeighborhood(pathPts[i], followZ, 1);
  }
  addNeighborhood(pathPts[pathPts.length - 1], followZ, 1);

  const list = Array.from(requestedKeys.values()).slice(0, 56);
  if (list.length === 0) {
    onProgress?.(1);
    return;
  }

  let completed = 0;
  const concurrency = 6;
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const idx = cursor++;
      const item = list[idx];
      await loadTileImage(item.z, item.x, item.y, tileCache);
      completed += 1;
      onProgress?.(completed / list.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
}

function easeInOutCubic(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - t, 3);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawMapTiles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cameraCenter: LatLngLiteral,
  cameraZoom: number,
  focalX: number,
  focalY: number,
  tileCache: TileCache
): void {
  // Base warm Chandigarh map ground
  ctx.fillStyle = '#EAECE5';
  ctx.fillRect(0, 0, width, height);

  const tileZoom = Math.max(10, Math.min(18, Math.round(cameraZoom)));
  const tileWorldSize = 256 * Math.pow(2, cameraZoom - tileZoom);
  const centerWorld = latLngToWorldPx(cameraCenter, cameraZoom);
  const topLeftWorldX = centerWorld.x - focalX;
  const topLeftWorldY = centerWorld.y - focalY;

  const minTx = Math.floor(topLeftWorldX / tileWorldSize);
  const maxTx = Math.floor((topLeftWorldX + width) / tileWorldSize);
  const minTy = Math.floor(topLeftWorldY / tileWorldSize);
  const maxTy = Math.floor((topLeftWorldY + height) / tileWorldSize);
  const maxTileIdx = (1 << tileZoom) - 1;

  let drewAnyTile = false;

  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      if (tx < 0 || ty < 0 || tx > maxTileIdx || ty > maxTileIdx) continue;
      const sx = tx * tileWorldSize - topLeftWorldX;
      const sy = ty * tileWorldSize - topLeftWorldY;

      const entry = tileCache.get(`${tileZoom}/${tx}/${ty}`);
      if (entry && entry !== 'error' && entry.complete && entry.naturalWidth > 0) {
        ctx.drawImage(entry, sx, sy, tileWorldSize + 0.6, tileWorldSize + 0.6);
        drewAnyTile = true;
      } else {
        // Fallback: check one zoom level out so zoom transitions never flash blank
        const parentZ = tileZoom - 1;
        const ptx = Math.floor(tx / 2);
        const pty = Math.floor(ty / 2);
        const parentEntry = tileCache.get(`${parentZ}/${ptx}/${pty}`);
        if (
          parentEntry &&
          parentEntry !== 'error' &&
          parentEntry.complete &&
          parentEntry.naturalWidth > 0
        ) {
          const subX = (tx % 2) * 128;
          const subY = (ty % 2) * 128;
          ctx.drawImage(
            parentEntry,
            subX,
            subY,
            128,
            128,
            sx,
            sy,
            tileWorldSize + 0.6,
            tileWorldSize + 0.6
          );
          drewAnyTile = true;
        }
      }
    }
  }

  // Architectural Chandigarh sector grid fallback if tiles are still loading or offline
  if (!drewAnyTile) {
    ctx.strokeStyle = 'rgba(23, 45, 39, 0.08)';
    ctx.lineWidth = 1.5;
    const step = 80;
    const offX = ((-topLeftWorldX % step) + step) % step;
    const offY = ((-topLeftWorldY % step) + step) % step;
    for (let x = offX; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = offY; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }
}

export function renderJourneyFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: JourneyRenderState,
  rawT: number
): void {
  const t = Math.max(0, Math.min(1, rawT));
  const { payload, preferredUnit, samples, totalPathMeters, kmPins, overviewCamera, followZoom, tileCache } =
    state;

  const hasPath = samples.length >= 2 && totalPathMeters > 0.5;
  const focalX = width * 0.5;
  const focalY = height * 0.4; // Keep route & runner centered above bottom telemetry HUD

  // 3-Phase Strava-style camera + progress choreography
  let journeyP = 0;
  let cameraCenter: LatLngLiteral = overviewCamera.center;
  let cameraZoom = overviewCamera.zoom;
  let phaseLabel = 'START';

  if (t <= 0.08) {
    // Phase 1: Start point intro reveal
    const local = easeOutCubic(t / 0.08);
    journeyP = 0;
    const startPt = samples[0] ?? overviewCamera.center;
    cameraCenter = startPt;
    cameraZoom = followZoom - 0.35 + 0.35 * local;
    phaseLabel = 'START';
  } else if (t <= 0.82) {
    // Phase 2: Smooth Start -> Finish flyover
    const local = (t - 0.08) / 0.74;
    // Gentle ease-in at start & ease-out at finish while maintaining steady visual speed in middle
    journeyP = 0.0 + easeInOutCubic(local);
    const runner = interpolateJourneyAtProgress(samples, journeyP);
    if (hasPath) {
      // Blend slightly toward overview center so large routes don't whip awkwardly
      cameraCenter = {
        lat: runner.lat * 0.88 + overviewCamera.center.lat * 0.12,
        lng: runner.lng * 0.88 + overviewCamera.center.lng * 0.12,
      };
    } else {
      cameraCenter = overviewCamera.center;
    }
    cameraZoom = followZoom;
    phaseLabel = 'IN PROGRESS';
  } else {
    // Phase 3: Overview Zoom-Out showing full Start -> Finish journey
    const local = easeInOutCubic((t - 0.82) / 0.18);
    journeyP = 1;
    const finishPt = samples[samples.length - 1] ?? overviewCamera.center;
    const preZoomCenter = hasPath
      ? {
          lat: finishPt.lat * 0.88 + overviewCamera.center.lat * 0.12,
          lng: finishPt.lng * 0.88 + overviewCamera.center.lng * 0.12,
        }
      : overviewCamera.center;
    cameraCenter = {
      lat: preZoomCenter.lat + (overviewCamera.center.lat - preZoomCenter.lat) * local,
      lng: preZoomCenter.lng + (overviewCamera.center.lng - preZoomCenter.lng) * local,
    };
    cameraZoom = followZoom + (overviewCamera.zoom - followZoom) * local;
    phaseLabel = 'COMPLETE';
  }

  // 1. Draw real Chandigarh street/park map tiles
  drawMapTiles(ctx, width, height, cameraCenter, cameraZoom, focalX, focalY, tileCache);

  // Subtle edge vignette for contrast
  const topVignette = ctx.createLinearGradient(0, 0, 0, height * 0.2);
  topVignette.addColorStop(0, 'rgba(23, 45, 39, 0.42)');
  topVignette.addColorStop(1, 'rgba(23, 45, 39, 0)');
  ctx.fillStyle = topVignette;
  ctx.fillRect(0, 0, width, height * 0.2);

  const centerWorld = latLngToWorldPx(cameraCenter, cameraZoom);
  const project = (pt: LatLngLiteral) => {
    const wp = latLngToWorldPx(pt, cameraZoom);
    return {
      x: wp.x - centerWorld.x + focalX,
      y: wp.y - centerWorld.y + focalY,
    };
  };

  // 2. Draw Route Geometry
  if (hasPath) {
    // Subtle full-route ghost preview
    ctx.save();
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(23, 45, 39, 0.28)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((pt, idx) => {
      const xy = project(pt);
      if (idx === 0) ctx.moveTo(xy.x, xy.y);
      else ctx.lineTo(xy.x, xy.y);
    });
    ctx.stroke();
    ctx.restore();

    // Traversed active route up to journeyP
    const activeCount = Math.max(1, Math.floor(journeyP * (samples.length - 1)));
    const headPt = interpolateJourneyAtProgress(samples, journeyP);

    if (journeyP > 0.002) {
      const drawActivePath = () => {
        ctx.beginPath();
        for (let i = 0; i <= activeCount; i++) {
          const xy = project(samples[i]);
          if (i === 0) ctx.moveTo(xy.x, xy.y);
          else ctx.lineTo(xy.x, xy.y);
        }
        const hxy = project(headPt);
        ctx.lineTo(hxy.x, hxy.y);
      };

      // Dark-forest route casing
      ctx.save();
      ctx.strokeStyle = '#172D27';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawActivePath();
      ctx.stroke();

      // Electric-lime Strava/Tricity active ribbon
      ctx.shadowColor = 'rgba(154, 230, 46, 0.55)';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#9AE62E';
      ctx.lineWidth = 7.5;
      drawActivePath();
      ctx.stroke();
      ctx.restore();
    }

    // KM Milestone pins that pop in as the runner passes them
    for (const pin of kmPins) {
      if (journeyP < pin.progress && t < 0.85) continue;
      const pxy = project(pin.position);
      const pop = t >= 0.85 ? 1 : easeOutCubic(Math.min(1, (journeyP - pin.progress) / 0.04));
      const r = 14 * (0.4 + 0.6 * pop);

      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(pxy.x, pxy.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#172D27';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#172D27';
      ctx.font = '700 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${pin.km}K`, pxy.x, pxy.y + 0.5);
      ctx.restore();
    }

    // Start & Finish pins
    const startXY = project(samples[0]);
    const endXY = project(samples[samples.length - 1]);
    const isLoopClose = Math.hypot(startXY.x - endXY.x, startXY.y - endXY.y) < 28;
    const showFinish = journeyP >= 0.96 || t >= 0.82;

    // Start pin
    const startScale = t <= 0.08 ? 0.6 + 0.4 * easeOutCubic(t / 0.08) : 1;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(startXY.x, startXY.y, 18 * startScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#172D27';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#172D27';
    ctx.font = '800 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isLoopClose && showFinish ? 'S/F' : 'S', startXY.x, startXY.y + 1);
    ctx.restore();

    // Finish pin (shown when arrived or during overview)
    if (showFinish && !isLoopClose) {
      const fScale = t >= 0.82 ? 1 : easeOutCubic((journeyP - 0.96) / 0.04);
      ctx.save();
      ctx.fillStyle = '#172D27';
      ctx.beginPath();
      ctx.arc(endXY.x, endXY.y, 18 * fScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9AE62E';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('F', endXY.x, endXY.y + 1);
      ctx.restore();
    }

    // Directional runner beacon during Start -> Finish flyover
    if (t < 0.88) {
      const rxy = project(headPt);
      const beaconAlpha = t > 0.82 ? 1 - (t - 0.82) / 0.06 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, beaconAlpha);

      // Soft outer halo
      ctx.fillStyle = 'rgba(154, 230, 46, 0.32)';
      ctx.beginPath();
      ctx.arc(rxy.x, rxy.y, 26, 0, Math.PI * 2);
      ctx.fill();

      // Core circular badge rotated in running direction
      ctx.translate(rxy.x, rxy.y);
      ctx.rotate((headPt.headingDeg * Math.PI) / 180);

      ctx.fillStyle = '#172D27';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Forward directional arrow inside beacon
      ctx.fillStyle = '#9AE62E';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6.5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6.5, 6);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  } else {
    // Minimal/No GPS fallback: centered pulse-free route emblem on Chandigarh map
    const cxy = project(overviewCamera.center);
    ctx.save();
    ctx.fillStyle = 'rgba(23, 45, 39, 0.88)';
    ctx.beginPath();
    ctx.arc(cxy.x, cxy.y, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9AE62E';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#9AE62E';
    ctx.font = '800 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const meta = getWorkoutMeta(payload.workoutType);
    ctx.fillText(`${meta.label.toUpperCase()} LOG`, cxy.x, cxy.y - 8);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 13px sans-serif';
    ctx.fillText((payload.startName || 'WORLD').toUpperCase().slice(0, 14), cxy.x, cxy.y + 14);
    ctx.restore();

    if (t > 0.08 && t <= 0.82) {
      journeyP = easeInOutCubic((t - 0.08) / 0.74);
    } else if (t > 0.82) {
      journeyP = 1;
    }
  }

  const meta = getWorkoutMeta(payload.workoutType);

  // 3. Top Header Bar
  ctx.save();
  drawRoundedRect(ctx, 32, 28, 356, 42, 12);
  ctx.fillStyle = 'rgba(23, 45, 39, 0.9)';
  ctx.fill();
  ctx.fillStyle = '#9AE62E';
  ctx.font = '700 14px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(`OPEN RUN  ·  ${meta.fullLabel.toUpperCase()}`, 48, 49);

  drawRoundedRect(ctx, width - 196, 28, 164, 42, 12);
  ctx.fillStyle = 'rgba(23, 45, 39, 0.9)';
  ctx.fill();
  ctx.fillStyle = phaseLabel === 'COMPLETE' ? '#9AE62E' : '#B8E8C7';
  ctx.font = '700 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(phaseLabel, width - 114, 49);
  ctx.restore();

  // 4. Bottom Telemetry Scrim & Live-Ticking Stats HUD
  const scrimTop = height * 0.56;
  const scrimGrad = ctx.createLinearGradient(0, scrimTop, 0, height);
  scrimGrad.addColorStop(0, 'rgba(23, 45, 39, 0)');
  scrimGrad.addColorStop(0.32, 'rgba(23, 45, 39, 0.88)');
  scrimGrad.addColorStop(0.65, '#172D27');
  scrimGrad.addColorStop(1, '#12241F');
  ctx.fillStyle = scrimGrad;
  ctx.fillRect(0, scrimTop, width, height - scrimTop);

  const safeTitle = String(payload.title || meta.fullLabel).slice(0, 38);
  const elevSuffix =
    typeof payload.elevationGainMeters === 'number' && payload.elevationGainMeters > 0
      ? `  ·  ${formatElevationGain(payload.elevationGainMeters * journeyP, preferredUnit)} ELEV`
      : '';
  const safeMeta = `${formatRunDateSafe(payload.finishedAt)}  ·  ${payload.startName || 'GPS Route'}${elevSuffix}`.slice(0, 68);

  ctx.save();
  ctx.fillStyle = '#B8E8C7';
  ctx.font = '600 20px sans-serif';
  ctx.fillText(safeMeta, 42, height - 208);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 38px sans-serif';
  ctx.fillText(safeTitle, 42, height - 160);

  // Divider
  ctx.strokeStyle = 'rgba(184, 232, 199, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(42, height - 134);
  ctx.lineTo(width - 42, height - 134);
  ctx.stroke();

  // Live Distance, Duration, Pace or Speed
  const liveDistMeters = payload.distanceMeters * journeyP;
  const liveDurationSec = Math.round(payload.durationSec * journeyP);
  const speedKmh =
    typeof payload.avgSpeedKmh === 'number' && payload.avgSpeedKmh > 0
      ? payload.avgSpeedKmh
      : payload.avgPaceSecPerKm > 0
      ? 3600 / payload.avgPaceSecPerKm
      : payload.durationSec > 0
      ? (payload.distanceMeters / 1000) / (payload.durationSec / 3600)
      : 0;
  const rateLabel =
    meta.primaryMetric === 'speed'
      ? journeyP > 0.02
        ? formatSpeed(speedKmh, preferredUnit)
        : preferredUnit === 'mi'
        ? '--.- mph'
        : '--.- km/h'
      : journeyP > 0.02
      ? `${formatPace(payload.avgPaceSecPerKm, preferredUnit)}/${preferredUnit}`
      : `--:--`;

  const col1X = 42;
  const col2X = width * 0.39;
  const col3X = width * 0.72;

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '600 17px sans-serif';
  ctx.fillText('DISTANCE', col1X, height - 102);
  ctx.fillText('DURATION', col2X, height - 102);
  ctx.fillText(meta.primaryMetric === 'speed' ? 'AVG SPEED' : 'AVG PACE', col3X, height - 102);

  ctx.fillStyle = '#9AE62E';
  ctx.font = '700 44px monospace';
  ctx.fillText(formatDistance(liveDistMeters, preferredUnit), col1X, height - 54);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px monospace';
  ctx.fillText(formatDuration(liveDurationSec), col2X, height - 54);
  ctx.fillText(rateLabel, col3X, height - 54);

  // Journey progress bar along bottom
  const barX = 42;
  const barY = height - 26;
  const barW = width - 84;
  drawRoundedRect(ctx, barX, barY, barW, 8, 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();

  const fillW = Math.max(8, barW * journeyP);
  drawRoundedRect(ctx, barX, barY, fillW, 8, 4);
  ctx.fillStyle = '#9AE62E';
  ctx.fill();
  ctx.restore();
}

export async function recordJourneyVideo(params: {
  state: JourneyRenderState;
  durationMs?: number;
  onProgress?: (fraction: number, stage: 'tiles' | 'recording') => void;
  signal?: AbortSignal;
}): Promise<RecordedRunVideo> {
  const { state, durationMs = 10000, onProgress, signal } = params;
  if (typeof document === 'undefined') {
    throw new Error('Video export is only supported in the browser.');
  }

  const support = pickSupportedVideoMimeType();
  if (!support) {
    throw new Error('This browser does not support video recording export.');
  }

  if (state.tileCache.size === 0) {
    await preloadJourneyTiles(state, (p) => onProgress?.(p * 0.25, 'tiles'));
  }
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize video canvas.');
  }

  const captureFn = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream })
    .captureStream;
  if (typeof captureFn !== 'function') {
    throw new Error('Canvas stream capture is unsupported in this browser.');
  }

  // Draw initial frame before starting MediaRecorder
  renderJourneyFrame(ctx, 960, 960, state, 0);

  const stream = captureFn.call(canvas, 30);
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: support.mimeType,
      videoBitsPerSecond: 3_500_000,
    });
  } catch {
    recorder = new MediaRecorder(stream);
  }

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  const holdMs = 900; // Brief final hold on full Start -> Finish overview
  const totalMs = durationMs + holdMs;

  return new Promise<RecordedRunVideo>((resolve, reject) => {
    let timerId: number | null = null;
    let finished = false;

    const cleanup = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
      stream.getTracks().forEach((track) => track.stop());
    };

    const onAbort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Ignore stop error on abort
      }
      reject(new DOMException('Video export cancelled.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    recorder.onerror = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('MediaRecorder failed while encoding run video.'));
    };

    recorder.onstop = () => {
      signal?.removeEventListener('abort', onAbort);
      if (finished) return;
      finished = true;
      cleanup();
      const blob = new Blob(chunks, { type: recorder.mimeType || support.mimeType });
      if (blob.size === 0) {
        reject(new Error('Generated video file was empty.'));
        return;
      }
      const filename = sanitizeVideoFilename(state.payload.title, support.extension);
      const file = new File([blob], filename, {
        type: blob.type || support.mimeType,
        lastModified: Date.now(),
      });
      const objectUrl = URL.createObjectURL(blob);
      resolve({
        blob,
        file,
        mimeType: blob.type || support.mimeType,
        extension: support.extension,
        objectUrl,
        filename,
      });
    };

    recorder.start(250);
    const startPerf = performance.now();

    timerId = window.setInterval(() => {
      if (finished || signal?.aborted) return;
      const elapsed = performance.now() - startPerf;
      const t = Math.min(1, elapsed / durationMs);
      renderJourneyFrame(ctx, 960, 960, state, t);
      onProgress?.(0.25 + 0.75 * Math.min(1, elapsed / totalMs), 'recording');

      if (elapsed >= totalMs) {
        if (timerId !== null) {
          window.clearInterval(timerId);
          timerId = null;
        }
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          reject(new Error('Could not finalize video recording.'));
        }
      }
    }, 33);
  });
}
