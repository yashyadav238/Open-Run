import { getWorkoutMeta, normalizeWorkoutType } from '../data/workouts';
import type { RunActivityDoc, WorkoutType } from '../types/run';

export type RankTierId =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'emerald'
  | 'diamond'
  | 'pro'
  | 'ultra'
  | 'legend';

export interface RankStep {
  tier: RankTierId;
  tierName: string;
  division: 'I' | 'II' | 'III' | '';
  label: string;
  minKm: number;
  badgeClass: string;
  barClass: string;
}

export const RANK_LADDER: RankStep[] = [
  { tier: 'bronze', tierName: 'Bronze', division: 'I', label: 'Bronze I', minKm: 0, badgeClass: 'bg-amber-900/15 text-amber-900 border-amber-800/30', barClass: 'bg-amber-700' },
  { tier: 'bronze', tierName: 'Bronze', division: 'II', label: 'Bronze II', minKm: 8, badgeClass: 'bg-amber-900/15 text-amber-900 border-amber-800/30', barClass: 'bg-amber-700' },
  { tier: 'bronze', tierName: 'Bronze', division: 'III', label: 'Bronze III', minKm: 16, badgeClass: 'bg-amber-900/15 text-amber-900 border-amber-800/30', barClass: 'bg-amber-700' },

  { tier: 'silver', tierName: 'Silver', division: 'I', label: 'Silver I', minKm: 25, badgeClass: 'bg-slate-200 text-slate-800 border-slate-300', barClass: 'bg-slate-500' },
  { tier: 'silver', tierName: 'Silver', division: 'II', label: 'Silver II', minKm: 40, badgeClass: 'bg-slate-200 text-slate-800 border-slate-300', barClass: 'bg-slate-500' },
  { tier: 'silver', tierName: 'Silver', division: 'III', label: 'Silver III', minKm: 55, badgeClass: 'bg-slate-200 text-slate-800 border-slate-300', barClass: 'bg-slate-500' },

  { tier: 'gold', tierName: 'Gold', division: 'I', label: 'Gold I', minKm: 75, badgeClass: 'bg-yellow-100 text-yellow-900 border-yellow-300', barClass: 'bg-yellow-500' },
  { tier: 'gold', tierName: 'Gold', division: 'II', label: 'Gold II', minKm: 100, badgeClass: 'bg-yellow-100 text-yellow-900 border-yellow-300', barClass: 'bg-yellow-500' },
  { tier: 'gold', tierName: 'Gold', division: 'III', label: 'Gold III', minKm: 125, badgeClass: 'bg-yellow-100 text-yellow-900 border-yellow-300', barClass: 'bg-yellow-500' },

  { tier: 'platinum', tierName: 'Platinum', division: 'I', label: 'Platinum I', minKm: 150, badgeClass: 'bg-cyan-100 text-cyan-950 border-cyan-300', barClass: 'bg-cyan-600' },
  { tier: 'platinum', tierName: 'Platinum', division: 'II', label: 'Platinum II', minKm: 180, badgeClass: 'bg-cyan-100 text-cyan-950 border-cyan-300', barClass: 'bg-cyan-600' },
  { tier: 'platinum', tierName: 'Platinum', division: 'III', label: 'Platinum III', minKm: 215, badgeClass: 'bg-cyan-100 text-cyan-950 border-cyan-300', barClass: 'bg-cyan-600' },

  { tier: 'emerald', tierName: 'Emerald', division: 'I', label: 'Emerald I', minKm: 250, badgeClass: 'bg-emerald-100 text-emerald-950 border-emerald-300', barClass: 'bg-emerald-600' },
  { tier: 'emerald', tierName: 'Emerald', division: 'II', label: 'Emerald II', minKm: 300, badgeClass: 'bg-emerald-100 text-emerald-950 border-emerald-300', barClass: 'bg-emerald-600' },
  { tier: 'emerald', tierName: 'Emerald', division: 'III', label: 'Emerald III', minKm: 350, badgeClass: 'bg-emerald-100 text-emerald-950 border-emerald-300', barClass: 'bg-emerald-600' },

  { tier: 'diamond', tierName: 'Diamond', division: 'I', label: 'Diamond I', minKm: 400, badgeClass: 'bg-sky-100 text-sky-950 border-sky-300', barClass: 'bg-sky-600' },
  { tier: 'diamond', tierName: 'Diamond', division: 'II', label: 'Diamond II', minKm: 465, badgeClass: 'bg-sky-100 text-sky-950 border-sky-300', barClass: 'bg-sky-600' },
  { tier: 'diamond', tierName: 'Diamond', division: 'III', label: 'Diamond III', minKm: 530, badgeClass: 'bg-sky-100 text-sky-950 border-sky-300', barClass: 'bg-sky-600' },

  { tier: 'pro', tierName: 'Pro', division: 'I', label: 'Pro I', minKm: 600, badgeClass: 'bg-indigo-100 text-indigo-950 border-indigo-300', barClass: 'bg-indigo-600' },
  { tier: 'pro', tierName: 'Pro', division: 'II', label: 'Pro II', minKm: 665, badgeClass: 'bg-indigo-100 text-indigo-950 border-indigo-300', barClass: 'bg-indigo-600' },
  { tier: 'pro', tierName: 'Pro', division: 'III', label: 'Pro III', minKm: 730, badgeClass: 'bg-indigo-100 text-indigo-950 border-indigo-300', barClass: 'bg-indigo-600' },

  { tier: 'ultra', tierName: 'Ultra', division: 'I', label: 'Ultra I', minKm: 800, badgeClass: 'bg-fuchsia-100 text-fuchsia-950 border-fuchsia-300', barClass: 'bg-fuchsia-600' },
  { tier: 'ultra', tierName: 'Ultra', division: 'II', label: 'Ultra II', minKm: 865, badgeClass: 'bg-fuchsia-100 text-fuchsia-950 border-fuchsia-300', barClass: 'bg-fuchsia-600' },
  { tier: 'ultra', tierName: 'Ultra', division: 'III', label: 'Ultra III', minKm: 930, badgeClass: 'bg-fuchsia-100 text-fuchsia-950 border-fuchsia-300', barClass: 'bg-fuchsia-600' },

  { tier: 'legend', tierName: 'Legend', division: '', label: 'Legend (1000+ km)', minKm: 1000, badgeClass: 'bg-[#172D27] text-[#9AE62E] border-[#172D27]', barClass: 'bg-[#9AE62E]' },
];

