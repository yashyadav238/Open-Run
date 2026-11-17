import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';

interface ProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  profile?: {
    displayName: string;
    avatarUrl?: string;
    email?: string;
  };
}

interface MusicSession {
  spotify?: ProviderTokens;
  youtube?: ProviderTokens;
}

const SESSION_COOKIE_NAME = 'openrun_music_sid';
const sessions = new Map<string, MusicSession>();

function getAppUrl(req: Request): string {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl;
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(val);
    }
  }
  return out;
}

function getOrCreateSessionId(req: Request, res: Response): string {
  const cookies = parseCookies(req);
  let sid = cookies[SESSION_COOKIE_NAME];
  if (!sid || sid.length < 16) {
    sid = crypto.randomBytes(24).toString('hex');
  }
  if (!sessions.has(sid)) {
    sessions.set(sid, {});
  }
  res.cookie(SESSION_COOKIE_NAME, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return sid;
}

function getSession(req: Request): MusicSession | null {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE_NAME];
  if (!sid) return null;
  return sessions.get(sid) || null;
}

function renderPopupResultHtml(payload: {
  type: 'OAUTH_MUSIC_SUCCESS' | 'OAUTH_MUSIC_ERROR';
  provider: 'spotify' | 'youtube';
  message?: string;
}): string {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>OPEN RUN Music Auth</title></head>
  <body style="font-family:system-ui,sans-serif;background:#172D27;color:#F6F5F0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
    <div>
      <p style="font-size:15px;font-weight:600;margin:0;">${
        payload.type === 'OAUTH_MUSIC_SUCCESS'
          ? 'Connected successfully! Returning to OPEN RUN...'
          : payload.message || 'Authentication failed. You can close this window.'
      }</p>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage(${safeJson}, '*');
        window.close();
      }
    </script>
  </body>
