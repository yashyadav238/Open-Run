import express from 'express';
import http from 'node:http';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  getNightExcludePolygonsForPoint,
  isInsideChandigarh,
} from './src/data/tricityPlaces';
import {
  analyzeRouteStraightness,
  computeElevationStats,
  computeLeastTurnsRouteCost,
  haversineMeters,
} from './src/lib/geo';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'open-run' });
  });

  app.get('/api/maps-config', (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    res.json({ apiKey });
  });

  app.post('/api/elevation', async (req, res) => {
    const rawPoints = req.body?.points;
    const rawAltitudes = Array.isArray(req.body?.altitudes) ? req.body.altitudes : null;

    if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
      res.json({
        available: false,
        elevationGainMeters: null,
        elevationLossMeters: null,
        minElevationMeters: null,
        maxElevationMeters: null,
      });
      return;
    }

    const validIndices: number[] = [];
    for (let i = 0; i < rawPoints.length; i++) {
      const p = rawPoints[i];
      if (
        p &&
        typeof p.lat === 'number' &&
        typeof p.lng === 'number' &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        p.lat >= -90 &&
        p.lat <= 90 &&
        p.lng >= -180 &&
        p.lng <= 180
      ) {
        validIndices.push(i);
      }
    }

    if (validIndices.length < 2) {
      res.json({
        available: false,
        elevationGainMeters: null,
        elevationLossMeters: null,
        minElevationMeters: null,
        maxElevationMeters: null,
      });
      return;
    }

    // Evenly resample up to 48 points across the full path while always preserving start and end
    const MAX_SAMPLES = 48;
    const sampledOriginalIndices: number[] = [];
    if (validIndices.length <= MAX_SAMPLES) {
      sampledOriginalIndices.push(...validIndices);
    } else {
      for (let i = 0; i < MAX_SAMPLES; i++) {
        const pos = Math.round((i * (validIndices.length - 1)) / (MAX_SAMPLES - 1));
        const idx = validIndices[pos];
        if (sampledOriginalIndices[sampledOriginalIndices.length - 1] !== idx) {
          sampledOriginalIndices.push(idx);
        }
      }
    }

    const sampledPoints = sampledOriginalIndices.map((idx) => ({
      lat: Number(rawPoints[idx].lat),
      lng: Number(rawPoints[idx].lng),
    }));

    const cumulativeMeters: number[] = [0];
    for (let i = 1; i < sampledPoints.length; i++) {
      cumulativeMeters.push(
        cumulativeMeters[i - 1] + haversineMeters(sampledPoints[i - 1], sampledPoints[i])
      );
    }
    const totalDistanceMeters = cumulativeMeters[cumulativeMeters.length - 1] || 0;

    let elevations: number[] | null = null;
    let provider: 'google' | 'open_meteo' | 'gps' | null = null;

    // 1. Primary: Google Maps Elevation API (server-side)
    const apiKey = (
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      ''
    ).trim();

    if (apiKey) {
      try {
        const locationsParam = sampledPoints
          .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
          .join('|');
        const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(
          locationsParam
        )}&key=${encodeURIComponent(apiKey)}`;
        const upstream = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (upstream.ok) {
          const data = (await upstream.json()) as {
            status?: string;
            results?: Array<{ elevation?: number }>;
          };
          if (
            data.status === 'OK' &&
            Array.isArray(data.results) &&
            data.results.length === sampledPoints.length &&
            data.results.every((r) => typeof r.elevation === 'number' && Number.isFinite(r.elevation))
          ) {
            elevations = data.results.map((r) => Number(r.elevation));
            provider = 'google';
          }
        }
      } catch {
        // Fall through cleanly to Copernicus DEM / GPS fallback
      }
    }

    // 2. Fallback: Open-Meteo Copernicus DEM 90m elevation API
    if (!elevations) {
      try {
        const lats = sampledPoints.map((p) => p.lat.toFixed(5)).join(',');
        const lngs = sampledPoints.map((p) => p.lng.toFixed(5)).join(',');
        const meteoUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
        const upstream = await fetch(meteoUrl, { signal: AbortSignal.timeout(4000) });
        if (upstream.ok) {
          const data = (await upstream.json()) as { elevation?: number[] };
          if (
            Array.isArray(data.elevation) &&
            data.elevation.length === sampledPoints.length &&
            data.elevation.every((v) => typeof v === 'number' && Number.isFinite(v))
          ) {
            elevations = data.elevation.map((v) => Number(v));
            provider = 'open_meteo';
          }
        }
      } catch {
        // Fall through cleanly to device GPS altitude fallback
      }
    }

    // 3. Offline fallback: Device GPS altitude samples if provided with the same length
    if (
      !elevations &&
      rawAltitudes &&
      rawAltitudes.length === rawPoints.length
    ) {
      const gpsSamples = sampledOriginalIndices
        .map((idx) => rawAltitudes[idx])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (gpsSamples.length >= 4 && gpsSamples.length === sampledOriginalIndices.length) {
        elevations = gpsSamples;
        provider = 'gps';
      }
    }

    if (!elevations || !provider || elevations.length < 2) {
      res.json({
        available: false,
        elevationGainMeters: null,
        elevationLossMeters: null,
        minElevationMeters: null,
        maxElevationMeters: null,
      });
      return;
    }

    const hysteresis = provider === 'gps' ? 1.5 : 0.8;
    const stats = computeElevationStats(elevations, totalDistanceMeters, hysteresis);
    const profile = stats.smoothed.map((el, i) => ({
      distanceMeters: Math.round(cumulativeMeters[i] ?? 0),
      distRatio:
        totalDistanceMeters > 0
          ? Number(((cumulativeMeters[i] ?? 0) / totalDistanceMeters).toFixed(4))
          : i / Math.max(1, stats.smoothed.length - 1),
      elevationM: el,
    }));

    res.json({
      available: true,
      provider,
      elevationGainMeters: stats.elevationGainMeters,
      elevationLossMeters: stats.elevationLossMeters,
      minElevationMeters: stats.minElevationMeters,
      maxElevationMeters: stats.maxElevationMeters,
      avgGradePct: stats.avgGradePct,
      profile,
    });
  });

  app.get('/api/cities/resolve', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
      return;
    }

    const googleKey = (
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      ''
    ).trim();

    if (googleKey) {
      try {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
          `${lat},${lng}`
        )}&result_type=locality|administrative_area_level_2|administrative_area_level_1|country&key=${encodeURIComponent(
          googleKey
        )}`;
        const upstream = await fetch(geocodeUrl, { signal: AbortSignal.timeout(6000) });
        if (upstream.ok) {
          const data = (await upstream.json()) as {
            status?: string;
            results?: Array<{
              address_components?: Array<{
                long_name?: string;
                short_name?: string;
                types?: string[];
              }>;
            }>;
          };
          const components = data.results?.flatMap((r) => r.address_components || []) || [];
          const findType = (type: string) =>
            components.find((c) => c.types?.includes(type))?.long_name;
          const cityName =
            findType('locality') ||
            findType('postal_town') ||
            findType('administrative_area_level_2') ||
            findType('administrative_area_level_1') ||
            findType('country');
          const country = findType('country');
          if (cityName) {
            res.json({ name: cityName, country: country || '', lat, lng });
            return;
          }
        }
      } catch {
        // Fall through to Nominatim reverse lookup
      }
    }

    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        String(lat)
      )}&lon=${encodeURIComponent(String(lng))}&zoom=10&addressdetails=1`;
      const upstream = await fetch(nomUrl, {
        headers: { 'User-Agent': 'OpenRun/1.0 (+https://openrun.app)' },
        signal: AbortSignal.timeout(6000),
      });
      if (upstream.ok) {
        const data = (await upstream.json()) as {
          name?: string;
          address?: {
            city?: string;
            town?: string;
            village?: string;
            municipality?: string;
            county?: string;
            state?: string;
            country?: string;
          };
        };
        const addr = data.address || {};
        const cityName =
          addr.city ||
          addr.town ||
          addr.village ||
          addr.municipality ||
          addr.county ||
          addr.state ||
          data.name ||
          addr.country;
        if (cityName) {
          res.json({ name: cityName, country: addr.country || '', lat, lng });
          return;
        }
      }
    } catch {
      // Fall back to coordinate label
    }

    res.json({
      name: `City (${lat.toFixed(2)}, ${lng.toFixed(2)})`,
      country: '',
      lat,
      lng,
    });
  });

  const walkCache = new Map<string, { expiresAt: number; payload: unknown }>();
  let activeUpstream = 0;
  const waitQueue: Array<() => void> = [];

  async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (activeUpstream >= 3) {
      await new Promise<void>((resolve) => waitQueue.push(resolve));
    }
    activeUpstream += 1;
    try {
      return await fn();
    } finally {
      activeUpstream -= 1;
      const next = waitQueue.shift();
      if (next) next();
    }
  }

  function decodePolyline6(encoded: string): Array<{ lat: number; lng: number }> {
    const pts: Array<{ lat: number; lng: number }> = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
      let b = 0;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index < encoded.length);
      lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index < encoded.length);
      lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      pts.push({ lat: lat / 1e6, lng: lng / 1e6 });
    }
    return pts;
  }

  type TravelRoutingProfile = 'pedestrian' | 'bicycle';

  function resolveTravelProfile(body: unknown): TravelRoutingProfile {
    if (!body || typeof body !== 'object') return 'pedestrian';
    const b = body as { travelProfile?: unknown; workoutType?: unknown };
    if (b.travelProfile === 'bicycle' || b.workoutType === 'cycling') {
      return 'bicycle';
    }
    return 'pedestrian';
  }

  type StepPayload = {
    instruction: string;
    distanceMeters: number;
    durationSec: number;
    maneuver?: string;
    startLocation?: { lat: number; lng: number };
  };

  type RouteCandidatePayload = {
    provider: string;
    path: Array<{ lat: number; lng: number }>;
    distanceMeters: number;
    durationSec: number;
    steps: StepPayload[];
  };

  function pickBestCandidate(
    candidates: RouteCandidatePayload[],
    preferLeastTurns: boolean
  ): RouteCandidatePayload | null {
    const valid = candidates.filter((c) => c.path.length >= 2 && c.distanceMeters > 0);
    if (valid.length === 0) return null;
    if (valid.length === 1 || !preferLeastTurns) {
      return valid[0];
    }
    const minDistance = Math.min(...valid.map((c) => c.distanceMeters));
    let best = valid[0];
    let bestCost = Infinity;
    for (const cand of valid) {
      const stats = analyzeRouteStraightness(cand.path);
      const cost = computeLeastTurnsRouteCost(stats, cand.distanceMeters, minDistance);
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
    return best;
  }

  async function queryGraphHopperChunk(
    chunk: Array<{ lat: number; lng: number }>,
    ghKey: string,
    profile: 'foot' | 'bike' = 'foot',
    preferLeastTurns = true
  ): Promise<RouteCandidatePayload[]> {
    const buildParams = (withAlternatives: boolean) => {
      const ghParams = new URLSearchParams({
        profile,
        points_encoded: 'false',
        instructions: 'true',
        calc_points: 'true',
        key: ghKey,
      });
      if (withAlternatives && chunk.length === 2) {
        ghParams.append('algorithm', 'alternative_route');
        ghParams.append('alternative_route.max_paths', '3');
        ghParams.append('alternative_route.max_weight_factor', '1.45');
        ghParams.append('alternative_route.max_share_factor', '0.75');
      }
      for (const p of chunk) {
        ghParams.append('point', `${p.lat},${p.lng}`);
      }
      return ghParams;
    };

    const tryAlt = preferLeastTurns && chunk.length === 2;
    let ghRes = await withUpstreamSlot(() =>
      fetch(`https://graphhopper.com/api/1/route?${buildParams(tryAlt).toString()}`, {
        signal: AbortSignal.timeout(10000),
      })
    );
    if (!ghRes.ok && tryAlt) {
      ghRes = await withUpstreamSlot(() =>
        fetch(`https://graphhopper.com/api/1/route?${buildParams(false).toString()}`, {
          signal: AbortSignal.timeout(10000),
        })
      );
    }
    if (!ghRes.ok) return [];
    const ghData = (await ghRes.json()) as {
      paths?: Array<{
        distance: number;
        time: number;
        points?: { coordinates?: Array<[number, number]> };
        instructions?: Array<{ text: string; distance: number; time: number; interval?: [number, number] }>;
      }>;
    };
    const out: RouteCandidatePayload[] = [];
    for (const ghPath of ghData.paths || []) {
      const coords = ghPath?.points?.coordinates || [];
      if (coords.length < 2) continue;
      const path = coords.map(([lng, lat]) => ({ lat, lng }));
      const steps: StepPayload[] = (ghPath.instructions || []).map((inst) => {
        const idx = Math.min(path.length - 1, Math.max(0, inst.interval?.[0] ?? 0));
        return {
          instruction: inst.text || 'Continue along path',
          distanceMeters: Math.round(inst.distance || 0),
          durationSec: Math.round((inst.time || 0) / 1000),
          startLocation: path[idx],
        };
      });
      out.push({
        provider: profile === 'bike' ? 'graphhopper-bike' : 'graphhopper-foot',
        path,
        distanceMeters: Math.round(ghPath.distance),
        durationSec: Math.round(ghPath.time / 1000),
        steps,
      });
    }
    return out;
  }

  const handleModalRoute: express.RequestHandler = async (req, res) => {
    const waypoints = req.body?.waypoints as Array<{ lat: number; lng: number }> | undefined;
    const rawPrefs = Array.isArray(req.body?.preferences) ? (req.body.preferences as string[]) : [];
    const sortedPrefs = [...new Set(rawPrefs.map(String))].sort();
    const preferLeastTurns =
      req.body?.preferLeastTurns !== false && req.body?.shortestOnly !== true;
    const travelProfile = resolveTravelProfile(req.body);
    if (!Array.isArray(waypoints) || waypoints.length < 2 || waypoints.length > 20) {
      res.status(400).json({ error: 'Between 2 and 20 waypoints are required.' });
      return;
    }

    const normalized = waypoints.map((p) => ({
      lat: Number(Number(p.lat).toFixed(5)),
      lng: Number(Number(p.lng).toFixed(5)),
    }));
    const cacheKey = `${travelProfile}|${preferLeastTurns ? 'straight' : 'std'}|${normalized
      .map((p) => `${p.lat},${p.lng}`)
      .join(';')}|${sortedPrefs.join(',')}`;
    const cached = walkCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.payload);
      return;
    }

    const sendAndCache = (payload: unknown) => {
      if (walkCache.size > 300) {
        const firstKey = walkCache.keys().next().value;
        if (firstKey) walkCache.delete(firstKey);
      }
      walkCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60 * 1000, payload });
      res.json(payload);
    };

    const isNightMode = sortedPrefs.includes('well_lit');
    const ghKey = process.env.GRAPHHOPPER_API_KEY || '';
    const ghProfile: 'foot' | 'bike' = travelProfile === 'bicycle' ? 'bike' : 'foot';

    const fetchGraphHopperCandidates = async (): Promise<RouteCandidatePayload[]> => {
      if (!ghKey || isNightMode) return [];
      try {
        if (normalized.length <= 5) {
          return await queryGraphHopperChunk(normalized, ghKey, ghProfile, preferLeastTurns);
        }
        // Chunk into <=5-waypoint GraphHopper segments so long/art routes also benefit
        const chunks: Array<Array<{ lat: number; lng: number }>> = [];
        for (let i = 0; i < normalized.length - 1; i += 4) {
          chunks.push(normalized.slice(i, Math.min(normalized.length, i + 5)));
        }
        const chunkResults = await Promise.all(
          chunks.map(async (c) => {
            const list = await queryGraphHopperChunk(c, ghKey, ghProfile, preferLeastTurns);
            return pickBestCandidate(list, preferLeastTurns);
          })
        );
        if (chunkResults.every((r) => r !== null)) {
          const mergedPath: Array<{ lat: number; lng: number }> = [];
          const mergedSteps: StepPayload[] = [];
          let totalDistance = 0;
          let totalDuration = 0;
          for (const seg of chunkResults) {
            if (!seg) continue;
            if (mergedPath.length > 0 && seg.path.length > 0) {
              mergedPath.push(...seg.path.slice(1));
            } else {
              mergedPath.push(...seg.path);
            }
            mergedSteps.push(...seg.steps);
            totalDistance += seg.distanceMeters;
            totalDuration += seg.durationSec;
          }
          if (mergedPath.length >= 2) {
            return [
              {
                provider: ghProfile === 'bike' ? 'graphhopper-bike' : 'graphhopper-foot',
                path: mergedPath,
                distanceMeters: totalDistance,
                durationSec: totalDuration,
                steps: mergedSteps,
              },
            ];
          }
        }
      } catch {
        // Fall through to Valhalla / OSM router
      }
      return [];
    };

    // 2. Valhalla Pedestrian or Bicycle tuned with high maneuver_penalty for long straight paths
    const preferParksOrPaths =
      sortedPrefs.length === 0 ||
      sortedPrefs.includes('parks_greenery') ||
      sortedPrefs.includes('pedestrian_paths') ||
      sortedPrefs.includes('quieter_roads');
    const avoidStairs = sortedPrefs.includes('avoid_stairs');
    const turnPenalty = preferLeastTurns ? 165 : 15;
    const pedestrianCosting = isNightMode
      ? {
          walking_speed: 9.2,
          use_lit: 1.0,
          walkway_factor: 0.92,
          alley_factor: 2.6,
          sidewalk_factor: 0.52,
          driveway_factor: 1.8,
          use_tracks: 0.05,
          use_living_streets: 0.9,
          use_roads: 0.72,
          step_penalty: avoidStairs ? 140 : 25,
          maneuver_penalty: turnPenalty,
        }
      : {
          walking_speed: 9.2,
          walkway_factor: preferParksOrPaths ? 0.58 : 0.74,
          alley_factor: preferParksOrPaths ? 0.85 : 0.95,
          sidewalk_factor: 0.82,
          driveway_factor: 2.0,
          use_tracks: preferParksOrPaths ? 0.8 : 0.55,
          use_living_streets: 0.88,
          use_roads: preferLeastTurns ? 0.42 : preferParksOrPaths ? 0.22 : 0.45,
          step_penalty: avoidStairs ? 120 : 8,
          maneuver_penalty: turnPenalty,
        };
    const bicycleCosting = {
      bicycle_type: 'Hybrid',
      cycling_speed: 21,
      use_roads: isNightMode ? 0.72 : preferLeastTurns ? 0.62 : preferParksOrPaths ? 0.28 : 0.58,
      use_hills: 0.4,
      avoid_bad_surfaces: 0.25,
      use_living_streets: 0.85,
      maneuver_penalty: preferLeastTurns ? 180 : 20,
      ...(isNightMode ? { use_lit: 0.9 } : {}),
    };

    const nightExcludePolygons =
      isNightMode && isInsideChandigarh(normalized[0])
        ? getNightExcludePolygonsForPoint(normalized[0])
        : undefined;

    type ValhallaTrip = {
      summary?: { length?: number; time?: number };
      legs?: Array<{
        shape?: string;
        maneuvers?: Array<{
          instruction?: string;
          length?: number;
          time?: number;
          begin_shape_index?: number;
        }>;
      }>;
    };

    const parseValhallaTrip = (trip?: ValhallaTrip): RouteCandidatePayload | null => {
      if (!trip) return null;
      const legs = trip.legs || [];
      const fullPath: Array<{ lat: number; lng: number }> = [];
      const steps: StepPayload[] = [];
      for (const leg of legs) {
        if (!leg.shape) continue;
        const legPts = decodePolyline6(leg.shape);
        for (const m of leg.maneuvers || []) {
          const idx = Math.min(legPts.length - 1, Math.max(0, m.begin_shape_index || 0));
          steps.push({
            instruction:
              m.instruction ||
              (travelProfile === 'bicycle' ? 'Continue along bikeway' : 'Continue along pedestrian path'),
            distanceMeters: Math.round((m.length || 0) * 1000),
            durationSec: Math.round(m.time || 0),
            startLocation: legPts[idx],
          });
        }
        if (fullPath.length > 0 && legPts.length > 0) {
          fullPath.push(...legPts.slice(1));
        } else {
          fullPath.push(...legPts);
        }
      }
      const totalDistMeters = Math.round((trip.summary?.length || 0) * 1000);
      const totalDurationSec = Math.round(trip.summary?.time || 0);
      if (fullPath.length < 2 || totalDistMeters <= 0) return null;
      return {
        provider: travelProfile === 'bicycle' ? 'valhalla-bicycle' : 'valhalla-pedestrian',
        path: fullPath,
        distanceMeters: totalDistMeters,
        durationSec: totalDurationSec,
        steps,
      };
    };

    const queryValhallaRoute = async (withExcludes: boolean) => {
      const payload: Record<string, unknown> = {
        locations: normalized.map((p, idx) => ({
          lat: p.lat,
          lon: p.lng,
          type: idx === 0 || idx === normalized.length - 1 ? 'break' : 'through',
        })),
        costing: travelProfile,
        costing_options:
          travelProfile === 'bicycle'
            ? { bicycle: bicycleCosting }
            : { pedestrian: pedestrianCosting },
        units: 'kilometers',
      };
      if (preferLeastTurns && normalized.length === 2) {
        payload.alternates = 2;
      }
      if (withExcludes && nightExcludePolygons && nightExcludePolygons.length > 0) {
        payload.exclude_polygons = nightExcludePolygons;
      }
      return await withUpstreamSlot(() =>
        fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'OpenRun/1.0',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(14000),
        })
      );
    };

    const fetchValhallaCandidates = async (): Promise<RouteCandidatePayload[]> => {
      try {
        let valRes = await queryValhallaRoute(true);
        if (!valRes.ok && isNightMode && nightExcludePolygons && nightExcludePolygons.length > 0) {
          // Retry without exclude_polygons if user's start/via point sits directly inside a zone box
          valRes = await queryValhallaRoute(false);
        }
        if (!valRes.ok) return [];
        const valData = (await valRes.json()) as {
          trip?: ValhallaTrip;
          alternates?: Array<{ trip?: ValhallaTrip }>;
        };
        const out: RouteCandidatePayload[] = [];
        const primary = parseValhallaTrip(valData.trip);
        if (primary) out.push(primary);
        for (const alt of valData.alternates || []) {
          const parsed = parseValhallaTrip(alt.trip);
          if (parsed) out.push(parsed);
        }
        return out;
      } catch {
        return [];
      }
    };

    // Query both GraphHopper alternatives and Valhalla turn-penalized paths when optimizing for straightness,
    // or fall through seamlessly to Valhalla if GraphHopper is disabled/night-mode.
    const [ghCandidates, valhallaCandidates] = preferLeastTurns
      ? await Promise.all([fetchGraphHopperCandidates(), fetchValhallaCandidates()])
      : [await fetchGraphHopperCandidates(), [] as RouteCandidatePayload[]];

    const combinedCandidates = [...valhallaCandidates, ...ghCandidates];
    if (combinedCandidates.length > 0) {
      const winner = pickBestCandidate(combinedCandidates, preferLeastTurns);
      if (winner) {
        sendAndCache(winner);
        return;
      }
    }

    if (!preferLeastTurns) {
      const valFallback = await fetchValhallaCandidates();
      const winner = pickBestCandidate(valFallback, false);
      if (winner) {
        sendAndCache(winner);
        return;
      }
    }

    // 3. Fallback: OSM Router (routed-foot / routed-bike) with alternatives scoring
    try {
      const coordStr = normalized.map((p) => `${p.lng},${p.lat}`).join(';');
      const altParam = preferLeastTurns && normalized.length === 2 ? '&alternatives=true' : '';
      const url =
        travelProfile === 'bicycle'
          ? `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true${altParam}`
          : `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=true${altParam}`;
      const upstream = await withUpstreamSlot(() =>
        fetch(url, {
          headers: { 'User-Agent': 'OpenRun/1.0' },
          signal: AbortSignal.timeout(9000),
        })
      );
      if (!upstream.ok) {
        res.status(502).json({ error: `Upstream ${travelProfile} router unavailable.` });
        return;
      }
      const data = (await upstream.json()) as {
        code?: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry?: { coordinates?: Array<[number, number]> };
          legs?: Array<{
            steps?: Array<{
              distance: number;
              duration: number;
              name?: string;
              maneuver?: { type?: string; modifier?: string; location?: [number, number] };
            }>;
          }>;
        }>;
      };

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        res.status(404).json({ error: `No connected ${travelProfile} route found.` });
        return;
      }

      const osrmCandidates: RouteCandidatePayload[] = [];
      for (const route of data.routes) {
        const coords = route?.geometry?.coordinates || [];
        if (coords.length < 2) continue;
        const path = coords.map(([lng, lat]) => ({ lat, lng }));
        const steps: StepPayload[] = [];
        for (const leg of route.legs || []) {
          for (const st of leg.steps || []) {
            const mType = st.maneuver?.type || 'continue';
            const mMod = st.maneuver?.modifier ? ` ${st.maneuver.modifier}` : '';
            const roadName = st.name ? ` onto ${st.name}` : '';
            const loc = st.maneuver?.location;
            steps.push({
              instruction: `${mType.charAt(0).toUpperCase() + mType.slice(1)}${mMod}${roadName}`.trim(),
              distanceMeters: Math.round(st.distance || 0),
              durationSec: Math.round(st.duration || 0),
              maneuver: st.maneuver?.modifier || st.maneuver?.type,
              startLocation: loc ? { lat: loc[1], lng: loc[0] } : undefined,
            });
          }
        }
        osrmCandidates.push({
          provider: travelProfile === 'bicycle' ? 'osm-bike' : 'osm-foot',
          path,
          distanceMeters: Math.round(route.distance),
          durationSec: Math.round(route.duration),
          steps,
        });
      }

      const winner = pickBestCandidate(osrmCandidates, preferLeastTurns);
      if (!winner) {
        res.status(404).json({ error: `No connected ${travelProfile} route found.` });
        return;
      }

      sendAndCache(winner);
    } catch {
      res.status(502).json({ error: `Failed to reach ${travelProfile} routing service.` });
    }
  };

  app.post('/api/routing/walk', handleModalRoute);
  app.post('/api/routing/route', handleModalRoute);

  app.post('/api/routing/trace-art', async (req, res) => {
    const shape = req.body?.shape as Array<{ lat: number; lng: number }> | undefined;
    const rawPrefs = Array.isArray(req.body?.preferences) ? (req.body.preferences as string[]) : [];
    const sortedPrefs = [...new Set(rawPrefs.map(String))].sort();
    const isNightMode = sortedPrefs.includes('well_lit');
    const travelProfile = resolveTravelProfile(req.body);
    if (!Array.isArray(shape) || shape.length < 4 || shape.length > 60) {
      res.status(400).json({ error: 'Between 4 and 60 shape coordinates are required.' });
      return;
    }

    const normalized = shape.map((p) => ({
      lat: Number(Number(p.lat).toFixed(5)),
      lng: Number(Number(p.lng).toFixed(5)),
    }));
    const cacheKey = `art:${travelProfile}:${isNightMode ? 'night:' : ''}${normalized.map((p) => `${p.lat},${p.lng}`).join(';')}`;
    const cached = walkCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.payload);
      return;
    }

    const cacheAndSend = (payload: unknown) => {
      if (walkCache.size > 300) {
        const firstKey = walkCache.keys().next().value;
        if (firstKey) walkCache.delete(firstKey);
      }
      walkCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60 * 1000, payload });
      res.json(payload);
    };

    const artPedestrianCosting = isNightMode
      ? {
          walking_speed: 9.2,
          use_lit: 1.0,
          walkway_factor: 0.9,
          alley_factor: 2.4,
          sidewalk_factor: 0.55,
          use_tracks: 0.05,
          use_living_streets: 0.9,
          use_roads: 0.72,
          step_penalty: 25,
        }
      : {
          walking_speed: 9.2,
          walkway_factor: 0.65,
          alley_factor: 0.75,
          use_tracks: 0.75,
          use_living_streets: 0.85,
          use_roads: 0.32,
          step_penalty: 10,
        };
    const artBicycleCosting = {
      bicycle_type: 'Hybrid',
      cycling_speed: 21,
      use_roads: isNightMode ? 0.7 : 0.35,
      use_hills: 0.4,
      avoid_bad_surfaces: 0.25,
      use_living_streets: 0.85,
      ...(isNightMode ? { use_lit: 0.9 } : {}),
    };
    const artCostingOptions =
      travelProfile === 'bicycle'
        ? { bicycle: artBicycleCosting }
        : { pedestrian: artPedestrianCosting };

    try {
      const valRes = await withUpstreamSlot(() =>
        fetch('https://valhalla1.openstreetmap.de/trace_route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'OpenRun/1.0',
          },
          body: JSON.stringify({
            shape: normalized.map((p) => ({ lat: p.lat, lon: p.lng })),
            costing: travelProfile,
            costing_options: artCostingOptions,
            shape_match: 'map_snap',
            trace_options: {
              search_radius: 100,
              gps_accuracy: 75,
              breakage_distance: 1500,
              interpolation_distance: 15,
            },
            units: 'kilometers',
          }),
          signal: AbortSignal.timeout(12000),
        })
      );

      if (valRes.ok) {
        const valData = (await valRes.json()) as {
          trip?: {
            summary?: { length?: number; time?: number };
            legs?: Array<{
              shape?: string;
              maneuvers?: Array<{
                instruction?: string;
                length?: number;
                time?: number;
                begin_shape_index?: number;
              }>;
            }>;
          };
        };

        const legs = valData.trip?.legs || [];
        // Single continuous leg indicates HMM successfully stitched the entire shape without breaks
        if (legs.length === 1 && legs[0].shape) {
          const path = decodePolyline6(legs[0].shape);
          const steps = (legs[0].maneuvers || []).map((m) => {
            const idx = Math.min(path.length - 1, Math.max(0, m.begin_shape_index || 0));
            return {
              instruction:
                m.instruction ||
                (travelProfile === 'bicycle' ? 'Continue along bikeway' : 'Continue along pedestrian path'),
              distanceMeters: Math.round((m.length || 0) * 1000),
              durationSec: Math.round(m.time || 0),
              startLocation: path[idx],
            };
          });
          const distanceMeters = Math.round((valData.trip?.summary?.length || 0) * 1000);
          const durationSec = Math.round(valData.trip?.summary?.time || 0);
          if (path.length >= 4 && distanceMeters > 150) {
            cacheAndSend({
              provider: travelProfile === 'bicycle' ? 'valhalla-hmm-bike-art' : 'valhalla-hmm-art',
              path,
              distanceMeters,
              durationSec,
              steps,
            });
            return;
          }
        }
      }
    } catch {
      // Fall through to multi-point route snapping
    }

    // Fallback: sample up to 9 evenly spaced anchor points via Valhalla route
    const step = Math.max(1, Math.floor((normalized.length - 1) / 8));
    const anchors: Array<{ lat: number; lng: number }> = [];
    for (let i = 0; i < normalized.length; i += step) {
      anchors.push(normalized[i]);
    }
    const last = normalized[normalized.length - 1];
    if (anchors[anchors.length - 1].lat !== last.lat || anchors[anchors.length - 1].lng !== last.lng) {
      anchors.push(last);
    }

    try {
      const valRes = await withUpstreamSlot(() =>
        fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'OpenRun/1.0',
          },
          body: JSON.stringify({
            locations: anchors.map((p, idx) => ({
              lat: p.lat,
              lon: p.lng,
              type: idx === 0 || idx === anchors.length - 1 ? 'break' : 'through',
            })),
            costing: travelProfile,
            costing_options: artCostingOptions,
            units: 'kilometers',
          }),
          signal: AbortSignal.timeout(12000),
        })
      );
      if (valRes.ok) {
        const valData = (await valRes.json()) as {
          trip?: {
            summary?: { length?: number; time?: number };
            legs?: Array<{
              shape?: string;
              maneuvers?: Array<{
                instruction?: string;
                length?: number;
                time?: number;
                begin_shape_index?: number;
              }>;
            }>;
          };
        };
        const legs = valData.trip?.legs || [];
        const fullPath: Array<{ lat: number; lng: number }> = [];
        const steps: Array<{
          instruction: string;
          distanceMeters: number;
          durationSec: number;
          startLocation?: { lat: number; lng: number };
        }> = [];
        for (const leg of legs) {
          if (!leg.shape) continue;
          const legPts = decodePolyline6(leg.shape);
          for (const m of leg.maneuvers || []) {
            const idx = Math.min(legPts.length - 1, Math.max(0, m.begin_shape_index || 0));
            steps.push({
              instruction:
                m.instruction ||
                (travelProfile === 'bicycle' ? 'Continue along bikeway' : 'Continue along pedestrian path'),
              distanceMeters: Math.round((m.length || 0) * 1000),
              durationSec: Math.round(m.time || 0),
              startLocation: legPts[idx],
            });
          }
          if (fullPath.length > 0 && legPts.length > 0) fullPath.push(...legPts.slice(1));
          else fullPath.push(...legPts);
        }
        const totalDistMeters = Math.round((valData.trip?.summary?.length || 0) * 1000);
        const totalDurationSec = Math.round(valData.trip?.summary?.time || 0);
        if (fullPath.length >= 4 && totalDistMeters > 150) {
          cacheAndSend({
            provider: travelProfile === 'bicycle' ? 'valhalla-bicycle' : 'valhalla-pedestrian',
            path: fullPath,
            distanceMeters: totalDistMeters,
            durationSec: totalDurationSec,
            steps,
          });
          return;
        }
      }
    } catch {
      // ignore
    }

    res.status(502).json({ error: `Unable to snap GPS Art curve to ${travelProfile} roads.` });
  });

  const tileCache = new Map<string, { expiresAt: number; buf: Buffer; contentType: string }>();
  const pendingTiles = new Map<string, Promise<{ buf: Buffer; contentType: string } | null>>();

  app.get('/api/map-tile/:z/:x/:y', async (req, res) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(String(req.params.y).replace(/\.png$/i, ''));
    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 10 ||
      z > 18 ||
      x < 0 ||
      y < 0
    ) {
      res.status(400).send('Invalid tile coordinates');
      return;
    }

    const maxTile = 1 << z;
    if (x >= maxTile || y >= maxTile) {
      res.status(400).send('Tile out of bounds');
      return;
    }

    const key = `${z}/${x}/${y}`;
    const cached = tileCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(cached.buf);
      return;
    }

    const cartoKey = (process.env.CARTO_API_KEY || '').trim();
    const sources: Array<{ url: string; headers?: Record<string, string>; isCarto?: boolean }> = [];
    if (cartoKey) {
      sources.push({
        url: `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png?api_key=${encodeURIComponent(cartoKey)}`,
        headers: { 'User-Agent': 'OpenRun/1.0' },
        isCarto: true,
      });
    }
    sources.push(
      {
        url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        headers: {
          'User-Agent': 'OpenRun/1.0 (+https://openrun.app)',
          Accept: 'image/png,image/*;q=0.9,*/*;q=0.8',
        },
      },
      {
        url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
        headers: { 'User-Agent': 'OpenRun/1.0' },
      }
    );

    let inflight = pendingTiles.get(key);
    if (!inflight) {
      inflight = (async () => {
        for (const src of sources) {
          try {
            const upstream = await fetch(src.url, {
              headers: src.headers,
              signal: AbortSignal.timeout(6000),
            });
            if (!upstream.ok) continue;

            const etag = upstream.headers.get('etag') || '';
            if (src.isCarto && etag.includes('wm-')) {
              // Carto serves "API KEY REQUIRED" watermark PNGs with etag starting with wm-
              continue;
            }

            const contentType = upstream.headers.get('content-type') || 'image/png';
            if (!contentType.startsWith('image/')) continue;

            const arr = await upstream.arrayBuffer();
            const buf = Buffer.from(arr);
            if (buf.length < 100) continue;

            if (tileCache.size >= 400) {
              const oldestKey = tileCache.keys().next().value;
              if (oldestKey) tileCache.delete(oldestKey);
            }
            tileCache.set(key, {
              expiresAt: Date.now() + 24 * 60 * 60 * 1000,
              buf,
              contentType,
            });
            return { buf, contentType };
          } catch {
            // Try fallback tile provider
          }
        }
        return null;
      })();
      pendingTiles.set(key, inflight);
      inflight.finally(() => {
        pendingTiles.delete(key);
      });
    }

    const result = await inflight;
    if (result) {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(result.buf);
      return;
    }

    res.status(502).send('Tile unavailable');
  });

  const imagesDir =
    process.env.NODE_ENV === 'production'
      ? path.resolve(process.cwd(), 'dist', 'images')
      : path.resolve(process.cwd(), 'public', 'images');
  app.use('/images', express.static(imagesDir, { maxAge: '7d' }));

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    vitePromise.catch((err) => {
      console.error('Failed to initialize Vite middleware:', err);
    });
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('error', (err) => {
    console.error('Server failed to bind port:', err);
    process.exit(1);
  });
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`OPEN RUN server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
