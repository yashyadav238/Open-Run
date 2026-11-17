import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Edit3, Flame, Heart, Music, Play, RefreshCw, Volume2, VolumeX, X } from 'lucide-react';

export interface MotivationalQuote {
  id: string;
  text: string;
  author?: string;
  role?: string;
  subline?: string;
}

export const MOTIVATIONAL_QUOTES: MotivationalQuote[] = [
  // General brutal & motivating quotes
  {
    id: 'gen_1',
    text: 'Nobody cares that you are tired. Lace up and move.',
    subline: 'Excuses burn zero calories.',
  },
  {
    id: 'gen_2',
    text: 'Your comfort zone is where your goals go to die.',
    subline: 'Step outside. Start the clock.',
  },
  {
    id: 'gen_3',
    text: 'Discipline is doing it when your legs scream stay in bed.',
    subline: 'Motivation fades. Kilometres stay.',
  },
  {
    id: 'gen_4',
    text: 'Stop waiting to feel ready. You will never feel ready.',
    subline: 'The first kilometre is always the hardest.',
  },
  {
    id: 'gen_5',
    text: 'The version of you that quit yesterday is hoping you quit today.',
    subline: 'Prove them wrong on the road.',
  },
  {
    id: 'gen_6',
    text: 'You do not get the body or pace you wish for. You get the one you suffer for.',
    subline: 'Earn every split.',
  },
  {
    id: 'gen_7',
    text: 'Rain, heat, wind, fatigue — the road does not negotiate.',
    subline: 'Show up anyway.',
  },
  {
    id: 'gen_8',
    text: 'Pain is temporary. Regret for skipping the session lasts all day.',
    subline: 'Outrun the excuse.',
  },
  {
    id: 'gen_9',
    text: 'Your mind gives up long before your legs actually do.',
    subline: 'Push past the noise.',
  },
  {
    id: 'gen_10',
    text: 'Every kilometre you skip is a kilometre your future self has to pay for.',
    subline: 'Collect the work now.',
  },
  {
    id: 'gen_11',
    text: 'Stop negotiating with weakness. You made a promise — keep it.',
    subline: 'No shortcuts. Just miles.',
  },
  {
    id: 'gen_12',
    text: 'You already survived 100% of your hardest workouts. This one will not break you.',
    subline: 'Lock in and go.',
  },

  // Famous & legendary personality quotes
  {
    id: 'fam_1',
    text: 'You are in danger of living a life so comfortable and soft, that you will die without ever realizing your true potential.',
    author: 'David Goggins',
    role: 'Ultramarathon Runner & Former Navy SEAL',
  },
  {
    id: 'fam_2',
    text: 'I hated every minute of training, but I said, don’t quit. Suffer now and live the rest of your life as a champion.',
    author: 'Muhammad Ali',
    role: '3x Heavyweight Boxing Champion',
  },
  {
    id: 'fam_3',
    text: 'Rest at the end, not in the middle.',
    author: 'Kobe Bryant',
    role: '5x NBA Champion',
  },
  {
    id: 'fam_4',
    text: 'No human is limited. Only the disciplined ones in life are free.',
    author: 'Eliud Kipchoge',
    role: 'Olympic Marathon Champion',
  },
  {
    id: 'fam_5',
    text: 'Do not pray for an easy life, pray for the strength to endure a difficult one.',
    author: 'Bruce Lee',
    role: 'Martial Artist & Philosopher',
  },
  {
    id: 'fam_6',
    text: 'Arise, awake, and stop not till the goal is reached.',
    author: 'Swami Vivekananda',
    role: 'Philosopher & Spiritual Leader',
  },
  {
    id: 'fam_7',
    text: 'The impediment to action advances action. What stands in the way becomes the way.',
    author: 'Marcus Aurelius',
    role: 'Roman Emperor & Stoic Philosopher',
  },
  {
    id: 'fam_8',
    text: 'Strength does not come from winning. Your struggles develop your strengths. When you go through hardships and decide not to surrender, that is strength.',
    author: 'Arnold Schwarzenegger',
    role: '7x Mr. Olympia & Former Governor',
  },
  {
    id: 'fam_9',
    text: 'I can accept failure, everyone fails at something. But I can’t accept not trying.',
    author: 'Michael Jordan',
    role: '6x NBA Champion',
  },
  {
    id: 'fam_10',
    text: 'I trained 4 years to run 9 seconds, and people give up when they don’t see results in 2 months.',
    author: 'Usain Bolt',
    role: '8x Olympic Gold Medalist',
  },
  {
    id: 'fam_11',
    text: 'Discipline is doing what you hate to do, but nonetheless doing it like you love it.',
    author: 'Mike Tyson',
    role: 'Undisputed Heavyweight Champion',
  },
  {
    id: 'fam_12',
    text: 'To give anything less than your best is to sacrifice the gift.',
    author: 'Steve Prefontaine',
    role: 'Olympic Distance Runner',
  },
  {
    id: 'fam_13',
    text: 'It always seems impossible until it’s done.',
    author: 'Nelson Mandela',
    role: 'Former President of South Africa',
  },
  {
    id: 'fam_14',
    text: 'Discipline equals freedom.',
    author: 'Jocko Willink',
    role: 'Retired Navy SEAL Officer',
  },
  {
    id: 'fam_15',
    text: 'A champion is defined not by their wins, but by how they can recover when they fall.',
    author: 'Serena Williams',
    role: '23x Grand Slam Champion',
  },
  {
    id: 'fam_16',
    text: 'Difficulties strengthen the mind, as labor does the body.',
    author: 'Seneca',
    role: 'Stoic Philosopher',
  },
  {
    id: 'fam_17',
    text: 'How long are you going to wait before you demand the best for yourself?',
    author: 'Epictetus',
    role: 'Greek Stoic Philosopher',
  },
  {
    id: 'fam_18',
    text: 'If you are going through hell, keep going.',
    author: 'Winston Churchill',
    role: 'Former UK Prime Minister',
  },
  {
    id: 'fam_19',
    text: 'Nothing in the world is worth having or worth doing unless it means effort, pain, difficulty.',
    author: 'Theodore Roosevelt',
    role: '26th U.S. President',
  },
  {
    id: 'fam_20',
    text: 'Hard work beats talent when talent fails to work hard.',
    author: 'Kevin Durant',
    role: '2x NBA Champion & Olympic Gold Medalist',
  },
];

