export type CityName = 'Chandigarh';

export type RouteMode = 'normal' | 'run_art';

export type RouteType = 'circular' | 'out_and_back' | 'point_to_point' | 'run_art';

export type RouteDifficulty = 'easy' | 'moderate' | 'challenging';

export type RoutePreference =
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

export type AppTab = 'home' | 'plan' | 'explore' | 'routes' | 'history' | 'profile';

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
    distanceMeters: number;
    durationSec: number;
    city: 'Chandigarh';
    routingProvider?: string;
  };
  geometry: {
    type: 'LineString';
    coordinates: Array<[number, number]>; // [lng, lat]
  };
}

export interface GeneratedRouteCandidate {
  id: string;
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

export interface GpsSample {
  lat: number;
  lng: number;
  t: number;
  acc: number;
}

export interface RunActivityDoc {
  id: string;
  userId: string;
  routeId?: string;
  routeName: string;
  routeType: RouteType | 'free_run';
  distanceMeters: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  bestPaceSecPerKm: number;
  avgSpeedKmh: number;
  elevationGainMeters?: number;
  splits: SplitRecord[];
  encodedPolyline: string;
  startName: string;
  sampleCount: number;
  status: 'completed';
  startedAt: string;
  finishedAt: string;
  createdAt?: unknown;
}

export interface UserProfileDoc {
  uid: string;
  displayName: string;
  photoURL?: string;
  preferredUnit: 'km' | 'mi';
  preferredTerrain?: string;
  city?: CityName;
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
  city: CityName;
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
