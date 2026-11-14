import type { LatLngLiteral, NamedLocation, TricityPlace } from '../types/run';

export const TRICITY_CENTER = { lat: 30.7333, lng: 76.7794 };

export const TRICITY_START_PRESETS: NamedLocation[] = [
  { name: 'Sukhna Lake Promenade', city: 'Chandigarh', lat: 30.7421, lng: 76.8188 },
  { name: 'Sector 17 Plaza & Green Belt', city: 'Chandigarh', lat: 30.7415, lng: 76.7824 },
  { name: 'Leisure Valley (Sector 10)', city: 'Chandigarh', lat: 30.7536, lng: 76.7879 },
  { name: 'Rose Garden Loop (Sector 16)', city: 'Chandigarh', lat: 30.7467, lng: 76.7827 },
  { name: 'Terraced Garden (Sector 33)', city: 'Chandigarh', lat: 30.7145, lng: 76.7728 },
  { name: 'Garden of Fragrance (Sector 36)', city: 'Chandigarh', lat: 30.7285, lng: 76.7599 },
];

export const VERIFIED_TRICITY_PLACES: TricityPlace[] = [
  {
    id: 'sukhna-lake',
    name: 'Sukhna Lake Promenade',
    city: 'Chandigarh',
    area: 'Sector 1',
    description: 'Traffic-free lakeside promenade with soft brick-paved shoulder, shaded tree canopy, drinking water kiosks, and Shivalik views.',
    lat: 30.7421,
    lng: 76.8188,
    imageUrl: '/images/place_sukhna_lake_1794574349339.jpg',
    paths: ['2.9 km Lakefront Main Track', '5.8 km Out-and-Back Embankment', '10 km Sukhna + Rock Garden Loop'],
    suggestedDistancesKm: [3, 5, 10, 15],
    surface: 'Asphalt & Stone Track',
    lighting: 'Promenade streetlighting present',
    lastVerified: 'Nov 2026',
    tags: ['Traffic-Free', 'Waterfront', 'Flat'],
  },
  {
    id: 'leisure-valley',
    name: 'Leisure Valley Green Corridor',
    city: 'Chandigarh',
    area: 'Sectors 10, 16, 23 & 36',
    description: 'Continuous 8 km north-south park spine connecting Rose Garden, Bougainvillea Garden, and Shanti Kunj with shaded footpaths.',
    lat: 30.7536,
    lng: 76.7879,
    imageUrl: '/images/place_leisure_valley_1794574349295.jpg',
    paths: ['3 km Rose Garden Loop', '5 km Sector 10–16 Spine', '8.2 km Full Valley Out-and-Back'],
    suggestedDistancesKm: [3, 5, 8, 10],
    surface: 'Paved Park Path & Mud Verge',
    lighting: 'Park Path Lighting',
    lastVerified: 'Nov 2026',
    tags: ['Parks', 'Tree Canopy', 'Low Traffic'],
  },
  {
    id: 'rose-garden-16',
    name: 'Zakir Hussain Rose Garden & Shanti Kunj',
    city: 'Chandigarh',
    area: 'Sector 16',
    description: 'Shaded heritage garden tracks linked seamlessly via pedestrian underpasses to Sector 17 Plaza and Cricket Stadium green belts.',
    lat: 30.7467,
    lng: 76.7827,
    imageUrl: '/images/place_leisure_valley_1794574349295.jpg',
    paths: ['2 km Garden Inner Track', '5 km Sector 16–17–9 Loop', '10 km Central Sector Grid'],
    suggestedDistancesKm: [2, 5, 10],
    surface: 'Paved Garden Path & Sidewalk',
    lighting: 'Park & Street Lit',
    lastVerified: 'Nov 2026',
    tags: ['Gardens', 'Central', 'Shaded'],
  },
  {
    id: 'bougainvillea-sector-3',
    name: 'Bougainvillea Garden & Capitol Grid',
    city: 'Chandigarh',
    area: 'Sector 3 / Sector 4',
    description: 'Quiet north Chandigarh avenues bordering the foothills, ideal for crisp tempo sessions and flat marathon-prep loops.',
    lat: 30.7568,
    lng: 76.7942,
    imageUrl: '/images/place_panchkula_park_1794574350479.jpg',
    paths: ['3 km Sector 3–4 Loop', '5 km Jan Marg & Park Spine', '10 km Northern Foothill Loop'],
    suggestedDistancesKm: [3, 5, 10, 15],
    surface: 'Smooth Asphalt & Sidewalk',
    lighting: 'Wide Boulevard Streetlights',
    lastVerified: 'Nov 2026',
    tags: ['Quiet', 'Wide Sidewalks', 'Tempo Friendly'],
  },
  {
    id: 'terraced-garden-33',
    name: 'Terraced Garden & Sector 33–34 Circuit',
    city: 'Chandigarh',
    area: 'Sector 33 / 34',
    description: 'South-central community park circuit connected to quiet tree-lined internal sector lanes with minimal vehicular crossings.',
    lat: 30.7145,
    lng: 76.7728,
    imageUrl: '/images/place_mohali_park_1794574350384.jpg',
    paths: ['1.5 km Terraced Garden Loop', '5 km Sector 33–34–21 Loop', '10 km Dakshin Green Grid'],
    suggestedDistancesKm: [2, 5, 10],
    surface: 'Paved Park Walk & Asphalt',
    lighting: 'Park & Avenue Streetlights',
    lastVerified: 'Nov 2026',
    tags: ['Neighborhood', 'Flat Loop'],
  },
  {
    id: 'garden-of-fragrance-36',
    name: 'Garden of Fragrance & Sector 36 Green Belt',
    city: 'Chandigarh',
    area: 'Sector 36 / 35',
    description: 'Fragrant botanical green belt along the western Leisure Valley branch, offering long unbroken shaded paths for daily runs.',
    lat: 30.7285,
    lng: 76.7599,
    imageUrl: '/images/place_leisure_valley_1794574349295.jpg',
    paths: ['2 km Garden Perimeter', '5 km Sector 36–35–23 Loop', '10 km West Valley Long Run'],
    suggestedDistancesKm: [2, 5, 10],
    surface: 'Paved Walkway & Soil Shoulder',
    lighting: 'Park & Avenue Lit',
    lastVerified: 'Nov 2026',
    tags: ['Parks', 'Tree Canopy', 'Low Traffic'],
  },
];

