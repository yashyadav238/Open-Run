import { formatPace } from '../lib/geo';
import type { RouteDifficulty, RoutePreference, WorkoutType } from '../types/run';

export type WorkoutRoutingProfile = 'pedestrian' | 'bicycle';

export interface WorkoutMeta {
  id: WorkoutType;
  label: string;
  fullLabel: string;
  verb: string;
  pastNoun: string;
  routingProfile: WorkoutRoutingProfile;
  primaryMetric: 'pace' | 'speed';
  defaultSpeedKmh: number;
  maxSpeedMs: number;
  maxSpeedKmh: number;
  speedBarMaxKmh: number;
  met: number;
  distancePresetsKm: number[];
  maxPlanKm: number;
  defaultDistanceKm: number;
  artNamePrefix: string;
  preferenceLabels: Partial<Record<RoutePreference, string>>;
}

export const ALL_WORKOUT_TYPES: WorkoutType[] = [
  'running',
  'cycling',
  'walking',
  'hiking',
  'trail_run',
];

export const WORKOUT_CATALOG: Record<WorkoutType, WorkoutMeta> = {
  running: {
    id: 'running',
    label: 'Run',
    fullLabel: 'Outdoor Run',
    verb: 'Run',
    pastNoun: 'Run',
    routingProfile: 'pedestrian',
    primaryMetric: 'pace',
    defaultSpeedKmh: 10.2,
    maxSpeedMs: 11.5,
    maxSpeedKmh: 42,
    speedBarMaxKmh: 22,
    met: 9.8,
    distancePresetsKm: [1, 2, 3, 5, 7, 10],
    maxPlanKm: 60,
    defaultDistanceKm: 5,
    artNamePrefix: 'Run Art',
    preferenceLabels: {
      least_turns: 'Least Turns · Straight Paths',
      parks_greenery: 'Parks & Greenery',
      pedestrian_paths: 'Pedestrian Paths',
      quieter_roads: 'Quieter Roads',
      scenic: 'Scenic / Lakefront',
      avoid_stairs: 'Flat / No Stairs',
      well_lit: 'Well-Lit (Night)',
    },
  },
  cycling: {
    id: 'cycling',
    label: 'Cycle',
    fullLabel: 'Bike Ride',
    verb: 'Ride',
    pastNoun: 'Bike Ride',
    routingProfile: 'bicycle',
    primaryMetric: 'speed',
    defaultSpeedKmh: 21.0,
    maxSpeedMs: 33.0,
    maxSpeedKmh: 120,
    speedBarMaxKmh: 45,
    met: 7.5,
    distancePresetsKm: [5, 10, 20, 30, 50, 75],
    maxPlanKm: 150,
    defaultDistanceKm: 15,
    artNamePrefix: 'Cycle Art',
    preferenceLabels: {
      least_turns: 'Least Turns · Long Straightaways',
      parks_greenery: 'Greenways & Parks',
      pedestrian_paths: 'Dedicated Bike Paths',
      quieter_roads: 'Quiet Side Streets',
      scenic: 'Scenic Waterfronts',
      avoid_stairs: 'Step-Free Bikeable',
      well_lit: 'Well-Lit Avenues',
    },
  },
  walking: {
    id: 'walking',
    label: 'Walk',
    fullLabel: 'Outdoor Walk',
    verb: 'Walk',
    pastNoun: 'Walk',
    routingProfile: 'pedestrian',
    primaryMetric: 'pace',
    defaultSpeedKmh: 5.0,
    maxSpeedMs: 4.5,
    maxSpeedKmh: 16,
    speedBarMaxKmh: 10,
    met: 3.8,
    distancePresetsKm: [1, 2, 3, 5, 7, 10],
    maxPlanKm: 40,
    defaultDistanceKm: 3,
    artNamePrefix: 'Walk Art',
    preferenceLabels: {
      least_turns: 'Least Turns · Straight Walkways',
      parks_greenery: 'Parks & Gardens',
      pedestrian_paths: 'Footpaths & Walkways',
      quieter_roads: 'Quiet Streets',
      scenic: 'Lakefront & Shaded',
      avoid_stairs: 'Step-Free / Easy',
      well_lit: 'Well-Lit Evening Paths',
    },
  },
  hiking: {
    id: 'hiking',
    label: 'Hike',
    fullLabel: 'Trail Hike',
    verb: 'Hike',
    pastNoun: 'Hike',
    routingProfile: 'pedestrian',
    primaryMetric: 'pace',
    defaultSpeedKmh: 4.2,
    maxSpeedMs: 5.0,
    maxSpeedKmh: 18,
    speedBarMaxKmh: 10,
    met: 6.0,
    distancePresetsKm: [2, 3, 5, 8, 12, 18],
    maxPlanKm: 50,
    defaultDistanceKm: 5,
    artNamePrefix: 'Hike Art',
    preferenceLabels: {
      least_turns: 'Long Direct Trails',
      parks_greenery: 'Nature & Forests',
      pedestrian_paths: 'Trailhead Paths',
      quieter_roads: 'Off-Road Corridors',
      scenic: 'Water & Ridge Views',
      avoid_stairs: 'Gentle Grade',
      well_lit: 'Clear Daytime Trails',
    },
  },
  trail_run: {
    id: 'trail_run',
    label: 'Trail',
    fullLabel: 'Trail Run',
    verb: 'Trail Run',
    pastNoun: 'Trail Run',
    routingProfile: 'pedestrian',
    primaryMetric: 'pace',
    defaultSpeedKmh: 8.8,
    maxSpeedMs: 10.5,
    maxSpeedKmh: 38,
    speedBarMaxKmh: 20,
    met: 10.5,
    distancePresetsKm: [2, 3, 5, 8, 10, 15],
    maxPlanKm: 60,
    defaultDistanceKm: 5,
    artNamePrefix: 'Trail Art',
    preferenceLabels: {
      least_turns: 'Fewer Turns · Direct Trails',
      parks_greenery: 'Green Trails & Canopy',
      pedestrian_paths: 'Unpaved & Path Links',
      quieter_roads: 'Car-Free Trails',
      scenic: 'Lakeside & Creek Paths',
      avoid_stairs: 'Smooth Rolling',
      well_lit: 'Open Sightlines',
    },
  },
};