const BAG_KEY = 'open_run_quote_bag_v3';
const LAST_IDX_KEY = 'open_run_last_quote_idx_v3';
const FAVORITES_KEY = 'open_run_favorite_quotes_v1';
const CUSTOM_QUOTE_KEY = 'open_run_custom_startup_quote_v1';
const AUDIO_PREF_KEY = 'open_run_startup_audio_pref_v1';
const LAST_TUNE_KEY = 'open_run_last_tune_idx_v1';

interface CustomStartupQuote {
  enabled: boolean;
  text: string;
  author?: string;
}

interface StartupAudioPref {
  mode: 'builtin' | 'spotify' | 'youtube' | 'off';
  customUrl: string;
  label?: string;
}

const BUILTIN_TUNES: Array<{ name: string; notes: number[]; tempoMs: number }> = [
  { name: 'Dawn Rise', notes: [261.63, 329.63, 392.0, 523.25], tempoMs: 145 },
  { name: 'Tempo Pulse', notes: [293.66, 369.99, 440.0, 587.33, 440.0, 587.33], tempoMs: 120 },
  { name: 'Summit Chord', notes: [220.0, 277.18, 329.63, 440.0, 659.25], tempoMs: 150 },
  { name: 'Stride Spark', notes: [329.63, 392.0, 493.88, 659.25], tempoMs: 130 },
  { name: 'Victory Fanfare', notes: [261.63, 329.63, 392.0, 493.88, 523.25, 659.25], tempoMs: 115 },
];

function drawNextTuneIndex(): number {
  try {
    const raw = localStorage.getItem(LAST_TUNE_KEY);
    const last = raw !== null ? Number(raw) : -1;
    const next = (Number.isInteger(last) ? last + 1 : 0) % BUILTIN_TUNES.length;
    localStorage.setItem(LAST_TUNE_KEY, String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * BUILTIN_TUNES.length);
  }
}

function playSynthTune(tuneIndex: number): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const tune = BUILTIN_TUNES[tuneIndex % BUILTIN_TUNES.length];
    const now = ctx.currentTime;
    tune.notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + (i * tune.tempoMs) / 1000);
      gain.gain.setValueAtTime(0.001, now + (i * tune.tempoMs) / 1000);
      gain.gain.exponentialRampToValueAtTime(0.12, now + (i * tune.tempoMs) / 1000 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + ((i + 1.4) * tune.tempoMs) / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + (i * tune.tempoMs) / 1000);
      osc.stop(now + ((i + 1.5) * tune.tempoMs) / 1000);
    });
  } catch {
    // Browser autoplay policy may block until user gesture
  }
}