/**
 * Verified Chandigarh inter-sector green belts, neighbourhood park trails,
 * Leisure Valley spines, and narrow pedestrian passes/subways connecting sectors.
 */
export const CHANDIGARH_PARK_AND_PASS_NODES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Bougainvillea Garden Footpath (Sec 3)', lat: 30.7574, lng: 76.7926 },
  { name: 'Leisure Valley North Spine (Sec 10)', lat: 30.7536, lng: 76.7879 },
  { name: 'Shanti Kunj Green Pass (Sec 16)', lat: 30.7501, lng: 76.7848 },
  { name: 'Rose Garden Pedestrian Underpass (Sec 16–17)', lat: 30.7444, lng: 76.7829 },
  { name: 'Sector 17–22 Pedestrian Subway', lat: 30.7358, lng: 76.7768 },
  { name: 'Bamboo Valley & Sec 23–24 Pass', lat: 30.7385, lng: 76.7689 },
  { name: 'Sector 15–16 Park Connector Pass', lat: 30.7495, lng: 76.7746 },
  { name: 'Sector 8–9 Inner Green Trail', lat: 30.7438, lng: 76.7947 },
  { name: 'Sector 7–26 Green Belt Pass', lat: 30.7318, lng: 76.8034 },
  { name: 'Tagore Park Pass (Sec 18–19)', lat: 30.7346, lng: 76.7885 },
  { name: 'Sector 21–22 Green Spine Footpath', lat: 30.7279, lng: 76.7765 },
  { name: 'Sector 20–30 Park Corridor', lat: 30.7192, lng: 76.7811 },
  { name: 'Topiary Park Inner Trail (Sec 35)', lat: 30.7239, lng: 76.7644 },
  { name: 'Hibiscus & Fragrance Garden Pass (Sec 36)', lat: 30.7296, lng: 76.7576 },
  { name: 'Terraced Garden Inner Track (Sec 33)', lat: 30.7145, lng: 76.7728 },
  { name: 'Japanese Garden Track (Sec 31)', lat: 30.7034, lng: 76.7849 },
  { name: 'Butterfly Park Trail (Sec 26)', lat: 30.7255, lng: 76.8089 },
  { name: 'Sector 37–38 West Green Belt', lat: 30.7445, lng: 76.7518 },
  { name: 'Sector 40–41 Park Connector Pass', lat: 30.7364, lng: 76.7429 },
  { name: 'Sector 44–45 Fitness Park Spine', lat: 30.7069, lng: 76.7591 },
  { name: 'Sector 46–47 Green Belt Walk', lat: 30.6989, lng: 76.7664 },
];

