import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  Activity,
  Bookmark,
  Compass,
  Home,
  Megaphone,
  MessageCircle,
  Navigation,
  Play,
  User,
  Users,
} from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { BrutalQuoteOverlay } from './components/BrutalQuoteOverlay';
import { LiveRunTracker } from './components/LiveRunTracker';
import { MusicPlayerDock } from './components/MusicPlayerDock';
import type { ElevationFetchStatus } from './components/ElevationProfileCard';
import { RunSummaryModal, type AutoSaveStatus } from './components/RunSummaryModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TRICITY_START_PRESETS } from './data/tricityPlaces';
import {
  isChandigarhCityName,
  loadGuestRunningCity,
  resolveRunningCity,
  saveGuestRunningCity,
  type ActiveRunningCity,
} from './data/worldCities';
import { getWorkoutMeta, normalizeWorkoutType } from './data/workouts';
import { decodePolyline } from './lib/geo';
import { resolveGoogleMapsApiKey } from './lib/mapsConfig';
import { applyAppTheme, loadSavedTheme, type AppThemeId } from './lib/theme';
import { fetchDetailedElevation } from './services/routingService';
import { ExploreView } from './pages/ExploreView';
import { HomeView } from './pages/HomeView';
import { MessagesView } from './pages/MessagesView';
import { MyRunsView } from './pages/MyRunsView';
import { OpenInvitesView } from './pages/OpenInvitesView';
import { PlanRunView, type PlannerInitialRequest } from './pages/PlanRunView';
import { ProfileView } from './pages/ProfileView';
import { SocialView, type SocialDraftRun, type SocialSubTab } from './pages/SocialView';
import {
  deleteRunRecord,
  saveCompletedRun,
  subscribeFriendsLiveBeacons,
  subscribeMyFriendRequests,
  subscribeOpenRunInvites,
  updateRunJournal,
} from './services/firestoreService';
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
  ElevationProfilePoint,
  FriendRequestDoc,
  GeneratedRouteCandidate,
  GpsSample,
  LiveBeaconDoc,
  NamedLocation,
  OpenRunInviteDoc,
  RouteMode,
  RouteType,
  RunActivityDoc,
  RunArtShapeType,
  SavedRouteDoc,
  TricityPlace,
  WorkoutType,
} from './types/run';

const GUEST_WORKOUT_KEY = 'open_run_guest_workout_v1';

function loadGuestWorkout(): WorkoutType {
  try {
    return normalizeWorkoutType(localStorage.getItem(GUEST_WORKOUT_KEY));
  } catch {
    return 'running';
  }
}

const NAV_ITEMS: Array<{
  id: AppTab;
  label: string;
  mobileLabel?: string;
  showOnMobile?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'plan', label: 'Plan Run', mobileLabel: 'Plan', icon: Navigation },
  { id: 'messages', label: 'Messages', mobileLabel: 'DMs', icon: MessageCircle },
  { id: 'social', label: 'Social', mobileLabel: 'Social', icon: Users },
  { id: 'invites', label: 'Open Invites', mobileLabel: 'Invites', showOnMobile: false, icon: Megaphone },
  { id: 'explore', label: 'Explore', showOnMobile: false, icon: Compass },
  { id: 'routes', label: 'My Routes', showOnMobile: false, icon: Bookmark },
  { id: 'history', label: 'Run History', mobileLabel: 'My Runs', icon: Activity },
  { id: 'profile', label: 'Profile', icon: User },
];

