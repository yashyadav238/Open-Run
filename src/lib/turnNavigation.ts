import { bearingDegrees, haversineMeters } from './geo';
import type { LatLngLiteral, RouteStepInstruction } from '../types/run';

export type TurnDirectionType =
  | 'left'
  | 'slight_left'
  | 'sharp_left'
  | 'right'
  | 'slight_right'
  | 'sharp_right'
  | 'uturn'
  | 'finish'
  | 'straight';

export interface TurnCuePoint {
  index: number;
  turnType: TurnDirectionType;
  spokenAction: string;
  immediateAction: string;
  displayLabel: string;
  maneuver: string;
  position: LatLngLiteral;
  cumRouteMeters: number;
}

export interface TurnVoiceState {
  pre100: boolean;
  now: boolean;
}

export interface TurnEvaluationResult {
  nextCursorIdx: number;
  runnerCumMeters: number;
  upcomingTurn: TurnCuePoint | null;
  distToTurnMeters: number;
  voicePrompt: string | null;
  voiceStage: 'pre100' | 'now' | null;
}

export const TURN_ADVANCE_NOTIFY_METERS = 115;
export const TURN_IMMEDIATE_NOTIFY_METERS = 25;

export function computeCumulativePathMeters(path: LatLngLiteral[]): number[] {
  if (path.length === 0) return [];
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  return cum;
}

function normalizeTurnFromText(
  maneuver?: string,
  instruction?: string
): TurnDirectionType {
  const txt = `${maneuver || ''} ${instruction || ''}`.toLowerCase();
  if (txt.includes('u-turn') || txt.includes('uturn') || txt.includes('turn around')) {
    return 'uturn';
  }
  if (txt.includes('arrive') || txt.includes('destination') || txt.includes('finish')) {
    return 'finish';
  }
  if (txt.includes('sharp left')) return 'sharp_left';
  if (txt.includes('slight left') || txt.includes('keep left') || txt.includes('bear left')) {
    return 'slight_left';
  }
  if (txt.includes('left')) return 'left';
  if (txt.includes('sharp right')) return 'sharp_right';
  if (txt.includes('slight right') || txt.includes('keep right') || txt.includes('bear right')) {
    return 'slight_right';
  }
  if (txt.includes('right')) return 'right';
  return 'straight';
}

function extractRoadSuffix(instruction?: string): string {
  if (!instruction) return '';
  const clean = instruction.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const ontoMatch = clean.match(/\b(?:onto|on|toward|towards)\s+([^,.;]+)/i);
  if (!ontoMatch?.[1]) return '';
  const road = ontoMatch[1].trim();
  if (!road || road.length > 42 || /^pedestrian\s+path$/i.test(road)) return '';
  return ` onto ${road}`;
}

function describeTurnType(
  turnType: TurnDirectionType,
  roadSuffix = ''
): {
  spokenAction: string;
  immediateAction: string;
  displayLabel: string;
  maneuver: string;
} {
  switch (turnType) {
    case 'left':
      return {
        spokenAction: `turn left${roadSuffix}`,
        immediateAction: `Turn left now${roadSuffix}`,
        displayLabel: `Turn Left${roadSuffix}`,
        maneuver: 'turn-left',
      };
    case 'slight_left':
      return {
        spokenAction: `keep slightly left${roadSuffix}`,
        immediateAction: `Keep left now${roadSuffix}`,
        displayLabel: `Keep Left${roadSuffix}`,
        maneuver: 'turn-slight-left',
      };
    case 'sharp_left':
      return {
        spokenAction: `take a sharp left${roadSuffix}`,
        immediateAction: `Sharp left turn now${roadSuffix}`,
        displayLabel: `Sharp Left${roadSuffix}`,
        maneuver: 'turn-left',
      };
    case 'right':
      return {
        spokenAction: `turn right${roadSuffix}`,
        immediateAction: `Turn right now${roadSuffix}`,
        displayLabel: `Turn Right${roadSuffix}`,
        maneuver: 'turn-right',
      };
    case 'slight_right':
      return {
        spokenAction: `keep slightly right${roadSuffix}`,
        immediateAction: `Keep right now${roadSuffix}`,
        displayLabel: `Keep Right${roadSuffix}`,
        maneuver: 'turn-slight-right',
      };
    case 'sharp_right':
      return {
        spokenAction: `take a sharp right${roadSuffix}`,
        immediateAction: `Sharp right turn now${roadSuffix}`,
        displayLabel: `Sharp Right${roadSuffix}`,
        maneuver: 'turn-right',
      };
    case 'uturn':
      return {
        spokenAction: 'make a U-turn',
        immediateAction: 'Turn around now',
        displayLabel: 'U-Turn',
        maneuver: 'uturn',
      };
    case 'finish':
      return {
        spokenAction: 'you will reach your finish point',
        immediateAction: 'Finish point reached. Great run!',
        displayLabel: 'Finish Point',
        maneuver: 'finish',
      };
    default:
      return {
        spokenAction: `continue straight${roadSuffix}`,
        immediateAction: `Continue straight${roadSuffix}`,
        displayLabel: `Continue Straight${roadSuffix}`,
        maneuver: 'straight',
      };
  }
}

function signedAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  let diff = ((toDeg - fromDeg + 540) % 360) - 180;
  if (diff === -180) diff = 180;
  return diff;
}

function classifyTurnAngle(deltaDeg: number): TurnDirectionType {
  const abs = Math.abs(deltaDeg);
  if (abs < 38) return 'straight';
  if (abs >= 145) return 'uturn';
  if (deltaDeg > 0) {
    if (abs < 65) return 'slight_right';
    if (abs <= 118) return 'right';
    return 'sharp_right';
  }
  if (abs < 65) return 'slight_left';
  if (abs <= 118) return 'left';
  return 'sharp_left';
}

function pointAtOffset(
  path: LatLngLiteral[],
  cumMeters: number[],
  idx: number,
  deltaMeters: number
): LatLngLiteral {
  const target = Math.max(0, Math.min(cumMeters[cumMeters.length - 1], cumMeters[idx] + deltaMeters));
  if (deltaMeters >= 0) {
    for (let j = idx; j < path.length - 1; j++) {
      if (cumMeters[j + 1] >= target) {
        const span = Math.max(1e-6, cumMeters[j + 1] - cumMeters[j]);
        const t = (target - cumMeters[j]) / span;
        return {
          lat: path[j].lat + (path[j + 1].lat - path[j].lat) * t,
          lng: path[j].lng + (path[j + 1].lng - path[j].lng) * t,
        };
      }
    }
    return path[path.length - 1];
  }

  for (let j = idx; j > 0; j--) {
    if (cumMeters[j - 1] <= target) {
      const span = Math.max(1e-6, cumMeters[j] - cumMeters[j - 1]);
      const t = (target - cumMeters[j - 1]) / span;
      return {
        lat: path[j - 1].lat + (path[j].lat - path[j - 1].lat) * t,
        lng: path[j - 1].lng + (path[j].lng - path[j - 1].lng) * t,
      };
    }
  }
  return path[0];
}

export function extractGeometryTurns(path: LatLngLiteral[]): TurnCuePoint[] {
  if (path.length < 3) return [];
  const cum = computeCumulativePathMeters(path);
  const total = cum[cum.length - 1];
  if (total < 60) return [];

  const turns: TurnCuePoint[] = [];
  let lastTurnCum = -100;

  for (let i = 1; i < path.length - 1; i++) {
    const curCum = cum[i];
    if (curCum < 25 || curCum > total - 25) continue;
    if (curCum - lastTurnCum < 45) continue;

    const pBack = pointAtOffset(path, cum, i, -24);
    const pAhead = pointAtOffset(path, cum, i, 24);
    if (haversineMeters(pBack, path[i]) < 8 || haversineMeters(path[i], pAhead) < 8) {
      continue;
    }

    const inBearing = bearingDegrees(pBack, path[i]);
    const outBearing = bearingDegrees(path[i], pAhead);
    const delta = signedAngleDeltaDeg(inBearing, outBearing);
    const turnType = classifyTurnAngle(delta);

    if (turnType === 'straight') continue;

    const desc = describeTurnType(turnType);
    turns.push({
      index: turns.length,
      turnType,
      ...desc,
      position: path[i],
      cumRouteMeters: Math.round(curCum),
    });
    lastTurnCum = curCum;
  }

  const finishDesc = describeTurnType('finish');
  turns.push({
    index: turns.length,
    turnType: 'finish',
    ...finishDesc,
    position: path[path.length - 1],
    cumRouteMeters: Math.round(total),
  });

  return turns;
}

