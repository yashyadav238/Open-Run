import { normalizeWorkoutType } from '../data/workouts';
import type { RunActivityDoc, RunArtDesignDoc } from '../types/run';

export interface ChallengeDefinition {
  key: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  timeframe: string;
  computeProgress: (runs: RunActivityDoc[], artDesigns: RunArtDesignDoc[]) => number;
}

export interface AchievementDefinition {
  key: string;
  title: string;
  subtitle: string;
  unlocked: (runs: RunActivityDoc[], artDesigns: RunArtDesignDoc[]) => boolean;
}

export const CHALLENGES: ChallengeDefinition[] = [
  {
    key: 'first_run',
    title: 'First Activity',
    description: 'Complete your first GPS-tracked session anywhere.',
    target: 1,
    unit: 'workout',
    timeframe: 'Anytime',
    computeProgress: (runs) => Math.min(1, runs.length),
  },
  {
    key: 'first_5k',
    title: 'First 5K',
    description: 'Finish a single workout of 5.0 km or more.',
    target: 5,
    unit: 'km',
    timeframe: 'Single workout',
    computeProgress: (runs) => {
      const maxKm = runs.reduce((m, r) => Math.max(m, r.distanceMeters / 1000), 0);
      return Number(Math.min(5, maxKm).toFixed(2));
    },
  },
  {
    key: 'first_10k',
    title: 'First 10K',
    description: 'Cover 10.0 km in a single session.',
    target: 10,
    unit: 'km',
    timeframe: 'Single workout',
    computeProgress: (runs) => {
      const maxKm = runs.reduce((m, r) => Math.max(m, r.distanceMeters / 1000), 0);
      return Number(Math.min(10, maxKm).toFixed(2));
    },
  },
  {
    key: 'week_10k',
    title: '10 KM Weekly Rhythm',
    description: 'Accumulate 10 km within the last 7 days.',
    target: 10,
    unit: 'km',
    timeframe: '7 days',
    computeProgress: (runs) => {
      const cutoff = Date.now() - 7 * 86400 * 1000;
      const sum = runs
        .filter((r) => new Date(r.finishedAt).getTime() >= cutoff)
        .reduce((acc, r) => acc + r.distanceMeters / 1000, 0);
      return Number(Math.min(10, sum).toFixed(2));
    },
  },
  {
    key: 'month_25k',
    title: '25 KM Monthly Base',
    description: 'Build steady endurance with 25 km in the last 30 days.',
    target: 25,
    unit: 'km',
    timeframe: '30 days',
    computeProgress: (runs) => {
      const cutoff = Date.now() - 30 * 86400 * 1000;
      const sum = runs
        .filter((r) => new Date(r.finishedAt).getTime() >= cutoff)
        .reduce((acc, r) => acc + r.distanceMeters / 1000, 0);
      return Number(Math.min(25, sum).toFixed(2));
    },
  },
  {
    key: 'five_runs_month',
    title: 'Five Sessions in a Month',
    description: 'Log 5 completed workouts across 30 days.',
    target: 5,
    unit: 'workouts',
    timeframe: '30 days',
    computeProgress: (runs) => {
      const cutoff = Date.now() - 30 * 86400 * 1000;
      return Math.min(5, runs.filter((r) => new Date(r.finishedAt).getTime() >= cutoff).length);
    },
  },
  {
    key: 'explore_three_areas',
    title: 'Explore Three Areas',
    description: 'Train from at least 3 distinct parks or neighborhoods.',
    target: 3,
    unit: 'areas',
    timeframe: 'All time',
    computeProgress: (runs) => {
      const unique = new Set(runs.map((r) => r.startName.trim()).filter(Boolean));
      return Math.min(3, unique.size);
    },
  },
  {
    key: 'gps_art_challenge',
    title: 'GPS Art Finisher',
    description: 'Complete a GPS Art route on real street & park paths.',
    target: 1,
    unit: 'artwork',
    timeframe: 'All time',
    computeProgress: (runs, art) => {
      const completedRuns = runs.filter((r) => r.routeType === 'run_art').length;
      const completedArt = art.filter((a) => a.status === 'completed').length;
      return Math.min(1, Math.max(completedRuns, completedArt));
    },
  },
  {
    key: 'first_bike_ride',
    title: 'First Bike Ride',
    description: 'Track your first cycling workout with live GPS speed.',
    target: 1,
    unit: 'ride',
    timeframe: 'Anytime',
    computeProgress: (runs) =>
      Math.min(1, runs.filter((r) => normalizeWorkoutType(r.workoutType) === 'cycling').length),
  },
  {
    key: 'cycle_25k',
    title: '25 KM Cycling Cruise',
    description: 'Finish a single cycling ride of 25.0 km or more.',
    target: 25,
    unit: 'km',
    timeframe: 'Single ride',
    computeProgress: (runs) => {
      const maxKm = runs
        .filter((r) => normalizeWorkoutType(r.workoutType) === 'cycling')
        .reduce((m, r) => Math.max(m, r.distanceMeters / 1000), 0);
      return Number(Math.min(25, maxKm).toFixed(2));
    },
  },
  {
    key: 'walk_5k',
    title: '5 KM Mindful Walk',
    description: 'Accumulate 5.0 km across walking or hiking sessions.',
    target: 5,
    unit: 'km',
    timeframe: 'All time',
    computeProgress: (runs) => {
      const sumKm = runs
        .filter((r) => {
          const w = normalizeWorkoutType(r.workoutType);
          return w === 'walking' || w === 'hiking';
        })
        .reduce((acc, r) => acc + r.distanceMeters / 1000, 0);
      return Number(Math.min(5, sumKm).toFixed(2));
    },
  },
  {
    key: 'multi_sport_athlete',
    title: 'Multi-Sport Explorer',
    description: 'Complete workouts in 2 or more distinct sports (e.g., Run + Cycle + Walk).',
    target: 2,
    unit: 'sports',
    timeframe: 'All time',
    computeProgress: (runs) => {
      const sports = new Set(runs.map((r) => normalizeWorkoutType(r.workoutType)));
      return Math.min(2, sports.size);
    },
  },
];

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'first_km',
    title: 'First Kilometre',
    subtitle: 'Logged 1+ km in a live session',
    unlocked: (runs) => runs.some((r) => r.distanceMeters >= 1000),
  },
  {
    key: 'club_10',
    title: '10 KM Club',
    subtitle: '10 cumulative km tracked',
    unlocked: (runs) => runs.reduce((s, r) => s + r.distanceMeters / 1000, 0) >= 10,
  },
  {
    key: 'club_50',
    title: '50 KM Club',
    subtitle: '50 cumulative km tracked',
    unlocked: (runs) => runs.reduce((s, r) => s + r.distanceMeters / 1000, 0) >= 50,
  },
  {
    key: 'club_100',
    title: '100 KM Club',
    subtitle: '100 cumulative km tracked',
    unlocked: (runs) => runs.reduce((s, r) => s + r.distanceMeters / 1000, 0) >= 100,
  },
  {
    key: 'tricity_explorer',
    title: 'City Explorer',
    subtitle: 'Trained in 3+ distinct locations',
    unlocked: (runs) => new Set(runs.map((r) => r.startName.trim()).filter(Boolean)).size >= 3,
  },
  {
    key: 'gps_artist',
    title: 'GPS Artist',
    subtitle: 'Completed a GPS Art route',
    unlocked: (runs, art) =>
      runs.some((r) => r.routeType === 'run_art') || art.some((a) => a.status === 'completed'),
  },
  {
    key: 'two_wheel_start',
    title: 'Two-Wheel Ignition',
    subtitle: 'Completed a GPS-tracked bike ride',
    unlocked: (runs) => runs.some((r) => normalizeWorkoutType(r.workoutType) === 'cycling'),
  },
  {
    key: 'daily_walker',
    title: 'Steady Strider',
    subtitle: 'Logged an outdoor walk or trail hike',
    unlocked: (runs) =>
      runs.some((r) => {
        const w = normalizeWorkoutType(r.workoutType);
        return w === 'walking' || w === 'hiking';
      }),
  },
  {
    key: 'multi_sport',
    title: 'All-Round Mover',
    subtitle: 'Logged 2+ different workout types',
    unlocked: (runs) => new Set(runs.map((r) => normalizeWorkoutType(r.workoutType))).size >= 2,
  },
];