function TricityRunShell() {
  const { user, profile, runs, savedRoutes, artDesigns, refreshProfile } = useAuth();

  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [showStartupQuote, setShowStartupQuote] = useState(true);
  const [uiTheme, setUiTheme] = useState<AppThemeId>(() => loadSavedTheme());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [guestCity, setGuestCity] = useState<ActiveRunningCity>(() => loadGuestRunningCity());
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutType>(() => loadGuestWorkout());

  const [planRequest, setPlanRequest] = useState<PlannerInitialRequest | null>(null);
  const [openInvites, setOpenInvites] = useState<OpenRunInviteDoc[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestDoc[]>([]);
  const [liveFriends, setLiveFriends] = useState<LiveBeaconDoc[]>([]);
  const [invitePreselectedRoute, setInvitePreselectedRoute] = useState<SavedRouteDoc | null>(null);
  const [socialSubTab, setSocialSubTab] = useState<SocialSubTab>('feed');
  const [socialDraftRun, setSocialDraftRun] = useState<SocialDraftRun | null>(null);

  const [liveRoute, setLiveRoute] = useState<GeneratedRouteCandidate | null | undefined>(undefined);
  const [localRuns, setLocalRuns] = useState<LocalSavedRunRecord[]>(() => loadLocalRuns());
  const [completedRun, setCompletedRun] = useState<{
    localId: string;
    syncedRunId?: string;
    saveStatus: AutoSaveStatus;
    saveError?: string | null;
    elevationStatus: ElevationFetchStatus;
    elevationProfile?: ElevationProfilePoint[];
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
    if (profile?.preferredWorkout) {
      setSelectedWorkout(normalizeWorkoutType(profile.preferredWorkout));
    }
  }, [profile?.preferredWorkout]);

  const handleSelectWorkout = useCallback((next: WorkoutType) => {
    const normalized = normalizeWorkoutType(next);
    setSelectedWorkout(normalized);
    try {
      localStorage.setItem(GUEST_WORKOUT_KEY, normalized);
    } catch {
      // ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    applyAppTheme(uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    const handler = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  useEffect(() => {
    try {
      const unsub = subscribeOpenRunInvites(setOpenInvites);
      return () => unsub();
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setFriendRequests([]);
      setLiveFriends([]);
      return;
    }
    const unsubReqs = subscribeMyFriendRequests(user.uid, setFriendRequests);
    const unsubBeacons = subscribeFriendsLiveBeacons(user.uid, setLiveFriends);
    return () => {
      unsubReqs();
      unsubBeacons();
    };
  }, [user?.uid]);

  const acceptedFriends = useMemo(
    () => friendRequests.filter((r) => r.status === 'accepted'),
    [friendRequests]
  );

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
  const effectiveUserPhotoUrl =
    profile && typeof profile.photoURL === 'string'
      ? profile.photoURL
      : user?.photoURL || '';

  const activeCity: ActiveRunningCity = useMemo(() => {
    if (user && profile?.city) {
      return resolveRunningCity(profile.city, profile.cityLat, profile.cityLng);
    }
    return guestCity;
  }, [user, profile?.city, profile?.cityLat, profile?.cityLng, guestCity]);

  const handleSelectCity = useCallback((nextCity: ActiveRunningCity) => {
    setGuestCity(nextCity);
    saveGuestRunningCity(nextCity);
  }, []);

  const handleQuickGenerate = (params: {
    mode: RouteMode;
    workoutType?: WorkoutType;
    distanceKm: number;
    routeType: RouteType;
    shapeType?: RunArtShapeType;
    alphabetText?: string;
    start: NamedLocation;
  }) => {
    const wt = normalizeWorkoutType(params.workoutType ?? selectedWorkout);
    handleSelectWorkout(wt);
    setPlanRequest({ ...params, workoutType: wt, triggerKey: Date.now() });
    setActiveTab('plan');
  };

  const handlePlanAtPlace = (
    place: TricityPlace,
    distanceKm?: number,
    workoutType?: WorkoutType
  ) => {
    const wt = normalizeWorkoutType(workoutType ?? selectedWorkout);
    const meta = getWorkoutMeta(wt);
    handleSelectWorkout(wt);
    setPlanRequest({
      mode: 'normal',
      workoutType: wt,
      distanceKm: distanceKm ?? meta.defaultDistanceKm,
      routeType: 'circular',
      start: { name: place.name, city: place.city || activeCity.name, lat: place.lat, lng: place.lng },
      triggerKey: Date.now(),
    });
    setActiveTab('plan');
  };

  const handleStartSavedRoute = (sr: SavedRouteDoc) => {
    const path = decodePolyline(sr.encodedPolyline);
    const wt = normalizeWorkoutType(sr.workoutType);
    const candidate: GeneratedRouteCandidate = {
      id: sr.id,
      workoutType: wt,
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
      surfaceSummary: sr.notes || `Saved ${sr.city || activeCity.name} Route`,
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

  const handleSaveCompletedRunJournal = async (
    notes: string,
    photos: string[],
    shoeBrand?: string,
    shoeName?: string
  ) => {
    if (!completedRun) return;
    const cleanNotes = notes.trim().slice(0, 500);
    const cleanShoeBrand = (shoeBrand || '').trim().slice(0, 40);
    const cleanShoeName = (shoeName || '').trim().slice(0, 80);
    const updatedSummary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'> = {
      ...completedRun.summary,
      notes: cleanNotes,
      photos,
      shoeBrand: cleanShoeBrand || undefined,
      shoeName: cleanShoeName || undefined,
    };

    setCompletedRun((prev) =>
      prev && prev.localId === completedRun.localId
        ? { ...prev, summary: updatedSummary }
        : prev
    );

    const existingLocal = localRuns.find((r) => r.localId === completedRun.localId);
    setLocalRuns(
      upsertLocalRun({
        localId: completedRun.localId,
        ownerUid: user?.uid || null,
        syncStatus: completedRun.syncedRunId ? 'synced' : 'pending',
        syncedRunId: completedRun.syncedRunId,
        summary: updatedSummary,
        samples: completedRun.samples,
        savedAt: existingLocal?.savedAt || new Date().toISOString(),
      })
    );

    if (completedRun.syncedRunId && user && user.emailVerified) {
      await updateRunJournal(completedRun.syncedRunId, {
        notes: cleanNotes,
        photos,
        shoeBrand: cleanShoeBrand,
        shoeName: cleanShoeName,
      });
    }
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
              OPEN RUN
            </button>
            <p className="mt-0.5 text-[11px] font-medium text-[#5B6B64]">
              World Map · {activeCity.name}
            </p>
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
              Quick Start {getWorkoutMeta(selectedWorkout).label}
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
              OPEN RUN
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
                  {getWorkoutMeta(selectedWorkout).label}
                </button>
              )}
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:py-8 lg:pb-10">
            {activeTab === 'home' && (
              <HomeView
                profile={profile}
                activeCity={activeCity}
                selectedWorkout={selectedWorkout}
                onSelectWorkout={handleSelectWorkout}
                runs={mergedRuns}
                savedRoutes={savedRoutes}
                artDesigns={artDesigns}
                openInvites={openInvites}
                liveFriends={liveFriends}
                isAuthenticated={Boolean(user)}
                onNavigate={setActiveTab}
                onQuickGenerate={handleQuickGenerate}
                onStartSavedRoute={handleStartSavedRoute}
                onExplorePlace={(place) =>
                  handlePlanAtPlace(
                    place,
                    place.suggestedDistancesKm[1] || getWorkoutMeta(selectedWorkout).defaultDistanceKm,
                    selectedWorkout
                  )
                }
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'plan' && (
              <PlanRunView
                initialRequest={planRequest}
                defaultWorkoutType={selectedWorkout}
                onWorkoutChange={handleSelectWorkout}
                activeCity={activeCity}
                preferredUnit={unit}
                userId={user?.uid || null}
                emailVerified={Boolean(user?.emailVerified)}
                onStartRun={(route) => setLiveRoute(route)}
                onOpenCitySettings={() => setActiveTab('profile')}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'messages' && (
              <MessagesView
                userId={user?.uid || null}
                userName={profile?.displayName || user?.displayName || 'Runner'}
                emailVerified={Boolean(user?.emailVerified)}
                defaultWorkoutType={selectedWorkout}
                liveFriends={liveFriends}
                onOpenAuth={() => setAuthModalOpen(true)}
                onOpenSocialFriends={() => {
                  setSocialSubTab('friends');
                  setActiveTab('social');
                }}
              />
            )}

            {activeTab === 'social' && (
              <SocialView
                userId={user?.uid || null}
                userName={profile?.displayName || user?.displayName || 'Runner'}
                username={profile?.username}
                userPhotoUrl={effectiveUserPhotoUrl}
                emailVerified={Boolean(user?.emailVerified)}
                preferredUnit={unit}
                defaultWorkoutType={selectedWorkout}
                activeCity={activeCity}
                runs={mergedRuns}
                savedRoutes={savedRoutes}
                savedShoes={profile?.shoes}
                liveFriends={liveFriends}
                initialSubTab={socialSubTab}
                draftRun={socialDraftRun}
                onClearDraftRun={() => setSocialDraftRun(null)}
                onRefreshProfile={refreshProfile}
                onStartRoute={(route) => setLiveRoute(route)}
                onPlanDistance={(distanceKm, meetingPoint, workoutType) => {
                  const wt = normalizeWorkoutType(workoutType ?? selectedWorkout);
                  handleSelectWorkout(wt);
                  const matchedStart = isChandigarhCityName(activeCity.name)
                    ? TRICITY_START_PRESETS.find((p) =>
                        meetingPoint.toLowerCase().includes(p.name.split(' ')[0].toLowerCase())
                      ) || TRICITY_START_PRESETS[0]
                    : {
                        name: meetingPoint || `${activeCity.name} Center`,
                        city: activeCity.name,
                        lat: activeCity.lat,
                        lng: activeCity.lng,
                      };
                  setPlanRequest({
                    mode: 'normal',
                    workoutType: wt,
                    distanceKm,
                    routeType: 'circular',
                    start: {
                      ...matchedStart,
                      name: meetingPoint || matchedStart.name,
                    },
                    triggerKey: Date.now(),
                  });
                  setActiveTab('plan');
                }}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'invites' && (
              <OpenInvitesView
                userId={user?.uid || null}
                userName={profile?.displayName || user?.displayName || 'Runner'}
                emailVerified={Boolean(user?.emailVerified)}
                preferredUnit={unit}
                defaultWorkoutType={selectedWorkout}
                activeCity={activeCity}
                savedRoutes={savedRoutes}
                preselectedRoute={invitePreselectedRoute}
                onClearPreselectedRoute={() => setInvitePreselectedRoute(null)}
                onStartRoute={(route) => setLiveRoute(route)}
                onPlanAtLocation={(loc) => {
                  const wt = normalizeWorkoutType(loc.workoutType ?? selectedWorkout);
                  handleSelectWorkout(wt);
                  setPlanRequest({
                    mode: 'normal',
                    workoutType: wt,
                    distanceKm: loc.distanceKm,
                    routeType: 'circular',
                    start: { name: loc.name, city: activeCity.name, lat: loc.lat, lng: loc.lng },
                    triggerKey: Date.now(),
                  });
                  setActiveTab('plan');
                }}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'explore' && (
              <ExploreView
                userId={user?.uid || null}
                userName={profile?.displayName || user?.displayName || 'Runner'}
                emailVerified={Boolean(user?.emailVerified)}
                preferredUnit={unit}
                defaultWorkoutType={selectedWorkout}
                onWorkoutChange={handleSelectWorkout}
                activeCity={activeCity}
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
                onCreateOpenInvite={(sr) => {
                  setInvitePreselectedRoute(sr);
                  setActiveTab('invites');
                }}
                onShareRunToSocial={(run, mode) => {
                  setSocialDraftRun({
                    mode,
                    workoutType: run.workoutType,
                    routeName: run.routeName,
                    distanceMeters: run.distanceMeters,
                    durationSec: run.durationSec,
                    avgPaceSecPerKm: run.avgPaceSecPerKm,
                    avgSpeedKmh: run.avgSpeedKmh,
                    caloriesKcal: run.caloriesKcal,
                    elevationGainMeters: run.elevationGainMeters,
                    startName: run.startName,
                    encodedPolyline: run.encodedPolyline,
                  });
                  setSocialSubTab('feed');
                  setActiveTab('social');
                }}
                onDeleteRun={handleDeleteHistoryRun}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}

            {activeTab === 'profile' && (
              <ProfileView
                activeCity={activeCity}
                selectedWorkout={selectedWorkout}
                onSelectWorkout={handleSelectWorkout}
                onSelectCity={handleSelectCity}
                activeTheme={uiTheme}
                onSelectTheme={setUiTheme}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
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
          {NAV_ITEMS.filter((item) => item.showOnMobile !== false).map((item) => {
            const Icon = item.icon;
            const active =
              activeTab === item.id || (item.id === 'history' && activeTab === 'routes');
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
                  {item.mobileLabel || item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals & Live Run Overlays */}
      {showStartupQuote && (
        <BrutalQuoteOverlay
          workoutLabel={getWorkoutMeta(selectedWorkout).label}
          onDismiss={() => setShowStartupQuote(false)}
          onQuickStart={() => setLiveRoute(null)}
        />
      )}

      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      {liveRoute !== undefined && (
        <LiveRunTracker
          route={liveRoute}
          defaultWorkoutType={selectedWorkout}
          preferredUnit={unit}
          activeCity={activeCity}
          userId={user?.uid || null}
          userName={profile?.displayName || user?.displayName || 'Runner'}
          userPhotoUrl={effectiveUserPhotoUrl}
          emailVerified={Boolean(user?.emailVerified)}
          acceptedFriends={acceptedFriends}
          liveFriends={liveFriends}
          onCancel={() => setLiveRoute(undefined)}
          onFinishRun={(summary, samples) => {
            const localId = `local_run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const savedAt = new Date().toISOString();
            const nextLocal = upsertLocalRun({
              localId,
              ownerUid: user?.uid || null,
              syncStatus: 'pending',
              summary,
              samples,
              savedAt,
            });
            setLocalRuns(nextLocal);
            setLiveRoute(undefined);

            const pathPts =
              samples.length >= 2
                ? samples.map((s) => ({ lat: s.lat, lng: s.lng }))
                : summary.encodedPolyline
                ? decodePolyline(summary.encodedPolyline)
                : [];
            const alignedAlts =
              samples.length >= 2
                ? samples.map((s) => (typeof s.alt === 'number' ? s.alt : null))
                : undefined;

            const canCloudSave = Boolean(user && user.emailVerified);
            const hasPath = pathPts.length >= 2;

            setCompletedRun({
              localId,
              saveStatus: canCloudSave ? 'saving' : 'local_only',
              saveError: null,
              elevationStatus: hasPath ? 'loading' : 'unavailable',
              elevationProfile: undefined,
              summary,
              samples,
            });

            if (hasPath) {
              void (async () => {
                const elevRes = await fetchDetailedElevation(pathPts, alignedAlts, 3500);
                const enrichedSummary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'> =
                  elevRes.available
                    ? {
                        ...summary,
                        elevationGainMeters:
                          elevRes.elevationGainMeters ?? summary.elevationGainMeters,
                        ...(typeof elevRes.elevationLossMeters === 'number'
                          ? { elevationLossMeters: elevRes.elevationLossMeters }
                          : {}),
                        ...(typeof elevRes.minElevationMeters === 'number'
                          ? { minElevationMeters: elevRes.minElevationMeters }
                          : {}),
                        ...(typeof elevRes.maxElevationMeters === 'number'
                          ? { maxElevationMeters: elevRes.maxElevationMeters }
                          : {}),
                      }
                    : summary;

                const updatedLocal = upsertLocalRun({
                  localId,
                  ownerUid: user?.uid || null,
                  syncStatus: 'pending',
                  summary: enrichedSummary,
                  samples,
                  savedAt,
                });
                setLocalRuns(updatedLocal);
                setCompletedRun((prev) =>
                  prev && prev.localId === localId
                    ? {
                        ...prev,
                        summary: enrichedSummary,
                        elevationStatus: elevRes.available ? 'ready' : 'unavailable',
                        elevationProfile: elevRes.profile,
                      }
                    : prev
                );
                if (canCloudSave) {
                  void syncLocalRunToCloud(localId, enrichedSummary, samples);
                }
              })();
            } else if (canCloudSave) {
              void syncLocalRunToCloud(localId, summary, samples);
            }
          }}
        />
      )}

      {completedRun && (
        <RunSummaryModal
          summary={completedRun.summary}
          elevationStatus={completedRun.elevationStatus}
          elevationProfile={completedRun.elevationProfile}
          previousRuns={mergedRuns.filter(
            (r) => r.id !== completedRun.localId && r.id !== completedRun.syncedRunId
          )}
          preferredUnit={unit}
          savedShoes={profile?.shoes}
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
          onSaveJournal={handleSaveCompletedRunJournal}
          onDiscardRun={handleDiscardCompletedRun}
          onPostDailyRun={() => {
            setSocialDraftRun({
              mode: 'post',
              workoutType: completedRun.summary.workoutType,
              routeName: completedRun.summary.routeName,
              distanceMeters: completedRun.summary.distanceMeters,
              durationSec: completedRun.summary.durationSec,
              avgPaceSecPerKm: completedRun.summary.avgPaceSecPerKm,
              avgSpeedKmh: completedRun.summary.avgSpeedKmh,
              caloriesKcal: completedRun.summary.caloriesKcal,
              elevationGainMeters: completedRun.summary.elevationGainMeters,
              startName: completedRun.summary.startName,
              encodedPolyline: completedRun.summary.encodedPolyline,
            });
            setCompletedRun(null);
            setSocialSubTab('feed');
            setActiveTab('social');
          }}
          onAddStory={() => {
            setSocialDraftRun({
              mode: 'story',
              workoutType: completedRun.summary.workoutType,
              routeName: completedRun.summary.routeName,
              distanceMeters: completedRun.summary.distanceMeters,
              durationSec: completedRun.summary.durationSec,
              avgPaceSecPerKm: completedRun.summary.avgPaceSecPerKm,
              avgSpeedKmh: completedRun.summary.avgSpeedKmh,
              caloriesKcal: completedRun.summary.caloriesKcal,
              elevationGainMeters: completedRun.summary.elevationGainMeters,
              startName: completedRun.summary.startName,
              encodedPolyline: completedRun.summary.encodedPolyline,
            });
            setCompletedRun(null);
            setSocialSubTab('feed');
            setActiveTab('social');
          }}
          onOpenAuth={() => setAuthModalOpen(true)}
          onCloseHome={() => {
            setCompletedRun(null);
            setActiveTab('history');
          }}
        />
      )}

      <MusicPlayerDock />
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
        Loading OPEN RUN...
      </div>
    );
  }

  return (
    <AuthProvider>
      <APIProvider apiKey={mapsApiKey} language="en">
        <TricityRunShell />
      </APIProvider>
    </AuthProvider>
  );
}
