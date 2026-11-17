import { RUN_ART_TEMPLATES, sanitizeAlphabetInput, recommendAlphabetKm } from '../services/runArtService';
import type { RouteMode, RoutePreference, RouteType, WorkoutType } from '../types/run';

export interface ParsedRoutePrompt {
  mode: RouteMode;
  workoutType: WorkoutType;
  distanceKm: number;
  routeType: RouteType;
  shapeId?: string;
  alphabetText?: string;
  nightMode: boolean;
  loopCount: number;
  preferences: RoutePreference[];
  summaryTags: string[];
}

export const EXAMPLE_ROUTE_PROMPTS: string[] = [
  '8km shaded park loop with fewer crossings',
  '5k heart shaped run art',
  '12km fast cycling loop with least turns',
  '6km night safe well-lit run',
  'Spell RUN in 6km',
  '10km quiet out and back walk',
];

export function parseRoutePrompt(
  rawPrompt: string,
  defaults: {
    workoutType: WorkoutType;
    distanceKm: number;
    preferences: RoutePreference[];
  }
): ParsedRoutePrompt {
  const text = rawPrompt.trim();
  const lower = text.toLowerCase();

  // 1. Workout type
  let workoutType: WorkoutType = defaults.workoutType;
  if (/\b(cycl(e|ing)|bike|biking|ride|riding)\b/i.test(lower)) {
    workoutType = 'cycling';
  } else if (/\b(walk(ing)?|stroll(ing)?|hike|hiking)\b/i.test(lower)) {
    workoutType = 'walking';
  } else if (/\b(run(ning)?|jog(ging)?|sprint|marathon|tempo)\b/i.test(lower)) {
    workoutType = 'running';
  }

  // 2. Distance (km or miles or named distances)
  let distanceKm = defaults.distanceKm;
  let explicitDistance = false;

  const kmMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:km|kms|kilometer|kilometers|kilometre|kilometres|k)\b/);
  const miMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/);
  if (kmMatch) {
    const val = parseFloat(kmMatch[1]);
    if (Number.isFinite(val) && val >= 0.5 && val <= 100) {
      distanceKm = Math.round(val * 10) / 10;
      explicitDistance = true;
    }
  } else if (miMatch) {
    const val = parseFloat(miMatch[1]) * 1.60934;
    if (Number.isFinite(val) && val >= 0.5 && val <= 100) {
      distanceKm = Math.round(val * 10) / 10;
      explicitDistance = true;
    }
  } else if (/\bhalf\s*marathon\b/i.test(lower)) {
    distanceKm = 21.1;
    explicitDistance = true;
  } else if (/\bmarathon\b/i.test(lower)) {
    distanceKm = 42.2;
    explicitDistance = true;
  }

  // 3. Mode & GPS Art (alphabet or shape)
  let mode: RouteMode = 'normal';
  let shapeId: string | undefined;
  let alphabetText: string | undefined;

  const spellMatch = text.match(/(?:spell|write|letters?|word)\s+["']?([a-zA-Z0-9]{1,8})["']?/i);
  if (spellMatch) {
    const cleaned = sanitizeAlphabetInput(spellMatch[1]);
    if (cleaned) {
      mode = 'run_art';
      shapeId = 'alphabet';
      alphabetText = cleaned;
      if (!explicitDistance) {
        distanceKm = recommendAlphabetKm(cleaned.length);
      }
    }
  }

  if (mode === 'normal') {
    for (const tpl of RUN_ART_TEMPLATES) {
      if (tpl.id === 'alphabet' || tpl.id === 'custom') continue;
      const idWord = tpl.id.replace(/_/g, ' ');
      const nameLower = tpl.name.toLowerCase();
      if (
        lower.includes(idWord) ||
        lower.includes(nameLower) ||
        (tpl.id === 'lightning' && /\bbolt\b/i.test(lower))
      ) {
        mode = 'run_art';
        shapeId = tpl.id;
        if (!explicitDistance) {
          distanceKm = tpl.recommendedKm;
        }
        break;
      }
    }
  }

  // 4. Route type
  let routeType: RouteType = 'circular';
  if (/\b(out\s*(and|&|-)\s*back|there\s*and\s*back)\b/i.test(lower)) {
    routeType = 'out_and_back';
  } else if (/\b(point\s*to\s*point|one\s*-?\s*way)\b/i.test(lower)) {
    routeType = 'point_to_point';
  } else if (/\b(loop|circular|circuit|round\s*trip)\b/i.test(lower)) {
    routeType = 'circular';
  }

  // 5. Loop count
  let loopCount = 1;
  const loopNumMatch = lower.match(/(\d+)\s*(?:loops?|laps?)\b/);
  if (loopNumMatch) {
    loopCount = Math.min(5, Math.max(1, parseInt(loopNumMatch[1], 10)));
  } else if (/\bdouble\s*(?:loop|lap)\b/i.test(lower)) {
    loopCount = 2;
  } else if (/\btriple\s*(?:loop|lap)\b/i.test(lower)) {
    loopCount = 3;
  }

  // 6. Night mode
  const nightMode = /\b(night|evening|dark|well[\s-]?lit|after\s*dark|late)\b/i.test(lower);

  // 7. Preferences
  const prefSet = new Set<RoutePreference>(['avoid_restricted']);
  let matchedAnyPref = false;

  if (/\b(park|parks|green|greenery|shaded|shade|trees|nature|garden)\b/i.test(lower)) {
    prefSet.add('parks_greenery');
    matchedAnyPref = true;
  }
  if (/\b(quiet|calm|peaceful|low\s*traffic|avoid\s*traffic|no\s*highway|avoid\s*highway)\b/i.test(lower)) {
    prefSet.add('quieter_roads');
    matchedAnyPref = true;
  }
  if (/\b(straight|fast|tempo|speed|least\s*turns|few\s*turns|fewer\s*turns)\b/i.test(lower)) {
    prefSet.add('least_turns');
    matchedAnyPref = true;
  }
  if (/\b(footpath|sidewalk|pedestrian|trail|path)\b/i.test(lower)) {
    prefSet.add('pedestrian_paths');
    matchedAnyPref = true;
  }
  if (/\b(no\s*stairs|avoid\s*stairs|flat|stroller|wheelchair)\b/i.test(lower)) {
    prefSet.add('avoid_stairs');
    matchedAnyPref = true;
  }
  if (/\b(fewer\s*crossings|no\s*crossings|uninterrupted|no\s*signals)\b/i.test(lower)) {
    prefSet.add('fewer_crossings');
    matchedAnyPref = true;
  }
  if (nightMode) {
    prefSet.add('well_lit');
    prefSet.delete('parks_greenery');
    matchedAnyPref = true;
  }

  const preferences = matchedAnyPref ? Array.from(prefSet) : defaults.preferences;

  // 8. Summary tags
  const summaryTags: string[] = [
    `${distanceKm} km`,
    workoutType.charAt(0).toUpperCase() + workoutType.slice(1),
  ];
  if (mode === 'run_art') {
    summaryTags.push(alphabetText ? `GPS Art "${alphabetText}"` : `GPS Art (${shapeId})`);
  } else {
    summaryTags.push(
      routeType === 'out_and_back'
        ? 'Out & Back'
        : routeType === 'point_to_point'
          ? 'Point to Point'
          : loopCount > 1
            ? `${loopCount}x Loop`
            : 'Circular Loop'
    );
  }
  if (nightMode) summaryTags.push('Night Safe');
  if (prefSet.has('parks_greenery') && !nightMode) summaryTags.push('Parks & Shade');
  if (prefSet.has('quieter_roads')) summaryTags.push('Quiet Roads');
  if (prefSet.has('least_turns')) summaryTags.push('Least Turns');
  if (prefSet.has('fewer_crossings')) summaryTags.push('Fewer Crossings');

  return {
    mode,
    workoutType,
    distanceKm,
    routeType,
    shapeId,
    alphabetText,
    nightMode,
    loopCount,
    preferences,
    summaryTags,
  };
}