</html>`;
}

async function refreshSpotifyTokenIfNeeded(tokens: ProviderTokens): Promise<string | null> {
  if (Date.now() < tokens.expiresAtMs - 60_000) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) return null;
  const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!data.access_token) return null;
  tokens.accessToken = data.access_token;
  tokens.expiresAtMs = Date.now() + (data.expires_in || 3600) * 1000;
  if (data.refresh_token) tokens.refreshToken = data.refresh_token;
  return tokens.accessToken;
}

async function refreshYouTubeTokenIfNeeded(tokens: ProviderTokens): Promise<string | null> {
  if (Date.now() < tokens.expiresAtMs - 60_000) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) return null;
  const clientId = (process.env.YOUTUBE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  tokens.accessToken = data.access_token;
  tokens.expiresAtMs = Date.now() + (data.expires_in || 3600) * 1000;
  return tokens.accessToken;
}

export function registerMusicRoutes(app: Express): void {
  /* ------------------------------ Status ------------------------------ */
  app.get('/api/music/status', (req, res) => {
    const appUrl = getAppUrl(req);
    const session = getSession(req);
    const spotifyConfigured = Boolean(
      (process.env.SPOTIFY_CLIENT_ID || '').trim() &&
        (process.env.SPOTIFY_CLIENT_SECRET || '').trim()
    );
    const youtubeConfigured = Boolean(
      (process.env.YOUTUBE_CLIENT_ID || '').trim() &&
        (process.env.YOUTUBE_CLIENT_SECRET || '').trim()
    );

    res.json({
      spotify: {
        configured: spotifyConfigured,
        connected: Boolean(session?.spotify?.accessToken),
        profile: session?.spotify?.profile || null,
        redirectUri: `${appUrl}/auth/spotify/callback`,
      },
      youtube: {
        configured: youtubeConfigured,
        connected: Boolean(session?.youtube?.accessToken),
        profile: session?.youtube?.profile || null,
        redirectUri: `${appUrl}/auth/youtube/callback`,
      },
    });
  });

  /* --------------------------- Spotify OAuth -------------------------- */
  app.get('/api/music/spotify/auth-url', (req, res) => {
    const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    if (!clientId) {
      res.status(400).json({
        error: 'Spotify OAuth is not configured yet. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in AI Studio Secrets.',
      });
      return;
    }
    const sid = getOrCreateSessionId(req, res);
    const redirectUri = `${getAppUrl(req)}/auth/spotify/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state: sid,
      scope: [
        'user-read-private',
        'user-read-email',
        'playlist-read-private',
        'playlist-read-collaborative',
        'user-library-read',
      ].join(' '),
      show_dialog: 'true',
    });
    res.json({ url: `https://accounts.spotify.com/authorize?${params.toString()}` });
  });

  const handleSpotifyCallback = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthErr = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthErr || !code) {
      res.send(
        renderPopupResultHtml({
          type: 'OAUTH_MUSIC_ERROR',
          provider: 'spotify',
          message: oauthErr ? `Spotify authorization declined (${oauthErr}).` : 'Missing authorization code.',
        })
      );
      return;
    }

    const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    const redirectUri = `${getAppUrl(req)}/auth/spotify/callback`;

    try {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenResp.ok) {
        const text = await tokenResp.text();
        throw new Error(`Spotify token exchange failed (${tokenResp.status}): ${text.slice(0, 120)}`);
      }
      const tokenData = (await tokenResp.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      let profile: ProviderTokens['profile'];
      try {
        const meResp = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (meResp.ok) {
          const me = (await meResp.json()) as {
            display_name?: string;
            email?: string;
            images?: Array<{ url?: string }>;
          };
          profile = {
            displayName: me.display_name || 'Spotify User',
            email: me.email,
            avatarUrl: me.images?.[0]?.url,
          };
        }
      } catch {
        // Profile fetch is best-effort
      }

      const sid = state && state.length >= 16 ? state : getOrCreateSessionId(req, res);
      const sess = sessions.get(sid) || {};
      sess.spotify = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAtMs: Date.now() + (tokenData.expires_in || 3600) * 1000,
        profile,
      };
      sessions.set(sid, sess);
      res.cookie(SESSION_COOKIE_NAME, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.send(renderPopupResultHtml({ type: 'OAUTH_MUSIC_SUCCESS', provider: 'spotify' }));
    } catch (err) {
      res.send(
        renderPopupResultHtml({
          type: 'OAUTH_MUSIC_ERROR',
          provider: 'spotify',
          message: err instanceof Error ? err.message : 'Spotify connection failed.',
        })
      );
    }
  };

  app.get(['/auth/spotify/callback', '/auth/spotify/callback/'], handleSpotifyCallback);

  app.post('/api/music/spotify/disconnect', (req, res) => {
    const session = getSession(req);
    if (session) delete session.spotify;
    res.json({ ok: true });
  });

  app.get('/api/music/spotify/playlists', async (req, res) => {
    const session = getSession(req);
    if (!session?.spotify) {
      res.status(401).json({ error: 'Spotify account not connected.' });
      return;
    }
    const token = await refreshSpotifyTokenIfNeeded(session.spotify);
    if (!token) {
      delete session.spotify;
      res.status(401).json({ error: 'Spotify session expired. Please reconnect.' });
      return;
    }
    try {
      const resp = await fetch('https://api.spotify.com/v1/me/playlists?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        res.status(resp.status).json({ error: 'Could not load Spotify playlists.' });
        return;
      }
      const data = (await resp.json()) as {
        items?: Array<{
          id: string;
          name: string;
          images?: Array<{ url: string }>;
          tracks?: { total?: number };
          owner?: { display_name?: string };
        }>;
      };
      const items = (data.items || []).map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.tracks?.total ?? 0} tracks · ${p.owner?.display_name || 'Spotify'}`,
        thumbnailUrl: p.images?.[0]?.url || '',
        embedUrl: `https://open.spotify.com/embed/playlist/${p.id}?utm_source=generator&theme=0`,
        kind: 'playlist' as const,
      }));
      res.json({ items });
    } catch {
      res.status(500).json({ error: 'Failed to fetch Spotify playlists.' });
    }
  });

  app.get('/api/music/spotify/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ items: [] });
      return;
    }
    const session = getSession(req);
    if (!session?.spotify) {
      res.status(401).json({ error: 'Spotify account not connected.' });
      return;
    }
    const token = await refreshSpotifyTokenIfNeeded(session.spotify);
    if (!token) {
      delete session.spotify;
      res.status(401).json({ error: 'Spotify session expired. Please reconnect.' });
      return;
    }
    try {
      const resp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track,playlist&limit=8`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        res.status(resp.status).json({ error: 'Spotify search failed.' });
        return;
      }
      const data = (await resp.json()) as {
        tracks?: {
          items?: Array<{
            id: string;
            name: string;
            artists?: Array<{ name: string }>;
            album?: { images?: Array<{ url: string }> };
          }>;
        };
        playlists?: {
          items?: Array<{
            id: string;
            name: string;
            images?: Array<{ url: string }>;
            owner?: { display_name?: string };
          } | null>;
        };
      };
      const tracks = (data.tracks?.items || []).map((t) => ({
        id: t.id,
        title: t.name,
        subtitle: (t.artists || []).map((a) => a.name).join(', ') || 'Track',
        thumbnailUrl: t.album?.images?.[0]?.url || '',
        embedUrl: `https://open.spotify.com/embed/track/${t.id}?utm_source=generator&theme=0`,
        kind: 'track' as const,
      }));
      const playlists = (data.playlists?.items || [])
        .filter((p): p is NonNullable<typeof p> => Boolean(p && p.id))
        .map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: `Playlist · ${p.owner?.display_name || 'Spotify'}`,
          thumbnailUrl: p.images?.[0]?.url || '',
          embedUrl: `https://open.spotify.com/embed/playlist/${p.id}?utm_source=generator&theme=0`,
          kind: 'playlist' as const,
        }));
      res.json({ items: [...tracks, ...playlists] });
    } catch {
      res.status(500).json({ error: 'Spotify search failed.' });
    }
  });

  /* ------------------------ YouTube Music OAuth ----------------------- */
  app.get('/api/music/youtube/auth-url', (req, res) => {
    const clientId = (process.env.YOUTUBE_CLIENT_ID || '').trim();
    if (!clientId) {
      res.status(400).json({
        error: 'YouTube Music OAuth is not configured yet. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in AI Studio Secrets.',
      });
      return;
    }
    const sid = getOrCreateSessionId(req, res);
    const redirectUri = `${getAppUrl(req)}/auth/youtube/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state: sid,
      scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile',
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  });

  const handleYouTubeCallback = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthErr = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthErr || !code) {
      res.send(
        renderPopupResultHtml({
          type: 'OAUTH_MUSIC_ERROR',
          provider: 'youtube',
          message: oauthErr ? `YouTube Music authorization declined (${oauthErr}).` : 'Missing authorization code.',
        })
      );
      return;
    }

    const clientId = (process.env.YOUTUBE_CLIENT_ID || '').trim();
    const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
    const redirectUri = `${getAppUrl(req)}/auth/youtube/callback`;

    try {
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenResp.ok) {
        const text = await tokenResp.text();
        throw new Error(`YouTube token exchange failed (${tokenResp.status}): ${text.slice(0, 120)}`);
      }
      const tokenData = (await tokenResp.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      let profile: ProviderTokens['profile'];
      try {
        const meResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (meResp.ok) {
          const me = (await meResp.json()) as { name?: string; picture?: string };
          profile = {
            displayName: me.name || 'YouTube Music User',
            avatarUrl: me.picture,
          };
        }
      } catch {
        // Best-effort profile lookup
      }

      const sid = state && state.length >= 16 ? state : getOrCreateSessionId(req, res);
      const sess = sessions.get(sid) || {};
      sess.youtube = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAtMs: Date.now() + (tokenData.expires_in || 3600) * 1000,
        profile,
      };
      sessions.set(sid, sess);
      res.cookie(SESSION_COOKIE_NAME, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.send(renderPopupResultHtml({ type: 'OAUTH_MUSIC_SUCCESS', provider: 'youtube' }));
    } catch (err) {
      res.send(
        renderPopupResultHtml({
          type: 'OAUTH_MUSIC_ERROR',
          provider: 'youtube',
          message: err instanceof Error ? err.message : 'YouTube Music connection failed.',
        })
      );
    }
  };

  app.get(['/auth/youtube/callback', '/auth/youtube/callback/'], handleYouTubeCallback);

  app.post('/api/music/youtube/disconnect', (req, res) => {
    const session = getSession(req);
    if (session) delete session.youtube;
    res.json({ ok: true });
  });

  app.get('/api/music/youtube/playlists', async (req, res) => {
    const session = getSession(req);
    if (!session?.youtube) {
      res.status(401).json({ error: 'YouTube Music account not connected.' });
      return;
    }
    const token = await refreshYouTubeTokenIfNeeded(session.youtube);
    if (!token) {
      delete session.youtube;
      res.status(401).json({ error: 'YouTube Music session expired. Please reconnect.' });
      return;
    }
    try {
      const resp = await fetch(
        'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=20',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        res.status(resp.status).json({ error: 'Could not load YouTube Music playlists.' });
        return;
      }
      const data = (await resp.json()) as {
        items?: Array<{
          id: string;
          snippet?: {
            title?: string;
            channelTitle?: string;
            thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
          };
          contentDetails?: { itemCount?: number };
        }>;
      };
      const items = (data.items || []).map((p) => ({
        id: p.id,
        title: p.snippet?.title || 'Untitled Playlist',
        subtitle: `${p.contentDetails?.itemCount ?? 0} videos · ${p.snippet?.channelTitle || 'YouTube Music'}`,
        thumbnailUrl: p.snippet?.thumbnails?.medium?.url || p.snippet?.thumbnails?.default?.url || '',
        embedUrl: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(p.id)}&autoplay=1`,
        kind: 'playlist' as const,
      }));
      res.json({ items });
    } catch {
      res.status(500).json({ error: 'Failed to fetch YouTube Music playlists.' });
    }
  });

  app.get('/api/music/youtube/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ items: [] });
      return;
    }
    const session = getSession(req);
    if (!session?.youtube) {
      res.status(401).json({ error: 'YouTube Music account not connected.' });
      return;
    }
    const token = await refreshYouTubeTokenIfNeeded(session.youtube);
    if (!token) {
      delete session.youtube;
      res.status(401).json({ error: 'YouTube Music session expired. Please reconnect.' });
      return;
    }
    try {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        res.status(resp.status).json({ error: 'YouTube Music search failed.' });
        return;
      }
      const data = (await resp.json()) as {
        items?: Array<{
          id?: { videoId?: string };
          snippet?: {
            title?: string;
            channelTitle?: string;
            thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
          };
        }>;
      };
      const items = (data.items || [])
        .filter((v) => Boolean(v.id?.videoId))
        .map((v) => ({
          id: v.id!.videoId!,
          title: v.snippet?.title || 'Music Track',
          subtitle: v.snippet?.channelTitle || 'YouTube Music',
          thumbnailUrl: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || '',
          embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(v.id!.videoId!)}?autoplay=1`,
          kind: 'track' as const,
        }));
      res.json({ items });
    } catch {
      res.status(500).json({ error: 'YouTube Music search failed.' });
    }
  });
}