export interface RankProgress {
  current: RankStep;
  next: RankStep | null;
  totalKm: number;
  progressPct: number;
  kmToNext: number;
}

export function getRankForDistanceKm(totalKm: number): RankProgress {
  const safeKm = Math.max(0, Number.isFinite(totalKm) ? totalKm : 0);
  let idx = 0;
  for (let i = 0; i < RANK_LADDER.length; i++) {
    if (safeKm >= RANK_LADDER[i].minKm) {
      idx = i;
    } else {
      break;
    }
  }
  const current = RANK_LADDER[idx];
  const next = idx + 1 < RANK_LADDER.length ? RANK_LADDER[idx + 1] : null;
  if (!next) {
    return {
      current,
      next: null,
      totalKm: Number(safeKm.toFixed(1)),
      progressPct: 100,
      kmToNext: 0,
    };
  }
  const span = Math.max(1, next.minKm - current.minKm);
  const progressPct = Math.min(100, Math.max(0, Math.round(((safeKm - current.minKm) / span) * 100)));
  return {
    current,
    next,
    totalKm: Number(safeKm.toFixed(1)),
    progressPct,
    kmToNext: Number(Math.max(0, next.minKm - safeKm).toFixed(1)),
  };
}

export interface WorkoutCategoryRank {
  workoutType: WorkoutType;
  label: string;
  sessions: number;
  rank: RankProgress;
}

const RANKED_CATEGORIES: WorkoutType[] = ['running', 'trail_run', 'cycling', 'walking', 'hiking'];

export function computeCategoryRanks(runs: RunActivityDoc[]): {
  overall: RankProgress;
  categories: WorkoutCategoryRank[];
} {
  const kmByType: Record<WorkoutType, number> = {
    running: 0,
    trail_run: 0,
    cycling: 0,
    walking: 0,
    hiking: 0,
  };
  const countByType: Record<WorkoutType, number> = {
    running: 0,
    trail_run: 0,
    cycling: 0,
    walking: 0,
    hiking: 0,
  };

  let overallKm = 0;
  for (const r of runs) {
    const wt = normalizeWorkoutType(r.workoutType);
    const km = Math.max(0, (r.distanceMeters || 0) / 1000);
    kmByType[wt] += km;
    countByType[wt] += 1;
    overallKm += km;
  }

  return {
    overall: getRankForDistanceKm(overallKm),
    categories: RANKED_CATEGORIES.map((wt) => ({
      workoutType: wt,
      label: getWorkoutMeta(wt).fullLabel,
      sessions: countByType[wt],
      rank: getRankForDistanceKm(kmByType[wt]),
    })),
  };
}
