import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { MAX_BIO_LENGTH, sanitizeBioTags } from '../data/bioTags';
import { normalizeWorkoutType } from '../data/workouts';
import type {
  DailyRunPostDoc,
  DmMessageDoc,
  DmMessageType,
  DmThreadDoc,
  FriendRequestDoc,
  GpsSample,
  LiveBeaconDoc,
  LiveBeaconShareScope,
  LiveBeaconStatus,
  OpenEventRsvpDoc,
  OpenEventType,
  OpenRunInviteDoc,
  PathReportDoc,
  PersonalInviteStatus,
  RunActivityDoc,
  RunArtDesignDoc,
  RunnerDirectoryDoc,
  RunStoryDoc,
  SavedRouteDoc,
  StoryThemeColor,
  UserProfileDoc,
  UserSafetyDoc,
  WorkoutType,
} from '../types/run';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function makePairId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('__');
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function isValidUsernameFormat(username: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

function sanitizeUsernameSeed(displayName: string): string {
  const cleaned = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  return cleaned.length >= 3 ? cleaned : 'runner';
}

export function sanitizePhotoUrl(raw?: string | null): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) && trimmed.length <= 2048) {
    return trimmed;
  }
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length <= 80000) {
    return trimmed;
  }
  return '';
}

export async function checkUsernameAvailability(
  rawUsername: string,
  currentUid?: string
): Promise<{ available: boolean; normalized: string; reason?: string }> {
  const normalized = normalizeUsername(rawUsername);
  if (!isValidUsernameFormat(normalized)) {
    return {
      available: false,
      normalized,
      reason: 'Use 3–24 lowercase letters, numbers, or underscores.',
    };
  }
  const path = `usernames/${normalized}`;
  try {
    const snap = await getDoc(doc(db, 'usernames', normalized));
    if (!snap.exists()) {
      return { available: true, normalized };
    }
    const existingData = snap.data() as { uid?: string };
    if (currentUid && existingData.uid === currentUid) {
      return {
        available: true,
        normalized,
        reason: 'This is already your current @username.',
      };
    }
    return {
      available: false,
      normalized,
      reason: `@${normalized} is already taken.`,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function claimUsername(
  uid: string,
  rawUsername: string,
  displayName: string
): Promise<string> {
  const normalized = normalizeUsername(rawUsername);
  if (!isValidUsernameFormat(normalized)) {
    throw new Error('Username must be 3–24 characters using only lowercase letters, numbers, or underscores.');
  }
  const cleanName = (displayName || 'Open Runner').trim().slice(0, 80) || 'Open Runner';
  const path = `usernames/${normalized}`;
  try {
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', uid);
      const claimRef = doc(db, 'usernames', normalized);
      const [userSnap, claimSnap] = await Promise.all([tx.get(userRef), tx.get(claimRef)]);

      if (claimSnap.exists() && claimSnap.data().uid !== uid) {
        throw new Error(`@${normalized} is already taken. Try another username.`);
      }

      const oldUsername = userSnap.exists()
        ? (userSnap.data().username as string | undefined)
        : undefined;
      let oldClaimSnap = null;
      const oldClaimRef =
        oldUsername && oldUsername !== normalized && isValidUsernameFormat(oldUsername)
          ? doc(db, 'usernames', oldUsername)
          : null;
      if (oldClaimRef) {
        oldClaimSnap = await tx.get(oldClaimRef);
      }

      if (oldClaimRef && oldClaimSnap?.exists() && oldClaimSnap.data().uid === uid) {
        tx.delete(oldClaimRef);
      }
      if (!claimSnap.exists()) {
        tx.set(claimRef, {
          username: normalized,
          uid,
          displayName: cleanName,
          createdAt: serverTimestamp(),
        });
      }
      if (userSnap.exists()) {
        tx.update(userRef, {
          username: normalized,
          updatedAt: serverTimestamp(),
        });
      }
    });

    const freshUserSnap = await getDoc(doc(db, 'users', uid));
    if (freshUserSnap.exists()) {
      const fresh = freshUserSnap.data() as UserProfileDoc;
      await syncRunnerDirectoryCard(uid, {
        username: normalized,
        displayName: fresh.displayName || cleanName,
        photoURL: fresh.photoURL,
        city: fresh.city,
        bio: fresh.bio,
        bioTags: fresh.bioTags,
        preferredWorkout: fresh.preferredWorkout,
        totalDistanceKm: fresh.totalDistanceKm,
        totalRuns: fresh.totalRuns,
      });
    }
    return normalized;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('already taken') || err.message.includes('Username must be'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

async function tryAutoAssignUsername(uid: string, displayName: string): Promise<string | undefined> {
  const base = sanitizeUsernameSeed(displayName);
  const uidTail = uid.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 4) || 'run';
  const candidates = [
    base,
    `${base}_${uidTail}`.slice(0, 24),
    `${base}_${Math.floor(100 + Math.random() * 900)}`.slice(0, 24),
    `runner_${uidTail}${Math.floor(10 + Math.random() * 89)}`.slice(0, 24),
  ].filter(isValidUsernameFormat);

  for (const candidate of candidates) {
    try {
      const existing = await getDoc(doc(db, 'usernames', candidate));
      if (!existing.exists()) {
        return await claimUsername(uid, candidate, displayName);
      }
    } catch {
      // Try next candidate silently
    }
  }
  return undefined;
}

export async function lookupRunnerByUsername(rawUsername: string): Promise<RunnerDirectoryDoc | null> {
  const normalized = normalizeUsername(rawUsername);
  if (!isValidUsernameFormat(normalized)) return null;
  const path = `usernames/${normalized}`;
  try {
    const claimSnap = await getDoc(doc(db, 'usernames', normalized));
    if (!claimSnap.exists()) return null;
    const claim = claimSnap.data() as { uid: string; username: string; displayName: string };
    const dirSnap = await getDoc(doc(db, 'runner_directory', claim.uid));
    if (dirSnap.exists()) {
      return {
        username: claim.username,
        ...(dirSnap.data() as RunnerDirectoryDoc),
      };
    }
    return {
      uid: claim.uid,
      username: claim.username,
      displayName: claim.displayName,
      city: 'Chandigarh',
      totalDistanceKm: 0,
      totalRuns: 0,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function syncRunnerDirectoryCard(
  uid: string,
  data: {
    username?: string;
    displayName: string;
    photoURL?: string | null;
    city?: string;
    bio?: string;
    bioTags?: string[];
    preferredWorkout?: WorkoutType;
    totalDistanceKm?: number;
    totalRuns?: number;
  }
): Promise<void> {
  try {
    const cleanName = (data.displayName || 'Open Runner').trim().slice(0, 80) || 'Open Runner';
    const payload: Record<string, unknown> = {
      uid,
      displayName: cleanName,
      city: (data.city || 'Chandigarh').trim().slice(0, 80) || 'Chandigarh',
      totalDistanceKm: Number(Math.max(0, data.totalDistanceKm ?? 0).toFixed(2)),
      totalRuns: Math.max(0, Math.round(data.totalRuns ?? 0)),
      updatedAt: serverTimestamp(),
    };
    if (data.username && isValidUsernameFormat(data.username)) {
      payload.username = data.username;
    }
    const cleanPhoto = sanitizePhotoUrl(data.photoURL);
    payload.photoURL = cleanPhoto;
    if (typeof data.bio === 'string' && data.bio.trim()) {
      payload.bio = data.bio.trim().slice(0, MAX_BIO_LENGTH);
    }
    if (Array.isArray(data.bioTags)) {
      const cleanTags = sanitizeBioTags(data.bioTags);
      if (cleanTags.length > 0) {
        payload.bioTags = cleanTags;
      }
    }
    if (data.preferredWorkout) {
      payload.preferredWorkout = normalizeWorkoutType(data.preferredWorkout);
    }
    await setDoc(doc(db, 'runner_directory', uid), payload);
  } catch {
    // Non-fatal background directory sync
  }
}

export async function ensureUserProfile(
  uid: string,
  displayName: string,
  photoURL?: string | null
): Promise<UserProfileDoc> {
  const path = `users/${uid}`;
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as UserProfileDoc;
      let resolvedUsername = existing.username;
      if (!resolvedUsername) {
        resolvedUsername = await tryAutoAssignUsername(uid, existing.displayName || displayName);
      }
      void syncRunnerDirectoryCard(uid, {
        username: resolvedUsername,
        displayName: existing.displayName || displayName,
        photoURL: typeof existing.photoURL === 'string' ? existing.photoURL : photoURL,
        city: existing.city,
        bio: existing.bio,
        bioTags: existing.bioTags,
        preferredWorkout: existing.preferredWorkout,
        totalDistanceKm: existing.totalDistanceKm,
        totalRuns: existing.totalRuns,
      });
      return resolvedUsername && !existing.username
        ? { ...existing, username: resolvedUsername }
        : existing;
    }
    const cleanName = (displayName || 'Open Runner').slice(0, 80);
    const cleanInitialPhoto = sanitizePhotoUrl(photoURL);
    const profile: Record<string, unknown> = {
      uid,
      displayName: cleanName,
      preferredUnit: 'km',
      preferredWorkout: 'running',
      preferredTerrain: 'Parks & Paved Paths',
      city: 'Chandigarh',
      totalDistanceKm: 0,
      totalRuns: 0,
      totalDurationSec: 0,
      longestRunKm: 0,
      bestPaceSecPerKm: 0,
      currentStreakDays: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (cleanInitialPhoto) {
      profile.photoURL = cleanInitialPhoto;
    }
    await setDoc(ref, profile);
    const assignedUsername = await tryAutoAssignUsername(uid, cleanName);
    void syncRunnerDirectoryCard(uid, {
      username: assignedUsername,
      displayName: cleanName,
      photoURL: cleanInitialPhoto,
      city: 'Chandigarh',
      preferredWorkout: 'running',
      totalDistanceKm: 0,
      totalRuns: 0,
    });
    return {
      ...profile,
      uid,
      username: assignedUsername,
      displayName: cleanName,
      preferredUnit: 'km',
      preferredWorkout: 'running',
      totalDistanceKm: 0,
      totalRuns: 0,
      totalDurationSec: 0,
      longestRunKm: 0,
      bestPaceSecPerKm: 0,
      currentStreakDays: 0,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfileDoc,
      | 'displayName'
      | 'photoURL'
      | 'preferredUnit'
      | 'preferredWorkout'
      | 'preferredTerrain'
      | 'city'
      | 'cityLat'
      | 'cityLng'
      | 'bio'
      | 'bioTags'
    >
  >
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.displayName !== undefined) payload.displayName = updates.displayName.trim().slice(0, 80);
    if (updates.photoURL !== undefined) payload.photoURL = sanitizePhotoUrl(updates.photoURL);
    if (updates.preferredUnit !== undefined) payload.preferredUnit = updates.preferredUnit;
    if (updates.preferredWorkout !== undefined) {
      payload.preferredWorkout = normalizeWorkoutType(updates.preferredWorkout);
    }
    if (updates.preferredTerrain !== undefined) payload.preferredTerrain = updates.preferredTerrain.slice(0, 40);
    if (updates.city !== undefined) {
      payload.city = (updates.city.trim() || 'Chandigarh').slice(0, 80);
    }
    if (
      typeof updates.cityLat === 'number' &&
      Number.isFinite(updates.cityLat) &&
      updates.cityLat >= -90 &&
      updates.cityLat <= 90
    ) {
      payload.cityLat = updates.cityLat;
    }
    if (
      typeof updates.cityLng === 'number' &&
      Number.isFinite(updates.cityLng) &&
      updates.cityLng >= -180 &&
      updates.cityLng <= 180
    ) {
      payload.cityLng = updates.cityLng;
    }
    if (updates.bio !== undefined) {
      payload.bio = updates.bio.trim().slice(0, MAX_BIO_LENGTH);
    }
    if (updates.bioTags !== undefined) {
      payload.bioTags = sanitizeBioTags(updates.bioTags);
    }
    await updateDoc(doc(db, 'users', uid), payload);
    const freshSnap = await getDoc(doc(db, 'users', uid));
    if (freshSnap.exists()) {
      const fresh = freshSnap.data() as UserProfileDoc;
      void syncRunnerDirectoryCard(uid, {
        username: fresh.username,
        displayName: fresh.displayName,
        photoURL: fresh.photoURL,
        city: fresh.city,
        bio: fresh.bio,
        bioTags: fresh.bioTags,
        preferredWorkout: fresh.preferredWorkout,
        totalDistanceKm: fresh.totalDistanceKm,
        totalRuns: fresh.totalRuns,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function saveSafetySettings(uid: string, data: Omit<UserSafetyDoc, 'userId' | 'updatedAt'>): Promise<void> {
  const path = `users/${uid}/private/safety`;
  try {
    await setDoc(doc(db, 'users', uid, 'private', 'safety'), {
      userId: uid,
      emergencyContactName: data.emergencyContactName.slice(0, 80),
      emergencyContactPhone: data.emergencyContactPhone.slice(0, 30),
      trustedShareEnabled: Boolean(data.trustedShareEnabled),
      checkInIntervalMin: Math.min(240, Math.max(5, Math.round(data.checkInIntervalMin || 30))),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function getSafetySettings(uid: string): Promise<UserSafetyDoc | null> {
  const path = `users/${uid}/private/safety`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'safety'));
    return snap.exists() ? (snap.data() as UserSafetyDoc) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function saveRouteToLibrary(
  uid: string,
  route: Omit<SavedRouteDoc, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const routeId = makeSafeId('route');
  const path = `saved_routes/${routeId}`;
  try {
    await setDoc(doc(db, 'saved_routes', routeId), {
      userId: uid,
      name: route.name.slice(0, 120),
      notes: (route.notes || '').slice(0, 500),
      city: (route.city || 'Chandigarh').slice(0, 50),
      workoutType: normalizeWorkoutType(route.workoutType),
      routeType: route.routeType,
      distanceMeters: Math.round(route.distanceMeters),
      durationSec: Math.round(route.durationSec),
      elevationGainMeters: route.elevationGainMeters ?? 0,
      startLat: route.startLat,
      startLng: route.startLng,
      startName: route.startName.slice(0, 140),
      endLat: route.endLat,
      endLng: route.endLng,
      endName: route.endName.slice(0, 140),
      encodedPolyline: route.encodedPolyline.slice(0, 20000),
      preferences: (route.preferences || []).slice(0, 10),
      isPublic: Boolean(route.isPublic),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return routeId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateSavedRoute(
  routeId: string,
  updates: { name?: string; notes?: string; isPublic?: boolean }
): Promise<void> {
  const path = `saved_routes/${routeId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.name !== undefined) payload.name = updates.name.trim().slice(0, 120);
    if (updates.notes !== undefined) payload.notes = updates.notes.trim().slice(0, 500);
    if (updates.isPublic !== undefined) payload.isPublic = updates.isPublic;
    await updateDoc(doc(db, 'saved_routes', routeId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteSavedRoute(routeId: string): Promise<void> {
  const path = `saved_routes/${routeId}`;
  try {
    await deleteDoc(doc(db, 'saved_routes', routeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function saveCompletedRun(
  uid: string,
  run: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>,
  samples: GpsSample[],
  existingProfile: UserProfileDoc | null
): Promise<string> {
  const runId = makeSafeId('run');
  const path = `runs/${runId}`;
  const workoutType = normalizeWorkoutType(run.workoutType);
  try {
    const runDoc: Record<string, unknown> = {
      userId: uid,
      routeId: (run.routeId || '').slice(0, 128),
      routeName: run.routeName.slice(0, 120),
      workoutType,
      routeType: run.routeType,
      distanceMeters: Math.round(run.distanceMeters),
      durationSec: Math.round(run.durationSec),
      avgPaceSecPerKm: Math.round(run.avgPaceSecPerKm || 0),
      bestPaceSecPerKm: Math.round(run.bestPaceSecPerKm || 0),
      avgSpeedKmh: Number((run.avgSpeedKmh || 0).toFixed(2)),
      elevationGainMeters:
        typeof run.elevationGainMeters === 'number' && Number.isFinite(run.elevationGainMeters)
          ? Math.min(25000, Math.max(0, Math.round(run.elevationGainMeters)))
          : 0,
      splits: run.splits.slice(0, 100),
      encodedPolyline: run.encodedPolyline.slice(0, 25000),
      startName: run.startName.slice(0, 140),
      sampleCount: samples.length,
      status: 'completed',
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: serverTimestamp(),
    };
    if (
      typeof run.elevationLossMeters === 'number' &&
      Number.isFinite(run.elevationLossMeters) &&
      run.elevationLossMeters >= 0
    ) {
      runDoc.elevationLossMeters = Math.min(25000, Math.round(run.elevationLossMeters));
    }
    if (
      typeof run.minElevationMeters === 'number' &&
      Number.isFinite(run.minElevationMeters) &&
      run.minElevationMeters >= -500 &&
      run.minElevationMeters <= 9000
    ) {
      runDoc.minElevationMeters = Math.round(run.minElevationMeters);
    }
    if (
      typeof run.maxElevationMeters === 'number' &&
      Number.isFinite(run.maxElevationMeters) &&
      run.maxElevationMeters >= -500 &&
      run.maxElevationMeters <= 9000
    ) {
      runDoc.maxElevationMeters = Math.round(run.maxElevationMeters);
    }
    if (typeof run.caloriesKcal === 'number' && Number.isFinite(run.caloriesKcal) && run.caloriesKcal >= 0) {
      runDoc.caloriesKcal = Math.min(20000, Math.round(run.caloriesKcal));
    }
    await setDoc(doc(db, 'runs', runId), runDoc);

    // Batch GPS samples into chunks of 200 (never individual writes per point)
    if (samples.length > 0) {
      const batch = writeBatch(db);
      for (let i = 0; i < samples.length; i += 200) {
        const chunk = samples.slice(i, i + 200);
        const batchIdx = Math.floor(i / 200);
        const batchRef = doc(db, 'runs', runId, 'track_batches', `batch_${batchIdx}`);
        batch.set(batchRef, { batchIndex: batchIdx, points: chunk });
      }
      await batch.commit();
    }

    // Update user summary stats
    if (existingProfile) {
      const distKm = run.distanceMeters / 1000;
      const isRunPaceWorkout = workoutType === 'running' || workoutType === 'trail_run';
      const nextBestPace =
        isRunPaceWorkout &&
        run.avgPaceSecPerKm > 0 &&
        (existingProfile.bestPaceSecPerKm === 0 || run.avgPaceSecPerKm < existingProfile.bestPaceSecPerKm)
          ? Math.round(run.avgPaceSecPerKm)
          : existingProfile.bestPaceSecPerKm;
      const nextTotalDist = Number(((existingProfile.totalDistanceKm || 0) + distKm).toFixed(2));
      const nextTotalRuns = (existingProfile.totalRuns || 0) + 1;
      await updateDoc(doc(db, 'users', uid), {
        totalDistanceKm: nextTotalDist,
        totalRuns: nextTotalRuns,
        totalDurationSec: (existingProfile.totalDurationSec || 0) + Math.round(run.durationSec),
        longestRunKm: Number(Math.max(existingProfile.longestRunKm || 0, distKm).toFixed(2)),
        bestPaceSecPerKm: nextBestPace,
        updatedAt: serverTimestamp(),
      });
      void syncRunnerDirectoryCard(uid, {
        username: existingProfile.username,
        displayName: existingProfile.displayName,
        photoURL: existingProfile.photoURL,
        city: existingProfile.city,
        bio: existingProfile.bio,
        bioTags: existingProfile.bioTags,
        preferredWorkout: existingProfile.preferredWorkout,
        totalDistanceKm: nextTotalDist,
        totalRuns: nextTotalRuns,
      });
    }

    return runId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteRunRecord(runId: string): Promise<void> {
  const path = `runs/${runId}`;
  try {
    await deleteDoc(doc(db, 'runs', runId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function saveRunArtDesign(
  uid: string,
  design: Omit<RunArtDesignDoc, 'id' | 'userId' | 'createdAt'>
): Promise<string> {
  const designId = makeSafeId('art');
  const path = `run_art_designs/${designId}`;
  try {
    await setDoc(doc(db, 'run_art_designs', designId), {
      userId: uid,
      shapeType: design.shapeType,
      title: design.title.slice(0, 100),
      city: (design.city || 'Chandigarh').slice(0, 50),
      startLat: design.startLat,
      startLng: design.startLng,
      targetDistanceKm: design.targetDistanceKm,
      actualDistanceKm: Number(design.actualDistanceKm.toFixed(2)),
      encodedPolyline: design.encodedPolyline.slice(0, 25000),
      matchScore: Math.round(design.matchScore),
      status: design.status,
      createdAt: serverTimestamp(),
    });
    return designId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createPathReport(
  uid: string,
  report: Omit<PathReportDoc, 'id' | 'userId' | 'status' | 'createdAt'>
): Promise<string> {
  const reportId = makeSafeId('rep');
  const path = `path_reports/${reportId}`;
  try {
    await setDoc(doc(db, 'path_reports', reportId), {
      userId: uid,
      reporterName: report.reporterName.slice(0, 80),
      city: report.city.slice(0, 50),
      areaName: report.areaName.slice(0, 120),
      lat: report.lat ?? 30.7333,
      lng: report.lng ?? 76.7794,
      issueType: report.issueType,
      description: report.description.trim().slice(0, 300),
      status: 'active',
      createdAt: serverTimestamp(),
    });
    return reportId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeUserRuns(uid: string, onData: (runs: RunActivityDoc[]) => void) {
  const path = 'runs';
  const q = query(
    collection(db, 'runs'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RunActivityDoc, 'id'>) })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeSavedRoutes(uid: string, onData: (routes: SavedRouteDoc[]) => void) {
  const path = 'saved_routes';
  const q = query(
    collection(db, 'saved_routes'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavedRouteDoc, 'id'>) })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeRunArtDesigns(uid: string, onData: (designs: RunArtDesignDoc[]) => void) {
  const path = 'run_art_designs';
  const q = query(
    collection(db, 'run_art_designs'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RunArtDesignDoc, 'id'>) })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function fetchActivePathReports(): Promise<PathReportDoc[]> {
  const path = 'path_reports';
  try {
    const q = query(collection(db, 'path_reports'), where('status', '==', 'active'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PathReportDoc, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export interface CreateOpenInviteInput {
  eventType: OpenEventType;
  workoutType?: WorkoutType;
  title: string;
  description?: string;
  distanceKm: number;
  eventDateTime: string;
  meetingPoint: string;
  city: string;
  lat?: number;
  lng?: number;
  targetPace?: string;
  maxParticipants: number;
  routeId?: string;
  routeName?: string;
  encodedPolyline?: string;
  paceNote?: string;
}

export function subscribeOpenRunInvites(onData: (events: OpenRunInviteDoc[]) => void) {
  const path = 'open_events';
  const q = query(collection(db, 'open_events'), where('status', '==', 'open'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<OpenRunInviteDoc, 'id'>) }))
        .sort((a, b) => a.eventDateTime.localeCompare(b.eventDateTime));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeEventRsvps(
  eventId: string,
  onData: (rsvps: OpenEventRsvpDoc[]) => void
) {
  const path = `open_events/${eventId}/rsvps`;
  const q = query(
    collection(db, 'open_events', eventId, 'rsvps'),
    where('eventId', '==', eventId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<OpenEventRsvpDoc, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function checkUserJoinedEvents(
  eventIds: string[],
  uid: string
): Promise<Set<string>> {
  const joined = new Set<string>();
  if (!uid || eventIds.length === 0) return joined;

  await Promise.all(
    eventIds.map(async (eventId) => {
      const path = `open_events/${eventId}/rsvps/${uid}`;
      try {
        const snap = await getDoc(doc(db, 'open_events', eventId, 'rsvps', uid));
        if (snap.exists()) {
          joined.add(eventId);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }
    })
  );
  return joined;
}

export async function createOpenRunInvite(
  uid: string,
  hostName: string,
  input: CreateOpenInviteInput
): Promise<string> {
  const eventId = makeSafeId('evt');
  const path = `open_events/${eventId}`;
  try {
    const cleanHostName = (hostName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner';
    const cleanTitle = input.title.trim().slice(0, 120);
    const cleanMeeting = input.meetingPoint.trim().slice(0, 140);
    const cleanCity = (input.city || 'Chandigarh').trim().slice(0, 80) || 'Chandigarh';
    const cleanDistKm = Number(Math.min(250, Math.max(1, input.distanceKm || 5)).toFixed(2));
    const cleanMax = Math.min(1000, Math.max(2, Math.round(input.maxParticipants || 50)));
    const cleanDate = input.eventDateTime.trim().slice(0, 40);

    const eventPayload: Record<string, unknown> = {
      hostUserId: uid,
      hostName: cleanHostName,
      eventType: input.eventType,
      workoutType: normalizeWorkoutType(input.workoutType),
      title: cleanTitle,
      distanceKm: cleanDistKm,
      eventDateTime: cleanDate,
      meetingPoint: cleanMeeting,
      city: cleanCity,
      maxParticipants: cleanMax,
      rsvpCount: 1,
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (input.description && input.description.trim()) {
      eventPayload.description = input.description.trim().slice(0, 500);
    }
    if (input.targetPace && input.targetPace.trim()) {
      eventPayload.targetPace = input.targetPace.trim().slice(0, 60);
    }
    if (typeof input.lat === 'number' && Number.isFinite(input.lat)) {
      eventPayload.lat = input.lat;
    }
    if (typeof input.lng === 'number' && Number.isFinite(input.lng)) {
      eventPayload.lng = input.lng;
    }
    if (input.routeId && input.routeId.trim()) {
      eventPayload.routeId = input.routeId.trim().slice(0, 128);
    }
    if (input.routeName && input.routeName.trim()) {
      eventPayload.routeName = input.routeName.trim().slice(0, 120);
    }
    if (input.encodedPolyline && input.encodedPolyline.trim()) {
      eventPayload.encodedPolyline = input.encodedPolyline.trim().slice(0, 20000);
    }

    const rsvpPayload: Record<string, unknown> = {
      eventId,
      userId: uid,
      runnerName: cleanHostName,
      paceNote: (input.paceNote || input.targetPace || 'Host').trim().slice(0, 60),
      joinedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'open_events', eventId), eventPayload);
    batch.set(doc(db, 'open_events', eventId, 'rsvps', uid), rsvpPayload);
    await batch.commit();
    return eventId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function joinOpenRunInvite(
  eventId: string,
  uid: string,
  runnerName: string,
  paceNote?: string
): Promise<void> {
  const path = `open_events/${eventId}`;
  try {
    const eventRef = doc(db, 'open_events', eventId);
    const rsvpRef = doc(db, 'open_events', eventId, 'rsvps', uid);
    const [eventSnap, rsvpSnap] = await Promise.all([getDoc(eventRef), getDoc(rsvpRef)]);
    if (!eventSnap.exists()) {
      throw new Error('This open invite is no longer available.');
    }
    if (rsvpSnap.exists()) return;

    const data = eventSnap.data() as Omit<OpenRunInviteDoc, 'id'>;
    if (data.status !== 'open') {
      throw new Error('This open invite is closed.');
    }
    if (data.rsvpCount >= data.maxParticipants) {
      throw new Error('This open run has reached its participant limit.');
    }

    const cleanName = (runnerName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner';
    const rsvpPayload: Record<string, unknown> = {
      eventId,
      userId: uid,
      runnerName: cleanName,
      joinedAt: serverTimestamp(),
    };
    if (paceNote && paceNote.trim()) {
      rsvpPayload.paceNote = paceNote.trim().slice(0, 60);
    }

    const batch = writeBatch(db);
    batch.set(rsvpRef, rsvpPayload);
    batch.update(eventRef, {
      rsvpCount: data.rsvpCount + 1,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function leaveOpenRunInvite(eventId: string, uid: string): Promise<void> {
  const path = `open_events/${eventId}`;
  try {
    const eventRef = doc(db, 'open_events', eventId);
    const rsvpRef = doc(db, 'open_events', eventId, 'rsvps', uid);
    const [eventSnap, rsvpSnap] = await Promise.all([getDoc(eventRef), getDoc(rsvpRef)]);
    if (!eventSnap.exists() || !rsvpSnap.exists()) return;

    const data = eventSnap.data() as Omit<OpenRunInviteDoc, 'id'>;
    const batch = writeBatch(db);
    batch.delete(rsvpRef);
    batch.update(eventRef, {
      rsvpCount: Math.max(0, data.rsvpCount - 1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function cancelOpenRunInvite(eventId: string): Promise<void> {
  const path = `open_events/${eventId}`;
  try {
    await updateDoc(doc(db, 'open_events', eventId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteOpenRunInvite(eventId: string): Promise<void> {
  const path = `open_events/${eventId}`;
  try {
    await deleteDoc(doc(db, 'open_events', eventId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/* -------------------------------------------------------------------------- */
/* Social: Runner Directory, Friend Requests, DMs & Personal Run Invites       */
/* -------------------------------------------------------------------------- */

export function subscribeRunnerDirectory(onData: (runners: RunnerDirectoryDoc[]) => void) {
  const path = 'runner_directory';
  return onSnapshot(
    collection(db, 'runner_directory'),
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as RunnerDirectoryDoc)
        .filter((r) => Boolean(r.uid && r.displayName))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeMyFriendRequests(
  uid: string,
  onData: (requests: FriendRequestDoc[]) => void
) {
  const path = 'friend_requests';
  const q = query(
    collection(db, 'friend_requests'),
    where('participantUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<FriendRequestDoc, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function sendFriendRequest(
  fromRunner: { uid: string; displayName: string; photoURL?: string | null },
  toRunner: { uid: string; displayName: string; photoURL?: string | null }
): Promise<string> {
  if (fromRunner.uid === toRunner.uid) {
    throw new Error('You cannot send a friend request to yourself.');
  }
  const pairId = makePairId(fromRunner.uid, toRunner.uid);
  const path = `friend_requests/${pairId}`;
  try {
    const ref = doc(db, 'friend_requests', pairId);
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existing = existingSnap.data() as Omit<FriendRequestDoc, 'id'>;
      if (existing.status === 'accepted') {
        throw new Error('You are already friends with this runner.');
      }
      if (existing.status === 'pending') {
        throw new Error('A friend request is already pending between you two.');
      }
      // Replace declined request cleanly
      await deleteDoc(ref);
    }

    const participantUids = [fromRunner.uid, toRunner.uid].sort();
    const payload: Record<string, unknown> = {
      fromUid: fromRunner.uid,
      fromName: (fromRunner.displayName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner',
      toUid: toRunner.uid,
      toName: (toRunner.displayName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner',
      participantUids,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const cleanFromPhoto = sanitizePhotoUrl(fromRunner.photoURL);
    const cleanToPhoto = sanitizePhotoUrl(toRunner.photoURL);
    if (cleanFromPhoto) {
      payload.fromPhotoUrl = cleanFromPhoto;
    }
    if (cleanToPhoto) {
      payload.toPhotoUrl = cleanToPhoto;
    }

    await setDoc(ref, payload);
    return pairId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function respondFriendRequest(
  requestId: string,
  status: 'accepted' | 'declined'
): Promise<void> {
  const path = `friend_requests/${requestId}`;
  try {
    await updateDoc(doc(db, 'friend_requests', requestId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeFriendshipOrRequest(requestId: string): Promise<void> {
  const path = `friend_requests/${requestId}`;
  try {
    await deleteDoc(doc(db, 'friend_requests', requestId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeMyDmThreads(uid: string, onData: (threads: DmThreadDoc[]) => void) {
  const path = 'dm_threads';
  const q = query(
    collection(db, 'dm_threads'),
    where('participantUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DmThreadDoc, 'id'>),
        }))
        .sort((a, b) => {
          const msA = typeof (a.updatedAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (a.updatedAt as { toMillis: () => number }).toMillis()
            : 0;
          const msB = typeof (b.updatedAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (b.updatedAt as { toMillis: () => number }).toMillis()
            : 0;
          return msB - msA;
        });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeDmMessages(
  threadId: string,
  uid: string,
  onData: (messages: DmMessageDoc[]) => void
) {
  const path = `dm_threads/${threadId}/messages`;
  const q = query(
    collection(db, 'dm_threads', threadId, 'messages'),
    where('participantUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DmMessageDoc, 'id'>),
        }))
        .sort((a, b) => {
          const msA = typeof (a.createdAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (a.createdAt as { toMillis: () => number }).toMillis()
            : Date.now();
          const msB = typeof (b.createdAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (b.createdAt as { toMillis: () => number }).toMillis()
            : Date.now();
          return msA - msB;
        });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export interface SendDmInput {
  messageType: DmMessageType;
  text: string;
  workoutType?: WorkoutType;
  inviteDistanceKm?: number;
  inviteTitle?: string;
  inviteDateTime?: string;
  inviteMeetingPoint?: string;
  inviteRouteName?: string;
  inviteEncodedPolyline?: string;
  locationLat?: number;
  locationLng?: number;
  locationLabel?: string;
  locationIsLive?: boolean;
}

export async function sendDmMessage(
  threadId: string,
  friendRequest: FriendRequestDoc,
  sender: { uid: string; displayName: string },
  input: SendDmInput
): Promise<string> {
  const msgId = makeSafeId('msg');
  const path = `dm_threads/${threadId}/messages/${msgId}`;
  try {
    if (friendRequest.status !== 'accepted') {
      throw new Error('Accept the friend request before sending direct messages.');
    }

    const threadRef = doc(db, 'dm_threads', threadId);
    const threadSnap = await getDoc(threadRef);
    const cleanSenderName = (sender.displayName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner';
    const participantUids = [...friendRequest.participantUids];

    const isInvite = input.messageType === 'run_invite';
    const isLocation = input.messageType === 'location';
    const cleanDistance = Number(Math.min(250, Math.max(1, input.inviteDistanceKm || 5)).toFixed(2));
    const cleanInviteTitle = (input.inviteTitle || `${cleanDistance}K Personal Workout Invite`).trim().slice(0, 120);
    const cleanLocLabel = (input.locationLabel || 'Current GPS Location').trim().slice(0, 140);
    const cleanText = isInvite
      ? (input.text.trim() || `Invited you to a ${cleanDistance}K workout: ${cleanInviteTitle}`).slice(0, 500)
      : isLocation
      ? (
          input.text.trim() ||
          (input.locationIsLive
            ? `Sharing live workout location at ${cleanLocLabel}`
            : `Shared location pin: ${cleanLocLabel}`)
        ).slice(0, 500)
      : input.text.trim().slice(0, 500);

    if (!cleanText) {
      throw new Error('Message text cannot be empty.');
    }

    const msgPayload: Record<string, unknown> = {
      threadId,
      participantUids,
      senderUid: sender.uid,
      senderName: cleanSenderName,
      messageType: input.messageType,
      text: cleanText,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.workoutType) {
      msgPayload.workoutType = normalizeWorkoutType(input.workoutType);
    }

    if (isInvite) {
      msgPayload.inviteDistanceKm = cleanDistance;
      msgPayload.inviteTitle = cleanInviteTitle;
      msgPayload.inviteDateTime = (input.inviteDateTime || '').trim().slice(0, 40);
      msgPayload.inviteMeetingPoint = (input.inviteMeetingPoint || 'Sukhna Lake Police Post').trim().slice(0, 140);
      msgPayload.inviteStatus = 'pending';
      if (input.inviteRouteName && input.inviteRouteName.trim()) {
        msgPayload.inviteRouteName = input.inviteRouteName.trim().slice(0, 120);
      }
      if (input.inviteEncodedPolyline && input.inviteEncodedPolyline.trim()) {
        msgPayload.inviteEncodedPolyline = input.inviteEncodedPolyline.trim().slice(0, 20000);
      }
    }

    if (isLocation) {
      msgPayload.locationLat = Number((input.locationLat ?? 30.7333).toFixed(6));
      msgPayload.locationLng = Number((input.locationLng ?? 76.7794).toFixed(6));
      msgPayload.locationLabel = cleanLocLabel;
      msgPayload.locationIsLive = Boolean(input.locationIsLive);
    }

    const lastPreview = isInvite
      ? `Workout Invite (${cleanDistance}K): ${cleanInviteTitle}`.slice(0, 500)
      : isLocation
      ? `${input.locationIsLive ? 'Live Location' : 'Location'}: ${cleanLocLabel}`.slice(0, 500)
      : cleanText;

    const batch = writeBatch(db);
    if (!threadSnap.exists()) {
      batch.set(threadRef, {
        threadId,
        participantUids,
        lastMessageText: lastPreview,
        lastMessageType: input.messageType,
        lastSenderId: sender.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(threadRef, {
        lastMessageText: lastPreview,
        lastMessageType: input.messageType,
        lastSenderId: sender.uid,
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'dm_threads', threadId, 'messages', msgId), msgPayload);
    await batch.commit();
    return msgId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function respondPersonalRunInvite(
  threadId: string,
  messageId: string,
  status: Extract<PersonalInviteStatus, 'accepted' | 'declined'>
): Promise<void> {
  const path = `dm_threads/${threadId}/messages/${messageId}`;
  try {
    await updateDoc(doc(db, 'dm_threads', threadId, 'messages', messageId), {
      inviteStatus: status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/* -------------------------------------------------------------------------- */
/* Social: Daily Run Posts, Likes & 24h Run Stories                           */
/* -------------------------------------------------------------------------- */

export function subscribeDailyRunPosts(onData: (posts: DailyRunPostDoc[]) => void) {
  const path = 'daily_posts';
  const q = query(collection(db, 'daily_posts'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DailyRunPostDoc, 'id'>),
        }))
        .sort((a, b) => {
          const msA = typeof (a.createdAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (a.createdAt as { toMillis: () => number }).toMillis()
            : 0;
          const msB = typeof (b.createdAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (b.createdAt as { toMillis: () => number }).toMillis()
            : 0;
          return msB - msA;
        });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export interface CreateDailyRunPostInput {
  workoutType?: WorkoutType;
  caption: string;
  runTitle: string;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  elevationGainMeters?: number;
  startName: string;
  encodedPolyline?: string;
  moodTag?: string;
}

export async function createDailyRunPost(
  author: { uid: string; displayName: string; photoURL?: string | null },
  input: CreateDailyRunPostInput
): Promise<string> {
  const postId = makeSafeId('post');
  const path = `daily_posts/${postId}`;
  try {
    const cleanName = (author.displayName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner';
    const payload: Record<string, unknown> = {
      authorUid: author.uid,
      authorName: cleanName,
      workoutType: normalizeWorkoutType(input.workoutType),
      caption: input.caption.trim().slice(0, 400) || 'Completed today’s workout!',
      runTitle: input.runTitle.trim().slice(0, 120) || 'Daily Workout',
      distanceKm: Number(Math.min(300, Math.max(0.05, input.distanceKm || 1)).toFixed(2)),
      durationSec: Math.min(86400, Math.max(1, Math.round(input.durationSec || 60))),
      avgPaceSecPerKm: Math.min(3600, Math.max(0, Math.round(input.avgPaceSecPerKm || 0))),
      startName: input.startName.trim().slice(0, 140) || 'Chandigarh',
      likeCount: 0,
      visibility: 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (
      typeof input.elevationGainMeters === 'number' &&
      Number.isFinite(input.elevationGainMeters) &&
      input.elevationGainMeters >= 0
    ) {
      payload.elevationGainMeters = Math.min(25000, Math.round(input.elevationGainMeters));
    }
    const cleanAuthorPhoto = sanitizePhotoUrl(author.photoURL);
    if (cleanAuthorPhoto) {
      payload.authorPhotoUrl = cleanAuthorPhoto;
    }
    if (input.encodedPolyline && input.encodedPolyline.trim()) {
      payload.encodedPolyline = input.encodedPolyline.trim().slice(0, 25000);
    }
    if (input.moodTag && input.moodTag.trim()) {
      payload.moodTag = input.moodTag.trim().slice(0, 30);
    }
    await setDoc(doc(db, 'daily_posts', postId), payload);
    return postId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteDailyRunPost(postId: string): Promise<void> {
  const path = `daily_posts/${postId}`;
  try {
    await deleteDoc(doc(db, 'daily_posts', postId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function checkUserLikedPosts(postIds: string[], uid: string): Promise<Set<string>> {
  const liked = new Set<string>();
  if (!uid || postIds.length === 0) return liked;

  await Promise.all(
    postIds.map(async (postId) => {
      const path = `daily_posts/${postId}/likes/${uid}`;
      try {
        const snap = await getDoc(doc(db, 'daily_posts', postId, 'likes', uid));
        if (snap.exists()) liked.add(postId);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }
    })
  );
  return liked;
}

export async function toggleLikeDailyPost(
  postId: string,
  uid: string,
  runnerName: string
): Promise<boolean> {
  const path = `daily_posts/${postId}`;
  try {
    const postRef = doc(db, 'daily_posts', postId);
    const likeRef = doc(db, 'daily_posts', postId, 'likes', uid);
    const [postSnap, likeSnap] = await Promise.all([getDoc(postRef), getDoc(likeRef)]);
    if (!postSnap.exists()) return false;

    const currentLikes = Number((postSnap.data() as { likeCount?: number }).likeCount || 0);
    const batch = writeBatch(db);
    if (likeSnap.exists()) {
      batch.delete(likeRef);
      batch.update(postRef, {
        likeCount: Math.max(0, currentLikes - 1),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return false;
    } else {
      const cleanName = (runnerName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner';
      batch.set(likeRef, {
        postId,
        userId: uid,
        runnerName: cleanName,
        createdAt: serverTimestamp(),
      });
      batch.update(postRef, {
        likeCount: currentLikes + 1,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return true;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeActiveStories(onData: (stories: RunStoryDoc[]) => void) {
  const path = 'run_stories';
  const q = query(collection(db, 'run_stories'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const items = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RunStoryDoc, 'id'>),
        }))
        .filter((s) => s.expiresAtMs > now)
        .sort((a, b) => b.expiresAtMs - a.expiresAtMs);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export interface CreateRunStoryInput {
  workoutType?: WorkoutType;
  headline: string;
  caption?: string;
  distanceKm: number;
  durationSec: number;
  paceLabel?: string;
  themeColor: StoryThemeColor;
  encodedPolyline?: string;
}

export async function createRunStory(
  author: { uid: string; displayName: string; photoURL?: string | null },
  input: CreateRunStoryInput
): Promise<string> {
  const storyId = makeSafeId('story');
  const path = `run_stories/${storyId}`;
  try {
    const cleanName = (author.displayName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner';
    const payload: Record<string, unknown> = {
      authorUid: author.uid,
      authorName: cleanName,
      workoutType: normalizeWorkoutType(input.workoutType),
      headline: input.headline.trim().slice(0, 80) || 'Daily Workout Highlight',
      distanceKm: Number(Math.min(300, Math.max(0, input.distanceKm || 0)).toFixed(2)),
      durationSec: Math.min(86400, Math.max(0, Math.round(input.durationSec || 0))),
      themeColor: input.themeColor,
      expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
      visibility: 'public',
      createdAt: serverTimestamp(),
    };
    const cleanStoryPhoto = sanitizePhotoUrl(author.photoURL);
    if (cleanStoryPhoto) {
      payload.authorPhotoUrl = cleanStoryPhoto;
    }
    if (input.caption && input.caption.trim()) {
      payload.caption = input.caption.trim().slice(0, 220);
    }
    if (input.paceLabel && input.paceLabel.trim()) {
      payload.paceLabel = input.paceLabel.trim().slice(0, 30);
    }
    if (input.encodedPolyline && input.encodedPolyline.trim()) {
      payload.encodedPolyline = input.encodedPolyline.trim().slice(0, 25000);
    }
    await setDoc(doc(db, 'run_stories', storyId), payload);
    return storyId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteRunStory(storyId: string): Promise<void> {
  const path = `run_stories/${storyId}`;
  try {
    await deleteDoc(doc(db, 'run_stories', storyId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/* -------------------------------------------------------------------------- */
/* Real-Time Live Run Location Beacons                                        */
/* -------------------------------------------------------------------------- */

export interface UpsertLiveBeaconInput {
  workoutType?: WorkoutType;
  displayName: string;
  photoURL?: string | null;
  lat: number;
  lng: number;
  heading?: number;
  distanceMeters: number;
  elapsedSec: number;
  currentSpeedKmh: number;
  routeName: string;
  status: LiveBeaconStatus;
  shareScope: LiveBeaconShareScope;
  allowedUids: string[];
}

export async function upsertLiveBeacon(uid: string, input: UpsertLiveBeaconInput): Promise<void> {
  const path = `live_beacons/${uid}`;
  try {
    const cleanName = (input.displayName || 'Chandigarh Runner').trim().slice(0, 80) || 'Chandigarh Runner';
    const cleanAllowed = Array.from(new Set(input.allowedUids.filter(Boolean))).slice(0, 50);
    const payload: Record<string, unknown> = {
      uid,
      displayName: cleanName,
      workoutType: normalizeWorkoutType(input.workoutType),
      lat: Number(Math.min(90, Math.max(-90, input.lat)).toFixed(6)),
      lng: Number(Math.min(180, Math.max(-180, input.lng)).toFixed(6)),
      distanceMeters: Math.max(0, Math.round(input.distanceMeters || 0)),
      elapsedSec: Math.max(0, Math.round(input.elapsedSec || 0)),
      currentSpeedKmh: Number(Math.min(120, Math.max(0, input.currentSpeedKmh || 0)).toFixed(1)),
      routeName: (input.routeName || 'Live Workout').trim().slice(0, 120) || 'Live Workout',
      status: input.status,
      shareScope: input.shareScope,
      allowedUids: cleanAllowed,
      expiresAtMs: Date.now() + 3 * 60 * 60 * 1000,
      updatedAt: serverTimestamp(),
    };
    const cleanBeaconPhoto = sanitizePhotoUrl(input.photoURL);
    if (cleanBeaconPhoto) {
      payload.photoURL = cleanBeaconPhoto;
    }
    if (typeof input.heading === 'number' && Number.isFinite(input.heading)) {
      payload.heading = Number((((input.heading % 360) + 360) % 360).toFixed(1));
    }
    await setDoc(doc(db, 'live_beacons', uid), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function stopLiveBeacon(uid: string): Promise<void> {
  const path = `live_beacons/${uid}`;
  try {
    await deleteDoc(doc(db, 'live_beacons', uid));
  } catch {
    // Non-fatal if beacon already deleted or never created
  }
}

export function subscribeFriendsLiveBeacons(
  uid: string,
  onData: (beacons: LiveBeaconDoc[]) => void
) {
  const path = 'live_beacons';
  const q = query(
    collection(db, 'live_beacons'),
    where('allowedUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const items = snap.docs
        .map((d) => d.data() as LiveBeaconDoc)
        .filter((b) => b.uid !== uid && b.status !== 'ended' && b.expiresAtMs > now);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
