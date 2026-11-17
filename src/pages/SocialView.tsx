import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AtSign,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Footprints,
  Heart,
  ImagePlus,
  Loader2,
  LocateFixed,
  Lock,
  MapPin,
  MessageSquare,
  Navigation,
  Play,
  Plus,
  Radio,
  Route as RouteIcon,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ClubsSection } from '../components/ClubsSection';
import { TricityMap } from '../components/TricityMap';
import { WorkoutIcon, WorkoutSelector } from '../components/WorkoutIcon';
import { MAX_RUN_PHOTOS, processRunPhotoFile } from '../lib/avatarUpload';
import { TRICITY_START_PRESETS } from '../data/tricityPlaces';
import {
  estimateCaloriesKcal,
  estimateDurationSecForWorkout,
  formatSpeed,
  formatWorkoutPrimaryRate,
  getWorkoutMeta,
  normalizeWorkoutType,
} from '../data/workouts';
import {
  DEFAULT_RUNNING_CITY,
  isChandigarhCityName,
  type ActiveRunningCity,
} from '../data/worldCities';
import { decodePolyline, formatDistance, formatDuration, formatPace } from '../lib/geo';
import {
  checkUsernameAvailability,
  checkUserLikedPosts,
  claimUsername,
  createDailyRunPost,
  createRunStory,
  deleteDailyRunPost,
  deleteRunStory,
  isValidUsernameFormat,
  lookupRunnerByUsername,
  normalizeUsername,
  removeFriendshipOrRequest,
  respondFriendRequest,
  respondPersonalRunInvite,
  sendDmMessage,
  sendFriendRequest,
  stopLiveBeacon,
  subscribeActiveStories,
  subscribeDailyRunPosts,
  subscribeDmMessages,
  subscribeMyDmThreads,
  subscribeMyFriendRequests,
  subscribeRunnerDirectory,
  toggleLikeDailyPost,
  upsertLiveBeacon,
} from '../services/firestoreService';
import type {
  DailyRunPostDoc,
  DmMessageDoc,
  DmThreadDoc,
  FriendRequestDoc,
  GeneratedRouteCandidate,
  LatLngLiteral,
  LiveBeaconDoc,
  RunActivityDoc,
  RunnerDirectoryDoc,
  RunningShoeItem,
  RunStoryDoc,
  SavedRouteDoc,
  StoryThemeColor,
  WorkoutType,
} from '../types/run';

export type SocialSubTab = 'feed' | 'clubs' | 'friends' | 'messages';

export interface SocialDraftRun {
  mode: 'post' | 'story';
  workoutType?: WorkoutType;
  routeName: string;
  distanceMeters: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  avgSpeedKmh?: number;
  caloriesKcal?: number;
  elevationGainMeters?: number;
  startName: string;
  encodedPolyline?: string;
}

interface SocialViewProps {
  userId: string | null;
  userName: string;
  username?: string;
  userPhotoUrl?: string | null;
  emailVerified: boolean;
  preferredUnit: 'km' | 'mi';
  defaultWorkoutType?: WorkoutType;
  activeCity?: ActiveRunningCity;
  runs: RunActivityDoc[];
  savedRoutes: SavedRouteDoc[];
  savedShoes?: RunningShoeItem[];
  liveFriends?: LiveBeaconDoc[];
  initialSubTab?: SocialSubTab;
  draftRun?: SocialDraftRun | null;
  onClearDraftRun?: () => void;
  onRefreshProfile?: () => Promise<void>;
  onStartRoute: (route: GeneratedRouteCandidate) => void;
  onPlanDistance?: (distanceKm: number, meetingPoint: string, workoutType?: WorkoutType) => void;
  onOpenAuth: () => void;
}

const INVITE_DISTANCE_PRESETS = [
  { km: 2, label: '2K' },
  { km: 3, label: '3K' },
  { km: 5, label: '5K' },
  { km: 10, label: '10K' },
  { km: 15, label: '15K' },
  { km: 21.1, label: '21.1K Half' },
  { km: 42.2, label: '42.2K Full' },
];

const CYCLING_INVITE_DISTANCE_PRESETS = [
  { km: 10, label: '10K' },
  { km: 20, label: '20K' },
  { km: 30, label: '30K' },
  { km: 50, label: '50K' },
  { km: 75, label: '75K' },
  { km: 100, label: '100K' },
];

const STORY_THEMES: Array<{
  id: StoryThemeColor;
  label: string;
  bgClass: string;
  textClass: string;
  accentClass: string;
}> = [
  {
    id: 'pine',
    label: 'Pine Forest',
    bgClass: 'from-[#172D27] via-[#1E3B33] to-[#30483E]',
    textClass: 'text-white',
    accentClass: 'text-[#9AE62E]',
  },
  {
    id: 'lime',
    label: 'Electric Lime',
    bgClass: 'from-[#9AE62E] via-[#B4F056] to-[#74BE18]',
    textClass: 'text-[#141F1B]',
    accentClass: 'text-[#172D27]',
  },
  {
    id: 'sunset',
    label: 'Golden Sunset',
    bgClass: 'from-[#D97706] via-[#EA580C] to-[#9A3412]',
    textClass: 'text-white',
    accentClass: 'text-[#FEF3C7]',
  },
  {
    id: 'slate',
    label: 'Night Tempo',
    bgClass: 'from-[#0F172A] via-[#1E293B] to-[#334155]',
    textClass: 'text-white',
    accentClass: 'text-[#9AE62E]',
  },
];

const MOOD_TAGS = ['Strong', 'Sunrise', 'Tempo', 'Easy Jog', 'PR Pace', 'Group Vibe'];

