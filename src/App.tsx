import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  Activity,
  Bookmark,
  Compass,
  Home,
  Navigation,
  Play,
  User,
} from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { LiveRunTracker } from './components/LiveRunTracker';
import { RunSummaryModal, type AutoSaveStatus } from './components/RunSummaryModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { decodePolyline } from './lib/geo';
import { resolveGoogleMapsApiKey } from './lib/mapsConfig';
import { ExploreView } from './pages/ExploreView';
import { HomeView } from './pages/HomeView';
import { MyRunsView } from './pages/MyRunsView';
import { PlanRunView, type PlannerInitialRequest } from './pages/PlanRunView';
import { ProfileView } from './pages/ProfileView';
import { deleteRunRecord, saveCompletedRun } from './services/firestoreService';
import {
  getPendingUnsyncedRuns,
  loadLocalRuns,
  markLocalRunSynced,
  removeLocalRun,
  upsertLocalRun,
  type LocalSavedRunRecord,
} from './services/localRunsService';
import type {
  AppTab,
  GeneratedRouteCandidate,
  GpsSample,
  NamedLocation,
  RouteMode,
  RouteType,
  RunActivityDoc,
  RunArtShapeType,
  SavedRouteDoc,
  TricityPlace,
} from './types/run';

const NAV_ITEMS: Array<{ id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'plan', label: 'Plan Run', icon: Navigation },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'routes', label: 'My Routes', icon: Bookmark },
  { id: 'history', label: 'Run History', icon: Activity },
  { id: 'profile', label: 'Profile', icon: User },
];

