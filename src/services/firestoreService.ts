import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  GpsSample,
  PathReportDoc,
  RunActivityDoc,
  RunArtDesignDoc,
  SavedRouteDoc,
  UserProfileDoc,
  UserSafetyDoc,
} from '../types/run';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
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
      return snap.data() as UserProfileDoc;
    }
    const cleanName = (displayName || 'Tricity Runner').slice(0, 80);
    const profile: Record<string, unknown> = {
      uid,
      displayName: cleanName,
      preferredUnit: 'km',
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
    if (photoURL) {
      profile.photoURL = photoURL.slice(0, 512);
    }
    await setDoc(ref, profile);
    return {
      ...profile,
      uid,
      displayName: cleanName,
      preferredUnit: 'km',
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
  updates: Partial<Pick<UserProfileDoc, 'displayName' | 'preferredUnit' | 'preferredTerrain' | 'city'>>
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.displayName !== undefined) payload.displayName = updates.displayName.trim().slice(0, 80);
    if (updates.preferredUnit !== undefined) payload.preferredUnit = updates.preferredUnit;
    if (updates.preferredTerrain !== undefined) payload.preferredTerrain = updates.preferredTerrain.slice(0, 40);
    if (updates.city !== undefined) payload.city = updates.city;
    await updateDoc(doc(db, 'users', uid), payload);
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
  try {
    await setDoc(doc(db, 'runs', runId), {
      userId: uid,
      routeId: (run.routeId || '').slice(0, 128),
      routeName: run.routeName.slice(0, 120),
      routeType: run.routeType,
      distanceMeters: Math.round(run.distanceMeters),
      durationSec: Math.round(run.durationSec),
      avgPaceSecPerKm: Math.round(run.avgPaceSecPerKm || 0),
      bestPaceSecPerKm: Math.round(run.bestPaceSecPerKm || 0),
      avgSpeedKmh: Number((run.avgSpeedKmh || 0).toFixed(2)),
      elevationGainMeters: run.elevationGainMeters ?? 0,
      splits: run.splits.slice(0, 100),
      encodedPolyline: run.encodedPolyline.slice(0, 25000),
      startName: run.startName.slice(0, 140),
      sampleCount: samples.length,
      status: 'completed',
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: serverTimestamp(),
    });

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
      const nextBestPace =
        run.avgPaceSecPerKm > 0 &&
        (existingProfile.bestPaceSecPerKm === 0 || run.avgPaceSecPerKm < existingProfile.bestPaceSecPerKm)
          ? Math.round(run.avgPaceSecPerKm)
          : existingProfile.bestPaceSecPerKm;
      await updateDoc(doc(db, 'users', uid), {
        totalDistanceKm: Number(((existingProfile.totalDistanceKm || 0) + distKm).toFixed(2)),
        totalRuns: (existingProfile.totalRuns || 0) + 1,
        totalDurationSec: (existingProfile.totalDurationSec || 0) + Math.round(run.durationSec),
        longestRunKm: Number(Math.max(existingProfile.longestRunKm || 0, distKm).toFixed(2)),
        bestPaceSecPerKm: nextBestPace,
        updatedAt: serverTimestamp(),
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