/**
 * Verified street-accessible pedestrian intersections and park entry points
 * across Chandigarh Sectors (strictly avoiding Sukhna Lake water/sanctuary & gated interiors).
 */
export const CHANDIGARH_WALK_NODES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Sukhna Lake West Entry', lat: 30.7421, lng: 76.8181 },
  { name: 'Sukhna South Promenade Rd', lat: 30.7358, lng: 76.8144 },
  { name: 'Rock Garden / Sector 1 Rd', lat: 30.7525, lng: 76.8058 },
  { name: 'Sector 4 / Uttar Marg', lat: 30.7576, lng: 76.7988 },
  { name: 'Sector 5 / Lake Approach', lat: 30.7462, lng: 76.8104 },
  { name: 'Sector 7 / Madhya Marg', lat: 30.7339, lng: 76.8027 },
  { name: 'Sector 8 Inner Green Spine', lat: 30.7406, lng: 76.7966 },
  { name: 'Sector 9 / Jan Marg', lat: 30.7478, lng: 76.7924 },
  { name: 'Leisure Valley Sector 10', lat: 30.7536, lng: 76.7879 },
  { name: 'Sector 11 Outer Avenue', lat: 30.7592, lng: 76.7798 },
  { name: 'Sector 15 / Madhya Marg', lat: 30.7518, lng: 76.7689 },
  { name: 'Rose Garden Sector 16', lat: 30.7467, lng: 76.7827 },
  { name: 'Sector 17 Plaza North', lat: 30.7415, lng: 76.7824 },
  { name: 'Sector 18 / 19 Crossing', lat: 30.7327, lng: 76.7872 },
  { name: 'Sector 26 / Grain Market Rd', lat: 30.7283, lng: 76.8075 },
  { name: 'Sector 27 / 28 Green Belt', lat: 30.7219, lng: 76.7995 },
  { name: 'Sector 20 / 21 Park Axis', lat: 30.7244, lng: 76.7819 },
  { name: 'Sector 22 / Shastri Market Rd', lat: 30.7318, lng: 76.7726 },
  { name: 'Sector 23 / 24 Spine', lat: 30.7402, lng: 76.7641 },
  { name: 'Sector 36 Fragrance Path', lat: 30.7285, lng: 76.7599 },
  { name: 'Sector 35 / 34 Green Belt', lat: 30.7224, lng: 76.7669 },
  { name: 'Terraced Garden Sector 33', lat: 30.7145, lng: 76.7728 },
  { name: 'Sector 32 / 31 Park Rd', lat: 30.7082, lng: 76.7815 },
  { name: 'Sector 43 / 44 Green Walk', lat: 30.7148, lng: 76.7529 },
  { name: 'Sector 42 New Lake Path', lat: 30.7235, lng: 76.7445 },
  ...CHANDIGARH_PARK_AND_PASS_NODES,
];

