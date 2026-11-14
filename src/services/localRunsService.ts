import type { GpsSample, RunActivityDoc } from '../types/run';

const LOCAL_RUNS_STORAGE_KEY = 'tricity_completed_runs_v1';
const MAX_LOCAL_RUNS = 35;

export interface LocalSavedRunRecord {
  localId: string;
  ownerUid: string | null;
  syncStatus: 'pending' | 'synced';
  syncedRunId?: string;
  summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>;
  samples: GpsSample[];
  savedAt: string;
}

export function loadLocalRuns(): LocalSavedRunRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_RUNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalSavedRunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalRuns(records: LocalSavedRunRecord[]): LocalSavedRunRecord[] {
  if (typeof window === 'undefined') return records;
  const trimmed = records.slice(0, MAX_LOCAL_RUNS);
  try {
    window.localStorage.setItem(LOCAL_RUNS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // If storage quota is tight, strip raw GPS sample arrays from older records while keeping polylines/stats
    try {
      const compact = trimmed.slice(0, 15).map((r, idx) =>
        idx === 0 ? { ...r, samples: r.samples.slice(-150) } : { ...r, samples: [] }
      );
      window.localStorage.setItem(LOCAL_RUNS_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Ignore unrecoverable storage quota errors
    }
  }
  return trimmed;
}

export function upsertLocalRun(record: LocalSavedRunRecord): LocalSavedRunRecord[] {
  const existing = loadLocalRuns().filter((r) => r.localId !== record.localId);
  const nextRecord: LocalSavedRunRecord = {
    ...record,
    samples: record.samples.slice(-400),
  };
  return writeLocalRuns([nextRecord, ...existing]);
}

export function markLocalRunSynced(
  localId: string,
  syncedRunId: string,
  ownerUid: string
): LocalSavedRunRecord[] {
  const current = loadLocalRuns();
  const next = current.map((r) =>
    r.localId === localId
      ? {
          ...r,
          ownerUid,
          syncStatus: 'synced' as const,
          syncedRunId,
          samples: [],
        }
      : r
  );
  return writeLocalRuns(next);
}

export function removeLocalRun(idOrSyncedId: string): LocalSavedRunRecord[] {
  const current = loadLocalRuns();
  const next = current.filter(
    (r) => r.localId !== idOrSyncedId && r.syncedRunId !== idOrSyncedId
  );
  return writeLocalRuns(next);
}

export function getPendingUnsyncedRuns(uid?: string | null): LocalSavedRunRecord[] {
  return loadLocalRuns().filter(
    (r) => r.syncStatus === 'pending' && (r.ownerUid === null || (uid ? r.ownerUid === uid : false))
  );
}
