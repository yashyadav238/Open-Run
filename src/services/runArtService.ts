import {
  CHANDIGARH_WALK_NODES,
  getNightSafetyStatsForPath,
  isInsideChandigarh,
  isNightHazardOrWildlifeZone,
  isPathInsideChandigarh,
  isWaterOrRestrictedChandigarhPoint,
} from '../data/tricityPlaces';
import {
  buildGeoJsonLineString,
  computeKmMarkers,
  computeMaxSegmentGapMeters,
  discreteFrechetMeters,
  encodePolyline,
  haversineMeters,
  minDistanceToPathMeters,
  offsetMetersToLatLng,
  resample2DCurve,
} from '../lib/geo';
import type {
  GeneratedRouteCandidate,
  LatLngLiteral,
  NamedLocation,
  RoutePreference,
  RunArtShapeType,
  RunArtSize,
} from '../types/run';
import {
  fetchOptionalElevation,
  repeatRouteLaps,
  type ComputeRouteOutput,
  type PedestrianRoutingProvider,
} from './routingService';

export interface RunArtTemplate {
  id: RunArtShapeType;
  name: string;
  subtitle: string;
  recommendedKm: number;
  normalizedVertices: Array<{ x: number; y: number }>;
}

export interface RunArtGenerationResult {
  routes: GeneratedRouteCandidate[];
  warning?: string;
}

function buildParametricHeart(steps = 28): Array<{ x: number; y: number }> {
  const raw: Array<{ x: number; y: number }> = [];
  // Start at bottom cusp (t = PI) so start/finish sits cleanly at bottom tip
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI + (i / steps) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push({ x: x / 16, y: (y + 2.2) / 15 });
  }
  return raw;
}

function buildParametricCircle(steps = 28): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return pts;
}

function buildParametricInfinity(steps = 28): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    pts.push({
      x: Math.sin(t),
      y: 0.56 * Math.sin(2 * t),
    });
  }
  return pts;
}

export const RUN_ART_TEMPLATES: RunArtTemplate[] = [
  {
    id: 'heart',
    name: 'Heart',
    subtitle: 'Smooth parametric heart snapped via HMM onto Chandigarh avenues',
    recommendedKm: 5,
    normalizedVertices: buildParametricHeart(28),
  },
  {
    id: 'star',
    name: 'Star',
    subtitle: 'Symmetric five-pointed star aligned across Chandigarh sector blocks',
    recommendedKm: 7,
    normalizedVertices: [
      { x: 0, y: 1 },
      { x: 0.24, y: 0.34 },
      { x: 0.95, y: 0.31 },
      { x: 0.4, y: -0.12 },
      { x: 0.59, y: -0.81 },
      { x: 0, y: -0.38 },
      { x: -0.59, y: -0.81 },
      { x: -0.4, y: -0.12 },
      { x: -0.95, y: 0.31 },
      { x: -0.24, y: 0.34 },
      { x: 0, y: 1 },
    ],
  },
  {
    id: 'circle',
    name: 'Circle',
    subtitle: 'True circular loop mapped smoothly over sector parks & walkways',
    recommendedKm: 5,
    normalizedVertices: buildParametricCircle(28),
  },
  {
    id: 'smiley',
    name: 'Smiley Face',
    subtitle: 'Continuous round face loop with curved interior smile arc',
    recommendedKm: 6,
    normalizedVertices: [
      { x: 0, y: -1 },
      { x: 0.62, y: -0.78 },
      { x: 0.95, y: -0.31 },
      { x: 0.95, y: 0.31 },
      { x: 0.62, y: 0.78 },
      { x: 0, y: 1 },
      { x: -0.62, y: 0.78 },
      { x: -0.95, y: 0.31 },
      { x: -0.95, y: -0.31 },
      { x: -0.62, y: -0.78 },
      { x: -0.48, y: -0.25 },
      { x: 0, y: -0.56 },
      { x: 0.48, y: -0.25 },
      { x: 0, y: -1 },
    ],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    subtitle: 'Crisp four-corner diamond built directly for rectangular sector avenues',
    recommendedKm: 4,
    normalizedVertices: [
      { x: 0, y: -1 },
      { x: 0.84, y: 0 },
      { x: 0, y: 1 },
      { x: -0.84, y: 0 },
      { x: 0, y: -1 },
    ],
  },
  {
    id: 'infinity',
    name: 'Infinity',
    subtitle: 'Smooth lemniscate figure-eight crossing cleanly at a central intersection',
    recommendedKm: 7,
    normalizedVertices: buildParametricInfinity(28),
  },
  {
    id: 'lightning',
    name: 'Lightning',
    subtitle: 'Sharp diagonal bolt silhouette tuned for Chandigarh cross-sector spines',
    recommendedKm: 5,
    normalizedVertices: [
      { x: 0.15, y: 1 },
      { x: -0.55, y: 0.1 },
      { x: -0.05, y: 0.1 },
      { x: -0.2, y: -1 },
      { x: 0.58, y: -0.05 },
      { x: 0.08, y: -0.05 },
      { x: 0.15, y: 1 },
    ],
  },
  {
    id: 'hexagon',
    name: 'Sector Hex',
    subtitle: 'Six-sided geometric loop mapped cleanly onto Chandigarh sector blocks',
    recommendedKm: 4,
    normalizedVertices: [
      { x: 0, y: -1 },
      { x: 0.87, y: -0.5 },
      { x: 0.87, y: 0.5 },
      { x: 0, y: 1 },
      { x: -0.87, y: 0.5 },
      { x: -0.87, y: -0.5 },
      { x: 0, y: -1 },
    ],
  },
];

function rotatePoint(pt: { x: number; y: number }, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: pt.x * cos - pt.y * sin,
    y: pt.x * sin + pt.y * cos,
  };
}

interface GlyphDef {
  single: Array<{ x: number; y: number }>;
  joined: Array<{ x: number; y: number }>;
}

