import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Headphones,
  Link2,
  Loader2,
  LogOut,
  Music2,
  Play,
  Search,
  X,
} from 'lucide-react';

type MusicProvider = 'spotify' | 'youtube';

interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  profile: {
    displayName: string;
    avatarUrl?: string;
    email?: string;
  } | null;
  redirectUri: string;
}

interface MusicStatusResponse {
  spotify: ProviderStatus;
  youtube: ProviderStatus;
}

interface MusicMediaItem {
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  embedUrl: string;
  kind: 'playlist' | 'track';
  provider?: MusicProvider;
}

function parseDirectMusicUrl(rawUrl: string): MusicMediaItem | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Spotify playlist, track, album, or episode URL
  const spotifyMatch = trimmed.match(
    /open\.spotify\.com\/(playlist|track|album|episode)\/([a-zA-Z0-9]+)/i
  );
  if (spotifyMatch) {
    const type = spotifyMatch[1].toLowerCase();
    const id = spotifyMatch[2];
    return {
      id,
      title: `Spotify ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      subtitle: 'Direct Spotify Link',
      thumbnailUrl: '',
      embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`,
      kind: type === 'track' ? 'track' : 'playlist',
      provider: 'spotify',
    };
  }

  // YouTube / YouTube Music playlist URL
  const ytListMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  if (ytListMatch && /(youtube\.com|music\.youtube\.com|youtu\.be)/i.test(trimmed)) {
    const listId = ytListMatch[1];
    return {
      id: listId,
      title: 'YouTube Music Playlist',
      subtitle: 'Direct YouTube Music Link',
      thumbnailUrl: '',
      embedUrl: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}&autoplay=1`,
      kind: 'playlist',
      provider: 'youtube',
    };
  }

  // YouTube / YouTube Music video/song URL
  const ytVideoMatch = trimmed.match(
    /(?:youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  if (ytVideoMatch) {
    const videoId = ytVideoMatch[1];
    return {
      id: videoId,
      title: 'YouTube Music Track',
      subtitle: 'Direct YouTube Music Link',
      thumbnailUrl: '',
      embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`,
      kind: 'track',
      provider: 'youtube',
    };
  }

  return null;
}

