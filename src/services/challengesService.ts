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
    title: 'First Run',
    description: 'Complete your first GPS-tracked run anywhere in Chandigarh.',
    target: 1,
    unit: 'run',
    timeframe: 'Anytime',
    computeProgress: (runs) => Math.min(1, runs.length),
  },
  {
    key: 'first_5k',
    title: 'First 5K',
    description: 'Finish a single run of 5.0 km or more.',
    target: 5,
    unit: 'km',
    timeframe: 'Single run',
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
    timeframe: 'Single run',
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
    title: 'Five Runs in a Month',
    description: 'Log 5 completed runs across 30 days.',
    target: 5,
    unit: 'runs',
    timeframe: '30 days',
    computeProgress: (runs) => {
      const cutoff = Date.now() - 30 * 86400 * 1000;
      return Math.min(5, runs.filter((r) => new Date(r.finishedAt).getTime() >= cutoff).length);
    },
  },
  {
    key: 'explore_three_areas',
    title: 'Explore Three Areas',
    description: 'Run from at least 3 distinct Chandigarh parks or sectors.',
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
    title: 'Run Art Finisher',
    description: 'Complete a GPS Run Art route on real Chandigarh paths.',
    target: 1,
    unit: 'artwork',
    timeframe: 'All time',
    computeProgress: (runs, art) => {
      const completedRuns = runs.filter((r) => r.routeType === 'run_art').length;
      const completedArt = art.filter((a) => a.status === 'completed').length;
      return Math.min(1, Math.max(completedRuns, completedArt));
    },
  },
];

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'first_km',
    title: 'First Kilometre',
    subtitle: 'Logged 1+ km in a live run',
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
    title: 'Chandigarh Explorer',
    subtitle: 'Ran in 3+ distinct locations',
    unlocked: (runs) => new Set(runs.map((r) => r.startName.trim()).filter(Boolean)).size >= 3,
  },
  {
    key: 'gps_artist',
    title: 'GPS Artist',
    subtitle: 'Completed a Run Art route',
    unlocked: (runs, art) =>
      runs.some((r) => r.routeType === 'run_art') || art.some((a) => a.status === 'completed'),
  },
];