function parseEmbedUrl(mode: 'spotify' | 'youtube', rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (mode === 'spotify') {
    const m = trimmed.match(/open\.spotify\.com\/(track|playlist|album)\/([A-Za-z0-9]+)/);
    if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`;
    return null;
  }
  if (mode === 'youtube') {
    const vMatch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/) || trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (vMatch) return `https://www.youtube.com/embed/${vMatch[1]}?autoplay=1&rel=0`;
    const listMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
    if (listMatch) return `https://www.youtube.com/embed/videoseries?list=${listMatch[1]}&autoplay=1`;
    return null;
  }
  return null;
}

function loadCustomQuote(): CustomStartupQuote {
  try {
    const raw = localStorage.getItem(CUSTOM_QUOTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CustomStartupQuote>;
      return {
        enabled: Boolean(parsed.enabled && parsed.text?.trim()),
        text: typeof parsed.text === 'string' ? parsed.text : '',
        author: typeof parsed.author === 'string' ? parsed.author : '',
      };
    }
  } catch {
    // ignore
  }
  return { enabled: false, text: '', author: '' };
}

function loadAudioPref(): StartupAudioPref {
  try {
    const raw = localStorage.getItem(AUDIO_PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StartupAudioPref>;
      if (parsed.mode === 'builtin' || parsed.mode === 'spotify' || parsed.mode === 'youtube' || parsed.mode === 'off') {
        return {
          mode: parsed.mode,
          customUrl: typeof parsed.customUrl === 'string' ? parsed.customUrl : '',
          label: typeof parsed.label === 'string' ? parsed.label : '',
        };
      }
    }
  } catch {
    // ignore
  }
  return { mode: 'builtin', customUrl: '' };
}

export function loadFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFavoriteIds(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage quota errors
  }
}

function createShuffledIndices(count: number, avoidFirst?: number): number[] {
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (typeof avoidFirst === 'number' && arr.length > 1 && arr[0] === avoidFirst) {
    const swapIdx = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swapIdx]] = [arr[swapIdx], arr[0]];
  }
  return arr;
}

/**
 * Draws the next quote index from a persisted shuffled bag so every app launch
 * guarantees a different quote, mixing general & famous personality quotes.
 */