function TricityRunShell() {
  const { user, profile, runs, savedRoutes, artDesigns, refreshProfile } = useAuth();

  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  const [planRequest, setPlanRequest] = useState<PlannerInitialRequest | null>(null);

  const [liveRoute, setLiveRoute] = useState<GeneratedRouteCandidate | null | undefined>(undefined);
  const [localRuns, setLocalRuns] = useState<LocalSavedRunRecord[]>(() => loadLocalRuns());
  const [completedRun, setCompletedRun] = useState<{
    localId: string;
    syncedRunId?: string;
    saveStatus: AutoSaveStatus;
    saveError?: string | null;
    summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>;
    samples: GpsSample[];
  } | null>(null);

  const inFlightSyncRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  const profileRef = useRef(profile);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    const handler = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  const syncLocalRunToCloud = useCallback(
    async (
      localId: string,
      summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>,
      samples: GpsSample[]
    ) => {
      if (inFlightSyncRef.current.has(localId)) return;
      const activeUser = userRef.current;
      if (!activeUser || !activeUser.emailVerified) {
        setCompletedRun((prev) =>
          prev && prev.localId === localId
            ? { ...prev, saveStatus: 'local_only', saveError: null }
            : prev
        );
        return;
      }

      inFlightSyncRef.current.add(localId);
      setCompletedRun((prev) =>
        prev && prev.localId === localId
          ? { ...prev, saveStatus: 'saving', saveError: null }
          : prev
      );

      try {
        const syncedRunId = await saveCompletedRun(
          activeUser.uid,
          summary,
          samples,
          profileRef.current
        );
        const updatedLocal = markLocalRunSynced(localId, syncedRunId, activeUser.uid);
        setLocalRuns(updatedLocal);
        setCompletedRun((prev) =>
          prev && prev.localId === localId
            ? { ...prev, syncedRunId, saveStatus: 'saved', saveError: null }
            : prev
        );
        await refreshProfile();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to sync run to cloud.';
        setCompletedRun((prev) =>
          prev && prev.localId === localId
            ? { ...prev, saveStatus: 'error', saveError: msg }
            : prev
        );
      } finally {
        inFlightSyncRef.current.delete(localId);
      }
    },
    [refreshProfile]
  );

  // Automatically sync any locally preserved runs as soon as user signs in & verifies
  useEffect(() => {
    if (!user || !user.emailVerified) return;
    const pending = getPendingUnsyncedRuns(user.uid);
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const rec of pending) {
        if (cancelled) break;
        await syncLocalRunToCloud(rec.localId, rec.summary, rec.samples);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, user?.emailVerified, syncLocalRunToCloud]);

  const mergedRuns: RunActivityDoc[] = useMemo(() => {
    const cloudFinishedKeys = new Set(
      runs.map((r) => `${r.finishedAt}_${Math.round(r.distanceMeters)}`)
    );
    const cloudIds = new Set(runs.map((r) => r.id));

    const pendingLocalAsDocs: RunActivityDoc[] = localRuns
      .filter((rec) => {
        if (rec.syncStatus === 'synced') return false;
        if (rec.ownerUid !== null && (!user || rec.ownerUid !== user.uid)) return false;
        if (rec.syncedRunId && cloudIds.has(rec.syncedRunId)) return false;
        const key = `${rec.summary.finishedAt}_${Math.round(rec.summary.distanceMeters)}`;
        return !cloudFinishedKeys.has(key);
      })
      .map((rec) => ({
        id: rec.localId,
        userId: rec.ownerUid || 'local',
        createdAt: rec.savedAt,
        ...rec.summary,
      }));

    return [...pendingLocalAsDocs, ...runs].sort(
      (a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()
    );
  }, [runs, localRuns, user]);

  const unit = profile?.preferredUnit || 'km';

  const handleQuickGenerate = (params: {
    mode: RouteMode;
    distanceKm: number;
    routeType: RouteType;
    shapeType?: RunArtShapeType;
    alphabetText?: string;
    start: NamedLocation;
  }) => {
    setPlanRequest({ ...params, triggerKey: Date.now() });
    setActiveTab('plan');
  };

  const handlePlanAtPlace = (place: TricityPlace, distanceKm = 5) => {
    setPlanRequest({
      mode: 'normal',
      distanceKm,
      routeType: 'circular',
      start: { name: place.name, city: 'Chandigarh', lat: place.lat, lng: place.lng },
      triggerKey: Date.now(),
    });
    setActiveTab('plan');
  };

  const handleStartSavedRoute = (sr: SavedRouteDoc) => {
    const path = decodePolyline(sr.encodedPolyline);
    const candidate: GeneratedRouteCandidate = {
      id: sr.id,
      label: 'Saved Route',
      name: sr.name,
      routeType: sr.routeType,
      distanceMeters: sr.distanceMeters,
      targetDistanceMeters: sr.distanceMeters,
      durationSec: sr.durationSec,
      elevationGainMeters: sr.elevationGainMeters ?? null,
      start: { name: sr.startName, lat: sr.startLat, lng: sr.startLng },
      end: { name: sr.endName, lat: sr.endLat, lng: sr.endLng },
      encodedPolyline: sr.encodedPolyline,
      path,
      steps: [],
      kmMarkers: [],
      characteristics: [],
      surfaceSummary: sr.notes || 'Saved Chandigarh Route',
      preferences: sr.preferences || [],
      difficulty: 'moderate',
      toleranceDiffPct: 0,
    };
    setLiveRoute(candidate);
  };

  const handleDiscardCompletedRun = async () => {
    if (!completedRun) return;
    if (completedRun.syncedRunId && user && user.emailVerified) {
      await deleteRunRecord(completedRun.syncedRunId);
    }
    setLocalRuns(removeLocalRun(completedRun.localId));
    setCompletedRun(null);
  };

  const handleDeleteHistoryRun = async (runId: string) => {
    if (!runId.startsWith('local_run_')) {
      await deleteRunRecord(runId);
    }
    setLocalRuns(removeLocalRun(runId));
  };

  return (
    <div className="min-h-screen bg-[#F6F5F0] text-[#141F1B]">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached — pedestrian routing automatically falls back to OpenStreetMap foot paths. Visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for account details.
          </span>
        </div>
      )}

      <div className="flex min-h-screen">
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-[#E5E3DC] lg:bg-white lg:px-4 lg:py-6 lg:sticky lg:top-0 lg:h-screen">
          <div className="px-2">
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className="font-display text-xl font-bold tracking-tight text-[#172D27] whitespace-nowrap"
            >
              TRICITY RUN
            </button>
            <p className="mt-0.5 text-[11px] font-medium text-[#5B6B64]">Chandigarh Edition</p>
          </div>

          <nav className="mt-8 flex-1 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-sm font-semibold transition ${
                    active
                      ? 'bg-[#172D27] text-[#9AE62E]'
                      : 'text-[#5B6B64] hover:bg-[#F6F5F0] hover:text-[#141F1B]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="space-y-2 border-t border-[#F0EFEA] pt-4">
            <button
              type="button"
              onClick={() => setLiveRoute(null)}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#9AE62E] px-4 text-xs font-bold text-[#172D27] transition hover:brightness-95"
            >
              <Play className="h-3.5 w-3.5" />
              Quick Start GPS Run
            </button>

            {!user && (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#D9D7CE] text-xs font-semibold text-[#141F1B]"
              >
                Sign In
              </button>
            )}
          </div>
        </aside>

        {/* Main Viewport */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Mobile Compact Top Header (strictly 3-zone) */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-[#E5E3DC] bg-white/95 px-4 backdrop-blur-md lg:hidden">
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className="font-display text-lg font-bold tracking-tight text-[#172D27] whitespace-nowrap shrink-0"
            >
              TRICITY RUN
            </button>
            <div className="flex items-center gap-2 shrink-0">
              {!user ? (
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="min-h-[38px] rounded-xl bg-[#172D27] px-3.5 text-xs font-semibold text-[#9AE62E] whitespace-nowrap"
                >
                  Sign In
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setLiveRoute(null)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3.5 text-xs font-semibold text-[#9AE62E] whitespace-nowrap"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run
                </button>
              )}
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:py-8 lg:pb-10">
            {activeTab === 'home' && (
              <HomeView
                profile={profile}
                runs={mergedRuns}
                savedRoutes={savedRoutes}
                artDesigns={artDesigns}
                isAuthenticated={Boolean(user)}
                onNavigate={setActiveTab}
                onQuickGenerate={handleQuickGenerate}
                onStartSavedRoute={handleStartSavedRoute}
                onExplorePlace={(place) => handlePlanAtPlace(place, place.suggestedDistancesKm[1] || 5)}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'plan' && (
              <PlanRunView
                initialRequest={planRequest}
                preferredUnit={unit}
                userId={user?.uid || null}
                emailVerified={Boolean(user?.emailVerified)}
                onStartRun={(route) => setLiveRoute(route)}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'explore' && (
              <ExploreView
                userId={user?.uid || null}
                userName={profile?.displayName || user?.displayName || 'Chandigarh Runner'}
                emailVerified={Boolean(user?.emailVerified)}
                preferredUnit={unit}
                onPlanAtPlace={handlePlanAtPlace}
                onStartRun={(route) => setLiveRoute(route)}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {(activeTab === 'routes' || activeTab === 'history') && (
              <MyRunsView
                mode={activeTab}
                profile={profile}
                runs={mergedRuns}
                savedRoutes={savedRoutes}
                userId={user?.uid || null}
                onStartSavedRoute={handleStartSavedRoute}
                onDeleteRun={handleDeleteHistoryRun}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'profile' && (
              <ProfileView onOpenAuth={() => setAuthModalOpen(true)} />
            )}
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E5E3DC] bg-white/95 backdrop-blur-md pb-safe lg:hidden"
      >
        <div className="grid h-16 grid-cols-6 items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex h-full flex-col items-center justify-center gap-0.5 transition ${
                  active ? 'text-[#172D27]' : 'text-[#5B6B64]'
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.5px]' : 'stroke-[1.75px]'}`} />
                <span className={`text-[10px] leading-tight whitespace-nowrap ${active ? 'font-bold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals & Live Run Overlays */}
      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      {liveRoute !== undefined && (
        <LiveRunTracker
          route={liveRoute}
          preferredUnit={unit}
          onCancel={() => setLiveRoute(undefined)}
          onFinishRun={(summary, samples) => {
            const localId = `local_run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const nextLocal = upsertLocalRun({
              localId,
              ownerUid: user?.uid || null,
              syncStatus: 'pending',
              summary,
              samples,
              savedAt: new Date().toISOString(),
            });
            setLocalRuns(nextLocal);
            setLiveRoute(undefined);

            const canCloudSave = Boolean(user && user.emailVerified);
            setCompletedRun({
              localId,
              saveStatus: canCloudSave ? 'saving' : 'local_only',
              saveError: null,
              summary,
              samples,
            });
            if (canCloudSave) {
              void syncLocalRunToCloud(localId, summary, samples);
            }
          }}
        />
      )}

      {completedRun && (
        <RunSummaryModal
          summary={completedRun.summary}
          previousRuns={mergedRuns.filter(
            (r) => r.id !== completedRun.localId && r.id !== completedRun.syncedRunId
          )}
          preferredUnit={unit}
          isAuthenticated={Boolean(user)}
          saveStatus={completedRun.saveStatus}
          saveError={completedRun.saveError}
          onRetrySync={() =>
            syncLocalRunToCloud(
              completedRun.localId,
              completedRun.summary,
              completedRun.samples
            )
          }
          onDiscardRun={handleDiscardCompletedRun}
          onOpenAuth={() => setAuthModalOpen(true)}
          onCloseHome={() => {
            setCompletedRun(null);
            setActiveTab('history');
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string>('');
  const [keyReady, setKeyReady] = useState(false);

  useEffect(() => {
    resolveGoogleMapsApiKey().then((k) => {
      setMapsApiKey(k);
      setKeyReady(true);
    });
  }, []);

  if (!keyReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F5F0] text-sm font-medium text-[#5B6B64]">
        Loading TRICITY RUN...
      </div>
    );
  }

  return (
    <AuthProvider>
      <APIProvider apiKey={mapsApiKey} language="en" region="IN">
        <TricityRunShell />
      </APIProvider>
    </AuthProvider>
  );
}
