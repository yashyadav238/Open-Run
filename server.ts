import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { getNightExcludePolygonsForPoint } from './src/data/tricityPlaces';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'tricity-run' });
  });

  app.get('/api/maps-config', (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    res.json({ apiKey });
  });

  app.post('/api/elevation', async (req, res) => {
    const apiKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      '';
    const points = req.body?.points;
    if (!apiKey || !Array.isArray(points) || points.length < 2) {
      res.json({ available: false, elevationGainMeters: null });
      return;
    }

    try {
      const sampled = points.slice(0, 24).map((p: { lat: number; lng: number }) => `${p.lat},${p.lng}`).join('|');
      const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(sampled)}&key=${encodeURIComponent(apiKey)}`;
      const upstream = await fetch(url);
      if (!upstream.ok) {
        res.json({ available: false, elevationGainMeters: null });
        return;
      }
      const data = await upstream.json() as { status: string; results?: Array<{ elevation: number }> };
      if (data.status !== 'OK' || !data.results || data.results.length < 2) {
        res.json({ available: false, elevationGainMeters: null });
        return;
      }
      let gain = 0;
      for (let i = 1; i < data.results.length; i++) {
        const diff = data.results[i].elevation - data.results[i - 1].elevation;
        if (diff > 0.5) gain += diff;
      }
      res.json({ available: true, elevationGainMeters: Math.round(gain) });
    } catch {
      res.json({ available: false, elevationGainMeters: null });
    }
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

  async function queryGraphHopperChunk(
    chunk: Array<{ lat: number; lng: number }>,
    ghKey: string
  ): Promise<{
    path: Array<{ lat: number; lng: number }>;
    distanceMeters: number;
    durationSec: number;
    steps: Array<{
      instruction: string;
      distanceMeters: number;
      durationSec: number;
      startLocation?: { lat: number; lng: number };
    }>;
  } | null> {
    const ghParams = new URLSearchParams({
      profile: 'foot',
      points_encoded: 'false',
      instructions: 'true',
      calc_points: 'true',
      key: ghKey,
    });
    for (const p of chunk) {
      ghParams.append('point', `${p.lat},${p.lng}`);
    }
    const ghRes = await withUpstreamSlot(() =>
      fetch(`https://graphhopper.com/api/1/route?${ghParams.toString()}`, {
        signal: AbortSignal.timeout(10000),
      })
    );
    if (!ghRes.ok) return null;
    const ghData = (await ghRes.json()) as {
      paths?: Array<{
        distance: number;
        time: number;
        points?: { coordinates?: Array<[number, number]> };
        instructions?: Array<{ text: string; distance: number; time: number; interval?: [number, number] }>;
      }>;
    };
    const ghPath = ghData.paths?.[0];
    const coords = ghPath?.points?.coordinates || [];
    if (!ghPath || coords.length < 2) return null;

    const path = coords.map(([lng, lat]) => ({ lat, lng }));
    const steps = (ghPath.instructions || []).map((inst) => {
      const idx = Math.min(path.length - 1, Math.max(0, inst.interval?.[0] ?? 0));
      return {
        instruction: inst.text || 'Continue along path',
        distanceMeters: Math.round(inst.distance || 0),
        durationSec: Math.round((inst.time || 0) / 1000),
        startLocation: path[idx],
      };
    });
    return {
      path,
      distanceMeters: Math.round(ghPath.distance),
      durationSec: Math.round(ghPath.time / 1000),
      steps,
    };
  }

  app.post('/api/routing/walk', async (req, res) => {
    const waypoints = req.body?.waypoints as Array<{ lat: number; lng: number }> | undefined;
    const rawPrefs = Array.isArray(req.body?.preferences) ? (req.body.preferences as string[]) : [];
    const sortedPrefs = [...new Set(rawPrefs.map(String))].sort();
    if (!Array.isArray(waypoints) || waypoints.length < 2 || waypoints.length > 20) {
      res.status(400).json({ error: 'Between 2 and 20 waypoints are required.' });
      return;
    }

    const normalized = waypoints.map((p) => ({
      lat: Number(Number(p.lat).toFixed(5)),
      lng: Number(Number(p.lng).toFixed(5)),
    }));
    const cacheKey = `${normalized.map((p) => `${p.lat},${p.lng}`).join(';')}|${sortedPrefs.join(',')}`;
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
    if (ghKey && !isNightMode) {
      try {
        // Chunk into <=5-waypoint GraphHopper segments so Run Art routes also benefit
        const chunks: Array<Array<{ lat: number; lng: number }>> = [];
        for (let i = 0; i < normalized.length - 1; i += 4) {
          chunks.push(normalized.slice(i, Math.min(normalized.length, i + 5)));
        }
        const chunkResults = await Promise.all(chunks.map((c) => queryGraphHopperChunk(c, ghKey)));
        if (chunkResults.every((r) => r !== null)) {
          const mergedPath: Array<{ lat: number; lng: number }> = [];
          const mergedSteps: Array<{
            instruction: string;
            distanceMeters: number;
            durationSec: number;
            startLocation?: { lat: number; lng: number };
          }> = [];
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
            sendAndCache({
              provider: 'graphhopper-foot',
              path: mergedPath,
              distanceMeters: totalDistance,
              durationSec: totalDuration,
              steps: mergedSteps,
            });
            return;
          }
        }
      } catch {
        // Fall through to Valhalla Pedestrian / OSM Foot
      }
    }

    // 2. Valhalla Pedestrian tuned for parks, green belts & narrow sector passes (or Night Safe well-lit avenues)
    const preferParksOrPaths =
      sortedPrefs.length === 0 ||
      sortedPrefs.includes('parks_greenery') ||
      sortedPrefs.includes('pedestrian_paths') ||
      sortedPrefs.includes('quieter_roads');
    const avoidStairs = sortedPrefs.includes('avoid_stairs');
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
        }
      : {
          walking_speed: 9.2,
          walkway_factor: preferParksOrPaths ? 0.58 : 0.74,
          alley_factor: preferParksOrPaths ? 0.7 : 0.85,
          sidewalk_factor: 0.9,
          driveway_factor: 1.8,
          use_tracks: preferParksOrPaths ? 0.82 : 0.55,
          use_living_streets: 0.88,
          use_roads: preferParksOrPaths ? 0.22 : 0.45,
          step_penalty: avoidStairs ? 120 : 8,
        };

    const nightExcludePolygons = isNightMode
      ? getNightExcludePolygonsForPoint(normalized[0])
      : undefined;

    const queryValhallaRoute = async (withExcludes: boolean) => {
      const payload: Record<string, unknown> = {
        locations: normalized.map((p, idx) => ({
          lat: p.lat,
          lon: p.lng,
          type: idx === 0 || idx === normalized.length - 1 ? 'break' : 'through',
        })),
        costing: 'pedestrian',
        costing_options: {
          pedestrian: pedestrianCosting,
        },
        units: 'kilometers',
      };
      if (withExcludes && nightExcludePolygons && nightExcludePolygons.length > 0) {
        payload.exclude_polygons = nightExcludePolygons;
      }
      return await withUpstreamSlot(() =>
        fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'TricityRun-Chandigarh/1.0',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(14000),
        })
      );
    };

    try {
      let valRes = await queryValhallaRoute(true);
      if (!valRes.ok && isNightMode && nightExcludePolygons && nightExcludePolygons.length > 0) {
        // Retry without exclude_polygons if user's start/via point sits directly inside a zone box
        valRes = await queryValhallaRoute(false);
      }

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
              instruction: m.instruction || 'Continue along pedestrian path',
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

        const totalDistMeters = Math.round((valData.trip?.summary?.length || 0) * 1000);
        const totalDurationSec = Math.round(valData.trip?.summary?.time || 0);
        if (fullPath.length >= 2 && totalDistMeters > 0) {
          sendAndCache({
            provider: 'valhalla-pedestrian',
            path: fullPath,
            distanceMeters: totalDistMeters,
            durationSec: totalDurationSec,
            steps,
          });
          return;
        }
      }
    } catch {
      // Fall through to OSM Foot router
    }

    // 3. Fallback: OSM Foot Router (routed-foot)
    try {
      const coordStr = normalized.map((p) => `${p.lng},${p.lat}`).join(';');
      const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=true`;
      const upstream = await withUpstreamSlot(() =>
        fetch(url, {
          headers: { 'User-Agent': 'TricityRun-Chandigarh/1.0' },
          signal: AbortSignal.timeout(9000),
        })
      );
      if (!upstream.ok) {
        res.status(502).json({ error: 'Upstream pedestrian router unavailable.' });
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

      const route = data.routes?.[0];
      const coords = route?.geometry?.coordinates || [];
      if (data.code !== 'Ok' || !route || coords.length < 2) {
        res.status(404).json({ error: 'No connected pedestrian route found.' });
        return;
      }

      const path = coords.map(([lng, lat]) => ({ lat, lng }));
      const steps: Array<{
        instruction: string;
        distanceMeters: number;
        durationSec: number;
        maneuver?: string;
        startLocation?: { lat: number; lng: number };
      }> = [];

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

      sendAndCache({
        provider: 'osm-foot',
        path,
        distanceMeters: Math.round(route.distance),
        durationSec: Math.round(route.duration),
        steps,
      });
    } catch {
      res.status(502).json({ error: 'Failed to reach pedestrian routing service.' });
    }
  });

  app.post('/api/routing/trace-art', async (req, res) => {
    const shape = req.body?.shape as Array<{ lat: number; lng: number }> | undefined;
    const rawPrefs = Array.isArray(req.body?.preferences) ? (req.body.preferences as string[]) : [];
    const sortedPrefs = [...new Set(rawPrefs.map(String))].sort();
    const isNightMode = sortedPrefs.includes('well_lit');
    if (!Array.isArray(shape) || shape.length < 4 || shape.length > 60) {
      res.status(400).json({ error: 'Between 4 and 60 shape coordinates are required.' });
      return;
    }

    const normalized = shape.map((p) => ({
      lat: Number(Number(p.lat).toFixed(5)),
      lng: Number(Number(p.lng).toFixed(5)),
    }));
    const cacheKey = `art:${isNightMode ? 'night:' : ''}${normalized.map((p) => `${p.lat},${p.lng}`).join(';')}`;
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

    try {
      const valRes = await withUpstreamSlot(() =>
        fetch('https://valhalla1.openstreetmap.de/trace_route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'TricityRun-Chandigarh/1.0',
          },
          body: JSON.stringify({
            shape: normalized.map((p) => ({ lat: p.lat, lon: p.lng })),
            costing: 'pedestrian',
            costing_options: {
              pedestrian: artPedestrianCosting,
            },
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
              instruction: m.instruction || 'Continue along pedestrian path',
              distanceMeters: Math.round((m.length || 0) * 1000),
              durationSec: Math.round(m.time || 0),
              startLocation: path[idx],
            };
          });
          const distanceMeters = Math.round((valData.trip?.summary?.length || 0) * 1000);
          const durationSec = Math.round(valData.trip?.summary?.time || 0);
          if (path.length >= 4 && distanceMeters > 150) {
            cacheAndSend({
              provider: 'valhalla-hmm-art',
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
      // Fall through to multi-point pedestrian route snapping
    }

    // Fallback: sample up to 9 evenly spaced anchor points via Valhalla pedestrian route
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
            'User-Agent': 'TricityRun-Chandigarh/1.0',
          },
          body: JSON.stringify({
            locations: anchors.map((p, idx) => ({
              lat: p.lat,
              lon: p.lng,
              type: idx === 0 || idx === anchors.length - 1 ? 'break' : 'through',
            })),
            costing: 'pedestrian',
            costing_options: {
              pedestrian: artPedestrianCosting,
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
              instruction: m.instruction || 'Continue along pedestrian path',
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
            provider: 'valhalla-pedestrian',
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

    res.status(502).json({ error: 'Unable to snap Run Art curve to pedestrian roads.' });
  });

  const tileCache = new Map<string, { expiresAt: number; buf: Buffer }>();
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
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(cached.buf);
      return;
    }

    const urls = [
      `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
      `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    ];

    for (const url of urls) {
      try {
        const upstream = await fetch(url, {
          headers: { 'User-Agent': 'TricityRun-Chandigarh/1.0' },
          signal: AbortSignal.timeout(6000),
        });
        if (!upstream.ok) continue;
        const arr = await upstream.arrayBuffer();
        const buf = Buffer.from(arr);
        if (buf.length < 100) continue;

        if (tileCache.size >= 400) {
          const oldestKey = tileCache.keys().next().value;
          if (oldestKey) tileCache.delete(oldestKey);
        }
        tileCache.set(key, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, buf });

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(buf);
        return;
      } catch {
        // Try fallback tile provider
      }
    }

    res.status(502).send('Tile unavailable');
  });

  const imagesDir =
    process.env.NODE_ENV === 'production'
      ? path.resolve(process.cwd(), 'dist', 'images')
      : path.resolve(process.cwd(), 'public', 'images');
  app.use('/images', express.static(imagesDir, { maxAge: '7d' }));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TRICITY RUN server running on port ${PORT}`);
  });
}

startServer();