export function buildRouteTurnCues(
  path: LatLngLiteral[],
  steps: RouteStepInstruction[] = []
): TurnCuePoint[] {
  const cum = computeCumulativePathMeters(path);
  const totalRouteMeters = cum.length > 0 ? cum[cum.length - 1] : 0;

  const parsed: TurnCuePoint[] = [];
  let minPathSearchIdx = 0;
  let runningStepDist = 0;

  for (const st of steps) {
    const turnType = normalizeTurnFromText(st.maneuver, st.instruction);
    const stepDist = Math.max(0, st.distanceMeters || 0);

    let matchedCum = runningStepDist;
    let matchedPos = st.startLocation;

    if (path.length >= 2 && st.startLocation) {
      let bestIdx = minPathSearchIdx;
      let bestDist = Infinity;
      for (let i = minPathSearchIdx; i < path.length; i++) {
        const d = haversineMeters(path[i], st.startLocation);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
        // Once well past an initial match on a loop, don't jump ahead to another lap unless close
        if (bestDist < 30 && cum[i] - cum[bestIdx] > 180) {
          break;
        }
      }
      if (bestDist < 120) {
        minPathSearchIdx = bestIdx;
        matchedCum = cum[bestIdx];
        matchedPos = path[bestIdx];
      }
    }

    runningStepDist += stepDist;

    if (turnType === 'straight') continue;
    if (!matchedPos) continue;

    // Skip duplicate turns closer than 25m
    const prevCue = parsed[parsed.length - 1];
    if (prevCue && Math.abs(matchedCum - prevCue.cumRouteMeters) < 25) {
      continue;
    }

    const suffix = turnType === 'finish' ? '' : extractRoadSuffix(st.instruction);
    const desc = describeTurnType(turnType, suffix);

    parsed.push({
      index: parsed.length,
      turnType,
      ...desc,
      position: matchedPos,
      cumRouteMeters: Math.round(matchedCum),
    });
  }

  const nonFinishCount = parsed.filter((t) => t.turnType !== 'finish').length;
  if (nonFinishCount === 0 && path.length >= 3 && totalRouteMeters > 120) {
    return extractGeometryTurns(path);
  }

  // Ensure a finish cue exists at end of route
  if (
    path.length >= 2 &&
    totalRouteMeters > 80 &&
    !parsed.some((t) => t.turnType === 'finish')
  ) {
    const finishDesc = describeTurnType('finish');
    parsed.push({
      index: parsed.length,
      turnType: 'finish',
      ...finishDesc,
      position: path[path.length - 1],
      cumRouteMeters: Math.round(totalRouteMeters),
    });
  }

  return parsed.sort((a, b) => a.cumRouteMeters - b.cumRouteMeters).map((t, idx) => ({
    ...t,
    index: idx,
  }));
}

export function formatAdvanceVoicePrompt(
  turn: TurnCuePoint,
  distToTurnMeters: number
): string {
  if (turn.turnType === 'finish') {
    return distToTurnMeters >= 80 && distToTurnMeters <= 120
      ? 'In 100 meters, you will reach your finish point.'
      : `In ${Math.max(10, Math.round(distToTurnMeters / 10) * 10)} meters, you will reach your finish point.`;
  }

  const spokenDist =
    distToTurnMeters >= 80 && distToTurnMeters <= 120
      ? 100
      : Math.max(20, Math.round(distToTurnMeters / 10) * 10);

  return `In ${spokenDist} meters, ${turn.spokenAction}.`;
}

