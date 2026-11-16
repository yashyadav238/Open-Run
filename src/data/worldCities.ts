import { bearingDegrees, destinationPoint, haversineMeters } from '../lib/geo';
import type { LatLngLiteral } from '../types/run';
import {
  clampToChandigarh,
  isInsideChandigarh,
  isPathInsideChandigarh,
} from './tricityPlaces';

export const DEFAULT_CITY_RADIUS_METERS = 16000;

export interface WorldCityPreset {
  name: string;
  country: string;
  lat: number;
  lng: number;
  zoom: number;
  tagline: string;
  radiusMeters?: number;
}

export const WORLD_RUNNING_CITIES: WorldCityPreset[] = [
  {
    name: 'Chandigarh',
    country: 'India',
    lat: 30.7333,
    lng: 76.7794,
    zoom: 13,
    tagline: 'Sukhna Lake · Leisure Valley · Sector Green Belts',
  },
  {
    name: 'New Delhi',
    country: 'India',
    lat: 28.6139,
    lng: 77.209,
    zoom: 13,
    tagline: 'Lodhi Gardens · India Gate · Nehru Park',
  },
  {
    name: 'Mumbai',
    country: 'India',
    lat: 19.076,
    lng: 72.8777,
    zoom: 13,
    tagline: 'Marine Drive · Worli Sea Face · Shivaji Park',
  },
  {
    name: 'Bengaluru',
    country: 'India',
    lat: 12.9716,
    lng: 77.5946,
    zoom: 13,
    tagline: 'Cubbon Park · Lalbagh · Sankey Tank',
  },
  {
    name: 'London',
    country: 'United Kingdom',
    lat: 51.5072,
    lng: -0.1276,
    zoom: 13,
    tagline: 'Hyde Park · Thames Path · Regent’s Park',
  },
  {
    name: 'New York',
    country: 'United States',
    lat: 40.7812,
    lng: -73.9665,
    zoom: 13,
    tagline: 'Central Park Loop · Hudson River Greenway',
  },
  {
    name: 'San Francisco',
    country: 'United States',
    lat: 37.7749,
    lng: -122.4194,
    zoom: 13,
    tagline: 'Embarcadero · Golden Gate Park · Crissy Field',
  },
  {
    name: 'Boston',
    country: 'United States',
    lat: 42.3601,
    lng: -71.0589,
    zoom: 13,
    tagline: 'Charles River Esplanade · Commonwealth Ave',
  },
  {
    name: 'Chicago',
    country: 'United States',
    lat: 41.8781,
    lng: -87.6298,
    zoom: 13,
    tagline: 'Lakefront Trail · Millennium Park',
  },
  {
    name: 'Paris',
    country: 'France',
    lat: 48.8566,
    lng: 2.3522,
    zoom: 13,
    tagline: 'Jardin du Luxembourg · Seine Banks · Tuileries',
  },
  {
    name: 'Berlin',
    country: 'Germany',
    lat: 52.52,
    lng: 13.405,
    zoom: 13,
    tagline: 'Tiergarten · Tempelhofer Feld · Spree Path',
  },
  {
    name: 'Amsterdam',
    country: 'Netherlands',
    lat: 52.3676,
    lng: 4.9041,
    zoom: 13,
    tagline: 'Vondelpark · Amstel River · Canal Belts',
  },
  {
    name: 'Tokyo',
    country: 'Japan',
    lat: 35.6812,
    lng: 139.753,
    zoom: 13,
    tagline: 'Imperial Palace Loop · Yoyogi Park · Sumida',
  },
  {
    name: 'Singapore',
    country: 'Singapore',
    lat: 1.2868,
    lng: 103.8545,
    zoom: 13,
    tagline: 'Marina Bay · East Coast Park · Botanic Gardens',
  },
  {
    name: 'Sydney',
    country: 'Australia',
    lat: -33.8688,
    lng: 151.2093,
    zoom: 13,
    tagline: 'Royal Botanic Gardens · Harbour Foreshore · Centennial Park',
  },
  {
    name: 'Melbourne',
    country: 'Australia',
    lat: -37.8136,
    lng: 144.9631,
    zoom: 13,
    tagline: 'The Tan Track · Yarra River Trail · Albert Park',
  },
  {
    name: 'Toronto',
    country: 'Canada',
    lat: 43.6532,
    lng: -79.3832,
    zoom: 13,
    tagline: 'Martin Goodman Trail · High Park · Waterfront',
  },
  {
    name: 'Dubai',
    country: 'UAE',
    lat: 25.2048,
    lng: 55.2708,
    zoom: 13,
    tagline: 'Jumeirah Corniche · Kite Beach · Dubai Canal',
  },
  {
    name: 'Seoul',
    country: 'South Korea',
    lat: 37.5665,
    lng: 126.978,
    zoom: 13,
    tagline: 'Han River Park · Cheonggyecheon · Namsan Loop',
  },
  {
    name: 'Cape Town',
    country: 'South Africa',
    lat: -33.9036,
    lng: 18.4106,
    zoom: 13,
    tagline: 'Sea Point Promenade · Green Point Park',
  },
];