/**
 * Well-lit Chandigarh sector avenues, active commercial plazas, and residential main spines
 * prioritized during Night Run Mode.
 */
export const CHANDIGARH_NIGHT_LIT_NODES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Sector 17 Plaza & Jan Marg Lit Spine', lat: 30.7415, lng: 76.7824 },
  { name: 'Sector 22 Shastri Market & Himalaya Marg', lat: 30.7318, lng: 76.7726 },
  { name: 'Sector 35 Market & Dakshin Marg Lit Ave', lat: 30.7224, lng: 76.7669 },
  { name: 'Sector 15 Market & Madhya Marg', lat: 30.7518, lng: 76.7689 },
  { name: 'Sector 8–9 Madhya Marg Lit Corridor', lat: 30.7406, lng: 76.7966 },
  { name: 'Sector 9 Jan Marg & Market Strip', lat: 30.7478, lng: 76.7924 },
  { name: 'Sector 10 Museum & Panjab Univ Ave', lat: 30.7545, lng: 76.7815 },
  { name: 'Sector 7 Madhya Marg Lit Avenue', lat: 30.7339, lng: 76.8027 },
  { name: 'Sector 19 / 27 Lit Sector Crossing', lat: 30.7288, lng: 76.7952 },
  { name: 'Sector 20 / 21 Lit Main Avenue', lat: 30.7244, lng: 76.7819 },
  { name: 'Sector 34 / 33 Lit Market Avenue', lat: 30.7195, lng: 76.7695 },
  { name: 'Sector 36 / 37 Lit Boulevard', lat: 30.7285, lng: 76.7599 },
  { name: 'Sector 43 / 44 Lit Main Road', lat: 30.7148, lng: 76.7529 },
  { name: 'Sukhna Lake Main Lit Front (West)', lat: 30.7421, lng: 76.8181 },
];

export interface NightAvoidZone {
  id: string;
  name: string;
  reason: 'wildlife' | 'unlit' | 'deserted';
  center: LatLngLiteral;
  radiusMeters: number;
  /** Compact bounding box [minLng, minLat, maxLng, maxLat] for Valhalla exclude_polygons */
  bbox: [number, number, number, number];
}

/**
 * Chandigarh zones avoided in Night Run Mode: wildlife sanctuaries, forest edges,
 * unlit park ravines, and deserted industrial/airport strips.
 */
export const CHANDIGARH_NIGHT_AVOID_ZONES: NightAvoidZone[] = [
  {
    id: 'sukhna-wildlife-sanctuary',
    name: 'Sukhna Wildlife Sanctuary & Rear Forest Trail',
    reason: 'wildlife',
    center: { lat: 30.7505, lng: 76.8275 },
    radiusMeters: 950,
    bbox: [76.8215, 30.7435, 76.8335, 30.7565],
  },
  {
    id: 'dhanas-sarangpur-wildlife',
    name: 'Dhanas Lake & Patiala Ki Rao Forest Edge',
    reason: 'wildlife',
    center: { lat: 30.7595, lng: 76.7435 },
    radiusMeters: 850,
    bbox: [76.7345, 30.7545, 76.7485, 30.7645],
  },
  {
    id: 'botanical-rock-woods',
    name: 'Capitol / Rock Garden Rear Forest Belt',
    reason: 'wildlife',
    center: { lat: 30.7585, lng: 76.8115 },
    radiusMeters: 620,
    bbox: [76.8065, 30.7540, 76.8170, 30.7635],
  },
  {
    id: 'industrial-airport-deserted',
    name: 'Industrial Area Phase I–II & Airport Dark Strip',
    reason: 'deserted',
    center: { lat: 30.6995, lng: 76.8045 },
    radiusMeters: 950,
    bbox: [76.7965, 30.6915, 76.8115, 30.7060],
  },
  {
    id: 'butterfly-kishangarh-edge',
    name: 'Butterfly Park & Kishangarh Forest Buffer',
    reason: 'wildlife',
    center: { lat: 30.7285, lng: 76.8225 },
    radiusMeters: 650,
    bbox: [76.8175, 30.7240, 76.8285, 30.7335],
  },
  {
    id: 'leisure-valley-dark-choe',
    name: 'Deep Leisure Valley Unlit Ravine Interior',
    reason: 'unlit',
    center: { lat: 30.7512, lng: 76.7862 },
    radiusMeters: 210,
    bbox: [76.7845, 30.7495, 76.7880, 30.7528],
  },
  {
    id: 'west-choe-sec42-edge',
    name: 'Sector 42 New Lake / West Forest Edge',
    reason: 'unlit',
    center: { lat: 30.7235, lng: 76.7365 },
    radiusMeters: 520,
    bbox: [76.7315, 30.7195, 76.7410, 30.7275],
  },
];

