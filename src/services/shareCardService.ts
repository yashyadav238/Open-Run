import {
  computeKmMarkers,
  formatDistance,
  formatDuration,
  formatPace,
} from '../lib/geo';
import type { LatLngLiteral, SplitRecord } from '../types/run';

export type ShareCardStyle = 'route' | 'splits' | 'adidas_poster' | 'pace_chart';

export interface ShareCardStyleMeta {
  id: ShareCardStyle;
  label: string;
  shortDesc: string;
}

export const SHARE_CARD_STYLES: ShareCardStyleMeta[] = [
  { id: 'route', label: 'Route Map', shortDesc: 'Map trace & 1K pins' },
  { id: 'splits', label: 'KM Splits', shortDesc: 'Adidas-style split bars' },
  { id: 'adidas_poster', label: 'Run Poster', shortDesc: 'Bold workout poster' },
  { id: 'pace_chart', label: 'Pace Chart', shortDesc: 'KM pace progression' },
];

export interface ShareCardRenderInput {
  style?: ShareCardStyle;
  title: string;
  subtitle: string;
  path: LatLngLiteral[];
  intendedPath?: LatLngLiteral[];
  primaryStatValue: string;
  secondaryLine: string;
  footerText: string;
  badgeText?: string;
  unit?: 'km' | 'mi';
  distanceMeters?: number;
  durationSec?: number;
  avgPaceSecPerKm?: number;
  avgSpeedKmh?: number;
  splits?: SplitRecord[];
}

export interface RenderedShareCard {
  blob: Blob;
  dataUrl: string;
}

export interface PreparedShareCard extends RenderedShareCard {
  file: File;
  filename: string;
  shareTitle: string;
  shareText: string;
  style: ShareCardStyle;
  sourceInput?: ShareCardRenderInput;
}

export interface SplitBarMetric {
  km: number;
  splitDurationSec: number;
  paceSecPerKm: number;
  speedRatio: number; // 0.3..1.0 where 1.0 = fastest split
  isFastest: boolean;
}

export interface SplitSummaryStats {
  bars: SplitBarMetric[];
  fastestKm: number | null;
  fastestPaceSec: number;
  slowestPaceSec: number;
  avgPaceSec: number;
}

export function buildSplitShareSummary(splits: SplitRecord[] = []): SplitSummaryStats {
  const valid = splits
    .filter((s) => Number.isFinite(s.km) && s.paceSecPerKm > 0 && s.splitDurationSec > 0)
    .sort((a, b) => a.km - b.km);

  if (valid.length === 0) {
    return {
      bars: [],
      fastestKm: null,
      fastestPaceSec: 0,
      slowestPaceSec: 0,
      avgPaceSec: 0,
    };
  }

  let fastestPaceSec = Infinity;
  let slowestPaceSec = 0;
  let fastestKm = valid[0].km;
  let sumPace = 0;

  for (const s of valid) {
    sumPace += s.paceSecPerKm;
    if (s.paceSecPerKm < fastestPaceSec) {
      fastestPaceSec = s.paceSecPerKm;
      fastestKm = s.km;
    }
    if (s.paceSecPerKm > slowestPaceSec) {
      slowestPaceSec = s.paceSecPerKm;
    }
  }

  const avgPaceSec = Math.round(sumPace / valid.length);
  const spread = Math.max(15, slowestPaceSec - fastestPaceSec);

  const bars: SplitBarMetric[] = valid.map((s) => {
    // Faster splits get longer athletic bars (1.0 for fastest, down to 0.35 for slowest)
    const normalized =
      slowestPaceSec === fastestPaceSec
        ? 0.85
        : 1 - ((s.paceSecPerKm - fastestPaceSec) / spread) * 0.62;
    return {
      km: s.km,
      splitDurationSec: s.splitDurationSec,
      paceSecPerKm: s.paceSecPerKm,
      speedRatio: Math.max(0.32, Math.min(1, Number(normalized.toFixed(3)))),
      isFastest: s.km === fastestKm,
    };
  });

  return {
    bars,
    fastestKm,
    fastestPaceSec,
    slowestPaceSec,
    avgPaceSec,
  };
}

export function sanitizeShareFilename(filename: string): string {
  const clean = (filename || 'tricity-run.png').replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean.endsWith('.png') ? clean : `${clean}.png`;
}

