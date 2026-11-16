export type RunPhase = 'ready' | 'running' | 'paused';
export type PauseReason = 'manual' | 'auto' | null;

export const ZERO_SPEED_THRESHOLD_MS = 0.35; // ~1.26 km/h
export const RESUME_SPEED_THRESHOLD_MS = 0.72; // ~2.59 km/h
export const AUTO_PAUSE_DELAY_MS = 4000; // 4s stationary triggers auto-pause

export interface SpeedSampleInput {
  reportedSpeedMs?: number | null;
  stepMeters: number;
  dtSec: number;
  accuracyMeters: number;
  maxValidSpeedMs?: number;
}

/**
 * Computes instantaneous running/cycling/walking speed in m/s from GPS Doppler speed and filtered displacement.
 * Snaps sub-threshold GPS drift cleanly to 0 so the instantaneous speed bar settles at 0.0 km/h when stopped.
 */
export function computeInstantaneousSpeedMs(input: SpeedSampleInput): number {
  const { reportedSpeedMs, stepMeters, dtSec, accuracyMeters, maxValidSpeedMs = 11.5 } = input;
  const safeDt = Math.max(0.5, dtSec);
  const displacementSpeed = stepMeters / safeDt;

  if (
    typeof reportedSpeedMs === 'number' &&
    Number.isFinite(reportedSpeedMs) &&
    reportedSpeedMs >= 0
  ) {
    if (reportedSpeedMs > maxValidSpeedMs) return 0;
    if (reportedSpeedMs < ZERO_SPEED_THRESHOLD_MS && stepMeters < 3) {
      return 0;
    }
    // Guard against stale Doppler speed when position didn't move over multiple seconds
    if (reportedSpeedMs > 0.5 && accuracyMeters <= 35 && safeDt >= 3 && stepMeters < 1.2) {
      return 0;
    }
    return reportedSpeedMs < ZERO_SPEED_THRESHOLD_MS ? 0 : reportedSpeedMs;
  }

  if (accuracyMeters > 65) return 0;
  if (stepMeters < 2 && safeDt >= 1.2) return 0;
  if (displacementSpeed > maxValidSpeedMs || displacementSpeed < ZERO_SPEED_THRESHOLD_MS) {
    return 0;
  }
  return displacementSpeed;
}

export interface AutoPauseEvalInput {
  phase: RunPhase;
  pauseReason: PauseReason;
  autoPauseEnabled: boolean;
  speedMs: number;
  nowMs: number;
  lastMotionMs: number;
  firstFixReceived: boolean;
  distFromPauseAnchorMeters: number;
  accuracyMeters: number;
}

export type AutoPauseAction = 'auto_pause' | 'auto_resume' | 'none';

/**
 * Evaluates whether an active run should auto-pause at zero speed or auto-resume when moving again.
 * Manual pauses are strictly preserved until the runner manually resumes.
 */
export function evaluateAutoPauseTransition(input: AutoPauseEvalInput): AutoPauseAction {
  const {
    phase,
    pauseReason,
    autoPauseEnabled,
    speedMs,
    nowMs,
    lastMotionMs,
    firstFixReceived,
    distFromPauseAnchorMeters,
    accuracyMeters,
  } = input;

  if (!autoPauseEnabled) return 'none';

  if (phase === 'running') {
    if (!firstFixReceived) return 'none';
    if (speedMs <= ZERO_SPEED_THRESHOLD_MS && nowMs - lastMotionMs >= AUTO_PAUSE_DELAY_MS) {
      return 'auto_pause';
    }
    return 'none';
  }

  if (phase === 'paused' && pauseReason === 'auto') {
    if (accuracyMeters > 55) return 'none';
    if (
      (speedMs >= RESUME_SPEED_THRESHOLD_MS && distFromPauseAnchorMeters >= 2.5) ||
      (distFromPauseAnchorMeters >= 7 && speedMs >= 0.55)
    ) {
      return 'auto_resume';
    }
  }

  return 'none';
}

export function speedBarPercent(speedKmh: number, maxSpeedBarKmh = 22): number {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return 0;
  const maxRef = Math.max(8, maxSpeedBarKmh);
  return Math.min(100, Math.max(4, Math.round((speedKmh / maxRef) * 100)));
}
