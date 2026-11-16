import React, { useMemo } from 'react';
import { Mountain, TrendingUp } from 'lucide-react';
import {
  buildPostRunDescription,
  classifyTerrainByElevation,
  formatDistance,
  formatElevationGain,
  formatElevationLoss,
  formatElevationValue,
} from '../lib/geo';
import type { ElevationProfilePoint } from '../types/run';

export type ElevationFetchStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface ElevationProfileCardProps {
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
  avgGradePct?: number | null;
  profile?: ElevationProfilePoint[];
  status?: ElevationFetchStatus;
  unit?: 'km' | 'mi';
  compact?: boolean;
}

export const ElevationProfileCard: React.FC<ElevationProfileCardProps> = ({
  workoutLabel,
  routeName,
  startName,
  distanceMeters,
  durationSec,
  rateText,
  caloriesKcal,
  elevationGainMeters,
  elevationLossMeters,
  minElevationMeters,
  maxElevationMeters,
  avgGradePct,
  profile,
  status = 'ready',
  unit = 'km',
  compact = false,
}) => {
  const descriptionText = useMemo(
    () =>
      buildPostRunDescription({
        workoutLabel,
        routeName,
        startName,
        distanceMeters,
        durationSec,
        rateText,
        caloriesKcal,
        elevationGainMeters:
          typeof elevationGainMeters === 'number' && Number.isFinite(elevationGainMeters)
            ? elevationGainMeters
            : null,
        elevationLossMeters:
          typeof elevationLossMeters === 'number' && Number.isFinite(elevationLossMeters)
            ? elevationLossMeters
            : null,
        minElevationMeters:
          typeof minElevationMeters === 'number' && Number.isFinite(minElevationMeters)
            ? minElevationMeters
            : null,
        maxElevationMeters:
          typeof maxElevationMeters === 'number' && Number.isFinite(maxElevationMeters)
            ? maxElevationMeters
            : null,
        unit,
      }),
    [
      workoutLabel,
      routeName,
      startName,
      distanceMeters,
      durationSec,
      rateText,
      caloriesKcal,
      elevationGainMeters,
      elevationLossMeters,
      minElevationMeters,
      maxElevationMeters,
      unit,
    ]
  );

  const terrain = classifyTerrainByElevation(elevationGainMeters, distanceMeters);
  const computedAvgGrade = useMemo(() => {
    if (typeof avgGradePct === 'number' && Number.isFinite(avgGradePct)) {
      return avgGradePct;
    }
    if (
      typeof elevationGainMeters === 'number' &&
      Number.isFinite(elevationGainMeters) &&
      distanceMeters > 50
    ) {
      return Number(((elevationGainMeters / distanceMeters) * 100).toFixed(1));
    }
    return null;
  }, [avgGradePct, elevationGainMeters, distanceMeters]);

  const chartGeometry = useMemo(() => {
    if (!profile || profile.length < 2) return null;
    const width = 600;
    const height = compact ? 118 : 148;
    const padL = 12;
    const padR = 12;
    const padT = 18;
    const padB = 18;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    let minE = Infinity;
    let maxE = -Infinity;
    let peakIdx = 0;
    profile.forEach((pt, idx) => {
      if (pt.elevationM < minE) minE = pt.elevationM;
      if (pt.elevationM > maxE) {
        maxE = pt.elevationM;
        peakIdx = idx;
      }
    });

    const rawSpan = maxE - minE;
    const paddedSpan = Math.max(8, rawSpan * 1.25);
    const midE = (minE + maxE) / 2;
    const chartMin = midE - paddedSpan / 2;
    const chartMax = midE + paddedSpan / 2;

    const coords = profile.map((pt, i) => {
      const ratio =
        Number.isFinite(pt.distRatio) && pt.distRatio >= 0 && pt.distRatio <= 1
          ? pt.distRatio
          : i / Math.max(1, profile.length - 1);
      const x = padL + ratio * plotW;
      const yNorm = (pt.elevationM - chartMin) / Math.max(1, chartMax - chartMin);
      const y = padT + (1 - yNorm) * plotH;
      return {
        x: Number(x.toFixed(1)),
        y: Number(y.toFixed(1)),
        el: pt.elevationM,
      };
    });

    const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
    const baseY = height - padB;
    const areaPath = `M ${coords[0].x},${baseY} L ${coords
      .map((c) => `${c.x},${c.y}`)
      .join(' L ')} L ${coords[coords.length - 1].x},${baseY} Z`;

    return {
      width,
      height,
      padL,
      padR,
      padT,
      baseY,
      coords,
      linePoints,
      areaPath,
      peak: coords[peakIdx],
      minE: Math.round(minE),
      maxE: Math.round(maxE),
    };
  }, [profile, compact]);

  const hasRange =
    typeof minElevationMeters === 'number' &&
    typeof maxElevationMeters === 'number' &&
    Number.isFinite(minElevationMeters) &&
    Number.isFinite(maxElevationMeters) &&
    (minElevationMeters !== 0 || maxElevationMeters !== 0);

  return (
    <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Mountain className="h-4 w-4 text-[#172D27]" />
            <h3 className="font-display text-base font-bold text-[#141F1B]">
              Workout Description &amp; Elevation
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-[#5B6B64]">{terrain.detail}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#EBF5EE] px-2.5 py-1 text-[11px] font-bold text-[#172D27]">
          <TrendingUp className="h-3.5 w-3.5 text-[#30483E]" />
          {status === 'loading' ? 'Computing elevation...' : terrain.label}
        </span>
      </div>

      {/* Auto-generated natural-language workout description */}
      <p className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] px-4 py-3 text-sm leading-relaxed text-[#141F1B]">
        {descriptionText}
      </p>

      {/* Workout & Elevation Telemetry Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 tabular-nums">
        <div className="rounded-xl bg-[#172D27] px-3.5 py-2.5 text-white">
          <p className="text-[11px] text-[#B8E8C7]/85">Elevation Gain</p>
          <p className="mt-0.5 font-mono text-base font-bold text-[#9AE62E]">
            {status === 'loading'
              ? '...'
              : formatElevationGain(elevationGainMeters, unit)}
          </p>
        </div>
        <div className="rounded-xl bg-[#F6F5F0] px-3.5 py-2.5">
          <p className="text-[11px] text-[#5B6B64]">Elevation Loss</p>
          <p className="mt-0.5 font-mono text-base font-bold text-[#141F1B]">
            {status === 'loading'
              ? '...'
              : typeof elevationLossMeters === 'number' && Number.isFinite(elevationLossMeters)
              ? formatElevationLoss(elevationLossMeters, unit)
              : '--'}
          </p>
        </div>
        <div className="rounded-xl bg-[#F6F5F0] px-3.5 py-2.5">
          <p className="text-[11px] text-[#5B6B64]">Min / Max Elev</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-[#141F1B]">
            {status === 'loading'
              ? '...'
              : hasRange
              ? `${formatElevationValue(minElevationMeters, unit)} – ${formatElevationValue(
                  maxElevationMeters,
                  unit
                )}`
              : '--'}
          </p>
        </div>
        <div className="rounded-xl bg-[#F6F5F0] px-3.5 py-2.5">
          <p className="text-[11px] text-[#5B6B64]">Avg Climb Grade</p>
          <p className="mt-0.5 font-mono text-base font-bold text-[#141F1B]">
            {status === 'loading'
              ? '...'
              : computedAvgGrade !== null
              ? `${computedAvgGrade}%`
              : '--'}
          </p>
        </div>
        <div className="col-span-2 rounded-xl bg-[#F6F5F0] px-3.5 py-2.5 sm:col-span-1">
          <p className="text-[11px] text-[#5B6B64]">Calories Burnt</p>
          <p className="mt-0.5 font-mono text-base font-bold text-[#141F1B]">
            {typeof caloriesKcal === 'number' && Number.isFinite(caloriesKcal)
              ? `${Math.round(caloriesKcal).toLocaleString()} kcal`
              : '--'}
          </p>
        </div>
      </div>

      {/* Elevation Profile SVG Chart */}
      {status === 'loading' ? (
        <div className="flex h-[112px] items-center justify-center rounded-xl border border-[#E5E3DC] bg-[#172D27]/95 px-4 text-xs font-medium text-[#B8E8C7]">
          Sampling terrain elevation profile across route coordinates...
        </div>
      ) : chartGeometry ? (
        <div className="rounded-xl bg-[#172D27] p-3.5 text-white">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-mono text-[#B8E8C7]">
            <span>ELEVATION PROFILE</span>
            <span>
              Low {formatElevationValue(chartGeometry.minE, unit)} · Peak{' '}
              {formatElevationValue(chartGeometry.maxE, unit)}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
            className="w-full overflow-visible"
            role="img"
            aria-label="Workout elevation profile chart"
          >
            <defs>
              <linearGradient id="openRunElevGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9AE62E" stopOpacity="0.48" />
                <stop offset="100%" stopColor="#9AE62E" stopOpacity="0.03" />
              </linearGradient>
            </defs>
            {/* Subtle horizontal reference grid lines */}
            <line
              x1={chartGeometry.padL}
              y1={chartGeometry.padT}
              x2={chartGeometry.width - chartGeometry.padR}
              y2={chartGeometry.padT}
              stroke="rgba(184, 232, 199, 0.14)"
              strokeDasharray="4 4"
            />
            <line
              x1={chartGeometry.padL}
              y1={(chartGeometry.padT + chartGeometry.baseY) / 2}
              x2={chartGeometry.width - chartGeometry.padR}
              y2={(chartGeometry.padT + chartGeometry.baseY) / 2}
              stroke="rgba(184, 232, 199, 0.12)"
              strokeDasharray="4 4"
            />
            <line
              x1={chartGeometry.padL}
              y1={chartGeometry.baseY}
              x2={chartGeometry.width - chartGeometry.padR}
              y2={chartGeometry.baseY}
              stroke="rgba(184, 232, 199, 0.22)"
            />
            <path d={chartGeometry.areaPath} fill="url(#openRunElevGrad)" />
            <polyline
              fill="none"
              stroke="#9AE62E"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={chartGeometry.linePoints}
            />
            {/* Peak marker */}
            <circle
              cx={chartGeometry.peak.x}
              cy={chartGeometry.peak.y}
              r="4.5"
              fill="#FFFFFF"
              stroke="#9AE62E"
              strokeWidth="2.5"
            />
          </svg>
          <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-[#B8E8C7]/80">
            <span>Start (0 {unit})</span>
            <span>Finish ({formatDistance(distanceMeters, unit)})</span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#D9D7CE] bg-[#F6F5F0] px-4 py-3 text-xs text-[#5B6B64]">
          {typeof elevationGainMeters === 'number' && Number.isFinite(elevationGainMeters)
            ? `Recorded ${formatElevationGain(elevationGainMeters, unit)} total climb for this session.`
            : 'Elevation profile appears automatically when a GPS route trace with 2+ points is recorded.'}
        </div>
      )}
    </div>
  );
};
