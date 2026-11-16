import React from 'react';
import { LocateFixed, MapPin, Navigation, Play, X } from 'lucide-react';
import { getWorkoutMeta } from '../data/workouts';
import { formatDistance, formatDuration } from '../lib/geo';
import type { PointToPointMeasureResult } from '../services/pointPathService';
import type { LatLngLiteral, WorkoutType } from '../types/run';

export type MeasureOriginMode = 'start' | 'current';

interface MapPointDistanceCardProps {
  originMode: MeasureOriginMode;
  startLabel: string;
  onChangeOriginMode: (mode: MeasureOriginMode) => void;
  gpsLocating: boolean;
  gpsError: string | null;
  hasGpsPosition: boolean;
  targetPoint: LatLngLiteral | null;
  measuring: boolean;
  result: PointToPointMeasureResult | null;
  preferredUnit: 'km' | 'mi';
  workoutType?: WorkoutType;
  onStartPathRun?: () => void;
  onSetTargetAsStart?: (pt: LatLngLiteral) => void;
  onClear: () => void;
}

export const MapPointDistanceCard: React.FC<MapPointDistanceCardProps> = ({
  originMode,
  startLabel,
  onChangeOriginMode,
  gpsLocating,
  gpsError,
  hasGpsPosition,
  targetPoint,
  measuring,
  result,
  preferredUnit,
  workoutType = 'running',
  onStartPathRun,
  onSetTargetAsStart,
  onClear,
}) => {
  const workoutMeta = getWorkoutMeta(workoutType);
  const isBike = workoutMeta.routingProfile === 'bicycle';

  return (
    <div className="rounded-2xl border border-[#E5E3DC] bg-white p-3.5 sm:p-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#5B6B64]">Measure From</span>
          <div className="inline-flex rounded-xl bg-[#F6F5F0] p-1">
            <button
              type="button"
              onClick={() => onChangeOriginMode('start')}
              className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap ${
                originMode === 'start'
                  ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                  : 'text-[#5B6B64] hover:text-[#141F1B]'
              }`}
            >
              Starting Point
            </button>
            <button
              type="button"
              onClick={() => onChangeOriginMode('current')}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap ${
                originMode === 'current'
                  ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                  : 'text-[#5B6B64] hover:text-[#141F1B]'
              }`}
            >
              <LocateFixed className="h-3.5 w-3.5" />
              {gpsLocating ? 'Locating...' : 'Current Point'}
            </button>
          </div>
        </div>

        {!targetPoint ? (
          <p className="text-xs text-[#5B6B64]">
            Click any point on the map to view the {isBike ? 'cycling' : 'pedestrian'} path &amp; distance from{' '}
            <span className="font-semibold text-[#141F1B]">
              {originMode === 'current'
                ? hasGpsPosition
                  ? 'your current GPS location'
                  : 'your current GPS location'
                : startLabel}
            </span>
            .
          </p>
        ) : (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-[36px] items-center gap-1 self-start rounded-xl border border-[#D9D7CE] px-2.5 text-xs font-semibold text-[#5B6B64] hover:bg-[#F6F5F0] hover:text-[#141F1B] sm:self-auto"
          >
            <X className="h-3.5 w-3.5" />
            Clear Pin
          </button>
        )}
      </div>

      {originMode === 'current' && gpsError && (
        <p className="mt-2 text-xs font-medium text-amber-800">{gpsError}</p>
      )}

      {targetPoint && (
        <div className="mt-3 border-t border-[#F0EFEA] pt-3">
          {measuring ? (
            <div className="flex items-center gap-2 text-xs font-medium text-[#30483E]">
              <Navigation className="h-4 w-4 text-[#0284C7]" />
              Calculating {isBike ? 'cycling' : 'pedestrian'} path &amp; distance...
            </div>
          ) : result ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid grid-cols-3 gap-3 sm:flex sm:items-center sm:gap-6">
                <div>
                  <p className="text-[11px] font-medium text-[#5B6B64]">
                    {result.isDirectFallback ? 'Direct Distance' : 'Path Distance'}
                  </p>
                  <p className="font-mono text-lg font-bold text-[#0284C7] tabular-nums">
                    {formatDistance(result.distanceMeters, preferredUnit)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#5B6B64]">Straight Line</p>
                  <p className="font-mono text-sm font-bold text-[#141F1B] tabular-nums">
                    {formatDistance(result.directMeters, preferredUnit)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#5B6B64]">
                    Est. {workoutMeta.verb} Time
                  </p>
                  <p className="font-mono text-sm font-bold text-[#141F1B] tabular-nums">
                    {formatDuration(result.durationSec)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onStartPathRun && (
                  <button
                    type="button"
                    onClick={onStartPathRun}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3.5 text-xs font-semibold text-[#9AE62E] transition hover:bg-[#30483E] whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {workoutMeta.verb} This Path
                  </button>
                )}
                {onSetTargetAsStart && (
                  <button
                    type="button"
                    onClick={() => onSetTargetAsStart(targetPoint)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0] whitespace-nowrap"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Set as Start
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {result && (
            <p className="mt-2 text-[11px] text-[#5B6B64] tabular-nums">
              {result.origin.name} → Map Pin ({result.target.lat.toFixed(4)}, {result.target.lng.toFixed(4)})
              {result.isDirectFallback
                ? ` · Direct straight-line preview (outside connected ${isBike ? 'cycling' : 'pedestrian'} network)`
                : result.turnCount !== undefined
                ? ` · ${result.turnCount} turns · ${result.straightPathPct ?? 0}% straight (max ${formatDistance(result.longestStraightMeters || 0, preferredUnit)})`
                : ` · Connected ${isBike ? 'cycling' : 'pedestrian'} path`}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
