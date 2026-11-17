import type { WorkoutType } from '../types/run';

export interface WeatherConditions {
  temperatureC: number;
  humidityPct: number;
  source: 'live' | 'estimated';
}

export type DehydrationLevel = 'Low' | 'Moderate' | 'High' | 'Severe';

export interface HydrationEstimate {
  fluidLossMl: number;
  sweatRateMlPerHr: number;
  recommendedRehydrationMl: number;
  dehydrationPct: number;
  level: DehydrationLevel;
  needsElectrolytes: boolean;
  tip: string;
  weather: WeatherConditions;
}

/**
 * Fetches current temperature (°C) and relative humidity (%) for a GPS coordinate
 * using the free Open-Meteo API, with a sensible fallback if offline or unavailable.
 */
export async function fetchWeatherConditions(
  lat?: number,
  lng?: number,
  timeoutMs = 3500
): Promise<WeatherConditions> {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return { temperatureC: 24, humidityPct: 55, source: 'estimated' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m`;
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      return { temperatureC: 24, humidityPct: 55, source: 'estimated' };
    }
    const data = (await resp.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
      };
    };
    const temp = data.current?.temperature_2m;
    const hum = data.current?.relative_humidity_2m;
    if (
      typeof temp === 'number' &&
      Number.isFinite(temp) &&
      typeof hum === 'number' &&
      Number.isFinite(hum)
    ) {
      return {
        temperatureC: Math.round(temp * 10) / 10,
        humidityPct: Math.round(hum),
        source: 'live',
      };
    }
  } catch {
    // Fall back to estimated mild outdoor conditions
  } finally {
    clearTimeout(timer);
  }
  return { temperatureC: 24, humidityPct: 55, source: 'estimated' };
}

/**
 * Estimates total fluid / sweat loss (ml) and dehydration level using:
 * - Ambient temperature (°C) & relative humidity (%)
 * - Calories burnt (kcal)
 * - Duration (sec) & average pace (sec/km)
 */
export function calculateHydrationLoss(params: {
  durationSec: number;
  caloriesKcal: number;
  avgPaceSecPerKm: number;
  workoutType?: WorkoutType;
  weather: WeatherConditions;
}): HydrationEstimate {
  const durationHr = Math.max(1 / 60, params.durationSec / 3600);
  const kcal = Math.max(10, params.caloriesKcal);
  const { temperatureC, humidityPct } = params.weather;

  // 1. Base sweat loss driven by metabolic heat (calories burnt) + duration
  // Roughly 1.05 ml per kcal burnt at temperate conditions (20°C, 50% RH)
  const metabolicMl = kcal * 1.05;

  // 2. Pace / intensity multiplier (faster running pace => higher core heat)
  let intensityFactor = 1.0;
  if (params.avgPaceSecPerKm > 0) {
    if (params.avgPaceSecPerKm <= 270) {
      intensityFactor = 1.22; // Very fast (< 4:30/km)
    } else if (params.avgPaceSecPerKm <= 330) {
      intensityFactor = 1.12; // Tempo (4:30 - 5:30/km)
    } else if (params.avgPaceSecPerKm <= 420) {
      intensityFactor = 1.04; // Steady (5:30 - 7:00/km)
    } else if (params.avgPaceSecPerKm > 600) {
      intensityFactor = 0.88; // Easy walk / recovery
    }
  }

  // 3. Temperature multiplier (baseline 20°C)
  // +3.2% sweat rate per °C above 20°C; -1.5% per °C below 20°C (clamped)
  const tempDelta = temperatureC - 20;
  const tempFactor =
    tempDelta >= 0
      ? Math.min(1.85, 1 + tempDelta * 0.032)
      : Math.max(0.68, 1 + tempDelta * 0.015);

  // 4. Humidity multiplier (above 50% RH, reduced evaporation increases sweat dripping)
  const humDelta = Math.max(0, humidityPct - 50);
  const humidityFactor = Math.min(1.35, 1 + humDelta * 0.0065);

  const rawFluidLossMl = metabolicMl * intensityFactor * tempFactor * humidityFactor;
  const fluidLossMl = Math.max(50, Math.round(rawFluidLossMl / 10) * 10);
  const sweatRateMlPerHr = Math.round(fluidLossMl / durationHr);

  // ACSM guideline: replace ~125% of fluid lost to account for ongoing urine losses
  const recommendedRehydrationMl = Math.round((fluidLossMl * 1.25) / 10) * 10;

  // Estimate % body-weight dehydration assuming a 70 kg reference athlete
  const dehydrationPct = Number(((fluidLossMl / 70000) * 100).toFixed(2));

  let level: DehydrationLevel = 'Low';
  let tip = 'Sip water steadily over the next 30–60 minutes to stay topped up.';
  if (fluidLossMl >= 1500 || dehydrationPct >= 2.1) {
    level = 'Severe';
    tip = 'High sweat loss detected. Rehydrate immediately with water + sodium/electrolytes over the next 2–3 hours.';
  } else if (fluidLossMl >= 900 || dehydrationPct >= 1.3) {
    level = 'High';
    tip = 'Significant fluid loss. Drink water with electrolytes (sodium & potassium) to restore balance.';
  } else if (fluidLossMl >= 450 || dehydrationPct >= 0.65) {
    level = 'Moderate';
    tip = 'Noticeable sweat loss. Drink 1–2 full glasses of water now and pair with a light salty snack.';
  }

  return {
    fluidLossMl,
    sweatRateMlPerHr,
    recommendedRehydrationMl,
    dehydrationPct,
    level,
    needsElectrolytes: fluidLossMl >= 700,
    tip,
    weather: params.weather,
  };
}

export function formatFluidMl(ml: number): string {
  if (ml >= 1000) {
    return `${(ml / 1000).toFixed(2)} L (${ml} ml)`;
  }
  return `${ml} ml`;
}