function drawNextUniqueQuoteIndex(currentIdx?: number): number {
  const count = MOTIVATIONAL_QUOTES.length;
  if (count <= 1) return 0;

  try {
    const rawLast = localStorage.getItem(LAST_IDX_KEY);
    const lastIdx =
      typeof currentIdx === 'number'
        ? currentIdx
        : rawLast !== null && Number.isInteger(Number(rawLast))
        ? Number(rawLast)
        : undefined;

    let bag: number[] = [];
    const rawBag = localStorage.getItem(BAG_KEY);
    if (rawBag) {
      const parsed = JSON.parse(rawBag);
      if (Array.isArray(parsed)) {
        bag = parsed.filter(
          (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < count
        );
      }
    }

    if (bag.length === 0) {
      bag = createShuffledIndices(count, lastIdx);
    }

    let nextIdx = bag.shift()!;
    if (typeof lastIdx === 'number' && nextIdx === lastIdx) {
      if (bag.length === 0) {
        bag = createShuffledIndices(count, lastIdx);
      }
      nextIdx = bag.shift()!;
    }

    localStorage.setItem(BAG_KEY, JSON.stringify(bag));
    localStorage.setItem(LAST_IDX_KEY, String(nextIdx));
    return nextIdx;
  } catch {
    let fallback = Math.floor(Math.random() * count);
    if (typeof currentIdx === 'number' && fallback === currentIdx) {
      fallback = (fallback + 1) % count;
    }
    return fallback;
  }
}

interface BrutalQuoteOverlayProps {
  workoutLabel: string;
  onDismiss: () => void;
  onQuickStart: () => void;
}

export const BrutalQuoteOverlay: React.FC<BrutalQuoteOverlayProps> = ({
  workoutLabel,
  onDismiss,
  onQuickStart,
}) => {
  const [quoteIdx, setQuoteIdx] = useState<number>(() => drawNextUniqueQuoteIndex());
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavoriteIds());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const [customQuote, setCustomQuote] = useState<CustomStartupQuote>(() => loadCustomQuote());
  const [audioPref, setAudioPref] = useState<StartupAudioPref>(() => loadAudioPref());
  const [tuneIdx, setTuneIdx] = useState<number>(() => drawNextTuneIndex());
  const [showCustomize, setShowCustomize] = useState(false);
  const [draftQuoteText, setDraftQuoteText] = useState(() => loadCustomQuote().text);
  const [draftQuoteAuthor, setDraftQuoteAuthor] = useState(() => loadCustomQuote().author || '');
  const [draftQuoteEnabled, setDraftQuoteEnabled] = useState(() => loadCustomQuote().enabled);
  const [draftAudioMode, setDraftAudioMode] = useState<StartupAudioPref['mode']>(() => loadAudioPref().mode);
  const [draftAudioUrl, setDraftAudioUrl] = useState(() => loadAudioPref().customUrl);
  const [linkedAccounts, setLinkedAccounts] = useState<{ spotify: boolean; youtube: boolean }>({
    spotify: false,
    youtube: false,
  });
  const playedOnMountRef = useRef(false);

  useEffect(() => {
    if (playedOnMountRef.current) return;
    playedOnMountRef.current = true;
    if (audioPref.mode === 'builtin') {
      playSynthTune(tuneIdx);
    }
  }, [audioPref.mode, tuneIdx]);

  useEffect(() => {
    let active = true;
    fetch('/api/music/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { spotify?: { connected?: boolean }; youtube?: { connected?: boolean } } | null) => {
        if (!active || !data) return;
        setLinkedAccounts({
          spotify: Boolean(data.spotify?.connected),
          youtube: Boolean(data.youtube?.connected),
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const quote: MotivationalQuote =
    customQuote.enabled && customQuote.text.trim() && !showFavoritesOnly
      ? {
          id: 'custom_user_quote',
          text: customQuote.text.trim(),
          author: customQuote.author?.trim() || 'My Personal Mantra',
          role: 'Custom Startup Quote',
        }
      : MOTIVATIONAL_QUOTES[quoteIdx];
  const isFavorite = favoriteIds.includes(quote.id);

  const toggleFavorite = () => {
    if (quote.id === 'custom_user_quote') return;
    setFavoriteIds((prev) => {
      const next = prev.includes(quote.id)
        ? prev.filter((id) => id !== quote.id)
        : [...prev, quote.id];
      saveFavoriteIds(next);
      if (next.length === 0) setShowFavoritesOnly(false);
      return next;
    });
  };

  const handleShowAnother = () => {
    if (customQuote.enabled) {
      const disabled = { ...customQuote, enabled: false };
      setCustomQuote(disabled);
      setDraftQuoteEnabled(false);
      try {
        localStorage.setItem(CUSTOM_QUOTE_KEY, JSON.stringify(disabled));
      } catch {
        // ignore
      }
    }
    if (showFavoritesOnly && favoriteIds.length > 0) {
      const favIndices = MOTIVATIONAL_QUOTES.map((q, i) => (favoriteIds.includes(q.id) ? i : -1)).filter(
        (i) => i >= 0
      );
      if (favIndices.length > 1) {
        const curPos = favIndices.indexOf(quoteIdx);
        setQuoteIdx(favIndices[(curPos + 1) % favIndices.length]);
      } else if (favIndices.length === 1) {
        setQuoteIdx(favIndices[0]);
      }
      return;
    }
    setQuoteIdx((cur) => drawNextUniqueQuoteIndex(cur));
    if (audioPref.mode === 'builtin') {
      const nextTune = drawNextTuneIndex();
      setTuneIdx(nextTune);
      playSynthTune(nextTune);
    }
  };

  const handleToggleFavoritesView = () => {
    if (favoriteIds.length === 0) return;
    if (!showFavoritesOnly) {
      const firstFavIdx = MOTIVATIONAL_QUOTES.findIndex((q) => favoriteIds.includes(q.id));
      if (firstFavIdx >= 0) setQuoteIdx(firstFavIdx);
      setShowFavoritesOnly(true);
    } else {
      setShowFavoritesOnly(false);
    }
  };

  const handleSaveCustomSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const nextQuote: CustomStartupQuote = {
      enabled: draftQuoteEnabled && Boolean(draftQuoteText.trim()),
      text: draftQuoteText.trim().slice(0, 240),
      author: draftQuoteAuthor.trim().slice(0, 60),
    };
    const nextAudio: StartupAudioPref = {
      mode: draftAudioMode,
      customUrl: draftAudioUrl.trim(),
    };
    setCustomQuote(nextQuote);
    setAudioPref(nextAudio);
    try {
      localStorage.setItem(CUSTOM_QUOTE_KEY, JSON.stringify(nextQuote));
      localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify(nextAudio));
    } catch {
      // ignore
    }
    if (nextAudio.mode === 'builtin') {
      playSynthTune(tuneIdx);
    }
    setShowCustomize(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  const activeEmbedUrl =
    audioPref.mode === 'spotify' || audioPref.mode === 'youtube'
      ? parseEmbedUrl(audioPref.mode, audioPref.customUrl)
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily motivation"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0C1814]/92 p-4 backdrop-blur-md"
    >
      <div className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl border border-[#9AE62E]/25 bg-[#172D27] p-7 text-white shadow-2xl sm:p-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#9AE62E]/12 blur-3xl"
        />

        <div className="relative flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-lg bg-[#234038] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#9AE62E]">
            <Flame className="h-3.5 w-3.5" />
            {showFavoritesOnly
              ? 'FAVORITE QUOTES'
              : customQuote.enabled
              ? 'MY STARTUP MANTRA'
              : 'OPEN RUN · DAILY FIRE'}
          </div>

          <div className="flex items-center gap-1.5">
            {audioPref.mode === 'builtin' && (
              <button
                type="button"
                title={`Play tune: ${BUILTIN_TUNES[tuneIdx].name}`}
                onClick={() => playSynthTune(tuneIdx)}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-white/10 px-2.5 text-[11px] font-semibold text-[#9AE62E] hover:bg-white/15"
              >
                <Volume2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{BUILTIN_TUNES[tuneIdx].name}</span>
              </button>
            )}

            <button
              type="button"
              title="Customize startup quote & audio"
              onClick={() => setShowCustomize((v) => !v)}
              className={`inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition ${
                showCustomize
                  ? 'bg-[#9AE62E] text-[#172D27]'
                  : 'bg-white/10 text-[#B8E8C7] hover:bg-white/15 hover:text-white'
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Customize</span>
            </button>

            {favoriteIds.length > 0 && (
              <button
                type="button"
                onClick={handleToggleFavoritesView}
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition ${
                  showFavoritesOnly
                    ? 'bg-[#9AE62E] text-[#172D27]'
                    : 'bg-white/10 text-[#B8E8C7] hover:bg-white/15 hover:text-white'
                }`}
              >
                <Heart className={`h-3.5 w-3.5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
                <span>{favoriteIds.length}</span>
              </button>
            )}

            {quote.id !== 'custom_user_quote' && (
              <button
                type="button"
                aria-label={isFavorite ? 'Remove quote from favorites' : 'Add quote to favorites'}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={toggleFavorite}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                  isFavorite
                    ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                    : 'text-[#B8E8C7]/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Heart className={`h-5 w-5 ${isFavorite ? 'fill-current' : ''}`} />
              </button>
            )}

            <button
              type="button"
              aria-label="Close quote"
              onClick={onDismiss}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[#B8E8C7]/80 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {showCustomize ? (
          <form onSubmit={handleSaveCustomSettings} className="relative mt-5 space-y-4 rounded-2xl bg-[#10211C] p-4 border border-white/10">
            <div className="space-y-2">
              <label className="flex items-center justify-between text-xs font-bold text-[#9AE62E]">
                <span>Your Personal Startup Quote</span>
                <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftQuoteEnabled}
                    onChange={(e) => setDraftQuoteEnabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#9AE62E]"
                  />
                  Show on startup
                </label>
              </label>
              <textarea
                rows={2}
                maxLength={240}
                value={draftQuoteText}
                onChange={(e) => setDraftQuoteText(e.target.value)}
                placeholder="Write your own motivating quote or mantra..."
                className="w-full rounded-xl border border-white/15 bg-[#172D27] p-2.5 text-xs text-white placeholder:text-white/40 focus:border-[#9AE62E] focus:outline-none"
              />
              <input
                type="text"
                maxLength={60}
                value={draftQuoteAuthor}
                onChange={(e) => setDraftQuoteAuthor(e.target.value)}
                placeholder="Attribution / Subline (optional)"
                className="w-full rounded-xl border border-white/15 bg-[#172D27] px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-[#9AE62E] focus:outline-none"
              />
            </div>

            <div className="space-y-2 border-t border-white/10 pt-3">
              <span className="flex items-center gap-1.5 text-xs font-bold text-[#9AE62E]">
                <Music className="h-3.5 w-3.5" />
                Startup Motivational Audio / Tune
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(
                  [
                    { id: 'builtin', label: 'Rotating Tunes' },
                    { id: 'spotify', label: `Spotify${linkedAccounts.spotify ? ' ✓' : ''}` },
                    { id: 'youtube', label: `YT Music${linkedAccounts.youtube ? ' ✓' : ''}` },
                    { id: 'off', label: 'Muted' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDraftAudioMode(opt.id)}
                    className={`rounded-lg border px-2.5 py-2 text-[11px] font-bold transition ${
                      draftAudioMode === opt.id
                        ? 'border-[#9AE62E] bg-[#9AE62E] text-[#172D27]'
                        : 'border-white/15 bg-[#172D27] text-[#B8E8C7] hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {(draftAudioMode === 'spotify' || draftAudioMode === 'youtube') && (
                <div className="space-y-1.5 pt-1">
                  <input
                    type="url"
                    value={draftAudioUrl}
                    onChange={(e) => setDraftAudioUrl(e.target.value)}
                    placeholder={
                      draftAudioMode === 'spotify'
                        ? 'Paste Spotify track or playlist URL (open.spotify.com/...)'
                        : 'Paste YouTube / YT Music track or playlist URL'
                    }
                    className="w-full rounded-xl border border-white/15 bg-[#172D27] px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-[#9AE62E] focus:outline-none"
                  />
                  <p className="text-[10px] text-[#B8E8C7]/75">
                    {draftAudioMode === 'spotify'
                      ? linkedAccounts.spotify
                        ? 'Spotify account linked — paste any track/playlist link to play on startup.'
                        : 'Tip: Link your Spotify account in the bottom-right Music dock for full playback.'
                      : linkedAccounts.youtube
                      ? 'YouTube Music account linked — paste any video/playlist link to play on startup.'
                      : 'Tip: Link your YouTube Music account in the bottom-right Music dock for full playback.'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCustomize(false)}
                className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-[#B8E8C7]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#9AE62E] px-4 py-2 text-xs font-extrabold text-[#172D27]"
              >
                Save Startup Setup
              </button>
            </div>
          </form>
        ) : (
          <>
            <blockquote className="relative mt-7">
              <p className="font-display text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
                &ldquo;{quote.text}&rdquo;
              </p>
              {quote.author ? (
                <footer className="mt-5 flex flex-col gap-0.5">
                  <span className="font-display text-sm font-bold text-[#9AE62E] sm:text-base">
                    — {quote.author}
                  </span>
                  {quote.role && (
                    <span className="font-mono text-[11px] uppercase tracking-wide text-[#B8E8C7]/80">
                      {quote.role}
                    </span>
                  )}
                </footer>
              ) : (
                quote.subline && (
                  <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wide text-[#9AE62E] sm:text-sm">
                    {quote.subline}
                  </p>
                )
              )}
            </blockquote>

            {activeEmbedUrl && (
              <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/15 bg-black/30">
                <iframe
                  src={activeEmbedUrl}
                  title="Startup Motivational Track"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  className="h-[88px] w-full border-0"
                />
              </div>
            )}

            {audioPref.mode === 'off' && (
              <p className="relative mt-4 inline-flex items-center gap-1.5 text-[11px] text-[#B8E8C7]/60">
                <VolumeX className="h-3.5 w-3.5" />
                Startup audio muted · tap Customize to enable tunes, Spotify, or YT Music
              </p>
            )}
          </>
        )}

        <div className="relative mt-8 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#9AE62E] px-5 text-sm font-extrabold text-[#172D27] transition hover:brightness-95"
          >
            Let&apos;s Go
            <ArrowRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              onDismiss();
              onQuickStart();
            }}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#9AE62E]/35 bg-[#234038] px-4 text-xs font-bold text-white transition hover:bg-[#2c4f45]"
          >
            <Play className="h-3.5 w-3.5 text-[#9AE62E]" />
            Start {workoutLabel} Now
          </button>

          <button
            type="button"
            aria-label="Show another quote"
            onClick={handleShowAnother}
            className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3.5 text-xs font-semibold text-[#B8E8C7] transition hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Another
          </button>
        </div>
      </div>
    </div>
  );
};