export const MusicPlayerDock: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<MusicProvider>('spotify');
  const [status, setStatus] = useState<MusicStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<MusicProvider | null>(null);
  const [playlists, setPlaylists] = useState<Record<MusicProvider, MusicMediaItem[]>>({
    spotify: [],
    youtube: [],
  });
  const [loadingList, setLoadingList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicMediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [directLink, setDirectLink] = useState('');
  const [nowPlaying, setNowPlaying] = useState<MusicMediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const resp = await fetch('/api/music/status', { credentials: 'include' });
      if (resp.ok) {
        const data = (await resp.json()) as MusicStatusResponse;
        setStatus(data);
      }
    } catch {
      // Ignore transient status fetch errors
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const fetchPlaylists = useCallback(async (provider: MusicProvider) => {
    setLoadingList(true);
    setError(null);
    try {
      const resp = await fetch(`/api/music/${provider}/playlists`, { credentials: 'include' });
      const data = (await resp.json()) as { items?: MusicMediaItem[]; error?: string };
      if (!resp.ok) {
        throw new Error(data.error || `Could not load ${provider} playlists.`);
      }
      setPlaylists((prev) => ({
        ...prev,
        [provider]: (data.items || []).map((item) => ({ ...item, provider })),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load playlists.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Listen for OAuth popup completion via postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }
      const data = event.data as {
        type?: string;
        provider?: MusicProvider;
        message?: string;
      };
      if (data?.type === 'OAUTH_MUSIC_SUCCESS' && data.provider) {
        setConnectingProvider(null);
        setError(null);
        void fetchStatus().then(() => {
          void fetchPlaylists(data.provider!);
        });
      } else if (data?.type === 'OAUTH_MUSIC_ERROR') {
        setConnectingProvider(null);
        setError(data.message || 'Could not link music account.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchPlaylists, fetchStatus]);

  useEffect(() => {
    if (!open) return;
    if (status?.[activeProvider]?.connected && playlists[activeProvider].length === 0) {
      void fetchPlaylists(activeProvider);
    }
  }, [open, activeProvider, status, playlists, fetchPlaylists]);

  const handleConnect = async (provider: MusicProvider) => {
    setConnectingProvider(provider);
    setError(null);
    try {
      const resp = await fetch(`/api/music/${provider}/auth-url`, { credentials: 'include' });
      const data = (await resp.json()) as { url?: string; error?: string };
      if (!resp.ok || !data.url) {
        throw new Error(data.error || `Unable to start ${provider} login.`);
      }
      const popup = window.open(
        data.url,
        `openrun_${provider}_oauth`,
        'width=540,height=680,noopener=no'
      );
      if (!popup) {
        setConnectingProvider(null);
        setError('Popup was blocked. Please allow popups for this site to link your music account.');
      }
    } catch (err) {
      setConnectingProvider(null);
      setError(err instanceof Error ? err.message : 'Unable to connect account.');
    }
  };

  const handleDisconnect = async (provider: MusicProvider) => {
    try {
      await fetch(`/api/music/${provider}/disconnect`, {
        method: 'POST',
        credentials: 'include',
      });
      setPlaylists((prev) => ({ ...prev, [provider]: [] }));
      setSearchResults([]);
      if (nowPlaying?.provider === provider) {
        setNowPlaying(null);
      }
      await fetchStatus();
    } catch {
      setError('Failed to disconnect account.');
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const resp = await fetch(
        `/api/music/${activeProvider}/search?q=${encodeURIComponent(q)}`,
        { credentials: 'include' }
      );
      const data = (await resp.json()) as { items?: MusicMediaItem[]; error?: string };
      if (!resp.ok) {
        throw new Error(data.error || 'Search failed.');
      }
      setSearchResults((data.items || []).map((item) => ({ ...item, provider: activeProvider })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handlePlayDirectLink = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseDirectMusicUrl(directLink);
    if (!parsed) {
      setError('Paste a valid Spotify or YouTube Music track/playlist URL.');
      return;
    }
    setError(null);
    setNowPlaying(parsed);
    setDirectLink('');
  };

  const currentProviderStatus = status?.[activeProvider];
  const displayedItems = searchResults.length > 0 ? searchResults : playlists[activeProvider];

  return (
    <div className="fixed bottom-20 right-4 z-40 lg:bottom-5 lg:right-5">
      {/* Persistent embedded player stays mounted even when drawer is collapsed so audio keeps playing */}
      <div
        className={`w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-[#E5E3DC] bg-white shadow-2xl transition-all ${
          open ? 'block' : 'hidden'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-[#172D27] px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4 text-[#9AE62E]" />
            <div>
              <h3 className="font-display text-sm font-bold leading-tight">Workout Music</h3>
              <p className="text-[10px] text-[#B8E8C7]">Spotify &amp; YouTube Music</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Minimize music player"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#B8E8C7] hover:bg-[#30483E] hover:text-white"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {/* Provider Switcher */}
        <div className="grid grid-cols-2 gap-1.5 border-b border-[#E5E3DC] bg-[#F6F5F0] p-2">
          {(['spotify', 'youtube'] as MusicProvider[]).map((prov) => {
            const active = activeProvider === prov;
            const connected = Boolean(status?.[prov]?.connected);
            return (
              <button
                key={prov}
                type="button"
                onClick={() => {
                  setActiveProvider(prov);
                  setSearchResults([]);
                  setError(null);
                }}
                className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition ${
                  active
                    ? 'bg-[#172D27] text-[#9AE62E]'
                    : 'bg-white text-[#5B6B64] hover:text-[#141F1B]'
                }`}
              >
                <Music2 className="h-3.5 w-3.5" />
                <span>{prov === 'spotify' ? 'Spotify' : 'YT Music'}</span>
                {connected && <Check className="h-3 w-3 text-[#9AE62E]" />}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="max-h-[62dvh] overflow-y-auto p-3.5 space-y-3">
          {/* Connection Status Card */}
          <div className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0]/70 p-3">
            {loadingStatus && !status ? (
              <div className="flex items-center gap-2 text-xs text-[#5B6B64]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking connection...
              </div>
            ) : currentProviderStatus?.connected ? (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#172D27]">
                    Connected as {currentProviderStatus.profile?.displayName || 'Linked Account'}
                  </p>
                  <p className="text-[11px] text-[#5B6B64]">
                    {activeProvider === 'spotify' ? 'Spotify Library Synced' : 'YouTube Music Library Synced'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDisconnect(activeProvider)}
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[#D9D7CE] bg-white px-2.5 text-[11px] font-semibold text-[#5B6B64] hover:text-red-600"
                >
                  <LogOut className="h-3 w-3" />
                  Unlink
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#141F1B]">
                  Link your {activeProvider === 'spotify' ? 'Spotify' : 'YouTube Music'} account
                </p>
                <p className="text-[11px] text-[#5B6B64]">
                  Access your playlists, search tracks, and stream directly inside OPEN RUN.
                </p>
                <button
                  type="button"
                  disabled={connectingProvider === activeProvider}
                  onClick={() => void handleConnect(activeProvider)}
                  className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-xl bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E] disabled:opacity-60"
                >
                  {connectingProvider === activeProvider ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  {connectingProvider === activeProvider
                    ? 'Waiting for authorization...'
                    : `Connect ${activeProvider === 'spotify' ? 'Spotify' : 'YouTube Music'}`}
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
              {error}
            </div>
          )}

          {/* Connected Search & Playlists */}
          {currentProviderStatus?.connected && (
            <div className="space-y-2.5">
              <form onSubmit={handleSearch} className="flex gap-1.5">
                <div className="flex flex-1 items-center rounded-xl border border-[#D9D7CE] bg-white px-2.5">
                  <Search className="mr-1.5 h-3.5 w-3.5 text-[#5B6B64]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search ${activeProvider === 'spotify' ? 'Spotify' : 'YT Music'}...`}
                    className="h-9 w-full bg-transparent text-xs focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="min-h-[36px] rounded-xl bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E] disabled:opacity-60"
                >
                  {searching ? '...' : 'Go'}
                </button>
              </form>

              {loadingList ? (
                <div className="flex items-center justify-center py-4 text-xs text-[#5B6B64]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading your playlists...
                </div>
              ) : displayedItems.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-[#5B6B64]">
                    {searchResults.length > 0 ? 'Search Results' : 'Your Playlists'}
                  </p>
                  <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                    {displayedItems.map((item) => (
                      <button
                        key={`${item.provider}-${item.id}`}
                        type="button"
                        onClick={() => setNowPlaying(item)}
                        className="flex w-full items-center gap-2.5 rounded-xl border border-[#E5E3DC] bg-white p-2 text-left transition hover:bg-[#F6F5F0]"
                      >
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#172D27] text-[#9AE62E]">
                            <Music2 className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-[#141F1B]">{item.title}</p>
                          <p className="truncate text-[11px] text-[#5B6B64]">{item.subtitle}</p>
                        </div>
                        <Play className="h-3.5 w-3.5 shrink-0 text-[#30483E]" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-center text-xs text-[#5B6B64] py-2">
                  No playlists found. Try searching for a song or playlist above.
                </p>
              )}
            </div>
          )}

          {/* Quick Play by Link (works anytime for Spotify & YouTube Music URLs) */}
          <form onSubmit={handlePlayDirectLink} className="space-y-1.5 border-t border-[#E5E3DC] pt-3">
            <label className="block text-[11px] font-semibold text-[#5B6B64]">
              Or paste any Spotify / YouTube Music link
            </label>
            <div className="flex gap-1.5">
              <input
                type="url"
                value={directLink}
                onChange={(e) => setDirectLink(e.target.value)}
                placeholder="https://open.spotify.com/... or music.youtube.com/..."
                className="h-9 flex-1 rounded-xl border border-[#D9D7CE] bg-white px-2.5 text-xs focus:border-[#172D27] focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[36px] rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-xs font-semibold text-[#141F1B] hover:bg-[#E5E3DC]"
              >
                Play
              </button>
            </div>
          </form>
        </div>

        {/* Embedded Player */}
        {nowPlaying && (
          <div className="border-t border-[#E5E3DC] bg-[#141F1B] p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
              <p className="truncate text-[11px] font-semibold text-[#9AE62E]">
                Now Playing: {nowPlaying.title}
              </p>
              <button
                type="button"
                aria-label="Stop music"
                onClick={() => setNowPlaying(null)}
                className="text-[#B8E8C7] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <iframe
              key={nowPlaying.embedUrl}
              src={nowPlaying.embedUrl}
              title={nowPlaying.title}
              width="100%"
              height={nowPlaying.provider === 'spotify' ? '152' : '180'}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              className="rounded-xl border-0"
            />
          </div>
        )}
      </div>

      {/* Floating Toggle Pill */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E] shadow-lg transition hover:bg-[#224037]"
        >
          <Headphones className="h-4 w-4" />
          <span>{nowPlaying ? `Playing: ${nowPlaying.title.slice(0, 18)}` : 'Music'}</span>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