export function withStyleSuffixFilename(baseFilename: string, style: ShareCardStyle): string {
  const clean = sanitizeShareFilename(baseFilename);
  if (style === 'route') return clean;
  const stem = clean.replace(/\.png$/i, '');
  return `${stem}-${style}.png`;
}

export function formatRunDateSafe(value: unknown): string {
  if (!value) return 'Recent Run';
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  if (typeof value === 'object' && value !== null) {
    const maybeTs = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      const d = maybeTs.toDate();
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    if (typeof maybeTs.seconds === 'number') {
      const d = new Date(maybeTs.seconds * 1000);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
  }
  return 'Recent Run';
}

export function dataUrlToBlobSync(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(parts[1] || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
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

function drawAdidasThreeBars(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  topY: number,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const stripes = [
    { offset: 0, h: 42, color: '#9AE62E' },
    { offset: 28, h: 64, color: '#B8E8C7' },
    { offset: 56, h: 86, color: '#30483E' },
  ];
  for (const s of stripes) {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    const x = rightX - 74 + s.offset;
    const y = topY + (86 - s.h);
    ctx.moveTo(x + 12, y);
    ctx.lineTo(x + 28, y);
    ctx.lineTo(x + 16, y + s.h);
    ctx.lineTo(x, y + s.h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawProjectedRoute(
  ctx: CanvasRenderingContext2D,
  safePath: LatLngLiteral[],
  safeIntended: LatLngLiteral[],
  box: { cx: number; cy: number; maxW: number; maxH: number },
  options: { strokeColor?: string; strokeWidth?: number; showKmSymbols?: boolean; showPins?: boolean } = {}
): void {
  const allPts = [...safeIntended, ...safePath];
  if (allPts.length < 2) return;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of allPts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const spanLat = Math.max(0.001, maxLat - minLat);
  const spanLngScaled = Math.max(0.001, (maxLng - minLng) * cosLat);
  const scale = Math.min(box.maxW / spanLngScaled, box.maxH / spanLat);

  const toXY = (p: LatLngLiteral) => ({
    x: box.cx + (p.lng - (minLng + maxLng) / 2) * cosLat * scale,
    y: box.cy - (p.lat - midLat) * scale,
  });

  if (safeIntended.length > 1) {
    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = 'rgba(184, 232, 199, 0.36)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    safeIntended.forEach((p, idx) => {
      const { x, y } = toXY(p);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  if (safePath.length > 1) {
    ctx.save();
    ctx.strokeStyle = options.strokeColor || '#9AE62E';
    ctx.lineWidth = options.strokeWidth || 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    safePath.forEach((p, idx) => {
      const { x, y } = toXY(p);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    if (options.showKmSymbols !== false) {
      const kmPins = computeKmMarkers(safePath);
      kmPins.forEach((km) => {
        const kxy = toXY(km.position);
        ctx.save();
        // Adidas-style 1km milestone diamond/circle emblem
        ctx.fillStyle = '#172D27';
        ctx.beginPath();
        ctx.arc(kxy.x, kxy.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#9AE62E';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${km.km}K`, kxy.x, kxy.y + 0.5);
        ctx.restore();
      });
    }

    if (options.showPins !== false) {
      const startXY = toXY(safePath[0]);
      const endXY = toXY(safePath[safePath.length - 1]);
      const isLoop = Math.hypot(startXY.x - endXY.x, startXY.y - endXY.y) < 16;

      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(startXY.x, startXY.y, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#172D27';
      ctx.font = '700 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isLoop ? 'S/F' : 'S', startXY.x, startXY.y + 1);

      if (!isLoop) {
        ctx.fillStyle = '#30483E';
        ctx.beginPath();
        ctx.arc(endXY.x, endXY.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('F', endXY.x, endXY.y + 1);
      }
      ctx.restore();
    }
  }
}

function renderRouteStyleCard(
  ctx: CanvasRenderingContext2D,
  input: ShareCardRenderInput,
  safePath: LatLngLiteral[],
  safeIntended: LatLngLiteral[]
): void {
  const safeTitle = String(input.title || 'Chandigarh Run').slice(0, 34);
  const safeSubtitle = String(input.subtitle || 'TRICITY RUN  ·  CHANDIGARH ACTIVITY').slice(0, 56);
  const safePrimary = String(input.primaryStatValue || '0.00 km');
  const safeSecondary = String(input.secondaryLine || '');
  const safeFooter = String(input.footerText || 'Chandigarh');

  ctx.fillStyle = '#172D27';
  ctx.fillRect(0, 0, 1080, 1080);

  // Subtle architectural grid lines inside map artwork frame
  ctx.strokeStyle = 'rgba(184, 232, 199, 0.07)';
  ctx.lineWidth = 1.5;
  for (let x = 72; x <= 1008; x += 117) {
    ctx.beginPath();
    ctx.moveTo(x, 225);
    ctx.lineTo(x, 705);
    ctx.stroke();
  }
  for (let y = 225; y <= 705; y += 96) {
    ctx.beginPath();
    ctx.moveTo(72, y);
    ctx.lineTo(1008, y);
    ctx.stroke();
  }

  drawAdidasThreeBars(ctx, 1008, 72, 0.9);

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '600 24px sans-serif';
  ctx.fillText(safeSubtitle, 72, 92);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px sans-serif';
  ctx.fillText(safeTitle, 72, 158);

  if (input.badgeText) {
    ctx.fillStyle = '#9AE62E';
    ctx.font = '700 24px monospace';
    ctx.fillText(String(input.badgeText), 72, 204);
  }

  if (safePath.length > 1 || safeIntended.length > 1) {
    drawProjectedRoute(ctx, safePath, safeIntended, {
      cx: 540,
      cy: 470,
      maxW: 760,
      maxH: 420,
    });
  } else {
    ctx.fillStyle = 'rgba(154, 230, 46, 0.1)';
    ctx.beginPath();
    ctx.arc(540, 465, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9AE62E';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#9AE62E';
    ctx.font = '700 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COMPLETED RUN', 540, 448);
    ctx.fillStyle = '#B8E8C7';
    ctx.font = '500 22px sans-serif';
    ctx.fillText('CHANDIGARH', 540, 488);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 735);
  ctx.lineTo(1008, 735);
  ctx.stroke();

  ctx.fillStyle = '#9AE62E';
  ctx.font = '700 84px monospace';
  ctx.fillText(safePrimary, 72, 835);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 32px monospace';
  ctx.fillText(safeSecondary, 72, 908);

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '500 24px sans-serif';
  ctx.fillText(safeFooter.slice(0, 62), 72, 980);
}

function renderKmSplitsStyleCard(
  ctx: CanvasRenderingContext2D,
  input: ShareCardRenderInput,
  safePath: LatLngLiteral[]
): void {
  const unit = input.unit || 'km';
  const safeTitle = String(input.title || 'Chandigarh Run').slice(0, 32);
  const safeFooter = String(input.footerText || 'Chandigarh').slice(0, 56);
  const distText =
    typeof input.distanceMeters === 'number'
      ? formatDistance(input.distanceMeters, unit)
      : input.primaryStatValue;
  const durText =
    typeof input.durationSec === 'number' ? formatDuration(input.durationSec) : '--:--';
  const avgPaceText =
    typeof input.avgPaceSecPerKm === 'number'
      ? `${formatPace(input.avgPaceSecPerKm, unit)}/${unit}`
      : '--:--';

  const splitSummary = buildSplitShareSummary(input.splits || []);

  // Crisp Adidas Running inspired dark athletic backdrop
  const bgGrad = ctx.createLinearGradient(0, 0, 1080, 1080);
  bgGrad.addColorStop(0, '#0F1C18');
  bgGrad.addColorStop(1, '#172D27');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1080, 1080);

  drawAdidasThreeBars(ctx, 1008, 64, 0.95);

  ctx.fillStyle = '#9AE62E';
  ctx.font = '700 22px monospace';
  ctx.fillText('KM SPLITWISE PACE  ·  TRICITY RUN', 72, 88);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px sans-serif';
  ctx.fillText(safeTitle, 72, 148);

  // Top 3 KPI boxes
  drawRoundedRect(ctx, 72, 182, 936, 122, 20);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(184, 232, 199, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const kpiLabels = ['DISTANCE', 'DURATION', 'AVG PACE'];
  const kpiValues = [distText, durText, avgPaceText];
  const kpiColors = ['#9AE62E', '#FFFFFF', '#FFFFFF'];
  for (let i = 0; i < 3; i++) {
    const x = 104 + i * 310;
    ctx.fillStyle = '#B8E8C7';
    ctx.font = '600 18px sans-serif';
    ctx.fillText(kpiLabels[i], x, 222);

    ctx.fillStyle = kpiColors[i];
    ctx.font = '700 42px monospace';
    ctx.fillText(kpiValues[i], x, 276);
  }

  // Splits Table Container
  drawRoundedRect(ctx, 72, 332, 936, 588, 22);
  ctx.fillStyle = 'rgba(14, 26, 22, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(184, 232, 199, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (splitSummary.bars.length > 0) {
    // Column headers
    ctx.fillStyle = '#B8E8C7';
    ctx.font = '700 18px monospace';
    ctx.fillText('KM', 104, 376);
    ctx.fillText('PACE EFFORT', 220, 376);
    ctx.fillText(`PACE (/${unit.toUpperCase()})`, 708, 376);
    ctx.fillText('SPLIT', 892, 376);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(104, 394);
    ctx.lineTo(976, 394);
    ctx.stroke();

    const maxRows = 10;
    const shown = splitSummary.bars.slice(0, maxRows);
    const hiddenCount = Math.max(0, splitSummary.bars.length - maxRows);
    const rowStep = shown.length <= 6 ? 76 : shown.length <= 8 ? 60 : 48;
    const barHeight = shown.length <= 6 ? 22 : shown.length <= 8 ? 18 : 14;

    shown.forEach((b, idx) => {
      const y = 434 + idx * rowStep;

      ctx.fillStyle = b.isFastest ? '#9AE62E' : '#FFFFFF';
      ctx.font = '700 22px monospace';
      ctx.fillText(`${String(b.km).padStart(2, '0')}`, 104, y);

      // Bar track
      const trackX = 220;
      const trackW = 445;
      const barY = y - barHeight + 2;
      drawRoundedRect(ctx, trackX, barY, trackW, barHeight, barHeight / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fill();

      // Bar fill
      const fillW = Math.max(24, Math.round(trackW * b.speedRatio));
      drawRoundedRect(ctx, trackX, barY, fillW, barHeight, barHeight / 2);
      ctx.fillStyle = b.isFastest ? '#9AE62E' : '#B8E8C7';
      ctx.fill();

      // Pace value
      ctx.fillStyle = b.isFastest ? '#9AE62E' : '#FFFFFF';
      ctx.font = '700 23px monospace';
      ctx.fillText(formatPace(b.paceSecPerKm, unit), 708, y);

      if (b.isFastest) {
        ctx.fillStyle = '#9AE62E';
        ctx.font = '700 13px monospace';
        ctx.fillText('BEST', 798, y - 2);
      }

      // Split cumulative / duration
      ctx.fillStyle = '#B8E8C7';
      ctx.font = '600 21px monospace';
      ctx.fillText(formatDuration(b.splitDurationSec), 892, y);
    });

    if (hiddenCount > 0) {
      ctx.fillStyle = '#B8E8C7';
      ctx.font = '600 18px sans-serif';
      ctx.fillText(
        `+ ${hiddenCount} more km split${hiddenCount > 1 ? 's' : ''} · Fastest KM ${splitSummary.fastestKm} (${formatPace(splitSummary.fastestPaceSec, unit)}/${unit})`,
        104,
        896
      );
    } else if (splitSummary.fastestKm !== null) {
      ctx.fillStyle = '#9AE62E';
      ctx.font = '700 19px monospace';
      ctx.fillText(
        `FASTEST SPLIT: KM ${splitSummary.fastestKm} @ ${formatPace(splitSummary.fastestPaceSec, unit)}/${unit}`,
        104,
        894
      );
    }
  } else {
    // Graceful sub-1K / no-splits state
    if (safePath.length > 1) {
      drawProjectedRoute(ctx, safePath, [], { cx: 540, cy: 545, maxW: 540, maxH: 260 }, { showKmSymbols: false });
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Run Distance Under 1.00 KM', 540, 760);
    ctx.fillStyle = '#B8E8C7';
    ctx.font = '500 21px sans-serif';
    ctx.fillText(
      `Complete 1 km+ runs to unlock full KM split bars · Avg Pace ${avgPaceText}`,
      540,
      804
    );
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '500 23px sans-serif';
  ctx.fillText(safeFooter, 72, 988);
}

function renderAdidasPosterStyleCard(
  ctx: CanvasRenderingContext2D,
  input: ShareCardRenderInput,
  safePath: LatLngLiteral[],
  safeIntended: LatLngLiteral[]
): void {
  const unit = input.unit || 'km';
  const safeTitle = String(input.title || 'Chandigarh Run').slice(0, 30);
  const safeFooter = String(input.footerText || 'Chandigarh').slice(0, 56);
  const distText =
    typeof input.distanceMeters === 'number'
      ? (unit === 'mi' ? input.distanceMeters / 1609.344 : input.distanceMeters / 1000).toFixed(2)
      : input.primaryStatValue.replace(/[^0-9.]/g, '') || '0.00';

  const durText =
    typeof input.durationSec === 'number' ? formatDuration(input.durationSec) : '--:--';
  const avgPaceText =
    typeof input.avgPaceSecPerKm === 'number'
      ? `${formatPace(input.avgPaceSecPerKm, unit)}/${unit}`
      : '--:--';
  const speedText =
    typeof input.avgSpeedKmh === 'number' ? `${input.avgSpeedKmh.toFixed(1)} km/h` : '-- km/h';

  const splitSummary = buildSplitShareSummary(input.splits || []);
  const bestSplitText =
    splitSummary.fastestKm !== null
      ? `KM ${splitSummary.fastestKm} · ${formatPace(splitSummary.fastestPaceSec, unit)}`
      : `${(input.splits || []).length} splits`;

  // High-contrast Adidas Running poster canvas
  ctx.fillStyle = '#111D19';
  ctx.fillRect(0, 0, 1080, 1080);

  // Subtle top-right diagonal 3 stripes
  drawAdidasThreeBars(ctx, 1008, 68, 1);

  // Route trace integrated cleanly in upper right stage
  if (safePath.length > 1 || safeIntended.length > 1) {
    drawProjectedRoute(
      ctx,
      safePath,
      safeIntended,
      { cx: 660, cy: 360, maxW: 620, maxH: 380 },
      { strokeColor: 'rgba(154, 230, 46, 0.85)', strokeWidth: 9 }
    );
  }

  // Brand + workout header on left
  ctx.fillStyle = '#9AE62E';
  ctx.font = '700 22px monospace';
  ctx.fillText('TRICITY RUN  ·  CHANDIGARH', 72, 92);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 40px sans-serif';
  ctx.fillText(safeTitle, 72, 152);

  // Oversized Adidas Hero Distance Block
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 174px monospace';
  ctx.fillText(distText, 66, 595);

  ctx.fillStyle = '#9AE62E';
  ctx.font = '800 44px monospace';
  ctx.fillText(unit.toUpperCase(), 74, 650);

  // Horizontal rule
  ctx.strokeStyle = 'rgba(184, 232, 199, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 704);
  ctx.lineTo(1008, 704);
  ctx.stroke();

  // 2x2 Poster Telemetry Matrix
  const metrics = [
    { label: 'DURATION', val: durText, accent: false },
    { label: 'AVG PACE', val: avgPaceText, accent: true },
    { label: 'AVG SPEED', val: speedText, accent: false },
    { label: splitSummary.fastestKm ? 'FASTEST SPLIT' : 'COMPLETED SPLITS', val: bestSplitText, accent: false },
  ];

  metrics.forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = col === 0 ? 72 : 560;
    const y = row === 0 ? 765 : 885;

    ctx.fillStyle = '#B8E8C7';
    ctx.font = '600 20px sans-serif';
    ctx.fillText(m.label, x, y);

    ctx.fillStyle = m.accent ? '#9AE62E' : '#FFFFFF';
    ctx.font = '700 44px monospace';
    ctx.fillText(m.val, x, y + 52);
  });

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '500 22px sans-serif';
  ctx.fillText(safeFooter, 72, 1004);
}

function renderPaceChartStyleCard(
  ctx: CanvasRenderingContext2D,
  input: ShareCardRenderInput,
  safePath: LatLngLiteral[]
): void {
  const unit = input.unit || 'km';
  const safeTitle = String(input.title || 'Chandigarh Run').slice(0, 28);
  const safeFooter = String(input.footerText || 'Chandigarh').slice(0, 56);
  const distText =
    typeof input.distanceMeters === 'number'
      ? formatDistance(input.distanceMeters, unit)
      : input.primaryStatValue;
  const avgPaceText =
    typeof input.avgPaceSecPerKm === 'number'
      ? `${formatPace(input.avgPaceSecPerKm, unit)}/${unit}`
      : '--:--';

  const splitSummary = buildSplitShareSummary(input.splits || []);

  ctx.fillStyle = '#172D27';
  ctx.fillRect(0, 0, 1080, 1080);

  // Header + compact mini route silhouette in top right
  ctx.fillStyle = '#B8E8C7';
  ctx.font = '700 22px monospace';
  ctx.fillText('PACE PROGRESSION  ·  TRICITY RUN', 72, 88);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px sans-serif';
  ctx.fillText(safeTitle, 72, 148);

  ctx.fillStyle = '#9AE62E';
  ctx.font = '700 32px monospace';
  ctx.fillText(`${distText}  ·  AVG ${avgPaceText}`, 72, 198);

  if (safePath.length > 1) {
    drawRoundedRect(ctx, 792, 64, 216, 170, 20);
    ctx.fillStyle = 'rgba(14, 26, 22, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(184, 232, 199, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawProjectedRoute(
      ctx,
      safePath,
      [],
      { cx: 900, cy: 149, maxW: 168, maxH: 126 },
      { strokeWidth: 5, showKmSymbols: false, showPins: true }
    );
  }

  // Chart Stage
  const chartX = 72;
  const chartY = 264;
  const chartW = 936;
  const chartH = 540;

  drawRoundedRect(ctx, chartX, chartY, chartW, chartH, 24);
  ctx.fillStyle = '#10201B';
  ctx.fill();
  ctx.strokeStyle = 'rgba(184, 232, 199, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (splitSummary.bars.length > 0) {
    const shown = splitSummary.bars.slice(0, 14);
    const plotLeft = chartX + 60;
    const plotRight = chartX + chartW - 60;
    const plotBottom = chartY + chartH - 74;
    const plotTop = chartY + 86;
    const plotH = plotBottom - plotTop;
    const slotW = (plotRight - plotLeft) / shown.length;
    const barW = Math.min(68, Math.max(24, slotW * 0.62));

    // Average reference dashed line
    const avgRatio =
      splitSummary.slowestPaceSec === splitSummary.fastestPaceSec
        ? 0.85
        : 1 -
          ((splitSummary.avgPaceSec - splitSummary.fastestPaceSec) /
            Math.max(15, splitSummary.slowestPaceSec - splitSummary.fastestPaceSec)) *
            0.62;
    const avgY = plotBottom - plotH * Math.max(0.32, Math.min(1, avgRatio));

    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = 'rgba(184, 232, 199, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(plotLeft - 10, avgY);
    ctx.lineTo(plotRight + 10, avgY);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#B8E8C7';
    ctx.font = '700 16px monospace';
    ctx.fillText(`AVG ${formatPace(splitSummary.avgPaceSec, unit)}`, plotLeft, avgY - 12);

    shown.forEach((b, idx) => {
      const cx = plotLeft + slotW * idx + slotW / 2;
      const h = Math.max(48, Math.round(plotH * b.speedRatio));
      const bx = cx - barW / 2;
      const by = plotBottom - h;

      drawRoundedRect(ctx, bx, by, barW, h, 10);
      ctx.fillStyle = b.isFastest ? '#9AE62E' : '#B8E8C7';
      ctx.fill();

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = b.isFastest ? '#9AE62E' : '#FFFFFF';
      ctx.font = shown.length > 9 ? '700 15px monospace' : '700 18px monospace';
      ctx.fillText(formatPace(b.paceSecPerKm, unit), cx, by - 14);

      ctx.fillStyle = '#B8E8C7';
      ctx.font = '700 18px monospace';
      ctx.fillText(`${b.km}K`, cx, plotBottom + 34);
      ctx.restore();
    });
  } else {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9AE62E';
    ctx.font = '700 36px monospace';
    ctx.fillText(avgPaceText, 540, 510);
    ctx.fillStyle = '#B8E8C7';
    ctx.font = '500 22px sans-serif';
    ctx.fillText('Log 1+ km splits during your run to plot KM pace bars', 540, 560);
    ctx.restore();
  }

  // Footer Summary
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 28px monospace';
  ctx.fillText(input.secondaryLine.slice(0, 56), 72, 890);

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '500 23px sans-serif';
  ctx.fillText(safeFooter, 72, 968);
}

export function renderRunShareCardSync(input: ShareCardRenderInput): RenderedShareCard | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const safePath = Array.isArray(input.path)
    ? input.path.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    : [];
  const safeIntended = Array.isArray(input.intendedPath)
    ? input.intendedPath.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    : [];

  const style: ShareCardStyle = input.style || 'route';
  if (style === 'splits') {
    renderKmSplitsStyleCard(ctx, input, safePath);
  } else if (style === 'adidas_poster') {
    renderAdidasPosterStyleCard(ctx, input, safePath, safeIntended);
  } else if (style === 'pace_chart') {
    renderPaceChartStyleCard(ctx, input, safePath);
  } else {
    renderRouteStyleCard(ctx, input, safePath, safeIntended);
  }

  const dataUrl = canvas.toDataURL('image/png');
  const blob = dataUrlToBlobSync(dataUrl);
  return { blob, dataUrl };
}

export async function renderRunShareCardBlob(
  input: ShareCardRenderInput
): Promise<RenderedShareCard | null> {
  return renderRunShareCardSync(input);
}

export function prepareShareCardSync(params: {
  filename: string;
  shareTitle: string;
  shareText: string;
  card: ShareCardRenderInput;
}): PreparedShareCard | null {
  const style: ShareCardStyle = params.card.style || 'route';
  const rendered = renderRunShareCardSync(params.card);
  if (!rendered) return null;
  const filename = withStyleSuffixFilename(params.filename, style);
  const file = new File([rendered.blob], filename, {
    type: 'image/png',
    lastModified: Date.now(),
  });
  return {
    ...rendered,
    file,
    filename,
    shareTitle: params.shareTitle,
    shareText: params.shareText,
    style,
    sourceInput: params.card,
  };
}

export function triggerPngDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeShareFilename(filename);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 150);
}

export async function copyPngBlobToClipboard(blob: Blob): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== 'function' ||
    typeof ClipboardItem === 'undefined'
  ) {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function copyShareText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type ShareCardOutcome =
  | 'shared_file'
  | 'cancelled'
  | 'unsupported'
  | 'downloaded_fallback'
  | 'failed';

export async function tryNativeSharePreparedCard(
  prepared: PreparedShareCard
): Promise<'shared_file' | 'cancelled' | 'unsupported' | 'failed'> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav || typeof nav.share !== 'function') {
    return 'unsupported';
  }

  if (typeof nav.canShare === 'function') {
    try {
      if (!nav.canShare({ files: [prepared.file] })) {
        return 'unsupported';
      }
    } catch {
      return 'unsupported';
    }
  }

  try {
    await nav.share({
      files: [prepared.file],
      title: prepared.shareTitle,
      text: prepared.shareText,
    });
    return 'shared_file';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'cancelled';
    }
    try {
      await nav.share({
        files: [prepared.file],
        title: prepared.shareTitle,
      });
      return 'shared_file';
    } catch (err2) {
      if (err2 instanceof DOMException && err2.name === 'AbortError') {
        return 'cancelled';
      }
      return 'unsupported';
    }
  }
}

export async function sharePngCard(params: {
  filename: string;
  shareTitle: string;
  shareText: string;
  card: ShareCardRenderInput;
  autoDownloadFallback?: boolean;
}): Promise<{ outcome: ShareCardOutcome; prepared: PreparedShareCard | null }> {
  const prepared = prepareShareCardSync(params);
  if (!prepared) return { outcome: 'failed', prepared: null };

  const nativeResult = await tryNativeSharePreparedCard(prepared);
  if (nativeResult === 'shared_file' || nativeResult === 'cancelled') {
    return { outcome: nativeResult, prepared };
  }

  if (params.autoDownloadFallback) {
    const objectUrl = URL.createObjectURL(prepared.blob);
    triggerPngDownload(objectUrl, prepared.filename);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    await copyShareText(prepared.shareText);
    return { outcome: 'downloaded_fallback', prepared };
  }

  return { outcome: 'unsupported', prepared };
}