export function normalizeWorkoutType(raw: unknown): WorkoutType {
  if (typeof raw === 'string' && raw in WORKOUT_CATALOG) {
    return raw as WorkoutType;
  }
  return 'running';
}

export function getWorkoutMeta(raw?: unknown): WorkoutMeta {
  return WORKOUT_CATALOG[normalizeWorkoutType(raw)];
}

export function estimateSpeedKmhForWorkout(
  workoutType?: unknown,
  difficulty: RouteDifficulty = 'moderate'
): number {
  const meta = getWorkoutMeta(workoutType);
  const mult = difficulty === 'easy' ? 0.88 : difficulty === 'challenging' ? 1.15 : 1.0;
  return Number((meta.defaultSpeedKmh * mult).toFixed(2));
}

export function estimateDurationSecForWorkout(
  distanceMeters: number,
  workoutType?: unknown,
  difficulty: RouteDifficulty = 'moderate'
): number {
  const speedKmh = estimateSpeedKmhForWorkout(workoutType, difficulty);
  const speedMs = Math.max(0.5, speedKmh / 3.6);
  return Math.max(30, Math.round(distanceMeters / speedMs));
}

export function estimateCaloriesKcal(
  workoutType: unknown,
  durationSec: number,
  distanceMeters: number,
  weightKg = 70
): number {
  const meta = getWorkoutMeta(workoutType);
  const hours = Math.max(0, durationSec) / 3600;
  const distKm = Math.max(0, distanceMeters) / 1000;
  if (hours <= 0 && distKm <= 0) return 0;
  const timeBased = meta.met * weightKg * hours;
  const distFactor =
    meta.id === 'cycling'
      ? 26
      : meta.id === 'walking'
      ? 48
      : meta.id === 'hiking'
      ? 62
      : 68;
  const distBased = distKm * distFactor;
  if (hours <= 0) return Math.round(distBased);
  return Math.max(1, Math.round(timeBased * 0.7 + distBased * 0.3));
}

export function formatSpeed(kmh: number, unit: 'km' | 'mi' = 'km'): string {
  if (!Number.isFinite(kmh) || kmh < 0) return unit === 'mi' ? '0.0 mph' : '0.0 km/h';
  if (unit === 'mi') {
    return `${(kmh * 0.621371).toFixed(1)} mph`;
  }
  return `${kmh.toFixed(1)} km/h`;
}

export function formatWorkoutPrimaryRate(params: {
  workoutType?: unknown;
  avgPaceSecPerKm: number;
  avgSpeedKmh?: number;
  unit: 'km' | 'mi';
}): string {
  const meta = getWorkoutMeta(params.workoutType);
  if (meta.primaryMetric === 'speed') {
    const kmh =
      typeof params.avgSpeedKmh === 'number' && params.avgSpeedKmh > 0
        ? params.avgSpeedKmh
        : params.avgPaceSecPerKm > 0
        ? 3600 / params.avgPaceSecPerKm
        : 0;
    return formatSpeed(kmh, params.unit);
  }
  return `${formatPace(params.avgPaceSecPerKm, params.unit)}/${params.unit}`;
}