const ALPHABET_GLYPHS: Record<string, GlyphDef> = {
  A: {
    single: [
      { x: 0, y: -1 },
      { x: 0.4, y: 1 },
      { x: 0.62, y: -0.1 },
      { x: 0.18, y: -0.1 },
      { x: 0.62, y: -0.1 },
      { x: 0.8, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0.4, y: 1 },
      { x: 0.62, y: -0.1 },
      { x: 0.18, y: -0.1 },
      { x: 0.62, y: -0.1 },
      { x: 0.8, y: -1 },
    ],
  },
  B: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.56, y: 1 },
      { x: 0.76, y: 0.55 },
      { x: 0.55, y: 0.06 },
      { x: 0, y: 0.06 },
      { x: 0.58, y: 0.06 },
      { x: 0.78, y: -0.46 },
      { x: 0.58, y: -1 },
      { x: 0, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.56, y: 1 },
      { x: 0.76, y: 0.55 },
      { x: 0.55, y: 0.06 },
      { x: 0, y: 0.06 },
      { x: 0.58, y: 0.06 },
      { x: 0.78, y: -0.46 },
      { x: 0.58, y: -1 },
      { x: 0, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  C: {
    single: [
      { x: 0.76, y: 0.74 },
      { x: 0.42, y: 1 },
      { x: 0.06, y: 0.58 },
      { x: 0, y: 0 },
      { x: 0.06, y: -0.58 },
      { x: 0.42, y: -1 },
      { x: 0.76, y: -0.74 },
    ],
    joined: [
      { x: 0.42, y: -1 },
      { x: 0.06, y: -0.58 },
      { x: 0, y: 0 },
      { x: 0.06, y: 0.58 },
      { x: 0.42, y: 1 },
      { x: 0.76, y: 0.74 },
      { x: 0.42, y: 1 },
      { x: 0.06, y: 0.58 },
      { x: 0, y: 0 },
      { x: 0.06, y: -0.58 },
      { x: 0.42, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  D: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.46, y: 1 },
      { x: 0.78, y: 0.54 },
      { x: 0.78, y: -0.54 },
      { x: 0.46, y: -1 },
      { x: 0, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.46, y: 1 },
      { x: 0.78, y: 0.54 },
      { x: 0.78, y: -0.54 },
      { x: 0.46, y: -1 },
      { x: 0, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  E: {
    single: [
      { x: 0.76, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 0.6, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -1 },
      { x: 0.76, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.76, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 0.6, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -1 },
      { x: 0.76, y: -1 },
    ],
  },
  F: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.76, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0.04 },
      { x: 0.62, y: 0.04 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.76, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0.04 },
      { x: 0.62, y: 0.04 },
      { x: 0, y: 0.04 },
      { x: 0, y: -1 },
      { x: 0.76, y: -1 },
    ],
  },
  G: {
    single: [
      { x: 0.74, y: 0.74 },
      { x: 0.4, y: 1 },
      { x: 0.06, y: 0.58 },
      { x: 0, y: 0 },
      { x: 0.06, y: -0.58 },
      { x: 0.4, y: -1 },
      { x: 0.76, y: -0.74 },
      { x: 0.76, y: -0.05 },
      { x: 0.4, y: -0.05 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.06, y: -0.58 },
      { x: 0, y: 0 },
      { x: 0.06, y: 0.58 },
      { x: 0.4, y: 1 },
      { x: 0.74, y: 0.74 },
      { x: 0.4, y: 1 },
      { x: 0.06, y: 0.58 },
      { x: 0, y: 0 },
      { x: 0.06, y: -0.58 },
      { x: 0.4, y: -1 },
      { x: 0.76, y: -0.74 },
      { x: 0.76, y: -0.05 },
      { x: 0.4, y: -0.05 },
      { x: 0.76, y: -0.05 },
      { x: 0.76, y: -1 },
    ],
  },
  H: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 0.8, y: 0 },
      { x: 0.8, y: 1 },
      { x: 0.8, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 0.8, y: 0 },
      { x: 0.8, y: 1 },
      { x: 0.8, y: -1 },
    ],
  },
  I: {
    single: [
      { x: 0.14, y: 1 },
      { x: 0.66, y: 1 },
      { x: 0.4, y: 1 },
      { x: 0.4, y: -1 },
      { x: 0.14, y: -1 },
      { x: 0.66, y: -1 },
    ],
    joined: [
      { x: 0.14, y: -1 },
      { x: 0.4, y: -1 },
      { x: 0.4, y: 1 },
      { x: 0.14, y: 1 },
      { x: 0.66, y: 1 },
      { x: 0.4, y: 1 },
      { x: 0.4, y: -1 },
      { x: 0.66, y: -1 },
    ],
  },
  J: {
    single: [
      { x: 0.22, y: 1 },
      { x: 0.76, y: 1 },
      { x: 0.76, y: -0.56 },
      { x: 0.44, y: -1 },
      { x: 0.12, y: -0.82 },
      { x: 0.04, y: -0.44 },
    ],
    joined: [
      { x: 0.44, y: -1 },
      { x: 0.12, y: -0.82 },
      { x: 0.04, y: -0.44 },
      { x: 0.12, y: -0.82 },
      { x: 0.44, y: -1 },
      { x: 0.76, y: -0.56 },
      { x: 0.76, y: 1 },
      { x: 0.24, y: 1 },
      { x: 0.76, y: 1 },
      { x: 0.76, y: -1 },
    ],
  },
  K: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 0.78, y: 1 },
      { x: 0, y: 0 },
      { x: 0.78, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 0.78, y: 1 },
      { x: 0, y: 0 },
      { x: 0.78, y: -1 },
    ],
  },
  L: {
    single: [
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 0.76, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 0.76, y: -1 },
    ],
  },
  M: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.4, y: -0.14 },
      { x: 0.8, y: 1 },
      { x: 0.8, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.4, y: -0.14 },
      { x: 0.8, y: 1 },
      { x: 0.8, y: -1 },
    ],
  },
  N: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.8, y: -1 },
      { x: 0.8, y: 1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.8, y: -1 },
      { x: 0.8, y: 1 },
      { x: 0.8, y: -1 },
    ],
  },
  O: {
    single: [
      { x: 0.4, y: -1 },
      { x: 0.04, y: -0.56 },
      { x: 0, y: 0 },
      { x: 0.04, y: 0.56 },
      { x: 0.4, y: 1 },
      { x: 0.76, y: 0.56 },
      { x: 0.8, y: 0 },
      { x: 0.76, y: -0.56 },
      { x: 0.4, y: -1 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.04, y: -0.56 },
      { x: 0, y: 0 },
      { x: 0.04, y: 0.56 },
      { x: 0.4, y: 1 },
      { x: 0.76, y: 0.56 },
      { x: 0.8, y: 0 },
      { x: 0.76, y: -0.56 },
      { x: 0.4, y: -1 },
    ],
  },
  P: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.56, y: 1 },
      { x: 0.78, y: 0.54 },
      { x: 0.56, y: 0.04 },
      { x: 0, y: 0.04 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.56, y: 1 },
      { x: 0.78, y: 0.54 },
      { x: 0.56, y: 0.04 },
      { x: 0, y: 0.04 },
      { x: 0, y: -1 },
      { x: 0.76, y: -1 },
    ],
  },
  Q: {
    single: [
      { x: 0.4, y: -1 },
      { x: 0.04, y: -0.56 },
      { x: 0, y: 0 },
      { x: 0.04, y: 0.56 },
      { x: 0.4, y: 1 },
      { x: 0.76, y: 0.56 },
      { x: 0.8, y: 0 },
      { x: 0.76, y: -0.56 },
      { x: 0.4, y: -1 },
      { x: 0.5, y: -0.44 },
      { x: 0.82, y: -1 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.04, y: -0.56 },
      { x: 0, y: 0 },
      { x: 0.04, y: 0.56 },
      { x: 0.4, y: 1 },
      { x: 0.76, y: 0.56 },
      { x: 0.8, y: 0 },
      { x: 0.76, y: -0.56 },
      { x: 0.4, y: -1 },
      { x: 0.5, y: -0.44 },
      { x: 0.82, y: -1 },
    ],
  },
  R: {
    single: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.56, y: 1 },
      { x: 0.78, y: 0.54 },
      { x: 0.56, y: 0.04 },
      { x: 0, y: 0.04 },
      { x: 0.28, y: 0.04 },
      { x: 0.8, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.56, y: 1 },
      { x: 0.78, y: 0.54 },
      { x: 0.56, y: 0.04 },
      { x: 0, y: 0.04 },
      { x: 0.28, y: 0.04 },
      { x: 0.8, y: -1 },
    ],
  },
  S: {
    single: [
      { x: 0.74, y: 0.72 },
      { x: 0.42, y: 1 },
      { x: 0.06, y: 0.74 },
      { x: 0.06, y: 0.26 },
      { x: 0.4, y: 0 },
      { x: 0.74, y: -0.26 },
      { x: 0.74, y: -0.74 },
      { x: 0.4, y: -1 },
      { x: 0.06, y: -0.72 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.06, y: -0.72 },
      { x: 0.4, y: -1 },
      { x: 0.74, y: -0.74 },
      { x: 0.74, y: -0.26 },
      { x: 0.4, y: 0 },
      { x: 0.06, y: 0.26 },
      { x: 0.06, y: 0.74 },
      { x: 0.42, y: 1 },
      { x: 0.74, y: 0.72 },
      { x: 0.42, y: 1 },
      { x: 0.06, y: 0.74 },
      { x: 0.06, y: 0.26 },
      { x: 0.4, y: 0 },
      { x: 0.74, y: -0.26 },
      { x: 0.74, y: -0.74 },
      { x: 0.4, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  T: {
    single: [
      { x: 0, y: 1 },
      { x: 0.8, y: 1 },
      { x: 0.4, y: 1 },
      { x: 0.4, y: -1 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.4, y: 1 },
      { x: 0, y: 1 },
      { x: 0.8, y: 1 },
      { x: 0.4, y: 1 },
      { x: 0.4, y: -1 },
    ],
  },
  U: {
    single: [
      { x: 0, y: 1 },
      { x: 0, y: -0.58 },
      { x: 0.22, y: -1 },
      { x: 0.58, y: -1 },
      { x: 0.8, y: -0.58 },
      { x: 0.8, y: 1 },
    ],
    joined: [
      { x: 0.22, y: -1 },
      { x: 0, y: -0.58 },
      { x: 0, y: 1 },
      { x: 0, y: -0.58 },
      { x: 0.22, y: -1 },
      { x: 0.58, y: -1 },
      { x: 0.8, y: -0.58 },
      { x: 0.8, y: 1 },
      { x: 0.8, y: -0.58 },
      { x: 0.58, y: -1 },
    ],
  },
  V: {
    single: [
      { x: 0, y: 1 },
      { x: 0.4, y: -1 },
      { x: 0.8, y: 1 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0, y: 1 },
      { x: 0.4, y: -1 },
      { x: 0.8, y: 1 },
      { x: 0.4, y: -1 },
    ],
  },
  W: {
    single: [
      { x: 0, y: 1 },
      { x: 0.2, y: -1 },
      { x: 0.4, y: 0.1 },
      { x: 0.6, y: -1 },
      { x: 0.8, y: 1 },
    ],
    joined: [
      { x: 0.2, y: -1 },
      { x: 0, y: 1 },
      { x: 0.2, y: -1 },
      { x: 0.4, y: 0.1 },
      { x: 0.6, y: -1 },
      { x: 0.8, y: 1 },
      { x: 0.6, y: -1 },
    ],
  },
  X: {
    single: [
      { x: 0, y: -1 },
      { x: 0.8, y: 1 },
      { x: 0.4, y: 0 },
      { x: 0, y: 1 },
      { x: 0.8, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0.8, y: 1 },
      { x: 0.4, y: 0 },
      { x: 0, y: 1 },
      { x: 0.8, y: -1 },
    ],
  },
  Y: {
    single: [
      { x: 0, y: 1 },
      { x: 0.4, y: 0 },
      { x: 0.8, y: 1 },
      { x: 0.4, y: 0 },
      { x: 0.4, y: -1 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.4, y: 0 },
      { x: 0, y: 1 },
      { x: 0.4, y: 0 },
      { x: 0.8, y: 1 },
      { x: 0.4, y: 0 },
      { x: 0.4, y: -1 },
    ],
  },
  Z: {
    single: [
      { x: 0, y: 1 },
      { x: 0.8, y: 1 },
      { x: 0, y: -1 },
      { x: 0.8, y: -1 },
    ],
    joined: [
      { x: 0, y: -1 },
      { x: 0.8, y: 1 },
      { x: 0, y: 1 },
      { x: 0.8, y: 1 },
      { x: 0, y: -1 },
      { x: 0.8, y: -1 },
    ],
  },
  '0': {
    single: [
      { x: 0.4, y: -1 },
      { x: 0.04, y: -0.56 },
      { x: 0, y: 0 },
      { x: 0.04, y: 0.56 },
      { x: 0.4, y: 1 },
      { x: 0.76, y: 0.56 },
      { x: 0.8, y: 0 },
      { x: 0.76, y: -0.56 },
      { x: 0.4, y: -1 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.04, y: -0.56 },
      { x: 0, y: 0 },
      { x: 0.04, y: 0.56 },
      { x: 0.4, y: 1 },
      { x: 0.76, y: 0.56 },
      { x: 0.8, y: 0 },
      { x: 0.76, y: -0.56 },
      { x: 0.4, y: -1 },
    ],
  },
  '1': {
    single: [
      { x: 0.16, y: 0.65 },
      { x: 0.44, y: 1 },
      { x: 0.44, y: -1 },
      { x: 0.14, y: -1 },
      { x: 0.74, y: -1 },
    ],
    joined: [
      { x: 0.14, y: -1 },
      { x: 0.44, y: -1 },
      { x: 0.44, y: 1 },
      { x: 0.16, y: 0.65 },
      { x: 0.44, y: 1 },
      { x: 0.44, y: -1 },
      { x: 0.74, y: -1 },
    ],
  },
  '2': {
    single: [
      { x: 0.06, y: 0.65 },
      { x: 0.4, y: 1 },
      { x: 0.74, y: 0.68 },
      { x: 0.74, y: 0.22 },
      { x: 0.04, y: -1 },
      { x: 0.78, y: -1 },
    ],
    joined: [
      { x: 0.04, y: -1 },
      { x: 0.74, y: 0.22 },
      { x: 0.74, y: 0.68 },
      { x: 0.4, y: 1 },
      { x: 0.06, y: 0.65 },
      { x: 0.4, y: 1 },
      { x: 0.74, y: 0.68 },
      { x: 0.74, y: 0.22 },
      { x: 0.04, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  '3': {
    single: [
      { x: 0.06, y: 0.75 },
      { x: 0.42, y: 1 },
      { x: 0.74, y: 0.62 },
      { x: 0.44, y: 0.04 },
      { x: 0.2, y: 0.04 },
      { x: 0.44, y: 0.04 },
      { x: 0.76, y: -0.55 },
      { x: 0.42, y: -1 },
      { x: 0.06, y: -0.75 },
    ],
    joined: [
      { x: 0.42, y: -1 },
      { x: 0.06, y: -0.75 },
      { x: 0.42, y: -1 },
      { x: 0.76, y: -0.55 },
      { x: 0.44, y: 0.04 },
      { x: 0.2, y: 0.04 },
      { x: 0.44, y: 0.04 },
      { x: 0.74, y: 0.62 },
      { x: 0.42, y: 1 },
      { x: 0.06, y: 0.75 },
      { x: 0.42, y: 1 },
      { x: 0.74, y: 0.62 },
      { x: 0.44, y: 0.04 },
      { x: 0.76, y: -0.55 },
      { x: 0.42, y: -1 },
      { x: 0.76, y: -1 },
    ],
  },
  '4': {
    single: [
      { x: 0.62, y: -1 },
      { x: 0.62, y: 1 },
      { x: 0.04, y: -0.25 },
      { x: 0.78, y: -0.25 },
    ],
    joined: [
      { x: 0.62, y: -1 },
      { x: 0.62, y: 1 },
      { x: 0.04, y: -0.25 },
      { x: 0.78, y: -0.25 },
      { x: 0.62, y: -0.25 },
      { x: 0.62, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  '5': {
    single: [
      { x: 0.76, y: 1 },
      { x: 0.06, y: 1 },
      { x: 0.06, y: 0.12 },
      { x: 0.5, y: 0.12 },
      { x: 0.76, y: -0.3 },
      { x: 0.72, y: -0.78 },
      { x: 0.38, y: -1 },
      { x: 0.04, y: -0.78 },
    ],
    joined: [
      { x: 0.38, y: -1 },
      { x: 0.04, y: -0.78 },
      { x: 0.38, y: -1 },
      { x: 0.72, y: -0.78 },
      { x: 0.76, y: -0.3 },
      { x: 0.5, y: 0.12 },
      { x: 0.06, y: 0.12 },
      { x: 0.06, y: 1 },
      { x: 0.76, y: 1 },
      { x: 0.06, y: 1 },
      { x: 0.06, y: 0.12 },
      { x: 0.5, y: 0.12 },
      { x: 0.76, y: -0.3 },
      { x: 0.72, y: -0.78 },
      { x: 0.38, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  '6': {
    single: [
      { x: 0.72, y: 0.82 },
      { x: 0.38, y: 1 },
      { x: 0.06, y: 0.55 },
      { x: 0.04, y: -0.58 },
      { x: 0.38, y: -1 },
      { x: 0.74, y: -0.62 },
      { x: 0.74, y: -0.12 },
      { x: 0.4, y: 0.12 },
      { x: 0.06, y: -0.12 },
    ],
    joined: [
      { x: 0.38, y: -1 },
      { x: 0.04, y: -0.58 },
      { x: 0.06, y: 0.55 },
      { x: 0.38, y: 1 },
      { x: 0.72, y: 0.82 },
      { x: 0.38, y: 1 },
      { x: 0.06, y: 0.55 },
      { x: 0.06, y: -0.12 },
      { x: 0.4, y: 0.12 },
      { x: 0.74, y: -0.12 },
      { x: 0.74, y: -0.62 },
      { x: 0.38, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  '7': {
    single: [
      { x: 0.04, y: 1 },
      { x: 0.78, y: 1 },
      { x: 0.28, y: -1 },
    ],
    joined: [
      { x: 0.28, y: -1 },
      { x: 0.78, y: 1 },
      { x: 0.04, y: 1 },
      { x: 0.78, y: 1 },
      { x: 0.28, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
  '8': {
    single: [
      { x: 0.4, y: -1 },
      { x: 0.06, y: -0.52 },
      { x: 0.4, y: 0 },
      { x: 0.08, y: 0.46 },
      { x: 0.4, y: 1 },
      { x: 0.72, y: 0.46 },
      { x: 0.4, y: 0 },
      { x: 0.74, y: -0.52 },
      { x: 0.4, y: -1 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.06, y: -0.52 },
      { x: 0.4, y: 0 },
      { x: 0.08, y: 0.46 },
      { x: 0.4, y: 1 },
      { x: 0.72, y: 0.46 },
      { x: 0.4, y: 0 },
      { x: 0.74, y: -0.52 },
      { x: 0.4, y: -1 },
    ],
  },
  '9': {
    single: [
      { x: 0.74, y: 0.12 },
      { x: 0.4, y: -0.12 },
      { x: 0.06, y: 0.22 },
      { x: 0.08, y: 0.72 },
      { x: 0.42, y: 1 },
      { x: 0.76, y: 0.68 },
      { x: 0.74, y: -0.65 },
      { x: 0.4, y: -1 },
      { x: 0.1, y: -0.82 },
    ],
    joined: [
      { x: 0.4, y: -1 },
      { x: 0.74, y: -0.65 },
      { x: 0.74, y: 0.12 },
      { x: 0.4, y: -0.12 },
      { x: 0.06, y: 0.22 },
      { x: 0.08, y: 0.72 },
      { x: 0.42, y: 1 },
      { x: 0.76, y: 0.68 },
      { x: 0.74, y: -0.65 },
      { x: 0.4, y: -1 },
      { x: 0.78, y: -1 },
    ],
  },
};

export function sanitizeAlphabetInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function recommendAlphabetKm(charCount: number): number {
  const n = Math.max(1, charCount);
  if (n === 1) return 3;
  if (n === 2) return 5;
  if (n === 3) return 7;
  if (n === 4) return 9;
  return 11;
}

/**
 * Builds a single unbroken continuous vector polyline for 1–6 uppercase letters or digits,
 * joining multiple characters cleanly along a street-aligned bottom baseline (y = -1)
 * and centering with preserved aspect ratio inside [-1, 1].
 */
export function buildAlphabetRunArtVertices(input: string): {
  text: string;
  charCount: number;
  vertices: Array<{ x: number; y: number }>;
} {
  const text = sanitizeAlphabetInput(input);
  if (!text) {
    return { text: '', charCount: 0, vertices: [] };
  }

  const chars = text.split('').filter((ch) => Boolean(ALPHABET_GLYPHS[ch]));
  if (chars.length === 0) {
    return { text: '', charCount: 0, vertices: [] };
  }

  const isMulti = chars.length > 1;
  const letterAdvance = 1.16; // 0.80 letter width + 0.36 clean street gap
  const combined: Array<{ x: number; y: number }> = [];

  chars.forEach((ch, idx) => {
    const def = ALPHABET_GLYPHS[ch];
    const pts = isMulti ? def.joined : def.single;
    const xOffset = idx * letterAdvance;
    pts.forEach((p) => {
      const worldPt = { x: p.x + xOffset, y: p.y };
      const prev = combined[combined.length - 1];
      if (!prev || Math.hypot(worldPt.x - prev.x, worldPt.y - prev.y) > 0.01) {
        combined.push(worldPt);
      }
    });
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of combined) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfSpan = Math.max(1e-4, Math.max(maxX - minX, maxY - minY) / 2);

  const vertices = combined.map((p) => ({
    x: Number(((p.x - cx) / halfSpan).toFixed(4)),
    y: Number(((p.y - cy) / halfSpan).toFixed(4)),
  }));

  return {
    text: chars.join(''),
    charCount: chars.length,
    vertices,
  };
}

/**
 * Curvature-aware anchor sampling (keeps sharp cusps intact when subsampling for fallback routing).
 */
export function adaptiveSampleShape(
  vertices: Array<{ x: number; y: number }>,
  maxAnchors = 12
): Array<{ x: number; y: number }> {
  if (vertices.length <= 2) return vertices;
  if (vertices.length >= maxAnchors) {
    const scored = vertices.map((v, i) => {
      if (i === 0 || i === vertices.length - 1) return { v, i, importance: Infinity };
      const prev = vertices[i - 1];
      const next = vertices[i + 1];
      const v1x = v.x - prev.x;
      const v1y = v.y - prev.y;
      const v2x = next.x - v.x;
      const v2y = next.y - v.y;
      const dot = v1x * v2x + v1y * v2y;
      const mag = Math.max(1e-6, Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
      const turnAngle = Math.acos(Math.max(-1, Math.min(1, dot / mag)));
      return { v, i, importance: turnAngle };
    });
    return [...scored]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxAnchors)
      .sort((a, b) => a.i - b.i)
      .map((item) => item.v);
  }
  return resample2DCurve(vertices, Math.min(maxAnchors, Math.max(vertices.length, 8)));
}

/**
 * Normalizes any custom user-drawn 2D points into centered [-1, 1] space.
 * When `autoClose` is true (Loop mode), closes the curve back to the start;
 * when false (`Any Start · Any End`), keeps the exact open endpoints!
 */
export function normalizeCustomSketch(
  rawPoints: Array<{ x: number; y: number }>,
  options?: { autoClose?: boolean }
): Array<{ x: number; y: number }> {
  if (rawPoints.length < 3) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rawPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfSpan = Math.max(1e-4, Math.max(maxX - minX, maxY - minY) / 2);

  // Flip Y so canvas top (-Y in screen) becomes north (+Y in geo)
  const normalized = rawPoints.map((p) => ({
    x: Number(((p.x - cx) / halfSpan).toFixed(4)),
    y: Number((-(p.y - cy) / halfSpan).toFixed(4)),
  }));

  const shouldAutoClose = options?.autoClose ?? true;
  if (shouldAutoClose) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.08) {
      normalized.push({ ...first });
    }
  }
  return normalized;
}

/**
 * Converts normalized 2D template coordinates into Chandigarh lat/lng anchored at `start`.
 */
export function projectShapeToChandigarhGeo(
  vertices: Array<{ x: number; y: number }>,
  start: LatLngLiteral,
  targetKm: number,
  rotationDeg: number,
  size: RunArtSize = 'standard',
  detourFactor = 1.28
): LatLngLiteral[] {
  const rotated = vertices.map((v) => rotatePoint(v, rotationDeg));
  let normalizedPerimeter = 0;
  for (let i = 1; i < rotated.length; i++) {
    normalizedPerimeter += Math.hypot(rotated[i].x - rotated[i - 1].x, rotated[i].y - rotated[i - 1].y);
  }

  const sizeMultiplier = size === 'compact' ? 0.85 : size === 'large' ? 1.15 : 1.0;
  const targetMeters = targetKm * 1000 * sizeMultiplier;
  const scaleMeters = targetMeters / (Math.max(1, normalizedPerimeter) * detourFactor);

  const originVertex = rotated[0];
  return rotated.map((v) => {
    const eastMeters = (v.x - originVertex.x) * scaleMeters;
    const northMeters = (v.y - originVertex.y) * scaleMeters;
    if (Math.hypot(eastMeters, northMeters) < 1) {
      return { lat: start.lat, lng: start.lng };
    }
    return offsetMetersToLatLng(start, eastMeters, northMeters);
  });
}

/**
 * Centers normalized 2D shape around `center` (for "Any Start · Any End" free-placement mode).
 */
export function projectShapeCenteredChandigarhGeo(
  vertices: Array<{ x: number; y: number }>,
  center: LatLngLiteral,
  targetKm: number,
  rotationDeg: number,
  size: RunArtSize = 'standard',
  detourFactor = 1.28
): LatLngLiteral[] {
  const rotated = vertices.map((v) => rotatePoint(v, rotationDeg));
  let normalizedPerimeter = 0;
  for (let i = 1; i < rotated.length; i++) {
    normalizedPerimeter += Math.hypot(rotated[i].x - rotated[i - 1].x, rotated[i].y - rotated[i - 1].y);
  }

  const sizeMultiplier = size === 'compact' ? 0.85 : size === 'large' ? 1.15 : 1.0;
  const targetMeters = targetKm * 1000 * sizeMultiplier;
  const scaleMeters = targetMeters / (Math.max(1, normalizedPerimeter) * detourFactor);

  return rotated.map((v) => {
    const eastMeters = v.x * scaleMeters;
    const northMeters = v.y * scaleMeters;
    if (Math.hypot(eastMeters, northMeters) < 1) {
      return { lat: center.lat, lng: center.lng };
    }
    return offsetMetersToLatLng(center, eastMeters, northMeters);
  });
}

function nearestChandigarhLandmark(pt: LatLngLiteral, fallback: string): string {
  let bestName = fallback;
  let bestDist = Infinity;
  for (const node of CHANDIGARH_WALK_NODES) {
    const d = haversineMeters(pt, node);
    if (d < bestDist) {
      bestDist = d;
      bestName = node.name;
    }
  }
  return bestName;
}

function densifyGuidePath(pts: LatLngLiteral[], pointsPerEdge = 2): LatLngLiteral[] {
  const out: LatLngLiteral[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (let s = 0; s < pointsPerEdge; s++) {
      const t = s / pointsPerEdge;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  if (pts.length > 0) out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Penalizes cul-de-sac whiskers / out-and-back retracing where consecutive edges fold >155° back over themselves.
 */
function computeBacktrackRatio(path: LatLngLiteral[]): number {
  if (path.length < 6) return 0;
  let reversals = 0;
  let totalSegs = 0;
  for (let i = 2; i < path.length; i++) {
    const dx1 = path[i - 1].lng - path[i - 2].lng;
    const dy1 = path[i - 1].lat - path[i - 2].lat;
    const dx2 = path[i].lng - path[i - 1].lng;
    const dy2 = path[i].lat - path[i - 1].lat;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 < 1e-6 || len2 < 1e-6) continue;
    totalSegs++;
    const cosAngle = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
    if (cosAngle < -0.9) reversals++;
  }
  return totalSegs > 0 ? reversals / totalSegs : 0;
}

/**
 * Evaluates HMM-snapped road routes using Discrete Frechet Distance, Bidirectional Hausdorff/Mean Boundary
 * proximity, Anti-Backtrack penalty, Distance Match, and Closure Completeness (normalized 0..1).
 *
 * Total Score = 0.60 * Shape Similarity + 0.25 * Distance Match + 0.15 * Route Completeness
 */
export function evaluateRunArtCandidateScores(
  intended: LatLngLiteral[],
  actual: LatLngLiteral[],
  targetMeters: number,
  actualMeters: number,
  options?: { allowOpenEnd?: boolean }
): {
  shapeSimilarityNorm: number;
  distanceMatchNorm: number;
  routeCompletenessNorm: number;
  totalScorePct: number;
  maxGapMeters: number;
  frechetMeters: number;
} {
  if (intended.length < 2 || actual.length < 2) {
    return {
      shapeSimilarityNorm: 0,
      distanceMatchNorm: 0,
      routeCompletenessNorm: 0,
      totalScorePct: 0,
      maxGapMeters: Infinity,
      frechetMeters: Infinity,
    };
  }

  const denseIntended = intended.length >= 24 ? intended : densifyGuidePath(intended, 3);

  let forwardErr = 0;
  for (const pt of denseIntended) {
    forwardErr += minDistanceToPathMeters(pt, actual);
  }
  const meanForward = forwardErr / denseIntended.length;

  const sampleStep = Math.max(1, Math.floor(actual.length / 40));
  const sampledActual = actual.filter((_, idx) => idx % sampleStep === 0 || idx === actual.length - 1);
  let backwardErr = 0;
  for (const pt of sampledActual) {
    backwardErr += minDistanceToPathMeters(pt, denseIntended);
  }
  const meanBackward = backwardErr / Math.max(1, sampledActual.length);

  const frechetMeters = discreteFrechetMeters(denseIntended, sampledActual);
  const boundaryMean = (meanForward + meanBackward) / 2;
  const backtrackRatio = computeBacktrackRatio(actual);

  // Blend sequential Frechet similarity (45%) + boundary Hausdorff mean (55%) - backtrack spike penalty
  const boundaryFloor = Math.max(160, targetMeters * 0.10);
  const frechetFloor = Math.max(380, targetMeters * 0.24);
  const boundaryScore = Math.max(0, Math.min(1, 1 - boundaryMean / boundaryFloor));
  const frechetScore = Math.max(0, Math.min(1, 1 - frechetMeters / frechetFloor));
  const shapeSimilarityNorm = Math.max(
    0,
    Math.min(1, 0.55 * boundaryScore + 0.45 * frechetScore - backtrackRatio * 0.4)
  );

  const relDistErr = Math.abs(actualMeters - targetMeters) / Math.max(1, targetMeters);
  const distanceMatchNorm = Math.max(0, Math.min(1, 1 - relDistErr));

  const maxGapMeters = computeMaxSegmentGapMeters(actual);
  const connectivityTerm = maxGapMeters <= 800 ? 1 : Math.max(0, 1 - (maxGapMeters - 800) / 800);

  let endpointTerm = 1;
  if (options?.allowOpenEnd) {
    const startSnapErr = haversineMeters(actual[0], intended[0]);
    const endSnapErr = haversineMeters(actual[actual.length - 1], intended[intended.length - 1]);
    const avgEndpointErr = (startSnapErr + endSnapErr) / 2;
    endpointTerm = avgEndpointErr <= 180 ? 1 : Math.max(0, 1 - (avgEndpointErr - 180) / 450);
  } else {
    const closureGap = haversineMeters(actual[0], actual[actual.length - 1]);
    endpointTerm = closureGap <= 120 ? 1 : Math.max(0, 1 - (closureGap - 120) / 350);
  }

  const routeCompletenessNorm = Math.max(0, Math.min(1, connectivityTerm * 0.65 + endpointTerm * 0.35));

  const totalNorm =
    0.6 * shapeSimilarityNorm + 0.25 * distanceMatchNorm + 0.15 * routeCompletenessNorm;

  return {
    shapeSimilarityNorm: Number(shapeSimilarityNorm.toFixed(3)),
    distanceMatchNorm: Number(distanceMatchNorm.toFixed(3)),
    routeCompletenessNorm: Number(routeCompletenessNorm.toFixed(3)),
    totalScorePct: Math.round(totalNorm * 100),
    maxGapMeters,
    frechetMeters: Math.round(frechetMeters),
  };
}

const CHANDIGARH_ART_ZONES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Sector 17 Central Grid', lat: 30.7408, lng: 76.7822 },
  { name: 'Sector 22 Pedestrian Grid', lat: 30.7318, lng: 76.7726 },
  { name: 'Rose Garden / Sector 16', lat: 30.7467, lng: 76.7827 },
  { name: 'Terraced Garden / Sector 33', lat: 30.7145, lng: 76.7728 },
  { name: 'Sector 35 Green Grid', lat: 30.7224, lng: 76.7669 },
  { name: 'Leisure Valley / Sector 10', lat: 30.7536, lng: 76.7879 },
];

const CHANDIGARH_NIGHT_ART_ZONES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Sector 17 Lit Central Grid', lat: 30.7408, lng: 76.7822 },
  { name: 'Sector 22 Shastri Market Grid', lat: 30.7318, lng: 76.7726 },
  { name: 'Sector 35 Lit Avenue Grid', lat: 30.7224, lng: 76.7669 },
  { name: 'Sector 15 Madhya Marg Grid', lat: 30.7518, lng: 76.7689 },
  { name: 'Sector 9 Jan Marg Grid', lat: 30.7468, lng: 76.7924 },
  { name: 'Sector 34 Lit Market Grid', lat: 30.7195, lng: 76.7695 },
];

export async function generateRunArtCandidates(
  provider: PedestrianRoutingProvider,
  template: RunArtTemplate,
  start: NamedLocation,
  targetKm: number,
  options?: {
    size?: RunArtSize;
    seedOffset?: number;
    anyStartAnyEnd?: boolean;
    loopCount?: number;
    nightMode?: boolean;
  }
): Promise<RunArtGenerationResult> {
  const size = options?.size || 'standard';
  const seedShift = ((options?.seedOffset || 0) * 30) % 360;
  const targetMeters = Math.max(1200, Math.round(targetKm * 1000));
  const anyStartAnyEnd = Boolean(options?.anyStartAnyEnd);
  const nightMode = Boolean(options?.nightMode);
  const artPreferences: RoutePreference[] = nightMode
    ? ['well_lit', 'pedestrian_paths']
    : ['parks_greenery', 'pedestrian_paths'];

  if (!anyStartAnyEnd && !isInsideChandigarh(start)) {
    throw new Error(
      'Starting pin is outside Chandigarh UT. Pick a Chandigarh location or switch to Any Start · Any End.'
    );
  }

  // Detect whether the template curve itself is open (start != end)
  const rawVerts = template.normalizedVertices;
  const isCurveOpen =
    rawVerts.length >= 2 &&
    Math.hypot(rawVerts[0].x - rawVerts[rawVerts.length - 1].x, rawVerts[0].y - rawVerts[rawVerts.length - 1].y) >
      0.12;
  const allowOpenEnd = anyStartAnyEnd || isCurveOpen;

  // Allow repeating Run Art shapes multiple laps (`loopCount`) to reach longer distances cleanly inside Chandigarh
  const requestedLoops = Math.max(1, Math.min(8, Math.round(options?.loopCount || 1)));
  const activeLoopCount = requestedLoops;
  const perLapKm = Math.max(0.8, targetKm / activeLoopCount);
  const perLapTargetMeters = Math.max(800, Math.round(perLapKm * 1000));

  // Resample smooth continuous curve for HMM Map Matching (up to 56 points for multi-letter alphabets; server limit is 60)
  const resampleTarget =
    template.id === 'alphabet'
      ? Math.min(56, Math.max(36, Math.round(template.normalizedVertices.length * 1.8)))
      : 32;
  const denseCurve = resample2DCurve(template.normalizedVertices, resampleTarget);
  const detourFactor =
    template.id === 'star' ||
    template.id === 'heart' ||
    template.id === 'lightning' ||
    template.id === 'infinity' ||
    template.id === 'alphabet' ||
    template.id === 'custom'
      ? 1.38
      : 1.24;

  const snapShapeToRoads = async (geoCurve: LatLngLiteral[]): Promise<ComputeRouteOutput> => {
    if (provider.traceArtShape) {
      try {
        return await provider.traceArtShape(geoCurve, artPreferences);
      } catch {
        // Fallback to multi-waypoint pedestrian route if HMM unavailable
      }
    }
    const fallbackAnchors = geoCurve.filter(
      (_, i) => i === 0 || i === geoCurve.length - 1 || i % 4 === 0
    );
    const originPt = anyStartAnyEnd ? geoCurve[0] : start;
    const destPt = allowOpenEnd ? geoCurve[geoCurve.length - 1] : originPt;
    return provider.computeWalkRoute(originPt, destPt, fallbackAnchors.slice(1, -1), artPreferences);
  };

  type TrialSpec = {
    anchor: { name: string; lat: number; lng: number };
    rot: number;
  };

  const trials: TrialSpec[] = [];
  const isAlphabet = template.id === 'alphabet';
  const activeZonePool = nightMode ? CHANDIGARH_NIGHT_ART_ZONES : CHANDIGARH_ART_ZONES;
  if (anyStartAnyEnd) {
    const zoneOffset = (options?.seedOffset || 0) % activeZonePool.length;
    const rotatedZones = [
      ...activeZonePool.slice(zoneOffset),
      ...activeZonePool.slice(0, zoneOffset),
    ];
    const selectedZones = rotatedZones.slice(0, 4);
    // Keep Alphabet Run Art upright (0° cardinal East or 36° aligned with Chandigarh sector grid)
    const gridAngles = isAlphabet ? [0, 36] : [36, -54];
    for (const z of selectedZones) {
      for (const a of gridAngles) {
        const rot = isAlphabet ? a : (a + seedShift + 360) % 360;
        trials.push({ anchor: z, rot });
      }
    }
  } else {
    const baseRotations = isAlphabet
      ? [0, 36, 18, -16]
      : start.lng > 76.805
      ? [-54, -144, 180, -90]
      : [36, 0, -54, 126];
    for (const r of baseRotations) {
      const rot = isAlphabet ? r : (r + seedShift + 360) % 360;
      trials.push({ anchor: start, rot });
    }
  }

  type ArtEval = {
    anchor: { name: string; lat: number; lng: number };
    rot: number;
    geoVertices: LatLngLiteral[];
    computed: ComputeRouteOutput;
    scores: ReturnType<typeof evaluateRunArtCandidateScores>;
    diffPct: number;
  };

  const projectFn = anyStartAnyEnd
    ? projectShapeCenteredChandigarhGeo
    : projectShapeToChandigarhGeo;

  const attemptArtPass = async (loopsToRun: number): Promise<ArtEval[]> => {
    const passLapKm = Math.max(0.8, targetKm / loopsToRun);
    const passLapMeters = Math.max(800, Math.round(passLapKm * 1000));

    const settled = await Promise.allSettled(
      trials.map(async (trial): Promise<ArtEval> => {
        let geoVertices = projectFn(
          denseCurve,
          trial.anchor,
          passLapKm,
          trial.rot,
          size,
          detourFactor
        );
        const invalidPts = geoVertices.filter(
          (v) =>
            isWaterOrRestrictedChandigarhPoint(v) ||
            !isInsideChandigarh(v) ||
            (nightMode && isNightHazardOrWildlifeZone(v).avoided)
        ).length;
        if (invalidPts > Math.floor(geoVertices.length / 8)) {
          throw new Error('Orientation exits Chandigarh UT or enters wildlife/unlit zone.');
        }

        let computed = await snapShapeToRoads(geoVertices);
        const initialDiff = Math.abs(computed.distanceMeters - passLapMeters) / passLapMeters;

        if (initialDiff > 0.24 && computed.distanceMeters > 400) {
          const calibratedKm = Math.min(
            passLapKm * 2.1,
            Math.max(passLapKm * 0.55, passLapKm * (passLapMeters / computed.distanceMeters))
          );
          const calVertices = projectFn(
            denseCurve,
            trial.anchor,
            calibratedKm,
            trial.rot,
            size,
            detourFactor
          );
          const calOutside = calVertices.filter(
            (v) => isWaterOrRestrictedChandigarhPoint(v) || !isInsideChandigarh(v)
          ).length;
          if (calOutside <= Math.floor(calVertices.length / 8)) {
            try {
              const recomputed = await snapShapeToRoads(calVertices);
              const newDiff = Math.abs(recomputed.distanceMeters - passLapMeters) / passLapMeters;
              if (
                newDiff < initialDiff &&
                recomputed.path.length >= 4 &&
                isPathInsideChandigarh(recomputed.path)
              ) {
                geoVertices = calVertices;
                computed = recomputed;
              }
            } catch {
              // Keep initial geometry if recalibration fails
            }
          }
        }

        if (!isPathInsideChandigarh(computed.path)) {
          throw new Error('Snapped Run Art route exited Chandigarh UT.');
        }

        const scores = evaluateRunArtCandidateScores(
          geoVertices,
          computed.path,
          passLapMeters,
          computed.distanceMeters,
          { allowOpenEnd }
        );

        if (scores.maxGapMeters > 1500 || computed.path.length < 4) {
          throw new Error('Route contains disconnected pedestrian segments.');
        }

        const isLapOpen =
          haversineMeters(computed.path[0], computed.path[computed.path.length - 1]) > 140;

        let finalComputed: ComputeRouteOutput = computed;
        if (loopsToRun > 1) {
          if (isLapOpen) {
            // Ping-pong along exact open artwork streets (forward then return reverse) with zero chord jumps
            const pingPongPath: LatLngLiteral[] = [...computed.path];
            const pingPongSteps = computed.steps.map((st, idx) =>
              idx === 0 ? { ...st, instruction: `Lap 1 of ${loopsToRun}: ${st.instruction}` } : st
            );
            for (let lap = 2; lap <= loopsToRun; lap++) {
              const segment = lap % 2 === 0 ? [...computed.path].reverse() : computed.path;
              pingPongPath.push(...segment.slice(1));
              pingPongSteps.push({
                instruction:
                  lap % 2 === 0
                    ? `Lap ${lap} of ${loopsToRun}: Return along letter/shape path`
                    : `Lap ${lap} of ${loopsToRun}: Trace forward along letter/shape path`,
                distanceMeters: computed.distanceMeters,
                durationSec: computed.durationSec,
                startLocation: segment[0],
              });
            }
            finalComputed = {
              ...computed,
              path: pingPongPath,
              steps: pingPongSteps,
              distanceMeters: computed.distanceMeters * loopsToRun,
              durationSec: computed.durationSec * loopsToRun,
            };
          } else {
            const repeated = repeatRouteLaps(
              computed.path,
              computed.steps,
              computed.distanceMeters,
              computed.durationSec,
              loopsToRun
            );
            finalComputed = {
              ...computed,
              path: repeated.path,
              steps: repeated.steps,
              distanceMeters: repeated.distanceMeters,
              durationSec: repeated.durationSec,
            };
          }
        }

        const diffPct = Math.round(
          (Math.abs(finalComputed.distanceMeters - targetMeters) / targetMeters) * 100
        );

        return { anchor: trial.anchor, rot: trial.rot, geoVertices, computed: finalComputed, scores, diffPct };
      })
    );

    const fulfilled = settled
      .filter((r): r is PromiseFulfilledResult<ArtEval> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (nightMode) {
      const safeOnly = fulfilled.filter((ev) => {
        const ns = getNightSafetyStatsForPath(ev.computed.path);
        return ns.wildlifeHits === 0 && ns.desertedHits === 0;
      });
      if (safeOnly.length > 0) {
        return safeOnly.sort((a, b) => b.scores.totalScorePct - a.scores.totalScorePct);
      }
    }

    return fulfilled.sort((a, b) => b.scores.totalScorePct - a.scores.totalScorePct);
  };

  let usedLoopCount = activeLoopCount;
  let valid = await attemptArtPass(usedLoopCount);

  // If a large single-lap closed artwork spilled outside Chandigarh UT, automatically try 2x/3x inner laps
  if (valid.length === 0 && usedLoopCount === 1 && !isCurveOpen && targetKm >= 6) {
    for (const autoLoops of [2, 3]) {
      valid = await attemptArtPass(autoLoops);
      if (valid.length > 0) {
        usedLoopCount = autoLoops;
        break;
      }
    }
  }
  void perLapTargetMeters;

  if (valid.length === 0) {
    throw new Error(
      `Could not form a clean connected ${template.name} (${targetKm} km) inside Chandigarh UT. Try 4–8 km, enable Any Start · Any End, or increase Loops (2×–3×).`
    );
  }

  const topCandidates = valid.slice(0, 3);
  const labels = anyStartAnyEnd
    ? ['Best Chandigarh Fit', 'Alternative Sector Grid', 'Open Alignment']
    : ['Best Match', 'Grid Alignment', 'Alternative Orientation'];

  const lapTag = usedLoopCount > 1 ? ` (${usedLoopCount}× Laps)` : '';

  const routes: GeneratedRouteCandidate[] = topCandidates.map((ev, idx) => {
    const durationSec = Math.round((ev.computed.distanceMeters / 1000) * 375);
    const actualStartPt = ev.computed.path[0] || ev.anchor;
    const actualEndPt = ev.computed.path[ev.computed.path.length - 1] || actualStartPt;
    const startName = anyStartAnyEnd
      ? nearestChandigarhLandmark(actualStartPt, ev.anchor.name)
      : start.name;
    const endName = allowOpenEnd
      ? nearestChandigarhLandmark(actualEndPt, startName)
      : start.name;
    const routeStart: NamedLocation = {
      name: startName,
      city: 'Chandigarh',
      lat: actualStartPt.lat,
      lng: actualStartPt.lng,
    };
    const routeEnd: NamedLocation = allowOpenEnd
      ? {
          name: endName,
          city: 'Chandigarh',
          lat: actualEndPt.lat,
          lng: actualEndPt.lng,
        }
      : start;

    const name = anyStartAnyEnd
      ? `${template.name} · ${ev.anchor.name}${lapTag}`
      : `${template.name} — ${start.name}${lapTag}`;

    const chars = [
      ...(nightMode ? ['Night Safe · Lit Streets'] : []),
      `${template.name} (${size})`,
      `${ev.scores.totalScorePct}% Fréchet/HMM match`,
      usedLoopCount > 1
        ? `${usedLoopCount}× repeated Chandigarh laps`
        : anyStartAnyEnd
        ? 'Auto Chandigarh start & end'
        : 'Closed start/finish loop',
    ].slice(0, 3);

    return {
      id: `art-${template.id}-${idx}-${Date.now()}`,
      label: labels[idx] || 'Alternative',
      name,
      routeType: 'run_art',
      distanceMeters: ev.computed.distanceMeters,
      targetDistanceMeters: targetMeters,
      durationSec,
      elevationGainMeters: null,
      start: routeStart,
      end: routeEnd,
      encodedPolyline: encodePolyline(ev.computed.path),
      path: ev.computed.path,
      geoJson: buildGeoJsonLineString(ev.computed.path, {
        name,
        routeType: 'run_art',
        distanceMeters: ev.computed.distanceMeters,
        durationSec,
        routingProvider: ev.computed.providerName,
      }),
      steps: ev.computed.steps,
      kmMarkers: computeKmMarkers(ev.computed.path),
      characteristics: chars,
      surfaceSummary: nightMode
        ? 'Well-lit Chandigarh streets & sidewalks (avoids wildlife & unlit zones)'
        : usedLoopCount > 1
        ? `${usedLoopCount}× repeated HMM-matched Chandigarh street laps`
        : 'HMM-matched Chandigarh pedestrian streets & park footpaths',
      routingProvider: ev.computed.providerName,
      preferences: artPreferences,
      difficulty: targetKm >= 10 ? 'challenging' : targetKm >= 5 ? 'moderate' : 'easy',
      toleranceDiffPct: ev.diffPct,
      matchScore: ev.scores.totalScorePct,
      shapeSimilarityNorm: ev.scores.shapeSimilarityNorm,
      distanceMatchNorm: ev.scores.distanceMatchNorm,
      routeCompletenessNorm: ev.scores.routeCompletenessNorm,
      loopCount: usedLoopCount > 1 ? usedLoopCount : undefined,
      intendedShapePath: ev.geoVertices,
      approximateMatchWarning:
        usedLoopCount > activeLoopCount
          ? `Built as ${usedLoopCount}× Chandigarh laps to keep the ${template.name} strictly inside Chandigarh UT.`
          : ev.scores.totalScorePct < 70
          ? `Approximate match (${ev.scores.totalScorePct}%): Chandigarh sector blocks adjust curves to real walkable streets. Try 5–8 km for sharper silhouettes.`
          : undefined,
    };
  });

  if (routes[0]) {
    routes[0].elevationGainMeters = await fetchOptionalElevation(routes[0].path);
  }

  return {
    routes,
    warning: routes[0]?.approximateMatchWarning,
  };
}

export async function generateRunArtRoute(
  provider: PedestrianRoutingProvider,
  template: RunArtTemplate,
  start: NamedLocation,
  targetKm: number
): Promise<GeneratedRouteCandidate> {
  const res = await generateRunArtCandidates(provider, template, start, targetKm);
  return res.routes[0];
}

export function exportRunArtPng(
  title: string,
  distanceKm: number,
  matchScore: number,
  intended: LatLngLiteral[],
  actual: LatLngLiteral[]
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#172D27';
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.strokeStyle = 'rgba(184, 232, 199, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 90; i < 1080; i += 90) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1080);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1080, i);
    ctx.stroke();
  }

  const allPts = [...intended, ...actual];
  if (allPts.length > 1) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of allPts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((midLat * Math.PI) / 180);
    const pad = 170;
    const spanLat = Math.max(0.001, maxLat - minLat);
    const spanLngScaled = Math.max(0.001, (maxLng - minLng) * cosLat);
    const scale = Math.min((1080 - pad * 2) / spanLngScaled, (840 - pad * 2) / spanLat);

    const toXY = (p: LatLngLiteral) => ({
      x: 540 + (p.lng - (minLng + maxLng) / 2) * cosLat * scale,
      y: 470 - (p.lat - midLat) * scale,
    });

    if (intended.length > 1) {
      ctx.save();
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = 'rgba(184, 232, 199, 0.38)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      intended.forEach((p, idx) => {
        const { x, y } = toXY(p);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    if (actual.length > 1) {
      ctx.strokeStyle = '#9AE62E';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      actual.forEach((p, idx) => {
        const { x, y } = toXY(p);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Start & Finish marker pins (show S/F when loop, or S & F separately when open)
      const startXY = toXY(actual[0]);
      const endXY = toXY(actual[actual.length - 1]);
      const isLoop = Math.hypot(startXY.x - endXY.x, startXY.y - endXY.y) < 18;

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(startXY.x, startXY.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#172D27';
      ctx.font = '700 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isLoop ? 'S/F' : 'S', startXY.x, startXY.y + 1);

      if (!isLoop) {
        ctx.fillStyle = '#30483E';
        ctx.beginPath();
        ctx.arc(endXY.x, endXY.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('F', endXY.x, endXY.y + 1);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '600 24px sans-serif';
  ctx.fillText('TRICITY RUN  ·  CHANDIGARH RUN ART', 72, 92);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px sans-serif';
  ctx.fillText(title, 72, 935, 936);

  ctx.fillStyle = '#B8E8C7';
  ctx.font = '600 28px monospace';
  ctx.fillText(`${distanceKm.toFixed(2)} KM  ·  ${matchScore}% SHAPE MATCH`, 72, 990);

  return canvas.toDataURL('image/png');
}