function defaultTomorrowMorningIso(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setHours(6, 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimestampSafe(ts: unknown): string {
  if (!ts) return 'Just now';
  try {
    const ms =
      typeof (ts as { toMillis?: () => number }).toMillis === 'function'
        ? (ts as { toMillis: () => number }).toMillis()
        : typeof ts === 'string'
        ? new Date(ts).getTime()
        : Date.now();
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return 'Recent';
  }
}

function MiniPolylineArt({
  encodedPolyline,
  darkBg = true,
  sizeClass = 'h-16 w-16',
}: {
  encodedPolyline?: string;
  darkBg?: boolean;
  sizeClass?: string;
}) {
  const pts = useMemo(() => (encodedPolyline ? decodePolyline(encodedPolyline) : []), [encodedPolyline]);
  if (pts.length < 2) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const spanLat = Math.max(0.0008, maxLat - minLat);
  const spanLngScaled = Math.max(0.0008, (maxLng - minLng) * cosLat);
  const scale = Math.min(50 / spanLngScaled, 50 / spanLat);
  const toXY = (p: { lat: number; lng: number }) => ({
    x: Number((36 + (p.lng - (minLng + maxLng) / 2) * cosLat * scale).toFixed(1)),
    y: Number((36 - (p.lat - midLat) * scale).toFixed(1)),
  });
  const svgPts = pts.map((p) => {
    const xy = toXY(p);
    return `${xy.x},${xy.y}`;
  });
  const startXY = toXY(pts[0]);

  return (
    <div
      className={`${sizeClass} shrink-0 rounded-xl p-1 ${
        darkBg ? 'bg-[#172D27]' : 'bg-black/15'
      }`}
    >
      <svg viewBox="0 0 72 72" className="h-full w-full">
        <polyline
          fill="none"
          stroke={darkBg ? '#9AE62E' : 'currentColor'}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={svgPts.join(' ')}
        />
        <circle cx={startXY.x} cy={startXY.y} r="4.5" fill="#FFFFFF" stroke="#172D27" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function RunnerAvatar({
  src,
  name,
  sizeClass = 'h-10 w-10',
  bgClass = 'bg-[#172D27] text-[#9AE62E]',
  textSizeClass = 'text-sm',
  borderClass = 'border border-[#E5E3DC]',
}: {
  src?: string | null;
  name: string;
  sizeClass?: string;
  bgClass?: string;
  textSizeClass?: string;
  borderClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const cleanSrc = typeof src === 'string' ? src.trim() : '';
  if (cleanSrc && !failed) {
    return (
      <img
        src={cleanSrc}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${sizeClass} shrink-0 rounded-full object-cover ${borderClass}`}
      />
    );
  }
  return (
    <div
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full ${bgClass} font-display ${textSizeClass} font-bold`}
    >
      {(name || 'R').charAt(0).toUpperCase()}
    </div>
  );
}

export const SocialView: React.FC<SocialViewProps> = ({
  userId,
  userName,
  username,
  userPhotoUrl,
  emailVerified,
  preferredUnit,
  defaultWorkoutType = 'running',
  activeCity = DEFAULT_RUNNING_CITY,
  runs,
  savedRoutes,
  savedShoes = [],
  liveFriends = [],
  initialSubTab = 'feed',
  draftRun,
  onClearDraftRun,
  onRefreshProfile,
  onStartRoute,
  onPlanDistance,
  onOpenAuth,
}) => {
  const [subTab, setSubTab] = useState<SocialSubTab>(initialSubTab);

  // Real-time community state
  const [runners, setRunners] = useState<RunnerDirectoryDoc[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestDoc[]>([]);
  const [dmThreads, setDmThreads] = useState<DmThreadDoc[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DmMessageDoc[]>([]);
  const [posts, setPosts] = useState<DailyRunPostDoc[]>([]);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());
  const [stories, setStories] = useState<RunStoryDoc[]>([]);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [socialSearch, setSocialSearch] = useState('');
  const [runnerSearch, setRunnerSearch] = useState('');
  const [exactLookupRunner, setExactLookupRunner] = useState<RunnerDirectoryDoc | null>(null);
  const [exactLookupLoading, setExactLookupLoading] = useState(false);

  // Inline @username handle management state
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleDraft, setHandleDraft] = useState(username || '');
  const [handleCheck, setHandleCheck] = useState<{
    state: 'idle' | 'checking' | 'available' | 'taken' | 'own' | 'invalid';
    message?: string;
  }>({ state: 'idle' });
  const [savingHandle, setSavingHandle] = useState(false);

  const defaultMeetingPoint = isChandigarhCityName(activeCity.name)
    ? TRICITY_START_PRESETS[0].name
    : `${activeCity.name} Center`;

  // Post Composer state
  const [showPostComposer, setShowPostComposer] = useState(false);
  const [postRunId, setPostRunId] = useState<string>('custom');
  const [postWorkoutType, setPostWorkoutType] = useState<WorkoutType>(
    normalizeWorkoutType(defaultWorkoutType)
  );
  const [postTitle, setPostTitle] = useState(`Morning ${activeCity.name} Run`);
  const [postDistanceKm, setPostDistanceKm] = useState<number>(5);
  const [postDurationMin, setPostDurationMin] = useState<number>(28);
  const [postStartName, setPostStartName] = useState(defaultMeetingPoint);
  const [postElevationGain, setPostElevationGain] = useState<number | undefined>(undefined);
  const [postPolyline, setPostPolyline] = useState<string>('');
  const [postCaption, setPostCaption] = useState('');
  const [postMood, setPostMood] = useState('Strong');
  const [postShoeBrand, setPostShoeBrand] = useState('');
  const [postShoeName, setPostShoeName] = useState('');
  const [postPhotos, setPostPhotos] = useState<string[]>([]);
  const [uploadingPostPhoto, setUploadingPostPhoto] = useState(false);
  const [posting, setPosting] = useState(false);
  const [lightboxPostPhoto, setLightboxPostPhoto] = useState<string | null>(null);
  const postPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Story Composer & Viewer state
  const [showStoryComposer, setShowStoryComposer] = useState(false);
  const [storyRunId, setStoryRunId] = useState<string>('custom');
  const [storyWorkoutType, setStoryWorkoutType] = useState<WorkoutType>(
    normalizeWorkoutType(defaultWorkoutType)
  );
  const [storyHeadline, setStoryHeadline] = useState('5K Done Before Sunrise!');
  const [storyCaption, setStoryCaption] = useState('');
  const [storyDistanceKm, setStoryDistanceKm] = useState<number>(5);
  const [storyDurationMin, setStoryDurationMin] = useState<number>(28);
  const [storyTheme, setStoryTheme] = useState<StoryThemeColor>('pine');
  const [storyPolyline, setStoryPolyline] = useState<string>('');
  const [postingStory, setPostingStory] = useState(false);
  const [viewingStoryIdx, setViewingStoryIdx] = useState<number | null>(null);

  // DM Composer & Personal Workout Invite Form state
  const [dmText, setDmText] = useState('');
  const [sendingDm, setSendingDm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteWorkoutType, setInviteWorkoutType] = useState<WorkoutType>(
    normalizeWorkoutType(defaultWorkoutType)
  );
  const [inviteDistanceKm, setInviteDistanceKm] = useState<number>(
    normalizeWorkoutType(defaultWorkoutType) === 'cycling' ? 20 : 5
  );
  const [inviteCustomDist, setInviteCustomDist] = useState('');
  const [inviteUseCustomDist, setInviteUseCustomDist] = useState(false);
  const [inviteTitle, setInviteTitle] = useState(
    normalizeWorkoutType(defaultWorkoutType) === 'cycling'
      ? 'Morning Group Bike Ride'
      : 'Morning Paced Run'
  );
  const [inviteDateTime, setInviteDateTime] = useState<string>(defaultTomorrowMorningIso);
  const [inviteMeetingPoint, setInviteMeetingPoint] = useState<string>(defaultMeetingPoint);
  const [inviteNote, setInviteNote] = useState('');
  const [inviteRouteId, setInviteRouteId] = useState<string>('');

  // Live Location & DM Location Sharing state
  const [focusedLiveUid, setFocusedLiveUid] = useState<string | null>(null);
  const [showLocationDrawer, setShowLocationDrawer] = useState(false);
  const [locatingPin, setLocatingPin] = useState(false);
  const [capturedPin, setCapturedPin] = useState<LatLngLiteral | null>(null);
  const [locationLabelInput, setLocationLabelInput] = useState('Current GPS Location');
  const [locationNoteInput, setLocationNoteInput] = useState('');
  const [viewingLocationMsg, setViewingLocationMsg] = useState<DmMessageDoc | null>(null);
  const [dmLiveSharingTo, setDmLiveSharingTo] = useState<{
    uid: string;
    name: string;
    startedAtMs: number;
  } | null>(null);
  const dmLiveWatchRef = useRef<number | null>(null);
  const dmLiveLastPushRef = useRef<number>(0);

  const showToast = (type: 'ok' | 'err', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4500);
  };

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  // Apply draft workout when navigated from RunSummaryModal or MyRunsView
  useEffect(() => {
    if (!draftRun) return;
    const wt = normalizeWorkoutType(draftRun.workoutType ?? defaultWorkoutType);
    const sportMeta = getWorkoutMeta(wt);
    const distKm = Number((draftRun.distanceMeters / 1000).toFixed(2));
    const durMin = Math.max(1, Math.round(draftRun.durationSec / 60));
    const primaryRate = formatWorkoutPrimaryRate({
      workoutType: wt,
      avgPaceSecPerKm: draftRun.avgPaceSecPerKm,
      avgSpeedKmh: draftRun.avgSpeedKmh,
      unit: preferredUnit,
    });
    const kcal =
      typeof draftRun.caloriesKcal === 'number' && draftRun.caloriesKcal > 0
        ? Math.round(draftRun.caloriesKcal)
        : estimateCaloriesKcal(wt, draftRun.durationSec, draftRun.distanceMeters);
    const calNote = kcal > 0 ? ` · ${kcal} kcal burnt` : '';
    const elevNote =
      typeof draftRun.elevationGainMeters === 'number' && draftRun.elevationGainMeters > 0
        ? ` · +${Math.round(draftRun.elevationGainMeters)} m elev gain`
        : '';
    if (draftRun.mode === 'post') {
      setSubTab('feed');
      setShowPostComposer(true);
      setPostRunId('draft');
      setPostWorkoutType(wt);
      setPostTitle(draftRun.routeName || `${activeCity.name} ${sportMeta.fullLabel}`);
      setPostDistanceKm(distKm > 0 ? distKm : 1);
      setPostDurationMin(durMin);
      setPostStartName(draftRun.startName || activeCity.name);
      setPostElevationGain(
        typeof draftRun.elevationGainMeters === 'number' && Number.isFinite(draftRun.elevationGainMeters)
          ? Math.round(draftRun.elevationGainMeters)
          : undefined
      );
      setPostPolyline(draftRun.encodedPolyline || '');
      setPostCaption(
        `Finished ${distKm} km ${sportMeta.fullLabel.toLowerCase()} on ${draftRun.routeName || `${activeCity.name} paths`} in ${formatDuration(draftRun.durationSec)} (${primaryRate}${elevNote}${calNote})!`
      );
    } else {
      setShowStoryComposer(true);
      setStoryRunId('draft');
      setStoryWorkoutType(wt);
      setStoryHeadline(`${distKm}K ${draftRun.routeName || sportMeta.label}`.slice(0, 80));
      setStoryDistanceKm(distKm);
      setStoryDurationMin(durMin);
      setStoryPolyline(draftRun.encodedPolyline || '');
      setStoryCaption(`${sportMeta.label} · ${primaryRate}${elevNote}${calNote} · ${draftRun.startName}`);
    }
    onClearDraftRun?.();
  }, [draftRun, onClearDraftRun, preferredUnit, defaultWorkoutType, activeCity.name]);

  // Subscribe to public (and friends-only when signed in) posts & active stories
  useEffect(() => {
    const unsubPosts = subscribeDailyRunPosts(setPosts, Boolean(userId));
    const unsubStories = subscribeActiveStories(setStories);
    return () => {
      unsubPosts();
      unsubStories();
    };
  }, [userId]);

  // Subscribe to authenticated runner directory, friend requests & DM threads
  useEffect(() => {
    if (!userId) {
      setRunners([]);
      setFriendRequests([]);
      setDmThreads([]);
      return;
    }
    const unsubDir = subscribeRunnerDirectory(setRunners);
    const unsubReqs = subscribeMyFriendRequests(userId, setFriendRequests);
    const unsubThreads = subscribeMyDmThreads(userId, setDmThreads);
    return () => {
      unsubDir();
      unsubReqs();
      unsubThreads();
    };
  }, [userId]);

  // Sync liked posts
  useEffect(() => {
    if (!userId || posts.length === 0) {
      setLikedPostIds(new Set());
      return;
    }
    checkUserLikedPosts(
      posts.map((p) => p.id),
      userId
    )
      .then(setLikedPostIds)
      .catch(() => {});
  }, [userId, posts]);

  // Subscribe to selected DM messages
  useEffect(() => {
    if (!userId || !selectedThreadId) {
      setMessages([]);
      return;
    }
    const unsubMsgs = subscribeDmMessages(selectedThreadId, userId, setMessages);
    return () => unsubMsgs();
  }, [userId, selectedThreadId]);

  // Derived friend groupings
  const incomingRequests = useMemo(
    () => friendRequests.filter((r) => r.status === 'pending' && r.toUid === userId),
    [friendRequests, userId]
  );
  const outgoingRequests = useMemo(
    () => friendRequests.filter((r) => r.status === 'pending' && r.fromUid === userId),
    [friendRequests, userId]
  );
  const acceptedFriends = useMemo(
    () => friendRequests.filter((r) => r.status === 'accepted'),
    [friendRequests]
  );

  // Auto-select first accepted friend when opening Messages tab
  useEffect(() => {
    if (subTab === 'messages' && !selectedThreadId && acceptedFriends.length > 0) {
      setSelectedThreadId(dmThreads[0]?.threadId || acceptedFriends[0].id);
    }
  }, [subTab, selectedThreadId, acceptedFriends, dmThreads]);

  const requestByOtherUid = useMemo(() => {
    const map = new Map<string, FriendRequestDoc>();
    for (const req of friendRequests) {
      const otherUid = req.fromUid === userId ? req.toUid : req.fromUid;
      map.set(otherUid, req);
    }
    return map;
  }, [friendRequests, userId]);

  const threadMap = useMemo(() => {
    const map = new Map<string, DmThreadDoc>();
    for (const t of dmThreads) map.set(t.threadId, t);
    return map;
  }, [dmThreads]);

  const selectedFriendship = useMemo(
    () => acceptedFriends.find((f) => f.id === selectedThreadId) || null,
    [acceptedFriends, selectedThreadId]
  );

  const runnerByUid = useMemo(() => {
    const map = new Map<string, RunnerDirectoryDoc>();
    for (const r of runners) map.set(r.uid, r);
    return map;
  }, [runners]);

  const selectedFriendDisplay = useMemo(() => {
    if (!selectedFriendship || !userId) return null;
    const isFrom = selectedFriendship.fromUid === userId;
    const uid = isFrom ? selectedFriendship.toUid : selectedFriendship.fromUid;
    return {
      uid,
      name: isFrom ? selectedFriendship.toName : selectedFriendship.fromName,
      username: runnerByUid.get(uid)?.username,
      photoUrl: isFrom ? selectedFriendship.toPhotoUrl : selectedFriendship.fromPhotoUrl,
    };
  }, [selectedFriendship, userId, runnerByUid]);

  // Sync draft handle when profile username changes
  useEffect(() => {
    if (!editingHandle) {
      setHandleDraft(username || '');
    }
  }, [username, editingHandle]);

  // Live availability check when editing @username in SocialView
  useEffect(() => {
    if (!editingHandle || !userId) {
      setHandleCheck({ state: 'idle' });
      return;
    }
    const norm = normalizeUsername(handleDraft);
    if (!norm) {
      setHandleCheck({ state: 'idle' });
      return;
    }
    if (norm === (username || '')) {
      setHandleCheck({ state: 'own', message: `@${norm} is your current username.` });
      return;
    }
    if (!isValidUsernameFormat(norm)) {
      setHandleCheck({
        state: 'invalid',
        message: '3–24 lowercase letters, numbers, or underscores.',
      });
      return;
    }
    let cancelled = false;
    setHandleCheck({ state: 'checking', message: `Checking @${norm}...` });
    const timer = window.setTimeout(() => {
      checkUsernameAvailability(norm, userId)
        .then((res) => {
          if (cancelled) return;
          if (res.available) {
            setHandleCheck({ state: 'available', message: `@${res.normalized} is available!` });
          } else {
            setHandleCheck({ state: 'taken', message: res.reason || `@${res.normalized} is taken.` });
          }
        })
        .catch(() => {
          if (!cancelled) setHandleCheck({ state: 'idle' });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editingHandle, handleDraft, username, userId]);

  // Debounced exact @username lookup in Firestore for global social search or Find Runners search
  const activeSearchTerm = (socialSearch.trim() || runnerSearch.trim());
  useEffect(() => {
    if (!userId) {
      setExactLookupRunner(null);
      setExactLookupLoading(false);
      return;
    }
    const norm = normalizeUsername(activeSearchTerm);
    if (!isValidUsernameFormat(norm)) {
      setExactLookupRunner(null);
      setExactLookupLoading(false);
      return;
    }
    let cancelled = false;
    setExactLookupLoading(true);
    const timer = window.setTimeout(() => {
      lookupRunnerByUsername(norm)
        .then((found) => {
          if (!cancelled) {
            setExactLookupRunner(found && found.uid !== userId ? found : null);
            setExactLookupLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setExactLookupRunner(null);
            setExactLookupLoading(false);
          }
        });
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSearchTerm, userId]);

  const matchingAcceptedFriends = useMemo(() => {
    const raw = socialSearch.trim().toLowerCase();
    const norm = normalizeUsername(socialSearch);
    if (!raw) return [];
    return acceptedFriends.filter((f) => {
      const otherUid = f.fromUid === userId ? f.toUid : f.fromUid;
      const friendName = (f.fromUid === userId ? f.toName : f.fromName).toLowerCase();
      const friendCard = runnerByUid.get(otherUid);
      const friendHandle = (friendCard?.username || '').toLowerCase();
      const friendBio = (friendCard?.bio || '').toLowerCase();
      const friendTagsMatch = (friendCard?.bioTags || []).some((t) =>
        t.toLowerCase().includes(raw)
      );
      return (
        friendName.includes(raw) ||
        (norm.length > 0 && friendHandle.includes(norm)) ||
        friendBio.includes(raw) ||
        friendTagsMatch
      );
    });
  }, [socialSearch, acceptedFriends, userId, runnerByUid]);

  const matchingDiscoverRunners = useMemo(() => {
    const raw = socialSearch.trim().toLowerCase();
    const norm = normalizeUsername(socialSearch);
    if (!raw) return [];
    const acceptedUidSet = new Set(
      acceptedFriends.map((f) => (f.fromUid === userId ? f.toUid : f.fromUid))
    );
    const list = runners
      .filter((r) => r.uid !== userId && !acceptedUidSet.has(r.uid))
      .filter((r) => {
        const nameMatch = r.displayName.toLowerCase().includes(raw);
        const cityMatch = (r.city || '').toLowerCase().includes(raw);
        const handleMatch = norm.length > 0 && (r.username || '').toLowerCase().includes(norm);
        const bioMatch = (r.bio || '').toLowerCase().includes(raw);
        const tagMatch = (r.bioTags || []).some((t) => t.toLowerCase().includes(raw));
        return nameMatch || cityMatch || handleMatch || bioMatch || tagMatch;
      });
    if (
      exactLookupRunner &&
      exactLookupRunner.uid !== userId &&
      !acceptedUidSet.has(exactLookupRunner.uid) &&
      !list.some((r) => r.uid === exactLookupRunner.uid)
    ) {
      return [exactLookupRunner, ...list];
    }
    return list;
  }, [socialSearch, runners, acceptedFriends, userId, exactLookupRunner]);

  const filteredDirectory = useMemo(() => {
    const q = runnerSearch.trim().toLowerCase();
    const qHandle = normalizeUsername(runnerSearch);
    const list = runners
      .filter((r) => r.uid !== userId)
      .filter(
        (r) =>
          !q ||
          r.displayName.toLowerCase().includes(q) ||
          (r.city || '').toLowerCase().includes(q) ||
          (qHandle.length > 0 && (r.username || '').toLowerCase().includes(qHandle)) ||
          (r.bio || '').toLowerCase().includes(q) ||
          (r.bioTags || []).some((t) => t.toLowerCase().includes(q))
      );
    if (
      q &&
      exactLookupRunner &&
      exactLookupRunner.uid !== userId &&
      !list.some((r) => r.uid === exactLookupRunner.uid)
    ) {
      return [exactLookupRunner, ...list];
    }
    return list;
  }, [runners, userId, runnerSearch, exactLookupRunner]);

  const requireVerifiedAction = (): boolean => {
    if (!userId) {
      onOpenAuth();
      return false;
    }
    if (!emailVerified) {
      showToast('err', 'Please verify your email in Profile before posting or messaging.');
      return false;
    }
    return true;
  };

  const handleSelectRunForPost = (selectedId: string) => {
    setPostRunId(selectedId);
    if (selectedId === 'custom') {
      setPostElevationGain(undefined);
      return;
    }
    const found = runs.find((r) => r.id === selectedId);
    if (!found) return;
    const wt = normalizeWorkoutType(found.workoutType);
    const distKm = Number((found.distanceMeters / 1000).toFixed(2));
    setPostWorkoutType(wt);
    setPostTitle(found.routeName || `${activeCity.name} ${getWorkoutMeta(wt).label}`);
    setPostDistanceKm(distKm > 0 ? distKm : 1);
    setPostDurationMin(Math.max(1, Math.round(found.durationSec / 60)));
    setPostStartName(found.startName || activeCity.name);
    setPostElevationGain(
      typeof found.elevationGainMeters === 'number' && Number.isFinite(found.elevationGainMeters)
        ? Math.round(found.elevationGainMeters)
        : undefined
    );
    setPostPolyline(found.encodedPolyline || '');
    setPostPhotos(found.photos ? found.photos.slice(0, MAX_RUN_PHOTOS) : []);
    if (!postCaption.trim()) {
      const kcal =
        typeof found.caloriesKcal === 'number' && found.caloriesKcal > 0
          ? Math.round(found.caloriesKcal)
          : estimateCaloriesKcal(wt, found.durationSec, found.distanceMeters);
      const elevTxt =
        typeof found.elevationGainMeters === 'number' && found.elevationGainMeters > 0
          ? `, +${Math.round(found.elevationGainMeters)} m elev gain`
          : '';
      const calTxt = kcal > 0 ? `, ${kcal} kcal burnt` : '';
      setPostCaption(
        `Logged ${distKm} km ${getWorkoutMeta(wt).fullLabel.toLowerCase()} around ${found.startName || activeCity.name} (${formatDuration(found.durationSec)}${elevTxt}${calTxt})!`
      );
    }
  };

  useEffect(() => {
    if (showPostComposer && postRunId === 'custom' && runs.length > 0 && !draftRun) {
      handleSelectRunForPost(runs[0].id);
    }
  }, [showPostComposer, postRunId, runs, draftRun]);

  const handlePostPhotoFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    const remaining = MAX_RUN_PHOTOS - postPhotos.length;
    if (remaining <= 0) {
      showToast('err', `You can attach up to ${MAX_RUN_PHOTOS} photos per post.`);
      return;
    }

    setUploadingPostPhoto(true);
    try {
      const added: string[] = [];
      for (const file of files.slice(0, remaining)) {
        const compressed = await processRunPhotoFile(file);
        added.push(compressed);
      }
      if (added.length > 0) {
        setPostPhotos((prev) => [...prev, ...added].slice(0, MAX_RUN_PHOTOS));
      }
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Could not process selected photo.');
    } finally {
      setUploadingPostPhoto(false);
    }
  };

  const handleSelectRunForStory = (selectedId: string) => {
    setStoryRunId(selectedId);
    if (selectedId === 'custom') return;
    const found = runs.find((r) => r.id === selectedId);
    if (!found) return;
    const wt = normalizeWorkoutType(found.workoutType);
    const distKm = Number((found.distanceMeters / 1000).toFixed(2));
    const rate = formatWorkoutPrimaryRate({
      workoutType: wt,
      avgPaceSecPerKm: found.avgPaceSecPerKm,
      avgSpeedKmh: found.avgSpeedKmh,
      unit: preferredUnit,
    });
    const kcal =
      typeof found.caloriesKcal === 'number' && found.caloriesKcal > 0
        ? Math.round(found.caloriesKcal)
        : estimateCaloriesKcal(wt, found.durationSec, found.distanceMeters);
    const calTxt = kcal > 0 ? ` · ${kcal} kcal burnt` : '';
    setStoryWorkoutType(wt);
    setStoryHeadline(`${distKm}K ${found.routeName || getWorkoutMeta(wt).label}`.slice(0, 80));
    setStoryDistanceKm(distKm);
    setStoryDurationMin(Math.max(1, Math.round(found.durationSec / 60)));
    setStoryPolyline(found.encodedPolyline || '');
    setStoryCaption(`${getWorkoutMeta(wt).label} · ${rate}${calTxt} · ${found.startName}`);
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireVerifiedAction() || !userId) return;
    const hasVerifiedRun = postRunId !== 'custom' || Boolean(draftRun);
    if (!hasVerifiedRun) {
      showToast('err', 'Complete a GPS workout first to publish a verified daily post.');
      return;
    }
    setPosting(true);
    try {
      const distKm = Math.max(0.1, Number(postDistanceKm) || 1);
      const durSec = Math.max(60, Math.round((Number(postDurationMin) || 1) * 60));
      const paceSec = Math.round(durSec / distKm);
      const isMyProfilePrivate = Boolean(userId && runnerByUid.get(userId)?.isPrivate);
      await createDailyRunPost(
        { uid: userId, displayName: userName, photoURL: userPhotoUrl },
        {
          workoutType: postWorkoutType,
          caption: postCaption.trim() || `Completed ${distKm} km today!`,
          runTitle: postTitle.trim() || `Daily ${getWorkoutMeta(postWorkoutType).label}`,
          distanceKm: distKm,
          durationSec: durSec,
          avgPaceSecPerKm: paceSec,
          elevationGainMeters: postElevationGain,
          startName: postStartName.trim() || activeCity.name,
          encodedPolyline: postPolyline || undefined,
          photos: postPhotos.length > 0 ? postPhotos : undefined,
          shoeBrand: postShoeBrand.trim() || undefined,
          shoeName: postShoeName.trim() || undefined,
          moodTag: postMood,
          visibility: isMyProfilePrivate ? 'friends' : 'public',
        }
      );
      setShowPostComposer(false);
      setPostCaption('');
      setPostShoeBrand('');
      setPostShoeName('');
      setPostPhotos([]);
      setPostElevationGain(undefined);
      showToast(
        'ok',
        isMyProfilePrivate
          ? 'Your workout post is live for your accepted friends!'
          : `Your ${getWorkoutMeta(postWorkoutType).fullLabel.toLowerCase()} is now live on the community feed!`
      );
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Could not publish workout post.');
    } finally {
      setPosting(false);
    }
  };

  const handleCreateStory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireVerifiedAction() || !userId) return;
    setPostingStory(true);
    try {
      const distKm = Math.max(0, Number(storyDistanceKm) || 0);
      const durSec = Math.max(0, Math.round((Number(storyDurationMin) || 0) * 60));
      const paceSec = distKm > 0 && durSec > 0 ? Math.round(durSec / distKm) : 0;
      const speedKmh = distKm > 0 && durSec > 0 ? distKm / (durSec / 3600) : 0;
      const rateLabel =
        distKm > 0 && durSec > 0
          ? formatWorkoutPrimaryRate({
              workoutType: storyWorkoutType,
              avgPaceSecPerKm: paceSec,
              avgSpeedKmh: speedKmh,
              unit: preferredUnit,
            })
          : undefined;
      await createRunStory(
        { uid: userId, displayName: userName, photoURL: userPhotoUrl },
        {
          workoutType: storyWorkoutType,
          headline: storyHeadline.trim() || `Daily ${getWorkoutMeta(storyWorkoutType).label} Story`,
          caption: storyCaption.trim() || undefined,
          distanceKm: distKm,
          durationSec: durSec,
          paceLabel: rateLabel,
          themeColor: storyTheme,
          encodedPolyline: storyPolyline || undefined,
        }
      );
      setShowStoryComposer(false);
      setStoryCaption('');
      showToast('ok', '24-hour Workout Story published!');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Could not publish story.');
    } finally {
      setPostingStory(false);
    }
  };

  const handleSendTextDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireVerifiedAction() || !userId || !selectedFriendship || !dmText.trim()) return;
    setSendingDm(true);
    try {
      await sendDmMessage(
        selectedFriendship.id,
        selectedFriendship,
        { uid: userId, displayName: userName },
        { messageType: 'text', text: dmText }
      );
      setDmText('');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSendingDm(false);
    }
  };

  const handleSendPersonalInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireVerifiedAction() || !userId || !selectedFriendship) return;
    const finalDistKm =
      inviteUseCustomDist && Number(inviteCustomDist) >= 1
        ? Math.min(250, Number(inviteCustomDist))
        : inviteDistanceKm;
    const attachedRoute = savedRoutes.find((r) => r.id === inviteRouteId);
    const effectiveWorkout = normalizeWorkoutType(attachedRoute?.workoutType ?? inviteWorkoutType);
    const sportMeta = getWorkoutMeta(effectiveWorkout);
    setSendingDm(true);
    try {
      await sendDmMessage(
        selectedFriendship.id,
        selectedFriendship,
        { uid: userId, displayName: userName },
        {
          messageType: 'run_invite',
          workoutType: effectiveWorkout,
          text:
            inviteNote.trim() ||
            `Hey! Want to ${sportMeta.verb.toLowerCase()} ${finalDistKm} km together at ${inviteMeetingPoint}?`,
          inviteDistanceKm: finalDistKm,
          inviteTitle: inviteTitle.trim() || `${finalDistKm}K ${activeCity.name} ${sportMeta.fullLabel}`,
          inviteDateTime: inviteDateTime || defaultTomorrowMorningIso(),
          inviteMeetingPoint: inviteMeetingPoint.trim() || defaultMeetingPoint,
          inviteRouteName: attachedRoute?.name,
          inviteEncodedPolyline: attachedRoute?.encodedPolyline,
        }
      );
      setShowInviteForm(false);
      setInviteNote('');
      showToast(
        'ok',
        `Sent ${finalDistKm}K ${sportMeta.label.toLowerCase()} invite to ${selectedFriendDisplay?.name || 'friend'}!`
      );
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Could not send personal workout invite.');
    } finally {
      setSendingDm(false);
    }
  };

  const handleLaunchInviteRoute = (msg: DmMessageDoc) => {
    const distKm = msg.inviteDistanceKm || 5;
    const wt = normalizeWorkoutType(msg.workoutType);
    const sportMeta = getWorkoutMeta(wt);
    if (msg.inviteEncodedPolyline) {
      const pts = decodePolyline(msg.inviteEncodedPolyline);
      if (pts.length >= 2) {
        const cand: GeneratedRouteCandidate = {
          id: `dm_${msg.id}`,
          workoutType: wt,
          label: 'DM Invite',
          name: msg.inviteRouteName || msg.inviteTitle || `${distKm}K ${sportMeta.label}`,
          routeType: 'circular',
          distanceMeters: Math.round(distKm * 1000),
          targetDistanceMeters: Math.round(distKm * 1000),
          durationSec: estimateDurationSecForWorkout(Math.round(distKm * 1000), wt, 'moderate'),
          elevationGainMeters: null,
          start: { name: msg.inviteMeetingPoint || activeCity.name, ...pts[0] },
          end: { name: msg.inviteMeetingPoint || activeCity.name, ...pts[pts.length - 1] },
          encodedPolyline: msg.inviteEncodedPolyline,
          path: pts,
          steps: [],
          kmMarkers: [],
          characteristics: [],
          surfaceSummary: `Personal ${sportMeta.label} Invite · ${msg.senderName}`,
          preferences: [],
          difficulty: 'moderate',
          toleranceDiffPct: 0,
        };
        onStartRoute(cand);
        return;
      }
    }
    if (onPlanDistance) {
      onPlanDistance(distKm, msg.inviteMeetingPoint || defaultMeetingPoint, wt);
    } else {
      onStartRoute(undefined as unknown as GeneratedRouteCandidate);
    }
  };

  const liveFriendByUid = useMemo(() => {
    const map = new Map<string, LiveBeaconDoc>();
    for (const b of liveFriends) map.set(b.uid, b);
    return map;
  }, [liveFriends]);

  const focusedLiveBeacon = useMemo(() => {
    if (liveFriends.length === 0) return null;
    return liveFriends.find((b) => b.uid === focusedLiveUid) || liveFriends[0];
  }, [liveFriends, focusedLiveUid]);

  const stopDmLiveLocation = async () => {
    if (dmLiveWatchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(dmLiveWatchRef.current);
      dmLiveWatchRef.current = null;
    }
    setDmLiveSharingTo(null);
    if (userId) {
      await stopLiveBeacon(userId);
    }
  };

  useEffect(() => {
    return () => {
      if (dmLiveWatchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(dmLiveWatchRef.current);
        dmLiveWatchRef.current = null;
      }
      if (dmLiveSharingTo && userId) {
        void stopLiveBeacon(userId);
      }
    };
  }, [dmLiveSharingTo, userId]);

  const captureCurrentGpsForDm = () => {
    if (!navigator.geolocation) {
      showToast('err', 'Geolocation is unavailable in this browser.');
      return;
    }
    setLocatingPin(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCapturedPin({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
        setLocatingPin(false);
      },
      (err) => {
        setLocatingPin(false);
        showToast(
          'err',
          err.code === 1
            ? 'Location permission denied. Allow location access in your browser to share GPS.'
            : 'Unable to acquire GPS fix right now. Try again in a moment.'
        );
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 5000 }
    );
  };

  const handleSendDmLocationPin = async (isLive: boolean) => {
    if (!requireVerifiedAction() || !userId || !selectedFriendship || !selectedFriendDisplay) return;
    if (!capturedPin) {
      captureCurrentGpsForDm();
      return;
    }
    setSendingDm(true);
    try {
      const cleanLabel = locationLabelInput.trim() || 'Current GPS Location';
      await sendDmMessage(
        selectedFriendship.id,
        selectedFriendship,
        { uid: userId, displayName: userName },
        {
          messageType: 'location',
          text:
            locationNoteInput.trim() ||
            (isLive
              ? `Sharing my live location from ${cleanLabel} — tap View on Map to follow!`
              : `Pinned location: ${cleanLabel}`),
          locationLat: capturedPin.lat,
          locationLng: capturedPin.lng,
          locationLabel: cleanLabel,
          locationIsLive: isLive,
        }
      );

      if (isLive) {
        const startedAtMs = Date.now();
        dmLiveLastPushRef.current = startedAtMs;
        setDmLiveSharingTo({
          uid: selectedFriendDisplay.uid,
          name: selectedFriendDisplay.name,
          startedAtMs,
        });
        await upsertLiveBeacon(userId, {
          displayName: userName,
          photoURL: userPhotoUrl,
          lat: capturedPin.lat,
          lng: capturedPin.lng,
          distanceMeters: 0,
          elapsedSec: 0,
          currentSpeedKmh: 0,
          routeName: cleanLabel,
          status: 'active',
          shareScope: 'selected',
          allowedUids: [selectedFriendDisplay.uid],
        });

        if (dmLiveWatchRef.current !== null && navigator.geolocation) {
          navigator.geolocation.clearWatch(dmLiveWatchRef.current);
        }
        if (navigator.geolocation) {
          dmLiveWatchRef.current = navigator.geolocation.watchPosition(
            (pos) => {
              const now = Date.now();
              if (now - dmLiveLastPushRef.current < 4000) return;
              dmLiveLastPushRef.current = now;
              const speedKmh =
                typeof pos.coords.speed === 'number' && pos.coords.speed > 0
                  ? Number((pos.coords.speed * 3.6).toFixed(1))
                  : 0;
              void upsertLiveBeacon(userId, {
                displayName: userName,
                photoURL: userPhotoUrl,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                heading: typeof pos.coords.heading === 'number' ? pos.coords.heading : undefined,
                distanceMeters: 0,
                elapsedSec: Math.round((now - startedAtMs) / 1000),
                currentSpeedKmh: speedKmh,
                routeName: cleanLabel,
                status: 'active',
                shareScope: 'selected',
                allowedUids: [selectedFriendDisplay.uid],
              }).catch(() => {});
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 2500, timeout: 10000 }
          );
        }
        showToast('ok', `Sharing live location with ${selectedFriendDisplay.name}!`);
      } else {
        showToast('ok', `Sent location pin to ${selectedFriendDisplay.name}!`);
      }

      setShowLocationDrawer(false);
      setLocationNoteInput('');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Could not share location.');
    } finally {
      setSendingDm(false);
    }
  };

  const activeStory = viewingStoryIdx !== null ? stories[viewingStoryIdx] || null : null;
  const activeStoryTheme =
    STORY_THEMES.find((t) => t.id === activeStory?.themeColor) || STORY_THEMES[0];

  return (
    <div className="space-y-6">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141F1B]">
            Social · Friends, Daily Runs &amp; Stories
          </h1>
          <p className="text-sm text-[#5B6B64]">
            Add running partners worldwide, send personal run invites in DMs, share daily runs, and post 24h stories
          </p>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl border border-[#E5E3DC] bg-white p-1">
          <button
            type="button"
            onClick={() => setSubTab('feed')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold ${
              subTab === 'feed' ? 'bg-[#172D27] text-[#9AE62E]' : 'text-[#5B6B64]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Daily Runs ({posts.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('clubs')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold ${
              subTab === 'clubs' ? 'bg-[#172D27] text-[#9AE62E]' : 'text-[#5B6B64]'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Clubs
          </button>
          <button
            type="button"
            onClick={() => setSubTab('friends')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold ${
              subTab === 'friends' ? 'bg-[#172D27] text-[#9AE62E]' : 'text-[#5B6B64]'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Friends ({acceptedFriends.length})
            {incomingRequests.length > 0 && (
              <span className="ml-0.5 rounded bg-[#9AE62E] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#172D27]">
                {incomingRequests.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('messages')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold ${
              subTab === 'messages' ? 'bg-[#172D27] text-[#9AE62E]' : 'text-[#5B6B64]'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            DMs &amp; Invites
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold ${
            feedback.type === 'ok'
              ? 'border-[#30483E]/30 bg-[#EBF5EE] text-[#172D27]'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Search Friends by @username or Name + My Unique @username Bar */}
      <section className="rounded-2xl border border-[#E5E3DC] bg-white p-4 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Global Friend & @username Search Bar */}
          <div className="flex-1">
            <div className="flex min-h-[46px] items-center rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3.5 focus-within:border-[#172D27] focus-within:bg-white">
              <Search className="mr-2.5 h-4 w-4 shrink-0 text-[#5B6B64]" />
              <input
                type="text"
                value={socialSearch}
                onChange={(e) => setSocialSearch(e.target.value)}
                placeholder={
                  userId
                    ? 'Search friends or find runners by @username or name...'
                    : 'Sign in to search friends by @username...'
                }
                className="w-full bg-transparent text-xs font-medium text-[#141F1B] placeholder:text-[#5B6B64] focus:outline-none sm:text-sm"
              />
              {socialSearch && (
                <button
                  type="button"
                  aria-label="Clear friend search"
                  onClick={() => setSocialSearch('')}
                  className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#5B6B64] hover:bg-[#E5E3DC]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* User's Own Unique @username Badge & Quick Claim/Edit */}
          {userId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] px-3 py-2 lg:justify-end">
              <div className="flex items-center gap-2">
                <AtSign className="h-4 w-4 shrink-0 text-[#172D27]" />
                {username ? (
                  <span className="font-mono text-xs font-bold text-[#172D27]">@{username}</span>
                ) : (
                  <span className="text-xs font-semibold text-[#5B6B64]">No @username set</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {username && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!navigator.clipboard) return;
                      void navigator.clipboard.writeText(`@${username}`).then(() => {
                        setCopiedHandle(true);
                        window.setTimeout(() => setCopiedHandle(false), 1800);
                      });
                    }}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-[#D9D7CE] bg-white px-2.5 text-[11px] font-semibold text-[#141F1B] hover:bg-[#EBF5EE]"
                  >
                    {copiedHandle ? (
                      <>
                        <Check className="h-3 w-3 text-[#30483E]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setHandleDraft(username || '');
                    setEditingHandle((v) => !v);
                  }}
                  className="inline-flex min-h-[32px] items-center rounded-lg bg-[#172D27] px-2.5 text-[11px] font-bold text-[#9AE62E]"
                >
                  {editingHandle ? 'Close' : username ? 'Change Handle' : 'Set @username'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="min-h-[44px] shrink-0 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E]"
            >
              Sign In to Claim @username
            </button>
          )}
        </div>

        {/* Inline Claim / Change @username Form */}
        {userId && editingHandle && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!userId) return;
              const norm = normalizeUsername(handleDraft);
              if (!isValidUsernameFormat(norm)) {
                showToast('err', 'Use 3–24 lowercase letters, numbers, or underscores.');
                return;
              }
              setSavingHandle(true);
              try {
                await claimUsername(userId, norm, userName);
                await onRefreshProfile?.();
                setEditingHandle(false);
                showToast('ok', `Your unique handle is now @${norm}!`);
              } catch (err) {
                showToast('err', err instanceof Error ? err.message : 'Could not update @username.');
              } finally {
                setSavingHandle(false);
              }
            }}
            className="rounded-xl border border-[#172D27]/20 bg-[#F6F5F0] p-3 space-y-2"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex min-h-[42px] flex-1 items-center rounded-xl border border-[#D9D7CE] bg-white px-3 focus-within:border-[#172D27]">
                <AtSign className="mr-1.5 h-4 w-4 shrink-0 text-[#5B6B64]" />
                <input
                  type="text"
                  value={handleDraft}
                  onChange={(e) =>
                    setHandleDraft(
                      e.target.value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '')
                    )
                  }
                  placeholder="choose_unique_username"
                  maxLength={24}
                  className="w-full bg-transparent font-mono text-xs font-semibold text-[#141F1B] focus:outline-none sm:text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={
                  savingHandle ||
                  !isValidUsernameFormat(normalizeUsername(handleDraft)) ||
                  handleCheck.state === 'taken' ||
                  handleCheck.state === 'invalid' ||
                  handleCheck.state === 'checking'
                }
                className="min-h-[42px] shrink-0 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E] disabled:opacity-50"
              >
                {savingHandle ? 'Saving...' : 'Save @username'}
              </button>
            </div>
            {handleCheck.state !== 'idle' && handleCheck.message && (
              <p
                className={`flex items-center gap-1 text-[11px] font-semibold ${
                  handleCheck.state === 'available' || handleCheck.state === 'own'
                    ? 'text-[#30483E]'
                    : handleCheck.state === 'checking'
                    ? 'text-[#5B6B64]'
                    : 'text-red-700'
                }`}
              >
                {(handleCheck.state === 'taken' || handleCheck.state === 'invalid') && (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                {(handleCheck.state === 'available' || handleCheck.state === 'own') && (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                )}
                {handleCheck.message}
              </p>
            )}
          </form>
        )}

        {/* Instant Global Search Results */}
        {socialSearch.trim().length > 0 && (
          <div className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-3.5 space-y-3">
            {!userId ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5B6B64]">
                <span>Sign in to search friends and runners by @username.</span>
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="min-h-[36px] rounded-lg bg-[#172D27] px-3 text-xs font-bold text-[#9AE62E]"
                >
                  Sign In
                </button>
              </div>
            ) : (
              <>
                {/* Connected Friends Matching Search */}
                {matchingAcceptedFriends.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#30483E]">
                      Your Running Friends ({matchingAcceptedFriends.length})
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {matchingAcceptedFriends.map((f) => {
                        const otherUid = f.fromUid === userId ? f.toUid : f.fromUid;
                        const friendName = f.fromUid === userId ? f.toName : f.fromName;
                        const handle = runnerByUid.get(otherUid)?.username;
                        return (
                          <div
                            key={f.id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-[#E5E3DC] bg-white p-2.5"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <RunnerAvatar
                                src={
                                  runnerByUid.get(otherUid)?.photoURL ||
                                  (f.fromUid === userId ? f.toPhotoUrl : f.fromPhotoUrl)
                                }
                                name={friendName}
                                sizeClass="h-9 w-9"
                                textSizeClass="text-xs"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-[#141F1B]">{friendName}</p>
                                {handle ? (
                                  <p className="truncate font-mono text-[11px] text-[#30483E]">@{handle}</p>
                                ) : (
                                  <p className="truncate text-[11px] text-[#5B6B64]">Running friend</p>
                                )}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedThreadId(f.id);
                                  setSubTab('messages');
                                  setShowLocationDrawer(false);
                                  setShowInviteForm(false);
                                }}
                                className="min-h-[34px] rounded-lg bg-[#172D27] px-2.5 text-[11px] font-bold text-[#9AE62E]"
                              >
                                DM
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedThreadId(f.id);
                                  setSubTab('messages');
                                  setShowInviteForm(true);
                                  setShowLocationDrawer(false);
                                }}
                                className="min-h-[34px] rounded-lg border border-[#D9D7CE] bg-white px-2 text-[11px] font-semibold text-[#141F1B]"
                              >
                                Invite
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Other Runners / Exact @username Lookup */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#5B6B64]">
                      Discover Runners ({matchingDiscoverRunners.length})
                    </p>
                    {exactLookupLoading && (
                      <span className="text-[11px] text-[#5B6B64]">Checking @username...</span>
                    )}
                  </div>
                  {matchingDiscoverRunners.length === 0 ? (
                    matchingAcceptedFriends.length === 0 && (
                      <p className="text-xs text-[#5B6B64]">
                        No runners found matching &ldquo;{socialSearch.trim()}&rdquo;. Ask your friend for their exact @username (e.g. @rahul_run).
                      </p>
                    )
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {matchingDiscoverRunners.map((runner) => {
                        const existingReq = requestByOtherUid.get(runner.uid);
                        const isExactHandle =
                          exactLookupRunner?.uid === runner.uid ||
                          (runner.username &&
                            runner.username.toLowerCase() === normalizeUsername(socialSearch));
                        return (
                          <div
                            key={runner.uid}
                            className="flex items-center justify-between gap-2 rounded-xl border border-[#E5E3DC] bg-white p-2.5"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <RunnerAvatar
                                src={runner.photoURL}
                                name={runner.displayName}
                                sizeClass="h-9 w-9"
                                bgClass="bg-[#30483E] text-white"
                                textSizeClass="text-xs"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate text-xs font-bold text-[#141F1B]">
                                    {runner.displayName}
                                  </p>
                                  {isExactHandle && (
                                    <span className="shrink-0 rounded bg-[#EBF5EE] px-1.5 py-0.5 text-[9px] font-bold text-[#172D27]">
                                      Exact @
                                    </span>
                                  )}
                                </div>
                                <p className="truncate font-mono text-[11px] text-[#5B6B64]">
                                  {runner.username ? `@${runner.username} · ` : ''}
                                  {runner.city || 'World'} · {(runner.totalDistanceKm || 0).toFixed(1)} km
                                </p>
                                {runner.bio && (
                                  <p className="mt-1 line-clamp-1 text-[11px] text-[#141F1B]">
                                    {runner.bio}
                                  </p>
                                )}
                                {runner.bioTags && runner.bioTags.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {runner.bioTags.slice(0, 3).map((tag) => (
                                      <span
                                        key={tag}
                                        className="rounded bg-[#EBF5EE] px-1.5 py-0.5 text-[10px] font-semibold text-[#172D27]"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                    {runner.bioTags.length > 3 && (
                                      <span className="rounded bg-[#F6F5F0] px-1.5 py-0.5 text-[10px] font-semibold text-[#5B6B64]">
                                        +{runner.bioTags.length - 3}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {existingReq?.status === 'pending' ? (
                              existingReq.fromUid === userId ? (
                                <span className="shrink-0 rounded-lg border border-[#D9D7CE] bg-[#F6F5F0] px-2.5 py-1.5 text-[11px] font-semibold text-[#5B6B64]">
                                  Sent
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!requireVerifiedAction()) return;
                                    await respondFriendRequest(existingReq.id, 'accepted');
                                    showToast('ok', `You and ${runner.displayName} are now friends!`);
                                  }}
                                  className="shrink-0 rounded-lg bg-[#172D27] px-2.5 py-1.5 text-[11px] font-bold text-[#9AE62E]"
                                >
                                  Accept
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!requireVerifiedAction() || !userId) return;
                                  try {
                                    await sendFriendRequest(
                                      { uid: userId, displayName: userName, photoURL: userPhotoUrl },
                                      { uid: runner.uid, displayName: runner.displayName, photoURL: runner.photoURL }
                                    );
                                    showToast('ok', `Friend request sent to ${runner.displayName}!`);
                                  } catch (err) {
                                    showToast(
                                      'err',
                                      err instanceof Error ? err.message : 'Could not send request.'
                                    );
                                  }
                                }}
                                className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg bg-[#172D27] px-2.5 text-[11px] font-bold text-[#9AE62E]"
                              >
                                <UserPlus className="h-3.5 w-3.5" />
                                Add
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* 24-Hour Run Stories Tray */}
      <section className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-[#141F1B]">24h Run Stories</h2>
            <p className="text-[11px] text-[#5B6B64]">Quick route moments that disappear after 24 hours</p>
          </div>
          <span className="font-mono text-[11px] font-semibold text-[#5B6B64] tabular-nums">
            {stories.length} active
          </span>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-1">
          {/* Add Story Card */}
          <button
            type="button"
            onClick={() => {
              if (!requireVerifiedAction()) return;
              if (runs.length > 0 && storyRunId === 'custom') {
                handleSelectRunForStory(runs[0].id);
              }
              setShowStoryComposer(true);
            }}
            className="flex h-28 w-24 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#172D27]/35 bg-[#F6F5F0] p-2 text-center transition hover:border-[#172D27]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#172D27] text-[#9AE62E]">
              <Plus className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-bold text-[#172D27]">Add Story</span>
          </button>

          {stories.length === 0 ? (
            <div className="flex h-28 flex-1 items-center rounded-2xl bg-[#F6F5F0] px-4 text-xs text-[#5B6B64]">
              No active stories yet. Share a 24h highlight from your latest {activeCity.name} run!
            </div>
          ) : (
            stories.map((story, idx) => {
              const theme = STORY_THEMES.find((t) => t.id === story.themeColor) || STORY_THEMES[0];
              return (
                <button
                  key={story.id}
                  type="button"
                  onClick={() => setViewingStoryIdx(idx)}
                  className={`relative flex h-28 w-24 shrink-0 flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br ${theme.bgClass} p-2.5 text-left shadow-sm ring-2 ring-[#9AE62E]/70 ring-offset-2 transition hover:scale-[1.02]`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`truncate text-[10px] font-bold ${theme.accentClass}`}>
                      {story.distanceKm}K
                    </span>
                    <span className={`text-[9px] opacity-80 ${theme.textClass}`}>
                      {formatTimestampSafe(story.createdAt)}
                    </span>
                  </div>
                  <div>
                    <p className={`line-clamp-2 text-[11px] font-bold leading-tight ${theme.textClass}`}>
                      {story.headline}
                    </p>
                    <p className={`mt-1 truncate text-[10px] opacity-85 ${theme.textClass}`}>
                      {story.authorName.split(' ')[0]}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* FRIENDS RUNNING LIVE NOW MAP PANEL */}
      {liveFriends.length > 0 && (
        <section className="rounded-2xl border border-[#172D27]/25 bg-white p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#172D27] text-[#9AE62E]">
                <Radio className="h-4 w-4 animate-pulse" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-[#141F1B]">
                  Friends Sharing Live Location ({liveFriends.length})
                </h2>
                <p className="text-xs text-[#5B6B64]">
                  Real-time GPS markers update automatically as your friends run
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="overflow-hidden rounded-2xl border border-[#E5E3DC] lg:col-span-7">
              <TricityMap
                liveFriends={liveFriends}
                fallbackCenter={{ lat: activeCity.lat, lng: activeCity.lng }}
                focusCenter={
                  focusedLiveBeacon
                    ? { lat: focusedLiveBeacon.lat, lng: focusedLiveBeacon.lng }
                    : undefined
                }
                focusZoom={15}
                heightClass="h-[250px] sm:h-[300px]"
              />
            </div>

            <div className="space-y-2.5 lg:col-span-5 max-h-[300px] overflow-y-auto pr-0.5">
              {liveFriends.map((b) => {
                const isFocused = focusedLiveBeacon?.uid === b.uid;
                const liveMeta = getWorkoutMeta(b.workoutType);
                const liveRateLabel =
                  liveMeta.primaryMetric === 'speed'
                    ? formatSpeed(b.currentSpeedKmh, preferredUnit)
                    : b.currentSpeedKmh > 0.3
                    ? `${formatPace(3600 / b.currentSpeedKmh, preferredUnit)}/${preferredUnit}`
                    : formatSpeed(b.currentSpeedKmh, preferredUnit);
                const friendship = acceptedFriends.find(
                  (fr) => fr.fromUid === b.uid || fr.toUid === b.uid
                );
                return (
                  <div
                    key={b.uid}
                    className={`rounded-xl border p-3 transition ${
                      isFocused
                        ? 'border-[#172D27] bg-[#EBF5EE]'
                        : 'border-[#E5E3DC] bg-[#F6F5F0]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          <p className="truncate text-sm font-bold text-[#141F1B]">{b.displayName}</p>
                        </div>
                        <p className="flex items-center gap-1 truncate text-[11px] font-medium text-[#5B6B64]">
                          <WorkoutIcon type={liveMeta.id} className="h-3 w-3 shrink-0 text-[#172D27]" />
                          <span className="truncate">
                            {liveMeta.label} · {b.routeName} · {b.status === 'paused' ? 'Paused' : 'Active'}
                          </span>
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-[#172D27] px-2 py-0.5 font-mono text-[10px] font-bold text-[#9AE62E] tabular-nums">
                        {formatDistance(b.distanceMeters, preferredUnit)}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-mono text-[#30483E] tabular-nums">
                      <span>
                        {liveRateLabel} · {formatDuration(b.elapsedSec)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setFocusedLiveUid(b.uid)}
                          className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-[#D9D7CE] bg-white px-2.5 font-sans text-[11px] font-bold text-[#172D27]"
                        >
                          <LocateFixed className="h-3 w-3" />
                          Center
                        </button>
                        {friendship && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedThreadId(friendship.id);
                              setSubTab('messages');
                            }}
                            className="inline-flex min-h-[30px] items-center gap-1 rounded-lg bg-[#172D27] px-2.5 font-sans text-[11px] font-bold text-[#9AE62E]"
                          >
                            <MessageSquare className="h-3 w-3" />
                            DM
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* TAB 1: DAILY RUNS FEED */}
      {subTab === 'clubs' && (
        <ClubsSection
          userId={userId}
          userName={userName}
          emailVerified={emailVerified}
          defaultCity={activeCity.name}
          defaultWorkoutType={defaultWorkoutType}
          onOpenAuth={onOpenAuth}
          onNotify={showToast}
        />
      )}

      {subTab === 'feed' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5E3DC] bg-white p-4">
            <div>
              <h2 className="font-display text-base font-bold text-[#141F1B]">Daily Run Feed</h2>
              <p className="text-xs text-[#5B6B64]">
                Post your completed daily run, GPS route snapshot, and running vibe
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!requireVerifiedAction()) return;
                if (runs.length > 0 && postRunId === 'custom') {
                  handleSelectRunForPost(runs[0].id);
                }
                setShowPostComposer((v) => !v);
              }}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E]"
            >
              <Plus className="h-4 w-4" />
              {showPostComposer ? 'Close Composer' : 'Post Daily Run'}
            </button>
          </div>

          {showPostComposer && (
            <form
              onSubmit={handleCreatePost}
              className="space-y-4 rounded-2xl border border-[#172D27]/30 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-bold text-[#141F1B]">Share Recorded Workout</h3>
                  <p className="text-[11px] text-[#5B6B64]">
                    Only verified GPS workouts can be posted · Workout stats are locked
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPostComposer(false)}
                  className="text-xs font-semibold text-[#5B6B64]"
                >
                  Cancel
                </button>
              </div>

              {runs.length === 0 && !draftRun ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                  You don&apos;t have any recorded GPS workouts yet. Complete a run, ride, or walk first so your verified route map and stats can be shared to the community feed.
                </div>
              ) : (
                <>
                  {runs.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-[#5B6B64]">
                        Select Recorded Activity
                      </label>
                      <select
                        value={postRunId}
                        onChange={(e) => handleSelectRunForPost(e.target.value)}
                        className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-xs font-medium text-[#141F1B]"
                      >
                        {runs.slice(0, 15).map((r) => (
                          <option key={r.id} value={r.id}>
                            [{getWorkoutMeta(r.workoutType).label}] {r.routeName} — {(r.distanceMeters / 1000).toFixed(2)} km ({formatDuration(r.durationSec)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Read-Only Verified Workout Card */}
                  <div className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0]/80 p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-[#172D27] px-2 py-1 text-[10px] font-bold text-[#9AE62E]">
                          <WorkoutIcon type={postWorkoutType} className="h-3 w-3" />
                          {getWorkoutMeta(postWorkoutType).label}
                        </span>
                        <span className="truncate font-display text-sm font-bold text-[#141F1B]">
                          {postTitle}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#5B6B64]">
                        <Lock className="h-3 w-3" />
                        Verified Stats (Locked)
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center tabular-nums sm:grid-cols-4">
                      <div className="rounded-lg bg-white p-2">
                        <p className="text-[10px] text-[#5B6B64]">Distance</p>
                        <p className="font-mono text-xs font-bold text-[#172D27]">{postDistanceKm} km</p>
                      </div>
                      <div className="rounded-lg bg-white p-2">
                        <p className="text-[10px] text-[#5B6B64]">Duration</p>
                        <p className="font-mono text-xs font-bold text-[#141F1B]">{postDurationMin} min</p>
                      </div>
                      <div className="rounded-lg bg-white p-2">
                        <p className="text-[10px] text-[#5B6B64]">Area</p>
                        <p className="truncate text-xs font-bold text-[#141F1B]">{postStartName}</p>
                      </div>
                      {typeof postElevationGain === 'number' && postElevationGain > 0 && (
                        <div className="rounded-lg bg-white p-2">
                          <p className="text-[10px] text-[#5B6B64]">Elev Gain</p>
                          <p className="font-mono text-xs font-bold text-[#172D27]">+{Math.round(postElevationGain)} m</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mood Tag */}
                  <div>
                    <label className="text-xs font-semibold text-[#5B6B64]">Mood Tag</label>
                    <select
                      value={postMood}
                      onChange={(e) => setPostMood(e.target.value)}
                      className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-sm"
                    >
                      {MOOD_TAGS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Caption */}
                  <div>
                    <label className="text-xs font-semibold text-[#5B6B64]">Caption / How did it feel?</label>
                    <textarea
                      rows={2}
                      required
                      maxLength={400}
                      value={postCaption}
                      onChange={(e) => setPostCaption(e.target.value)}
                      placeholder="Breezy morning along the park footpath, sunrise views..."
                      className="mt-1 w-full rounded-xl border border-[#D9D7CE] p-3 text-sm"
                    />
                  </div>

                  {/* Running Shoe (optional) */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-[#5B6B64]">
                      <Footprints className="h-3.5 w-3.5 text-[#30483E]" />
                      Running Shoe (optional)
                    </label>
                    {savedShoes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {savedShoes.map((shoe) => {
                          const selected =
                            postShoeName.trim().toLowerCase() === shoe.name.trim().toLowerCase() &&
                            postShoeBrand.trim().toLowerCase() === (shoe.brand || '').trim().toLowerCase();
                          return (
                            <button
                              key={shoe.id}
                              type="button"
                              onClick={() => {
                                setPostShoeBrand(shoe.brand || '');
                                setPostShoeName(shoe.name);
                              }}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                                selected
                                  ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                                  : 'border-[#D9D7CE] bg-[#F6F5F0] text-[#141F1B] hover:border-[#30483E]'
                              }`}
                            >
                              {shoe.brand ? `${shoe.brand} ${shoe.name}` : shoe.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        maxLength={40}
                        value={postShoeBrand}
                        onChange={(e) => setPostShoeBrand(e.target.value)}
                        placeholder="Shoe Brand (e.g. Nike)"
                        className="min-h-[40px] rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs text-[#141F1B]"
                      />
                      <input
                        type="text"
                        maxLength={80}
                        value={postShoeName}
                        onChange={(e) => setPostShoeName(e.target.value)}
                        placeholder="Shoe Model (e.g. Pegasus 41)"
                        className="min-h-[40px] rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs text-[#141F1B]"
                      />
                    </div>
                  </div>

                  {/* Phone Photo Upload */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-[#5B6B64]">
                        <Camera className="h-3.5 w-3.5 text-[#30483E]" />
                        Workout Photos (up to {MAX_RUN_PHOTOS})
                      </label>
                      <button
                        type="button"
                        disabled={uploadingPostPhoto || postPhotos.length >= MAX_RUN_PHOTOS}
                        onClick={() => postPhotoInputRef.current?.click()}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-xs font-semibold text-[#141F1B] hover:bg-[#E5E3DC] disabled:opacity-50"
                      >
                        {uploadingPostPhoto ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ImagePlus className="h-3.5 w-3.5 text-[#30483E]" />
                        )}
                        {uploadingPostPhoto ? 'Processing...' : `Add Photos (${postPhotos.length}/${MAX_RUN_PHOTOS})`}
                      </button>
                    </div>
                    <input
                      ref={postPhotoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePostPhotoFiles}
                      className="hidden"
                    />
                    {postPhotos.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {postPhotos.map((src, idx) => (
                          <div
                            key={idx}
                            className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[#E5E3DC] bg-[#F6F5F0]"
                          >
                            <img
                              src={src}
                              alt={`Workout photo ${idx + 1}`}
                              className="h-full w-full object-cover"
                            />
                            <button
                              type="button"
                              aria-label={`Remove photo ${idx + 1}`}
                              onClick={() =>
                                setPostPhotos((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white hover:bg-red-600"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={posting || uploadingPostPhoto}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#172D27] px-5 text-xs font-bold text-[#9AE62E] disabled:opacity-60"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {posting ? 'Publishing...' : 'Publish Workout'}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}

          {posts.filter((p) => {
            if (p.visibility !== 'friends') return true;
            if (!userId) return false;
            if (p.authorUid === userId) return true;
            return acceptedFriends.some((f) => f.fromUid === p.authorUid || f.toUid === p.authorUid);
          }).length === 0 ? (
            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
              <p className="font-display text-base font-bold text-[#141F1B]">No daily runs posted yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-[#5B6B64]">
                Be the first runner to post today&apos;s workout or share straight after finishing a GPS run!
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {posts
                .filter((p) => {
                  if (p.visibility !== 'friends') return true;
                  if (!userId) return false;
                  if (p.authorUid === userId) return true;
                  return acceptedFriends.some((f) => f.fromUid === p.authorUid || f.toUid === p.authorUid);
                })
                .map((post) => {
                const isOwn = post.authorUid === userId;
                const liked = likedPostIds.has(post.id);
                const postMeta = getWorkoutMeta(post.workoutType);
                const postSpeedKmh =
                  post.distanceKm > 0 && post.durationSec > 0
                    ? post.distanceKm / (post.durationSec / 3600)
                    : 0;
                const postPrimaryRate = formatWorkoutPrimaryRate({
                  workoutType: postMeta.id,
                  avgPaceSecPerKm: post.avgPaceSecPerKm,
                  avgSpeedKmh: postSpeedKmh,
                  unit: preferredUnit,
                });
                return (
                  <article
                    key={post.id}
                    className="flex flex-col justify-between rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <RunnerAvatar
                            src={runnerByUid.get(post.authorUid)?.photoURL || post.authorPhotoUrl}
                            name={post.authorName}
                            sizeClass="h-10 w-10"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-[#141F1B]">{post.authorName}</p>
                            <p className="truncate text-[11px] text-[#5B6B64]">
                              {formatTimestampSafe(post.createdAt)} · {post.startName}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-lg bg-[#172D27] px-2 py-1 text-[10px] font-bold text-[#9AE62E]">
                            <WorkoutIcon type={postMeta.id} className="h-3 w-3" />
                            {postMeta.label}
                          </span>
                          {post.moodTag && (
                            <span className="rounded-lg bg-[#EBF5EE] px-2 py-1 text-[10px] font-bold text-[#172D27]">
                              {post.moodTag}
                            </span>
                          )}
                          {(post.shoeBrand || post.shoeName) && (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-[#F6F5F0] border border-[#E5E3DC] px-2 py-1 text-[10px] font-bold text-[#172D27]">
                              <Footprints className="h-3 w-3 text-[#30483E]" />
                              {[post.shoeBrand, post.shoeName].filter(Boolean).join(' ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {(() => {
                        const pts = post.encodedPolyline ? decodePolyline(post.encodedPolyline) : [];
                        if (pts.length >= 2) {
                          const mapRoute: GeneratedRouteCandidate = {
                            id: `post-map-${post.id}`,
                            workoutType: postMeta.id,
                            label: postMeta.label,
                            name: post.runTitle,
                            routeType: 'circular',
                            distanceMeters: Math.round(post.distanceKm * 1000),
                            targetDistanceMeters: Math.round(post.distanceKm * 1000),
                            durationSec: post.durationSec,
                            elevationGainMeters: post.elevationGainMeters ?? null,
                            start: { name: post.startName, ...pts[0] },
                            end: { name: post.startName, ...pts[pts.length - 1] },
                            encodedPolyline: post.encodedPolyline || '',
                            path: pts,
                            steps: [],
                            kmMarkers: [],
                            characteristics: [],
                            surfaceSummary: '',
                            preferences: [],
                            difficulty: 'moderate',
                            toleranceDiffPct: 0,
                          };
                          return (
                            <div className="overflow-hidden rounded-xl border border-[#E5E3DC]">
                              <TricityMap
                                routes={[mapRoute]}
                                selectedRouteId={mapRoute.id}
                                preferredUnit={preferredUnit}
                                heightClass="h-[200px]"
                              />
                            </div>
                          );
                        }
                        return null;
                      })()}

                      <div className="flex items-center gap-3 rounded-xl bg-[#F6F5F0] p-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-display text-sm font-bold text-[#141F1B]">
                            {post.runTitle}
                          </h3>
                          <div
                            className={`mt-1.5 grid gap-2 tabular-nums ${
                              typeof post.elevationGainMeters === 'number' && post.elevationGainMeters > 0
                                ? 'grid-cols-4'
                                : 'grid-cols-3'
                            }`}
                          >
                            <div>
                              <p className="text-[10px] text-[#5B6B64]">Distance</p>
                              <p className="font-mono text-xs font-bold text-[#172D27]">
                                {post.distanceKm} km
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[#5B6B64]">Time</p>
                              <p className="font-mono text-xs font-bold text-[#141F1B]">
                                {formatDuration(post.durationSec)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[#5B6B64]">
                                {postMeta.primaryMetric === 'speed' ? 'Speed' : 'Pace'}
                              </p>
                              <p className="font-mono text-xs font-bold text-[#141F1B]">
                                {postPrimaryRate}
                              </p>
                            </div>
                            {typeof post.elevationGainMeters === 'number' && post.elevationGainMeters > 0 && (
                              <div>
                                <p className="text-[10px] text-[#5B6B64]">Elev</p>
                                <p className="font-mono text-xs font-bold text-[#172D27]">
                                  +{Math.round(post.elevationGainMeters)} m
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {post.photos && post.photos.length > 0 && (
                        <div
                          className={`grid gap-2 ${
                            post.photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                          }`}
                        >
                          {post.photos.map((photoSrc, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setLightboxPostPhoto(photoSrc)}
                              className="group aspect-[4/3] overflow-hidden rounded-xl border border-[#E5E3DC] bg-[#F6F5F0]"
                            >
                              <img
                                src={photoSrc}
                                alt={`${post.runTitle} photo ${idx + 1}`}
                                className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                              />
                            </button>
                          ))}
                        </div>
                      )}

                      <p className="text-xs leading-relaxed text-[#141F1B]">{post.caption}</p>
                    </div>

                    <div className="flex items-center justify-between border-t border-[#F0EFEA] pt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!requireVerifiedAction() || !userId) return;
                          const nowLiked = await toggleLikeDailyPost(post.id, userId, userName);
                          setLikedPostIds((prev) => {
                            const next = new Set(prev);
                            if (nowLiked) next.add(post.id);
                            else next.delete(post.id);
                            return next;
                          });
                        }}
                        className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition ${
                          liked
                            ? 'bg-[#172D27] text-[#9AE62E]'
                            : 'border border-[#D9D7CE] text-[#141F1B] hover:bg-[#F6F5F0]'
                        }`}
                      >
                        <Heart className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />
                        Kudos · <span className="font-mono tabular-nums">{post.likeCount}</span>
                      </button>

                      {isOwn && (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteDailyRunPost(post.id);
                            showToast('ok', 'Daily run post deleted.');
                          }}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-[#D9D7CE] px-3 text-xs font-semibold text-[#5B6B64] hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FRIENDS & RUNNER DIRECTORY */}
      {subTab === 'friends' && (
        <div className="space-y-6">
          {!userId ? (
            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
              <p className="font-display text-base font-bold text-[#141F1B]">Sign in to connect with runners</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-[#5B6B64]">
                Send friend requests, accept running buddies, and invite friends to custom-distance runs in their DMs.
              </p>
              <button
                type="button"
                onClick={onOpenAuth}
                className="mt-4 min-h-[44px] rounded-xl bg-[#172D27] px-5 text-xs font-bold text-[#9AE62E]"
              >
                Sign In to Add Friends
              </button>
            </div>
          ) : (
            <>
              {/* Incoming Friend Requests */}
              {incomingRequests.length > 0 && (
                <section className="rounded-2xl border border-[#172D27]/30 bg-white p-5 space-y-3">
                  <h2 className="font-display text-base font-bold text-[#141F1B]">
                    Incoming Friend Requests ({incomingRequests.length})
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {incomingRequests.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-[#F6F5F0] p-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <RunnerAvatar
                            src={runnerByUid.get(req.fromUid)?.photoURL || req.fromPhotoUrl}
                            name={req.fromName}
                            sizeClass="h-10 w-10"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-[#141F1B]">{req.fromName}</p>
                            <p className="truncate text-[11px] text-[#5B6B64]">
                              {runnerByUid.get(req.fromUid)?.username
                                ? `@${runnerByUid.get(req.fromUid)?.username} · Wants to be running friends`
                                : 'Wants to be running friends'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!requireVerifiedAction()) return;
                              await respondFriendRequest(req.id, 'accepted');
                              showToast('ok', `You and ${req.fromName} are now friends!`);
                            }}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-[#172D27] px-3 text-xs font-bold text-[#9AE62E]"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!requireVerifiedAction()) return;
                              await respondFriendRequest(req.id, 'declined');
                            }}
                            className="min-h-[38px] rounded-lg border border-[#D9D7CE] bg-white px-2.5 text-xs font-semibold text-[#5B6B64]"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* My Accepted Friends */}
              <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-3">
                <h2 className="font-display text-base font-bold text-[#141F1B]">
                  My Running Friends ({acceptedFriends.length})
                </h2>
                {acceptedFriends.length === 0 ? (
                  <p className="text-xs text-[#5B6B64]">
                    No friends added yet. Search runners below and send a friend request!
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {acceptedFriends.map((f) => {
                      const otherUid = f.fromUid === userId ? f.toUid : f.fromUid;
                      const friendName = f.fromUid === userId ? f.toName : f.fromName;
                      const friendCard = runnerByUid.get(otherUid);
                      const friendHandle = friendCard?.username;
                      return (
                        <div
                          key={f.id}
                          className="flex flex-col justify-between gap-2.5 rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <RunnerAvatar
                                src={
                                  friendCard?.photoURL ||
                                  (f.fromUid === userId ? f.toPhotoUrl : f.fromPhotoUrl)
                                }
                                name={friendName}
                                sizeClass="h-10 w-10"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-[#141F1B]">{friendName}</p>
                                <p className="truncate font-mono text-[11px] text-[#30483E]">
                                  {friendHandle ? `@${friendHandle}` : 'Connected partner'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedThreadId(f.id);
                                setSubTab('messages');
                                setShowInviteForm(true);
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#172D27] px-2.5 text-[11px] font-bold text-[#9AE62E]"
                            >
                              <MessageSquare className="h-3 w-3" />
                              DM / Invite
                            </button>
                            <button
                              type="button"
                              aria-label="Remove friend"
                              onClick={async () => {
                                await removeFriendshipOrRequest(f.id);
                                showToast('ok', `Removed ${friendName} from friends.`);
                              }}
                              className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-[#D9D7CE] bg-white text-[#5B6B64] hover:text-red-600"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                            </button>
                            </div>
                          </div>
                          {(friendCard?.bio || (friendCard?.bioTags && friendCard.bioTags.length > 0)) && (
                            <div className="border-t border-[#E5E3DC] pt-2 space-y-1.5">
                              {friendCard?.bio && (
                                <p className="line-clamp-2 text-[11px] leading-relaxed text-[#141F1B]">
                                  {friendCard.bio}
                                </p>
                              )}
                              {friendCard?.bioTags && friendCard.bioTags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {friendCard.bioTags.slice(0, 4).map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-md bg-[#EBF5EE] px-1.5 py-0.5 text-[10px] font-semibold text-[#172D27]"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {friendCard.bioTags.length > 4 && (
                                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#5B6B64]">
                                      +{friendCard.bioTags.length - 4}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {outgoingRequests.length > 0 && (
                  <div className="pt-2">
                    <p className="mb-2 text-xs font-semibold text-[#5B6B64]">
                      Sent Pending Requests ({outgoingRequests.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {outgoingRequests.map((req) => (
                        <div
                          key={req.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-3 py-1.5 text-xs"
                        >
                          <span className="font-semibold text-[#141F1B]">{req.toName}</span>
                          <span className="text-[#5B6B64]">Pending</span>
                          <button
                            type="button"
                            onClick={() => void removeFriendshipOrRequest(req.id)}
                            className="text-red-600 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Find Runners Directory */}
              <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display text-base font-bold text-[#141F1B]">Find Runners</h2>
                    <p className="text-xs text-[#5B6B64]">
                      Discover runners in {activeCity.name} and worldwide to add as friends
                    </p>
                  </div>
                  <div className="flex min-h-[42px] items-center rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 sm:w-64">
                    <Search className="mr-2 h-4 w-4 text-[#5B6B64]" />
                    <input
                      type="text"
                      value={runnerSearch}
                      onChange={(e) => setRunnerSearch(e.target.value)}
                      placeholder="Search @username, name, city, or bio tags..."
                      className="w-full bg-transparent text-xs focus:outline-none"
                    />
                  </div>
                </div>

                {filteredDirectory.length === 0 ? (
                  <div className="rounded-xl bg-[#F6F5F0] p-6 text-center text-xs text-[#5B6B64]">
                    {runners.length <= 1
                      ? 'No other runners have signed in yet. Once other runners sign in with their accounts, they will appear right here for friend requests.'
                      : 'No runners match your search filter.'}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredDirectory.map((runner) => {
                      const existingReq = requestByOtherUid.get(runner.uid);
                      return (
                        <div
                          key={runner.uid}
                          className="flex flex-col justify-between gap-2.5 rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-3.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <RunnerAvatar
                                src={runner.photoURL}
                                name={runner.displayName}
                                sizeClass="h-10 w-10"
                                bgClass="bg-[#30483E] text-white"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-[#141F1B]">{runner.displayName}</p>
                                {runner.username && (
                                  <p className="truncate font-mono text-[11px] font-semibold text-[#30483E]">
                                    @{runner.username}
                                  </p>
                                )}
                                <p className="truncate font-mono text-[11px] text-[#5B6B64] tabular-nums">
                                  {runner.city || 'World'} · {runner.totalRuns || 0} runs ·{' '}
                                  {(runner.totalDistanceKm || 0).toFixed(1)} km
                                </p>
                              </div>
                            </div>

                            {existingReq?.status === 'accepted' ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#EBF5EE] px-2.5 py-1.5 text-[11px] font-bold text-[#172D27]">
                                <UserCheck className="h-3.5 w-3.5" />
                                Friends
                              </span>
                            ) : existingReq?.status === 'pending' ? (
                              <span className="shrink-0 rounded-lg border border-[#D9D7CE] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#5B6B64]">
                                {existingReq.fromUid === userId ? 'Sent' : 'Incoming'}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!requireVerifiedAction() || !userId) return;
                                  try {
                                    await sendFriendRequest(
                                      { uid: userId, displayName: userName, photoURL: userPhotoUrl },
                                      { uid: runner.uid, displayName: runner.displayName, photoURL: runner.photoURL }
                                    );
                                    showToast('ok', `Friend request sent to ${runner.displayName}!`);
                                  } catch (err) {
                                    showToast('err', err instanceof Error ? err.message : 'Could not send request.');
                                  }
                                }}
                                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg bg-[#172D27] px-3 text-[11px] font-bold text-[#9AE62E]"
                              >
                                <UserPlus className="h-3.5 w-3.5" />
                                Add
                              </button>
                            )}
                          </div>

                          {(runner.bio || (runner.bioTags && runner.bioTags.length > 0)) && (
                            <div className="border-t border-[#E5E3DC] pt-2 space-y-1.5">
                              {runner.bio && (
                                <p className="line-clamp-2 text-[11px] leading-relaxed text-[#141F1B]">
                                  {runner.bio}
                                </p>
                              )}
                              {runner.bioTags && runner.bioTags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {runner.bioTags.slice(0, 4).map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-md bg-[#EBF5EE] px-1.5 py-0.5 text-[10px] font-semibold text-[#172D27]"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {runner.bioTags.length > 4 && (
                                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#5B6B64]">
                                      +{runner.bioTags.length - 4}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* TAB 3: DIRECT MESSAGES & PERSONAL RUN INVITES */}
      {subTab === 'messages' && (
        <div>
          {!userId ? (
            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
              <p className="font-display text-base font-bold text-[#141F1B]">Sign in for Direct Messages</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-[#5B6B64]">
                Chat 1-to-1 with your accepted friends and send personal run invites for 2K, 5K, 10K, Half Marathon, or custom distances.
              </p>
              <button
                type="button"
                onClick={onOpenAuth}
                className="mt-4 min-h-[44px] rounded-xl bg-[#172D27] px-5 text-xs font-bold text-[#9AE62E]"
              >
                Sign In
              </button>
            </div>
          ) : acceptedFriends.length === 0 ? (
            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center space-y-3">
              <p className="font-display text-base font-bold text-[#141F1B]">Add a friend to start messaging</p>
              <p className="mx-auto max-w-md text-xs text-[#5B6B64]">
                Direct Messages and personal run invites open as soon as a runner accepts your friend request.
              </p>
              <button
                type="button"
                onClick={() => setSubTab('friends')}
                className="min-h-[42px] rounded-xl bg-[#172D27] px-5 text-xs font-bold text-[#9AE62E]"
              >
                Find Runners &amp; Add Friends
              </button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-12">
              {/* Friend Threads List */}
              <aside className="rounded-2xl border border-[#E5E3DC] bg-white p-3 space-y-1.5 lg:col-span-4">
                <p className="px-2 py-1 text-xs font-bold text-[#5B6B64]">
                  Friends ({acceptedFriends.length})
                </p>
                {acceptedFriends.map((f) => {
                  const otherUid = f.fromUid === userId ? f.toUid : f.fromUid;
                  const friendName = f.fromUid === userId ? f.toName : f.fromName;
                  const friendHandle = runnerByUid.get(otherUid)?.username;
                  const thread = threadMap.get(f.id);
                  const active = selectedThreadId === f.id;
                  const isFriendLive = liveFriendByUid.has(otherUid);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedThreadId(f.id)}
                      className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${
                        active ? 'bg-[#172D27] text-white' : 'hover:bg-[#F6F5F0] text-[#141F1B]'
                      }`}
                    >
                      <div className="relative shrink-0">
                        <RunnerAvatar
                          src={
                            runnerByUid.get(otherUid)?.photoURL ||
                            (f.fromUid === userId ? f.toPhotoUrl : f.fromPhotoUrl)
                          }
                          name={friendName}
                          sizeClass="h-9 w-9"
                          bgClass={active ? 'bg-[#9AE62E] text-[#172D27]' : 'bg-[#172D27] text-[#9AE62E]'}
                          textSizeClass="text-xs"
                          borderClass={active ? 'border border-[#9AE62E]' : 'border border-[#E5E3DC]'}
                        />
                        {isFriendLive && (
                          <span
                            title="Sharing live location"
                            className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <p className="truncate text-xs font-bold">
                            {friendName}
                            {friendHandle ? (
                              <span
                                className={`ml-1 font-mono text-[10px] font-normal ${
                                  active ? 'text-[#9AE62E]' : 'text-[#5B6B64]'
                                }`}
                              >
                                @{friendHandle}
                              </span>
                            ) : null}
                          </p>
                          {isFriendLive && (
                            <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
                              Live
                            </span>
                          )}
                        </div>
                        <p
                          className={`truncate text-[11px] ${
                            active ? 'text-[#B8E8C7]' : 'text-[#5B6B64]'
                          }`}
                        >
                          {thread?.lastMessageText || 'Say hi or send a run invite'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </aside>

              {/* Active DM Conversation */}
              <section className="flex flex-col rounded-2xl border border-[#E5E3DC] bg-white lg:col-span-8">
                {selectedFriendDisplay ? (
                  <>
                    {/* Conversation Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E3DC] p-4">
                      <div className="flex items-center gap-2.5">
                        <RunnerAvatar
                          src={
                            runnerByUid.get(selectedFriendDisplay.uid)?.photoURL ||
                            selectedFriendDisplay.photoUrl
                          }
                          name={selectedFriendDisplay.name}
                          sizeClass="h-9 w-9"
                          textSizeClass="text-xs"
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-display text-sm font-bold text-[#141F1B]">
                              {selectedFriendDisplay.name}
                            </h2>
                            {selectedFriendDisplay.username && (
                              <span className="rounded bg-[#EBF5EE] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#172D27]">
                                @{selectedFriendDisplay.username}
                              </span>
                            )}
                            {liveFriendByUid.has(selectedFriendDisplay.uid) && (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                <Radio className="h-2.5 w-2.5 animate-pulse" />
                                Running Live
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#5B6B64]">
                            Personal DMs, Distance Invites &amp; Location Sharing
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!requireVerifiedAction()) return;
                            const next = !showLocationDrawer;
                            setShowLocationDrawer(next);
                            if (next) {
                              setShowInviteForm(false);
                              captureCurrentGpsForDm();
                            }
                          }}
                          className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition ${
                            showLocationDrawer
                              ? 'border-[#172D27] bg-[#EBF5EE] text-[#172D27]'
                              : 'border-[#D9D7CE] bg-white text-[#172D27] hover:bg-[#F6F5F0]'
                          }`}
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          Share Location
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowInviteForm((v) => !v);
                            setShowLocationDrawer(false);
                          }}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3.5 text-xs font-bold text-[#9AE62E]"
                        >
                          <RouteIcon className="h-3.5 w-3.5" />
                          {showInviteForm ? 'Hide Run Invite' : 'Send Personal Run Invite'}
                        </button>
                      </div>
                    </div>

                    {/* Active Standalone Live Sharing Status Banner */}
                    {dmLiveSharingTo && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-[#EBF5EE] px-4 py-2.5 text-xs">
                        <span className="flex items-center gap-2 font-bold text-[#172D27]">
                          <Radio className="h-4 w-4 animate-pulse text-emerald-600" />
                          Sharing your live GPS location with {dmLiveSharingTo.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => void stopDmLiveLocation()}
                          className="min-h-[32px] rounded-lg bg-[#172D27] px-3 text-[11px] font-bold text-[#9AE62E]"
                        >
                          Stop Live Location
                        </button>
                      </div>
                    )}

                    {/* Inline DM Location Sharing Drawer */}
                    {showLocationDrawer && (
                      <div className="border-b border-[#E5E3DC] bg-[#F6F5F0] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="flex items-center gap-1.5 text-xs font-bold text-[#172D27]">
                            <MapPin className="h-3.5 w-3.5" />
                            Share GPS Location with {selectedFriendDisplay.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowLocationDrawer(false)}
                            className="text-xs text-[#5B6B64]"
                          >
                            Close
                          </button>
                        </div>

                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <div>
                            <label className="text-[11px] font-semibold text-[#5B6B64]">
                              Location Label
                            </label>
                            <input
                              type="text"
                              maxLength={140}
                              value={locationLabelInput}
                              onChange={(e) => setLocationLabelInput(e.target.value)}
                              placeholder={`e.g. ${defaultMeetingPoint}`}
                              className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-[#5B6B64]">
                              Quick Note (optional)
                            </label>
                            <input
                              type="text"
                              maxLength={200}
                              value={locationNoteInput}
                              onChange={(e) => setLocationNoteInput(e.target.value)}
                              placeholder="Waiting near the trailhead!"
                              className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-2 text-[11px] font-mono text-[#30483E] tabular-nums">
                            {locatingPin ? (
                              <span>Acquiring GPS coordinates...</span>
                            ) : capturedPin ? (
                              <span>
                                GPS: {capturedPin.lat.toFixed(5)}, {capturedPin.lng.toFixed(5)}
                              </span>
                            ) : (
                              <span>GPS not locked yet</span>
                            )}
                            <button
                              type="button"
                              onClick={captureCurrentGpsForDm}
                              className="font-sans font-bold text-[#172D27] underline"
                            >
                              Refresh GPS
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={sendingDm || locatingPin || !capturedPin}
                              onClick={() => void handleSendDmLocationPin(false)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#172D27] bg-white px-3.5 text-xs font-bold text-[#172D27] disabled:opacity-50"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              Send Current Pin
                            </button>
                            <button
                              type="button"
                              disabled={sendingDm || locatingPin || !capturedPin}
                              onClick={() => void handleSendDmLocationPin(true)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3.5 text-xs font-bold text-[#9AE62E] disabled:opacity-50"
                            >
                              <Radio className="h-3.5 w-3.5" />
                              Share Live Location
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Personal Workout Invite Composer Inside DM */}
                    {showInviteForm && (
                      <form
                        onSubmit={handleSendPersonalInvite}
                        className="border-b border-[#E5E3DC] bg-[#F6F5F0] p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-[#172D27]">
                            Invite {selectedFriendDisplay.name} to a Personal {getWorkoutMeta(inviteWorkoutType).fullLabel}
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowInviteForm(false)}
                            className="text-xs text-[#5B6B64]"
                          >
                            Close
                          </button>
                        </div>

                        <div>
                          <p className="mb-1.5 text-[11px] font-semibold text-[#5B6B64]">Workout Sport</p>
                          <WorkoutSelector
                            compact
                            value={inviteWorkoutType}
                            onChange={(next) => {
                              setInviteWorkoutType(next);
                              setInviteUseCustomDist(false);
                              if (next === 'cycling') {
                                if (inviteDistanceKm < 10) setInviteDistanceKm(20);
                                setInviteTitle(`Morning ${activeCity.name} Group Bike Ride`);
                              } else {
                                if (inviteDistanceKm > 50) setInviteDistanceKm(5);
                                setInviteTitle(`Morning ${getWorkoutMeta(next).label}`);
                              }
                            }}
                          />
                        </div>

                        <div>
                          <p className="mb-1.5 text-[11px] font-semibold text-[#5B6B64]">
                            Select Distance
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(inviteWorkoutType === 'cycling'
                              ? CYCLING_INVITE_DISTANCE_PRESETS
                              : INVITE_DISTANCE_PRESETS
                            ).map((p) => {
                              const active = !inviteUseCustomDist && inviteDistanceKm === p.km;
                              return (
                                <button
                                  key={p.km}
                                  type="button"
                                  onClick={() => {
                                    setInviteUseCustomDist(false);
                                    setInviteDistanceKm(p.km);
                                  }}
                                  className={`min-h-[34px] rounded-lg px-2.5 font-mono text-xs font-bold ${
                                    active
                                      ? 'bg-[#172D27] text-[#9AE62E]'
                                      : 'border border-[#D9D7CE] bg-white text-[#141F1B]'
                                  }`}
                                >
                                  {p.label}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() => setInviteUseCustomDist(true)}
                              className={`min-h-[34px] rounded-lg px-2.5 text-xs font-semibold ${
                                inviteUseCustomDist
                                  ? 'bg-[#172D27] text-[#9AE62E]'
                                  : 'border border-[#D9D7CE] bg-white text-[#141F1B]'
                              }`}
                            >
                              Custom km
                            </button>
                          </div>

                          {inviteUseCustomDist && (
                            <input
                              type="number"
                              min={1}
                              max={250}
                              step={0.5}
                              value={inviteCustomDist}
                              onChange={(e) => setInviteCustomDist(e.target.value)}
                              placeholder="Enter distance in km (1–250)"
                              className="mt-2 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 font-mono text-xs"
                            />
                          )}
                        </div>

                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <div>
                            <label className="text-[11px] font-semibold text-[#5B6B64]">Run Title</label>
                            <input
                              type="text"
                              required
                              maxLength={120}
                              value={inviteTitle}
                              onChange={(e) => setInviteTitle(e.target.value)}
                              className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-[#5B6B64]">Date &amp; Time</label>
                            <input
                              type="datetime-local"
                              required
                              value={inviteDateTime}
                              onChange={(e) => setInviteDateTime(e.target.value)}
                              className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-[#5B6B64]">Meeting Point</label>
                            <input
                              type="text"
                              required
                              maxLength={140}
                              value={inviteMeetingPoint}
                              onChange={(e) => setInviteMeetingPoint(e.target.value)}
                              className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-[#5B6B64]">
                              Attach Saved Route (optional)
                            </label>
                            <select
                              value={inviteRouteId}
                              onChange={(e) => setInviteRouteId(e.target.value)}
                              className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs"
                            >
                              <option value="">No specific route attached</option>
                              {savedRoutes.map((sr) => (
                                <option key={sr.id} value={sr.id}>
                                  {sr.name} ({(sr.distanceMeters / 1000).toFixed(1)} km)
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            maxLength={400}
                            value={inviteNote}
                            onChange={(e) => setInviteNote(e.target.value)}
                            placeholder="Personal message (e.g. Easy conversational pace, coffee after!)"
                            className="min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs"
                          />
                        </div>

                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={sendingDm}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E] disabled:opacity-60"
                          >
                            <Send className="h-3.5 w-3.5" />
                            {sendingDm ? 'Sending...' : 'Send Run Invite in DM'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Message Timeline */}
                    <div className="flex-1 space-y-3 overflow-y-auto p-4 min-h-[300px] max-h-[480px]">
                      {messages.length === 0 ? (
                        <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-xs text-[#5B6B64]">
                          <MessageSquare className="mb-2 h-6 w-6 text-[#30483E]" />
                          <p>No messages yet with {selectedFriendDisplay.name}.</p>
                          <p className="mt-1">Say hello below or send a personal run invite for 5K, 10K, or custom distance.</p>
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const isMine = msg.senderUid === userId;
                          if (msg.messageType === 'run_invite') {
                            const status = msg.inviteStatus || 'pending';
                            const inviteSportMeta = getWorkoutMeta(msg.workoutType);
                            const dt = msg.inviteDateTime ? new Date(msg.inviteDateTime) : null;
                            const whenLabel =
                              dt && !Number.isNaN(dt.getTime())
                                ? dt.toLocaleString('en-IN', {
                                    weekday: 'short',
                                    day: 'numeric',
                                    month: 'short',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })
                                : msg.inviteDateTime || 'Flexible time';
                            return (
                              <div
                                key={msg.id}
                                className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                              >
                                <div className="w-full max-w-sm rounded-2xl border border-[#172D27]/25 bg-[#F6F5F0] p-3.5 space-y-2.5 shadow-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1 rounded bg-[#172D27] px-2 py-0.5 text-[10px] font-bold uppercase text-[#9AE62E]">
                                      <WorkoutIcon type={inviteSportMeta.id} className="h-3 w-3" />
                                      Personal {inviteSportMeta.label} Invite
                                    </span>
                                    <span className="font-mono text-xs font-bold text-[#172D27] tabular-nums">
                                      {msg.inviteDistanceKm} km
                                    </span>
                                  </div>

                                  <div>
                                    <h3 className="font-display text-sm font-bold text-[#141F1B]">
                                      {msg.inviteTitle}
                                    </h3>
                                    <p className="mt-0.5 text-xs text-[#5B6B64]">{msg.text}</p>
                                  </div>

                                  <div className="space-y-1 text-[11px] text-[#141F1B]">
                                    <p className="flex items-center gap-1.5">
                                      <Clock className="h-3.5 w-3.5 text-[#30483E]" />
                                      <span>{whenLabel}</span>
                                    </p>
                                    <p className="flex items-center gap-1.5">
                                      <MapPin className="h-3.5 w-3.5 text-[#30483E]" />
                                      <span>{msg.inviteMeetingPoint}</span>
                                    </p>
                                    {msg.inviteRouteName && (
                                      <p className="flex items-center gap-1.5 text-[#30483E] font-medium">
                                        <RouteIcon className="h-3.5 w-3.5" />
                                        <span>Route: {msg.inviteRouteName}</span>
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E3DC] pt-2">
                                    <span
                                      className={`text-[11px] font-bold uppercase ${
                                        status === 'accepted'
                                          ? 'text-[#172D27]'
                                          : status === 'declined'
                                          ? 'text-red-700'
                                          : 'text-amber-700'
                                      }`}
                                    >
                                      {status}
                                    </span>

                                    {!isMine && status === 'pending' && (
                                      <div className="flex gap-1.5">
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            if (!requireVerifiedAction()) return;
                                            await respondPersonalRunInvite(
                                              selectedFriendship!.id,
                                              msg.id,
                                              'accepted'
                                            );
                                            showToast(
                                              'ok',
                                              `Accepted ${msg.inviteDistanceKm}K ${inviteSportMeta.label.toLowerCase()} invite!`
                                            );
                                          }}
                                          className="min-h-[34px] rounded-lg bg-[#172D27] px-3 text-[11px] font-bold text-[#9AE62E]"
                                        >
                                          Accept {inviteSportMeta.verb}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            if (!requireVerifiedAction()) return;
                                            await respondPersonalRunInvite(
                                              selectedFriendship!.id,
                                              msg.id,
                                              'declined'
                                            );
                                          }}
                                          className="min-h-[34px] rounded-lg border border-[#D9D7CE] bg-white px-2.5 text-[11px] font-semibold text-[#5B6B64]"
                                        >
                                          Decline
                                        </button>
                                      </div>
                                    )}

                                    {status === 'accepted' && (
                                      <button
                                        type="button"
                                        onClick={() => handleLaunchInviteRoute(msg)}
                                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-[#172D27] px-3 text-[11px] font-bold text-[#9AE62E]"
                                      >
                                        <Play className="h-3 w-3" />
                                        {msg.inviteEncodedPolyline
                                          ? `${inviteSportMeta.verb} Route`
                                          : `Plan This ${inviteSportMeta.label}`}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          if (msg.messageType === 'location') {
                            const activeBeacon = liveFriendByUid.get(msg.senderUid);
                            const lat = activeBeacon?.lat ?? msg.locationLat ?? activeCity.lat;
                            const lng = activeBeacon?.lng ?? msg.locationLng ?? activeCity.lng;
                            return (
                              <div
                                key={msg.id}
                                className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                              >
                                <div className="w-full max-w-sm rounded-2xl border border-[#172D27]/25 bg-[#F6F5F0] p-3.5 space-y-2.5 shadow-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                        activeBeacon
                                          ? 'bg-emerald-600 text-white'
                                          : 'bg-[#172D27] text-[#9AE62E]'
                                      }`}
                                    >
                                      {activeBeacon ? (
                                        <>
                                          <Radio className="h-3 w-3 animate-pulse" />
                                          Live Now
                                        </>
                                      ) : msg.locationIsLive ? (
                                        'Live Location Share'
                                      ) : (
                                        'Shared Location'
                                      )}
                                    </span>
                                    <span className="font-mono text-[10px] font-semibold text-[#5B6B64] tabular-nums">
                                      {formatTimestampSafe(msg.createdAt)}
                                    </span>
                                  </div>

                                  <div>
                                    <h3 className="flex items-center gap-1.5 font-display text-sm font-bold text-[#141F1B]">
                                      <MapPin className="h-4 w-4 shrink-0 text-[#172D27]" />
                                      <span className="truncate">
                                        {msg.locationLabel || 'Shared GPS Location'}
                                      </span>
                                    </h3>
                                    <p className="mt-0.5 text-xs text-[#5B6B64]">{msg.text}</p>
                                  </div>

                                  <div className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-[11px] font-mono text-[#30483E] tabular-nums">
                                    <span>
                                      {activeBeacon
                                        ? `${formatDistance(activeBeacon.distanceMeters, preferredUnit)} · ${activeBeacon.currentSpeedKmh.toFixed(1)} km/h`
                                        : `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setViewingLocationMsg(msg)}
                                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-[#172D27] px-3 font-sans text-[11px] font-bold text-[#9AE62E]"
                                    >
                                      <Navigation className="h-3 w-3" />
                                      View on Map
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={msg.id}
                              className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs ${
                                  isMine
                                    ? 'bg-[#172D27] text-white'
                                    : 'bg-[#F6F5F0] text-[#141F1B]'
                                }`}
                              >
                                <p className="leading-relaxed">{msg.text}</p>
                                <p
                                  className={`mt-1 text-[10px] ${
                                    isMine ? 'text-[#B8E8C7]/80' : 'text-[#5B6B64]'
                                  }`}
                                >
                                  {formatTimestampSafe(msg.createdAt)}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Text Message Bar */}
                    <form
                      onSubmit={handleSendTextDm}
                      className="flex items-center gap-2 border-t border-[#E5E3DC] p-3"
                    >
                      <button
                        type="button"
                        aria-label="Share location in DM"
                        title="Share GPS or live location"
                        onClick={() => {
                          if (!requireVerifiedAction()) return;
                          const next = !showLocationDrawer;
                          setShowLocationDrawer(next);
                          if (next) {
                            setShowInviteForm(false);
                            captureCurrentGpsForDm();
                          }
                        }}
                        className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] text-[#172D27] hover:bg-[#EBF5EE]"
                      >
                        <MapPin className="h-4 w-4" />
                      </button>
                      <input
                        type="text"
                        maxLength={500}
                        value={dmText}
                        onChange={(e) => setDmText(e.target.value)}
                        placeholder={`Message ${selectedFriendDisplay.name}...`}
                        className="min-h-[44px] flex-1 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3.5 text-xs focus:border-[#172D27] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={sendingDm || !dmText.trim()}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E] disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send
                      </button>
                    </form>
                  </>
                ) : null}
              </section>
            </div>
          )}
        </div>
      )}

      {/* ADD STORY MODAL */}
      {showStoryComposer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreateStory}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-[#141F1B]">Add 24h Workout Story</h2>
                <p className="text-xs text-[#5B6B64]">Visible to the community for 24 hours</p>
              </div>
              <button
                type="button"
                onClick={() => setShowStoryComposer(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-[#5B6B64] hover:bg-[#F6F5F0]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#5B6B64]">Workout Sport</label>
              <WorkoutSelector compact value={storyWorkoutType} onChange={setStoryWorkoutType} />
            </div>

            {runs.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Link a Completed Workout</label>
                <select
                  value={storyRunId}
                  onChange={(e) => handleSelectRunForStory(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-xs font-medium"
                >
                  <option value="custom">Custom quick highlight</option>
                  {runs.slice(0, 10).map((r) => (
                    <option key={r.id} value={r.id}>
                      [{getWorkoutMeta(r.workoutType).label}] {r.routeName} — {(r.distanceMeters / 1000).toFixed(2)} km
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Story Headline</label>
              <input
                type="text"
                required
                maxLength={80}
                value={storyHeadline}
                onChange={(e) => setStoryHeadline(e.target.value)}
                placeholder={`e.g. 10K ${activeCity.name} Loop Done!`}
                className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Distance (km)</label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  step={0.1}
                  value={storyDistanceKm}
                  onChange={(e) => setStoryDistanceKm(Number(e.target.value))}
                  className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] px-3 font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Duration (min)</label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={storyDurationMin}
                  onChange={(e) => setStoryDurationMin(Number(e.target.value))}
                  className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] px-3 font-mono text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Story Caption (optional)</label>
              <input
                type="text"
                maxLength={220}
                value={storyCaption}
                onChange={(e) => setStoryCaption(e.target.value)}
                placeholder="Golden hour stride along Leisure Valley..."
                className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-[#5B6B64]">Story Theme</p>
              <div className="grid grid-cols-2 gap-2">
                {STORY_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStoryTheme(t.id)}
                    className={`flex min-h-[40px] items-center gap-2 rounded-xl border px-3 text-xs font-semibold ${
                      storyTheme === t.id
                        ? 'border-[#172D27] ring-2 ring-[#172D27]/20'
                        : 'border-[#E5E3DC]'
                    }`}
                  >
                    <span className={`h-4 w-4 rounded-full bg-gradient-to-br ${t.bgClass}`} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowStoryComposer(false)}
                className="min-h-[42px] rounded-xl border border-[#D9D7CE] px-4 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={postingStory}
                className="min-h-[42px] rounded-xl bg-[#172D27] px-5 text-xs font-bold text-[#9AE62E] disabled:opacity-60"
              >
                {postingStory ? 'Sharing...' : 'Share Story'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FULL-SCREEN STORY VIEWER */}
      {activeStory && viewingStoryIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div
            className={`relative flex h-[540px] max-h-[90dvh] w-full max-w-sm flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br ${activeStoryTheme.bgClass} p-6 shadow-2xl`}
          >
            {/* Top progress segments + author */}
            <div className="space-y-3">
              <div className="flex gap-1.5">
                {stories.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${
                      i <= viewingStoryIdx ? 'bg-white' : 'bg-white/30'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <RunnerAvatar
                    src={
                      runnerByUid.get(activeStory.authorUid)?.photoURL ||
                      activeStory.authorPhotoUrl
                    }
                    name={activeStory.authorName}
                    sizeClass="h-9 w-9"
                    bgClass="bg-black/25 text-white"
                    textSizeClass="text-xs"
                    borderClass="border border-white/40"
                  />
                  <div className="min-w-0">
                    <p className={`truncate text-xs font-bold ${activeStoryTheme.textClass}`}>
                      {activeStory.authorName}
                    </p>
                    <p className={`flex items-center gap-1 text-[10px] opacity-85 ${activeStoryTheme.textClass}`}>
                      <WorkoutIcon type={activeStory.workoutType} className="h-3 w-3 shrink-0" />
                      <span>
                        {getWorkoutMeta(activeStory.workoutType).label} ·{' '}
                        {formatTimestampSafe(activeStory.createdAt)} · 24h Story
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {activeStory.authorUid === userId && (
                    <button
                      type="button"
                      aria-label="Delete story"
                      onClick={async () => {
                        await deleteRunStory(activeStory.id);
                        setViewingStoryIdx(null);
                        showToast('ok', 'Story deleted.');
                      }}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl bg-black/20 ${activeStoryTheme.textClass}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Close story"
                    onClick={() => setViewingStoryIdx(null)}
                    className={`flex h-9 w-9 items-center justify-center rounded-xl bg-black/20 ${activeStoryTheme.textClass}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Center Visual & Stats */}
            <div className="my-auto flex flex-col items-center space-y-4 text-center">
              {activeStory.encodedPolyline && (
                <MiniPolylineArt
                  encodedPolyline={activeStory.encodedPolyline}
                  darkBg={false}
                  sizeClass="h-32 w-32"
                />
              )}
              <div>
                <p className={`font-mono text-4xl font-extrabold tabular-nums ${activeStoryTheme.accentClass}`}>
                  {activeStory.distanceKm} km
                </p>
                <h3 className={`mt-2 font-display text-2xl font-bold leading-tight ${activeStoryTheme.textClass}`}>
                  {activeStory.headline}
                </h3>
                {activeStory.caption && (
                  <p className={`mt-2 text-xs leading-relaxed opacity-90 ${activeStoryTheme.textClass}`}>
                    {activeStory.caption}
                  </p>
                )}
              </div>

              {(activeStory.durationSec > 0 || activeStory.paceLabel) && (
                <div className={`flex items-center gap-4 rounded-xl bg-black/20 px-4 py-2 font-mono text-xs font-semibold tabular-nums ${activeStoryTheme.textClass}`}>
                  {activeStory.durationSec > 0 && <span>{formatDuration(activeStory.durationSec)}</span>}
                  {activeStory.paceLabel && <span>{activeStory.paceLabel}</span>}
                </div>
              )}
            </div>

            {/* Prev / Next Navigation */}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={viewingStoryIdx === 0}
                onClick={() => setViewingStoryIdx((i) => (i !== null && i > 0 ? i - 1 : i))}
                className={`inline-flex min-h-[40px] items-center gap-1 rounded-xl bg-black/25 px-3 text-xs font-semibold disabled:opacity-30 ${activeStoryTheme.textClass}`}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </button>
              <button
                type="button"
                onClick={() =>
                  setViewingStoryIdx((i) =>
                    i !== null && i < stories.length - 1 ? i + 1 : null
                  )
                }
                className={`inline-flex min-h-[40px] items-center gap-1 rounded-xl bg-black/25 px-3 text-xs font-semibold ${activeStoryTheme.textClass}`}
              >
                {viewingStoryIdx < stories.length - 1 ? 'Next' : 'Done'}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DM SHARED / LIVE LOCATION MAP VIEWER MODAL */}
      {viewingLocationMsg && (() => {
        const activeSenderBeacon = liveFriendByUid.get(viewingLocationMsg.senderUid);
        const centerLat = activeSenderBeacon?.lat ?? viewingLocationMsg.locationLat ?? activeCity.lat;
        const centerLng = activeSenderBeacon?.lng ?? viewingLocationMsg.locationLng ?? activeCity.lng;
        const centerCoords = { lat: centerLat, lng: centerLng };
        const beaconSport = activeSenderBeacon ? getWorkoutMeta(activeSenderBeacon.workoutType) : null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-[#E5E3DC] p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-display text-base font-bold text-[#141F1B]">
                      {viewingLocationMsg.senderName} ·{' '}
                      {viewingLocationMsg.locationLabel || 'Shared Location'}
                    </h2>
                    {activeSenderBeacon && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                        <Radio className="h-3 w-3 animate-pulse" />
                        Live{beaconSport ? ` · ${beaconSport.label}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-[#5B6B64] tabular-nums">
                    {activeSenderBeacon
                      ? `${formatDistance(activeSenderBeacon.distanceMeters, preferredUnit)} · ${formatSpeed(activeSenderBeacon.currentSpeedKmh, preferredUnit)} · ${formatDuration(activeSenderBeacon.elapsedSec)}`
                      : `Coordinates: ${centerLat.toFixed(5)}, ${centerLng.toFixed(5)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingLocationMsg(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#5B6B64] hover:bg-[#F6F5F0]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <TricityMap
                fallbackCenter={{ lat: activeCity.lat, lng: activeCity.lng }}
                focusCenter={centerCoords}
                focusZoom={16}
                startLocation={!activeSenderBeacon ? centerCoords : undefined}
                liveFriends={activeSenderBeacon ? [activeSenderBeacon] : liveFriends}
                heightClass="h-[340px] sm:h-[400px]"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E3DC] bg-[#F6F5F0] px-4 py-3">
                <p className="text-xs text-[#5B6B64]">{viewingLocationMsg.text}</p>
                <button
                  type="button"
                  onClick={() => setViewingLocationMsg(null)}
                  className="min-h-[38px] rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {lightboxPostPhoto && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setLightboxPostPhoto(null)}
        >
          <button
            type="button"
            aria-label="Close photo"
            onClick={() => setLightboxPostPhoto(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxPostPhoto}
            alt="Full-size workout photo"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88dvh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