export const DEFAULT_RUNNING_CITY: WorldCityPreset = WORLD_RUNNING_CITIES[0];

const GUEST_CITY_STORAGE_KEY = 'tricity_selected_running_city_v1';

export interface ActiveRunningCity {
  name: string;
  country?: string;
  lat: number;
  lng: number;
  zoom: number;
  tagline?: string;
  radiusMeters?: number;
}

export function isChandigarhCityName(cityName?: string): boolean {
  return !cityName || /^chandigarh$/i.test(cityName.trim());
}

function isChandigarhSelectedCity(city?: ActiveRunningCity | null): boolean {
  if (!city) return false;
  return (
    isChandigarhCityName(city.name) &&
    haversineMeters(city, { lat: 30.7333, lng: 76.7794 }) <= 25000
  );
}

export function getCityBoundaryRadiusMeters(city?: ActiveRunningCity | null): number {
  if (!city) return DEFAULT_CITY_RADIUS_METERS;
  if (typeof city.radiusMeters === 'number' && Number.isFinite(city.radiusMeters) && city.radiusMeters >= 3000) {
    return city.radiusMeters;
  }
  return DEFAULT_CITY_RADIUS_METERS;
}

export function getCityLatLngBounds(
  city: ActiveRunningCity,
  radiusMeters = getCityBoundaryRadiusMeters(city)
): { south: number; west: number; north: number; east: number } {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.max(0.2, Math.cos((city.lat * Math.PI) / 180)));
  return {
    south: Math.max(-85, city.lat - latDelta),
    west: Math.max(-180, city.lng - lngDelta),
    north: Math.min(85, city.lat + latDelta),
    east: Math.min(180, city.lng + lngDelta),
  };
}

export function isInsideSelectedCity(
  pt: LatLngLiteral,
  city?: ActiveRunningCity | null
): boolean {
  if (!city) return true;
  if (isChandigarhSelectedCity(city)) {
    return isInsideChandigarh(pt);
  }
  return haversineMeters(pt, city) <= getCityBoundaryRadiusMeters(city);
}

export function clampPointToSelectedCity(
  pt: LatLngLiteral,
  city?: ActiveRunningCity | null
): LatLngLiteral {
  if (!city) return pt;
  if (isChandigarhSelectedCity(city)) {
    return clampToChandigarh(pt);
  }
  const maxSafeMeters = getCityBoundaryRadiusMeters(city) * 0.9;
  const dist = haversineMeters(city, pt);
  if (dist <= maxSafeMeters) return pt;
  const bearing = bearingDegrees(city, pt);
  return destinationPoint(city, maxSafeMeters, bearing);
}

export function isPathInsideSelectedCity(
  path: LatLngLiteral[],
  city?: ActiveRunningCity | null
): boolean {
  if (!city) return true;
  if (path.length < 2) return false;
  if (isChandigarhSelectedCity(city)) {
    return isPathInsideChandigarh(path);
  }
  if (!isInsideSelectedCity(path[0], city) || !isInsideSelectedCity(path[path.length - 1], city)) {
    return false;
  }
  const step = Math.max(1, Math.floor(path.length / 40));
  let checked = 0;
  let inside = 0;
  for (let i = 0; i < path.length; i += step) {
    checked += 1;
    if (isInsideSelectedCity(path[i], city)) inside += 1;
  }
  return checked > 0 && inside / checked >= 0.95;
}