function approxDistMeters(a: LatLngLiteral, b: LatLngLiteral): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}

export function isNightHazardOrWildlifeZone(pt: LatLngLiteral): {
  avoided: boolean;
  reason?: 'wildlife' | 'unlit' | 'deserted';
  zoneName?: string;
} {
  for (const zone of CHANDIGARH_NIGHT_AVOID_ZONES) {
    if (approxDistMeters(pt, zone.center) <= zone.radiusMeters) {
      return { avoided: true, reason: zone.reason, zoneName: zone.name };
    }
  }
  return { avoided: false };
}

export function getNightSafetyStatsForPath(path: LatLngLiteral[]): {
  wildlifeHits: number;
  desertedHits: number;
  unlitHits: number;
  litHits: number;
  avoidedNames: string[];
} {
  if (path.length === 0) {
    return { wildlifeHits: 0, desertedHits: 0, unlitHits: 0, litHits: 0, avoidedNames: [] };
  }
  let wildlifeHits = 0;
  let desertedHits = 0;
  let unlitHits = 0;
  let litHits = 0;
  const seenAvoided = new Set<string>();
  const step = Math.max(1, Math.floor(path.length / 36));

  for (let i = 0; i < path.length; i += step) {
    const pt = path[i];
    const haz = isNightHazardOrWildlifeZone(pt);
    if (haz.avoided) {
      if (haz.zoneName) seenAvoided.add(haz.zoneName);
      if (haz.reason === 'wildlife') wildlifeHits += 1;
      else if (haz.reason === 'deserted') desertedHits += 1;
      else unlitHits += 1;
    } else if (CHANDIGARH_NIGHT_LIT_NODES.some((n) => approxDistMeters(pt, n) < 380)) {
      litHits += 1;
    }
  }
  return {
    wildlifeHits,
    desertedHits,
    unlitHits,
    litHits,
    avoidedNames: Array.from(seenAvoided),
  };
}

/**
 * Selects up to 2 compact exclude polygons closest to the target point so total circumference stays
 * safely below Valhalla's 10,000m limit while blocking wildlife & deserted corridors.
 */
export function getNightExcludePolygonsForPoint(center: LatLngLiteral): Array<Array<[number, number]>> {
  return [...CHANDIGARH_NIGHT_AVOID_ZONES]
    .filter((z) => z.reason === 'wildlife' || z.reason === 'deserted')
    .sort((a, b) => approxDistMeters(center, a.center) - approxDistMeters(center, b.center))
    .slice(0, 2)
    .map((z) => {
      const [minLng, minLat, maxLng, maxLat] = z.bbox;
      return [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ];
    });
}

