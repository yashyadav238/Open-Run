import React, { useEffect, useState } from 'react';
import { Droplets, Loader2, Thermometer, Wind } from 'lucide-react';
import {
  calculateHydrationLoss,
  fetchWeatherConditions,
  formatFluidMl,
  type HydrationEstimate,
} from '../lib/hydration';
import type { WorkoutType } from '../types/run';

interface HydrationLossCardProps {
  durationSec: number;
  caloriesKcal: number;
  avgPaceSecPerKm: number;
  workoutType?: WorkoutType;
  lat?: number;
  lng?: number;
  compact?: boolean;
}

export const HydrationLossCard: React.FC<HydrationLossCardProps> = ({
  durationSec,
  caloriesKcal,
  avgPaceSecPerKm,
  workoutType,
  lat,
  lng,
  compact = false,
}) => {
  const [estimate, setEstimate] = useState<HydrationEstimate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchWeatherConditions(lat, lng).then((weather) => {
      if (cancelled) return;
      const result = calculateHydrationLoss({
        durationSec,
        caloriesKcal,
        avgPaceSecPerKm,
        workoutType,
        weather,
      });
      setEstimate(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [durationSec, caloriesKcal, avgPaceSecPerKm, workoutType, lat, lng]);

  const badgeColors: Record<string, string> = {
    Low: 'bg-[#EBF5EE] text-[#172D27]',
    Moderate: 'bg-amber-100 text-amber-900',
    High: 'bg-orange-100 text-orange-900',
    Severe: 'bg-red-100 text-red-900',
  };

  return (
    <div className={`rounded-2xl border border-[#E5E3DC] bg-white ${compact ? 'p-4' : 'p-5'} space-y-3.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Droplets className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold text-[#141F1B] sm:text-base">
              Sweat &amp; Hydration Loss
            </h3>
            <p className="text-[11px] text-[#5B6B64]">
              Estimated from temperature, humidity, calories &amp; pace
            </p>
          </div>
        </div>

        {estimate && (
          <span
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
              badgeColors[estimate.level] || badgeColors.Low
            }`}
          >
            {estimate.level} Dehydration ({estimate.dehydrationPct}%)
          </span>
        )}
      </div>

      {loading || !estimate ? (
        <div className="flex items-center gap-2 py-3 text-xs text-[#5B6B64]">
          <Loader2 className="h-4 w-4 animate-spin text-[#172D27]" />
          Checking local temperature &amp; humidity...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl bg-[#F6F5F0] p-3">
              <p className="text-[11px] text-[#5B6B64]">Water Lost (Sweat)</p>
              <p className="mt-0.5 font-mono text-base font-bold text-sky-700 tabular-nums">
                {formatFluidMl(estimate.fluidLossMl)}
              </p>
            </div>
            <div className="rounded-xl bg-[#F6F5F0] p-3">
              <p className="text-[11px] text-[#5B6B64]">Drink to Rehydrate</p>
              <p className="mt-0.5 font-mono text-base font-bold text-[#172D27] tabular-nums">
                {estimate.recommendedRehydrationMl} ml
              </p>
            </div>
            <div className="rounded-xl bg-[#F6F5F0] p-3">
              <p className="flex items-center gap-1 text-[11px] text-[#5B6B64]">
                <Thermometer className="h-3 w-3" />
                Temp / Humidity
              </p>
              <p className="mt-0.5 font-mono text-sm font-bold text-[#141F1B] tabular-nums">
                {estimate.weather.temperatureC}°C · {estimate.weather.humidityPct}%
              </p>
            </div>
            <div className="rounded-xl bg-[#F6F5F0] p-3">
              <p className="flex items-center gap-1 text-[11px] text-[#5B6B64]">
                <Wind className="h-3 w-3" />
                Sweat Rate
              </p>
              <p className="mt-0.5 font-mono text-sm font-bold text-[#141F1B] tabular-nums">
                {estimate.sweatRateMlPerHr} ml/hr
              </p>
            </div>
          </div>

          <p className="rounded-xl bg-sky-50/70 px-3.5 py-2.5 text-xs leading-relaxed text-sky-950">
            <span className="font-bold">Recovery Tip:</span> {estimate.tip}
          </p>
        </>
      )}
    </div>
  );
};
