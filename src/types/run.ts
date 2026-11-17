export type CityName = string;

export type WorkoutType = 'running' | 'cycling' | 'walking' | 'hiking' | 'trail_run';

export type RouteMode = 'normal' | 'run_art';

export type RouteType = 'circular' | 'out_and_back' | 'point_to_point' | 'run_art';

export type RouteDifficulty = 'easy' | 'moderate' | 'challenging';

export type RoutePreference =
  | 'least_turns'
  | 'parks_greenery'
  | 'pedestrian_paths'
  | 'quieter_roads'
  | 'avoid_stairs'
  | 'avoid_restricted'
  | 'fewer_crossings'
  | 'well_connected'
  | 'scenic'
  | 'well_lit';

export type RunArtShapeType =
  | 'heart'
  | 'star'
  | 'circle'
  | 'smiley'
  | 'diamond'
  | 'infinity'
  | 'lightning'
  | 'hexagon'
  | 'alphabet'
  | 'custom';

export type RunArtSize = 'compact' | 'standard' | 'large';

export type AppTab = 'home' | 'plan' | 'social' | 'messages' | 'invites' | 'explore' | 'routes' | 'history' | 'profile';

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export interface NamedLocation extends LatLngLiteral {
  name: string;
  city?: CityName | string;
}

export interface RouteStepInstruction {
  instruction: string;
  distanceMeters: number;
  durationSec: number;
  maneuver?: string;
  startLocation?: LatLngLiteral;
  endLocation?: LatLngLiteral;
}

export interface GeoJsonLineStringFeature {
  type: 'Feature';
  properties: {
    name: string;
    routeType: RouteType;
    workoutType?: WorkoutType;
    distanceMeters: number;
    durationSec: number;
    city: string;
    routingProvider?: string;
  };
  geometry: {
    type: 'LineString';
    coordinates: Array<[number, number]>; // [lng, lat]
  };
}

export interface GeneratedRouteCandidate {
  id: string;
  workoutType?: WorkoutType;
  label: string;
  name: string;
  routeType: RouteType;
  distanceMeters: number;
  targetDistanceMeters: number;
  durationSec: number;
  elevationGainMeters: number | null;
  start: NamedLocation;
  end: NamedLocation;
  encodedPolyline: string;
  path: LatLngLiteral[];
  geoJson?: GeoJsonLineStringFeature;
  steps: RouteStepInstruction[];
  kmMarkers: Array<{ km: number; position: LatLngLiteral }>;
  characteristics: string[];
  surfaceSummary: string;
  routingProvider?: string;
  preferences: RoutePreference[];
  difficulty: RouteDifficulty;
  toleranceDiffPct: number;
  turnCount?: number;
  longestStraightMeters?: number;
  straightPathPct?: number;
  matchScore?: number;
  shapeSimilarityNorm?: number; // 0..1
  distanceMatchNorm?: number; // 0..1
  routeCompletenessNorm?: number; // 0..1
  loopCount?: number;
  intendedShapePath?: LatLngLiteral[];
  approximateMatchWarning?: string;
}