export function findWorldCityPreset(cityName?: string): WorldCityPreset | undefined {
  if (!cityName) return undefined;
  const clean = cityName.trim().toLowerCase();
  if (!clean) return undefined;
  return (
    WORLD_RUNNING_CITIES.find((c) => c.name.toLowerCase() === clean) ||
    WORLD_RUNNING_CITIES.find((c) => clean.startsWith(c.name.toLowerCase()))
  );
}

export function resolveRunningCity(
  cityName?: string | null,
  cityLat?: number | null,
  cityLng?: number | null
): ActiveRunningCity {
  const cleanName = (cityName || '').trim() || DEFAULT_RUNNING_CITY.name;
  const matched = findWorldCityPreset(cleanName);
  const hasExplicitCoords =
    typeof cityLat === 'number' &&
    Number.isFinite(cityLat) &&
    typeof cityLng === 'number' &&
    Number.isFinite(cityLng) &&
    !(Math.abs(cityLat) < 0.0001 && Math.abs(cityLng) < 0.0001);

  if (hasExplicitCoords) {
    return {
      name: cleanName,
      country: matched?.country,
      lat: cityLat as number,
      lng: cityLng as number,
      zoom: matched?.zoom ?? 12,
      tagline: matched?.tagline || `${cleanName} · Pedestrian Streets & Parks`,
      radiusMeters: matched?.radiusMeters ?? DEFAULT_CITY_RADIUS_METERS,
    };
  }

  if (matched) {
    return {
      name: matched.name,
      country: matched.country,
      lat: matched.lat,
      lng: matched.lng,
      zoom: matched.zoom,
      tagline: matched.tagline,
      radiusMeters: matched.radiusMeters ?? DEFAULT_CITY_RADIUS_METERS,
    };
  }

  return {
    name: DEFAULT_RUNNING_CITY.name,
    country: DEFAULT_RUNNING_CITY.country,
    lat: DEFAULT_RUNNING_CITY.lat,
    lng: DEFAULT_RUNNING_CITY.lng,
    zoom: DEFAULT_RUNNING_CITY.zoom,
    tagline: DEFAULT_RUNNING_CITY.tagline,
    radiusMeters: DEFAULT_RUNNING_CITY.radiusMeters ?? DEFAULT_CITY_RADIUS_METERS,
  };
}

export function buildCityAnchorOffsets(city: ActiveRunningCity): Array<{
  name: string;
  lat: number;
  lng: number;
}> {
  const center: LatLngLiteral = { lat: city.lat, lng: city.lng };
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
  const shift = (eastM: number, northM: number) => ({
    lat: Number((center.lat + northM / metersPerDegLat).toFixed(6)),
    lng: Number((center.lng + eastM / metersPerDegLng).toFixed(6)),
  });

  return [
    { name: `${city.name} Center`, ...center },
    { name: `${city.name} North Loop`, ...shift(0, 520) },
    { name: `${city.name} East Loop`, ...shift(520, 0) },
    { name: `${city.name} South-West`, ...shift(-420, -420) },
  ];
}

export function loadGuestRunningCity(): ActiveRunningCity {
  try {
    const raw = localStorage.getItem(GUEST_CITY_STORAGE_KEY);
    if (!raw) return DEFAULT_RUNNING_CITY;
    const parsed = JSON.parse(raw) as Partial<ActiveRunningCity>;
    return resolveRunningCity(parsed.name, parsed.lat, parsed.lng);
  } catch {
    return DEFAULT_RUNNING_CITY;
  }
}

export function saveGuestRunningCity(city: ActiveRunningCity): void {
  try {
    localStorage.setItem(
      GUEST_CITY_STORAGE_KEY,
      JSON.stringify({
        name: city.name,
        lat: city.lat,
        lng: city.lng,
        country: city.country,
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}