export function isWaterOrRestrictedChandigarhPoint(pt: LatLngLiteral): boolean {
  // Sukhna Lake water body & Sukhna Wildlife Sanctuary to the NE
  if (pt.lat > 30.7385 && pt.lng > 76.8195) return true;
  // Sukhna southern marsh/forest edge
  if (pt.lat > 30.732 && pt.lng > 76.828) return true;
  // Chandigarh Golf Club interior (walled)
  if (pt.lat > 30.735 && pt.lat < 30.7445 && pt.lng > 76.8065 && pt.lng < 76.8165) return true;
  // Chandigarh Airport / Air Force restricted zone in south-east
  if (pt.lat < 30.684 && pt.lng > 76.778) return true;
  return false;
}

/**
 * Chandigarh Union Territory polygon (excludes Mohali, Panchkula, Zirakpur, Kharar, and Mullanpur/Nayagaon).
 */
export const CHANDIGARH_UT_POLYGON: LatLngLiteral[] = [
  { lat: 30.7685, lng: 76.7460 }, // NW (Sarangpur / PGI / Sec 14 north)
  { lat: 30.7695, lng: 76.7860 }, // North (Sec 12 / 11 / Uttar Marg north)
  { lat: 30.7665, lng: 76.8140 }, // NE (Capitol Complex / Rock Garden north)
  { lat: 30.7520, lng: 76.8350 }, // Sukhna West & Kishangarh / IT Park UT border
  { lat: 30.7340, lng: 76.8420 }, // Manimajra / Kalagram UT border (west of Panchkula Sec 1-5)
  { lat: 30.7150, lng: 76.8250 }, // Industrial Area Phase I / Railway Station east edge
  { lat: 30.6920, lng: 76.8120 }, // Industrial Area II / Hallomajra north edge
  { lat: 30.6845, lng: 76.7720 }, // Southern Vikas Marg (Sec 47 / 48 / 49 UT edge)
  { lat: 30.6940, lng: 76.7420 }, // SW UT edge (Sec 50 / 51 / 52 bordering Mohali)
  { lat: 30.7180, lng: 76.7250 }, // West UT edge (Sec 41 / 40 / 55 / 56 bordering Mohali)
  { lat: 30.7500, lng: 76.7270 }, // WNW UT edge (Sec 38W / Maloya / Dadu Majra)
];

export function isInsideChandigarh(pt: LatLngLiteral): boolean {
  let inside = false;
  const poly = CHANDIGARH_UT_POLYGON;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng;
    const yi = poly[i].lat;
    const xj = poly[j].lng;
    const yj = poly[j].lat;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function clampToChandigarh(pt: LatLngLiteral): LatLngLiteral {
  if (isInsideChandigarh(pt)) return pt;
  // Pull point smoothly back inside Chandigarh toward central Chandigarh
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    const probe = {
      lat: TRICITY_CENTER.lat + (pt.lat - TRICITY_CENTER.lat) * mid,
      lng: TRICITY_CENTER.lng + (pt.lng - TRICITY_CENTER.lng) * mid,
    };
    if (isInsideChandigarh(probe)) lo = mid;
    else hi = mid;
  }
  const safeT = Math.max(0, lo - 0.04);
  return {
    lat: Number((TRICITY_CENTER.lat + (pt.lat - TRICITY_CENTER.lat) * safeT).toFixed(6)),
    lng: Number((TRICITY_CENTER.lng + (pt.lng - TRICITY_CENTER.lng) * safeT).toFixed(6)),
  };
}

export function isPathInsideChandigarh(path: LatLngLiteral[]): boolean {
  if (path.length === 0) return false;
  const step = Math.max(1, Math.floor(path.length / 40));
  let outsideCount = 0;
  let checked = 0;
  for (let i = 0; i < path.length; i += step) {
    checked++;
    if (!isInsideChandigarh(path[i])) outsideCount++;
  }
  if (!isInsideChandigarh(path[0]) || !isInsideChandigarh(path[path.length - 1])) {
    return false;
  }
  return outsideCount <= Math.floor(checked * 0.05);
}