export interface SavedRouteDoc {
  id: string;
  userId: string;
  workoutType?: WorkoutType;
  name: string;
  notes?: string;
  city?: string;
  routeType: RouteType;
  distanceMeters: number;
  durationSec: number;
  elevationGainMeters?: number;
  startLat: number;
  startLng: number;
  startName: string;
  endLat: number;
  endLng: number;
  endName: string;
  encodedPolyline: string;
  preferences?: RoutePreference[];
  isPublic: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SplitRecord {
  km: number;
  splitDurationSec: number;
  paceSecPerKm: number;
  cumulativeDistanceMeters: number;
  lat?: number;
  lng?: number;
}

export interface CompletedKmCheckpoint {
  km: number;
  position: LatLngLiteral;
  splitDurationSec?: number;
  paceSecPerKm?: number;
}

export interface ElevationProfilePoint {
  distanceMeters: number;
  distRatio: number;
  elevationM: number;
}

export interface ElevationAnalysisResult {
  available: boolean;
  provider?: 'google' | 'open-meteo' | 'gps';
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  minElevationMeters: number | null;
  maxElevationMeters: number | null;
  avgGradePct?: number | null;
  profile?: ElevationProfilePoint[];
}

export interface GpsSample {
  lat: number;
  lng: number;
  t: number;
  acc: number;
  alt?: number;
}

export interface RunActivityDoc {
  id: string;
  userId: string;
  workoutType?: WorkoutType;
  routeId?: string;
  routeName: string;
  routeType: RouteType | 'free_run';
  distanceMeters: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  bestPaceSecPerKm: number;
  avgSpeedKmh: number;
  caloriesKcal?: number;
  elevationGainMeters?: number;
  elevationLossMeters?: number;
  minElevationMeters?: number;
  maxElevationMeters?: number;
  splits: SplitRecord[];
  encodedPolyline: string;
  startName: string;
  sampleCount: number;
  notes?: string;
  photos?: string[];
  shoeBrand?: string;
  shoeName?: string;
  status: 'completed';
  startedAt: string;
  finishedAt: string;
  createdAt?: unknown;
}

export interface RunningShoeItem {
  id: string;
  name: string;
  brand?: string;
  distanceKm: number;
  maxKm: number;
  isPrimary?: boolean;
}

export interface UserProfileDoc {
  uid: string;
  username?: string;
  displayName: string;
  photoURL?: string;
  preferredUnit: 'km' | 'mi';
  preferredWorkout?: WorkoutType;
  preferredTerrain?: string;
  city?: CityName;
  cityLat?: number;
  cityLng?: number;
  bio?: string;
  bioTags?: string[];
  isPrivate?: boolean;
  shoes?: RunningShoeItem[];
  totalDistanceKm: number;
  totalRuns: number;
  totalDurationSec: number;
  longestRunKm: number;
  bestPaceSecPerKm: number;
  currentStreakDays: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserSafetyDoc {
  userId: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  trustedShareEnabled: boolean;
  checkInIntervalMin: number;
  updatedAt?: unknown;
}

export interface TricityPlace {
  id: string;
  name: string;
  city: string;
  area: string;
  description: string;
  lat: number;
  lng: number;
  imageUrl: string;
  paths: string[];
  suggestedDistancesKm: number[];
  surface: string;
  lighting: string;
  lastVerified: string;
  tags: string[];
}

export interface PathReportDoc {
  id: string;
  userId: string;
  reporterName: string;
  city: string;
  areaName: string;
  lat?: number;
  lng?: number;
  issueType: 'blocked' | 'construction' | 'lighting' | 'surface';
  description: string;
  status: 'active' | 'resolved';
  createdAt?: unknown;
}

export interface RunArtDesignDoc {
  id: string;
  userId: string;
  shapeType: RunArtShapeType;
  title: string;
  city?: string;
  startLat: number;
  startLng: number;
  targetDistanceKm: number;
  actualDistanceKm: number;
  encodedPolyline: string;
  matchScore: number;
  status: 'planned' | 'completed';
  createdAt?: unknown;
}

export type OpenEventType = 'marathon' | 'fun_run';

export type OpenEventStatus = 'open' | 'cancelled' | 'completed';

export interface OpenRunInviteDoc {
  id: string;
  hostUserId: string;
  hostName: string;
  workoutType?: WorkoutType;
  eventType: OpenEventType;
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
  rsvpCount: number;
  status: OpenEventStatus;
  routeId?: string;
  routeName?: string;
  encodedPolyline?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OpenEventRsvpDoc {
  id: string;
  eventId: string;
  userId: string;
  runnerName: string;
  paceNote?: string;
  joinedAt?: unknown;
}

export interface RunnerDirectoryDoc {
  uid: string;
  username?: string;
  displayName: string;
  photoURL?: string;
  city?: string;
  preferredWorkout?: WorkoutType;
  bio?: string;
  bioTags?: string[];
  isPrivate?: boolean;
  totalDistanceKm?: number;
  totalRuns?: number;
  updatedAt?: unknown;
}

export interface UsernameClaimDoc {
  username: string;
  uid: string;
  displayName: string;
  createdAt?: unknown;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';

export interface FriendRequestDoc {
  id: string;
  fromUid: string;
  fromName: string;
  fromPhotoUrl?: string;
  toUid: string;
  toName: string;
  toPhotoUrl?: string;
  participantUids: string[];
  status: FriendRequestStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type DmMessageType = 'text' | 'run_invite' | 'location';
export type PersonalInviteStatus = 'pending' | 'accepted' | 'declined';

export interface DmThreadDoc {
  id: string;
  threadId: string;
  participantUids: string[];
  lastMessageText: string;
  lastMessageType: DmMessageType;
  lastSenderId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DmMessageDoc {
  id: string;
  threadId: string;
  participantUids: string[];
  senderUid: string;
  senderName: string;
  messageType: DmMessageType;
  text: string;
  workoutType?: WorkoutType;
  inviteDistanceKm?: number;
  inviteTitle?: string;
  inviteDateTime?: string;
  inviteMeetingPoint?: string;
  inviteStatus?: PersonalInviteStatus;
  inviteRouteName?: string;
  inviteEncodedPolyline?: string;
  locationLat?: number;
  locationLng?: number;
  locationLabel?: string;
  locationIsLive?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type LiveBeaconShareScope = 'friends' | 'selected';
export type LiveBeaconStatus = 'active' | 'paused' | 'ended';

export interface LiveBeaconDoc {
  uid: string;
  displayName: string;
  photoURL?: string;
  workoutType?: WorkoutType;
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
  expiresAtMs: number;
  updatedAt?: unknown;
}

export interface DailyRunPostDoc {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl?: string;
  workoutType?: WorkoutType;
  caption: string;
  runTitle: string;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  elevationGainMeters?: number;
  startName: string;
  encodedPolyline?: string;
  photos?: string[];
  shoeBrand?: string;
  shoeName?: string;
  moodTag?: string;
  likeCount: number;
  visibility: 'public' | 'friends';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type StoryThemeColor = 'pine' | 'lime' | 'sunset' | 'slate';

export interface RunStoryDoc {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl?: string;
  workoutType?: WorkoutType;
  headline: string;
  caption?: string;
  distanceKm: number;
  durationSec: number;
  paceLabel?: string;
  themeColor: StoryThemeColor;
  encodedPolyline?: string;
  expiresAtMs: number;
  visibility: 'public';
  createdAt?: unknown;
}

export interface RunClubDoc {
  id: string;
  name: string;
  description: string;
  city: string;
  tags: string[];
  ownerUid: string;
  ownerName: string;
  memberCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClubMemberDoc {
  id: string;
  clubId: string;
  userId: string;
  memberName: string;
  role: 'owner' | 'member';
  joinedAt?: unknown;
}