export function evaluateTurnVoiceCue(params: {
  path: LatLngLiteral[];
  cumPathMeters: number[];
  turns: TurnCuePoint[];
  userPos: LatLngLiteral;
  cursorIdx: number;
  spokenMap: Map<number, TurnVoiceState>;
}): TurnEvaluationResult {
  const { path, cumPathMeters, turns, userPos, cursorIdx, spokenMap } = params;

  if (path.length === 0 || turns.length === 0) {
    return {
      nextCursorIdx: cursorIdx,
      runnerCumMeters: 0,
      upcomingTurn: null,
      distToTurnMeters: 0,
      voicePrompt: null,
      voiceStage: null,
    };
  }

  // Advance cursor forward within a local corridor (up to +500m ahead along route)
  // so circular loops or out-and-backs never jump to a return leg prematurely.
  const safeCursor = Math.max(0, Math.min(path.length - 1, cursorIdx));
  const startSearchIdx = Math.max(0, safeCursor - 4);
  const startCum = cumPathMeters[safeCursor] ?? 0;

  let bestIdx = safeCursor;
  let bestDist = haversineMeters(userPos, path[safeCursor]);

  for (let i = startSearchIdx; i < path.length; i++) {
    if ((cumPathMeters[i] ?? 0) - startCum > 500) break;
    const d = haversineMeters(userPos, path[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  // If runner jumped far (e.g., rejoined route further along), widen search once
  if (bestDist > 90) {
    for (let i = safeCursor; i < path.length; i++) {
      const d = haversineMeters(userPos, path[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }

  // Project userPos onto adjacent route segments [bestIdx-1, bestIdx] and [bestIdx, bestIdx+1]
  // so long straight avenues with sparse polyline vertices still track distance meter-by-meter.
  let runnerCumMeters = cumPathMeters[bestIdx] ?? 0;
  let bestProjDist = bestDist;

  const projectOntoSegment = (segStartIdx: number) => {
    if (segStartIdx < 0 || segStartIdx >= path.length - 1) return;
    const a = path[segStartIdx];
    const b = path[segStartIdx + 1];
    const segLen = (cumPathMeters[segStartIdx + 1] ?? 0) - (cumPathMeters[segStartIdx] ?? 0);
    if (segLen < 1) return;

    const meanLatRad = (((a.lat + b.lat) / 2) * Math.PI) / 180;
    const cosLat = Math.max(0.2, Math.cos(meanLatRad));
    const ax = a.lng * cosLat;
    const ay = a.lat;
    const bx = b.lng * cosLat;
    const by = b.lat;
    const px = userPos.lng * cosLat;
    const py = userPos.lat;

    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;
    if (denom <= 1e-12) return;

    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom));
    const projPt: LatLngLiteral = {
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    };
    const dProj = haversineMeters(userPos, projPt);
    if (dProj <= bestProjDist + 1e-6) {
      bestProjDist = dProj;
      runnerCumMeters = (cumPathMeters[segStartIdx] ?? 0) + segLen * t;
    }
  };

  projectOntoSegment(bestIdx - 1);
  projectOntoSegment(bestIdx);

  // Select the next turn ahead (allow up to 12m grace past exact turn coordinate)
  let upcomingTurn: TurnCuePoint | null = null;
  for (const t of turns) {
    const state = spokenMap.get(t.index);
    if (t.cumRouteMeters >= runnerCumMeters - 12 && !state?.now) {
      upcomingTurn = t;
      break;
    }
  }

  if (!upcomingTurn) {
    // Fallback to last turn if nearing finish
    const remaining = turns.find((t) => t.cumRouteMeters >= runnerCumMeters);
    upcomingTurn = remaining || null;
  }

  if (!upcomingTurn) {
    return {
      nextCursorIdx: bestIdx,
      runnerCumMeters,
      upcomingTurn: null,
      distToTurnMeters: 0,
      voicePrompt: null,
      voiceStage: null,
    };
  }

  const distToTurnMeters = Math.max(0, Math.round(upcomingTurn.cumRouteMeters - runnerCumMeters));
  const prevState = spokenMap.get(upcomingTurn.index) || { pre100: false, now: false };

  let voicePrompt: string | null = null;
  let voiceStage: 'pre100' | 'now' | null = null;

  // Trigger immediate execution prompt within 25m
  if (distToTurnMeters <= TURN_IMMEDIATE_NOTIFY_METERS && !prevState.now) {
    spokenMap.set(upcomingTurn.index, { pre100: true, now: true });
    voicePrompt = upcomingTurn.immediateAction;
    voiceStage = 'now';
  } else if (
    distToTurnMeters <= TURN_ADVANCE_NOTIFY_METERS &&
    distToTurnMeters > TURN_IMMEDIATE_NOTIFY_METERS &&
    !prevState.pre100
  ) {
    // Trigger advance prompt ~100m before the turn
    spokenMap.set(upcomingTurn.index, { ...prevState, pre100: true });
    voicePrompt = formatAdvanceVoicePrompt(upcomingTurn, distToTurnMeters);
    voiceStage = 'pre100';
  }

  return {
    nextCursorIdx: bestIdx,
    runnerCumMeters,
    upcomingTurn,
    distToTurnMeters,
    voicePrompt,
    voiceStage,
  };
}
