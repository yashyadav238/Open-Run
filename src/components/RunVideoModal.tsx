import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Share2,
  X,
} from 'lucide-react';
import { copyShareText, formatRunDateSafe } from '../services/shareCardService';
import {
  createJourneyRenderState,
  pickSupportedVideoMimeType,
  preloadJourneyTiles,
  recordJourneyVideo,
  renderJourneyFrame,
  triggerVideoDownload,
  type RecordedRunVideo,
  type RunVideoPayload,
  type TileCache,
} from '../services/runVideoService';

interface RunVideoModalProps {
  open: boolean;
  payload: RunVideoPayload | null;
  preferredUnit: 'km' | 'mi';
  onClose: () => void;
}

const BASE_PLAYBACK_DURATION_MS = 10000;

export const RunVideoModal: React.FC<RunVideoModalProps> = ({
  open,
  payload,
  preferredUnit,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tileCacheRef = useRef<TileCache>(new Map());
  const progressRef = useRef<number>(0);
  const lastFramePerfRef = useRef<number | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const recordedVideoRef = useRef<RecordedRunVideo | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [progress, setProgress] = useState(0);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [tileProgressPct, setTileProgressPct] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [exportProgressPct, setExportProgressPct] = useState(0);
  const [recordedVideo, setRecordedVideo] = useState<RecordedRunVideo | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoSupport = useMemo(() => pickSupportedVideoMimeType(), []);

  const renderState = useMemo(() => {
    if (!open || !payload) return null;
    return createJourneyRenderState(payload, preferredUnit, tileCacheRef.current);
  }, [open, payload, preferredUnit]);

  const revokeCachedVideo = () => {
    if (recordedVideoRef.current?.objectUrl) {
      URL.revokeObjectURL(recordedVideoRef.current.objectUrl);
    }
    recordedVideoRef.current = null;
    setRecordedVideo(null);
  };

  // Reset state & preload Chandigarh map tiles whenever modal opens for a run
  useEffect(() => {
    if (!open || !renderState) {
      exportAbortRef.current?.abort();
      exportAbortRef.current = null;
      revokeCachedVideo();
      setExporting(false);
      setStatusNotice(null);
      setErrorMsg(null);
      return;
    }

    let cancelled = false;
    progressRef.current = 0;
    lastFramePerfRef.current = null;
    setProgress(0);
    setIsPlaying(true);
    setStatusNotice(null);
    setErrorMsg(null);
    revokeCachedVideo();

    setTilesLoading(true);
    setTileProgressPct(0);
    void preloadJourneyTiles(renderState, (frac) => {
      if (!cancelled) {
        setTileProgressPct(Math.round(frac * 100));
      }
    }).finally(() => {
      if (!cancelled) {
        setTilesLoading(false);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          renderJourneyFrame(ctx, canvas.width, canvas.height, renderState, progressRef.current);
        }
      }
    });

    return () => {
      cancelled = true;
      exportAbortRef.current?.abort();
      exportAbortRef.current = null;
      revokeCachedVideo();
    };
  }, [open, renderState]);

  // 60fps interactive replay loop
  useEffect(() => {
    if (!open || !renderState) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    renderJourneyFrame(ctx, canvas.width, canvas.height, renderState, progressRef.current);

    if (!isPlaying) {
      lastFramePerfRef.current = null;
      return;
    }

    let rafId = 0;
    const tick = (now: number) => {
      if (lastFramePerfRef.current === null) {
        lastFramePerfRef.current = now;
      }
      const dt = Math.min(100, Math.max(0, now - lastFramePerfRef.current));
      lastFramePerfRef.current = now;

      const deltaP = (dt * speed) / BASE_PLAYBACK_DURATION_MS;
      const nextP = Math.min(1, progressRef.current + deltaP);
      progressRef.current = nextP;
      setProgress(nextP);

      renderJourneyFrame(ctx, canvas.width, canvas.height, renderState, nextP);

      if (nextP < 1) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        lastFramePerfRef.current = null;
        setIsPlaying(false);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      lastFramePerfRef.current = null;
    };
  }, [open, renderState, isPlaying, speed, tilesLoading]);

  if (!open || !payload || !renderState) return null;

  const handleTogglePlay = () => {
    if (progressRef.current >= 0.999) {
      progressRef.current = 0;
      setProgress(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((prev) => !prev);
  };

  const handleReplay = () => {
    progressRef.current = 0;
    lastFramePerfRef.current = null;
    setProgress(0);
    setIsPlaying(true);
  };

  const handleScrub = (val: number) => {
    const p = Math.max(0, Math.min(1, val / 1000));
    progressRef.current = p;
    setProgress(p);
    setIsPlaying(false);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      renderJourneyFrame(ctx, canvas.width, canvas.height, renderState, p);
    }
  };

  const ensureVideoRecorded = async (): Promise<RecordedRunVideo | null> => {
    if (recordedVideoRef.current) return recordedVideoRef.current;

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExporting(true);
    setExportProgressPct(0);
    setErrorMsg(null);
    setStatusNotice(null);

    try {
      const video = await recordJourneyVideo({
        state: renderState,
        durationMs: BASE_PLAYBACK_DURATION_MS,
        onProgress: (frac) => {
          setExportProgressPct(Math.min(99, Math.round(frac * 100)));
        },
        signal: controller.signal,
      });
      recordedVideoRef.current = video;
      setRecordedVideo(video);
      setExportProgressPct(100);
      return video;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to encode journey video in this browser.'
      );
      return null;
    } finally {
      setExporting(false);
      exportAbortRef.current = null;
    }
  };

  const handleDownloadVideo = async () => {
    const video = await ensureVideoRecorded();
    if (!video) return;
    triggerVideoDownload(video.objectUrl, video.filename);
    setStatusNotice(`Saved ${video.extension.toUpperCase()} journey video to your device.`);
  };

  const handleShareVideo = async () => {
    const hadCached = Boolean(recordedVideoRef.current);
    const video = await ensureVideoRecorded();
    if (!video) return;

    const shareTitle = `OPEN RUN: ${payload.title}`;
    const shareText = `Watch my ${payload.title} run journey — OPEN RUN.`;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;

    if (nav && typeof nav.share === 'function') {
      const canShareFile =
        typeof nav.canShare !== 'function' ||
        (() => {
          try {
            return nav.canShare({ files: [video.file] });
          } catch {
            return false;
          }
        })();

      if (canShareFile) {
        try {
          await nav.share({
            files: [video.file],
            title: shareTitle,
            text: shareText,
          });
          setStatusNotice('Journey video shared!');
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          if (!hadCached && err instanceof DOMException && err.name === 'NotAllowedError') {
            setStatusNotice('Video rendered! Tap "Share Video" again to send via WhatsApp or social apps.');
            return;
          }
        }
      }
    }

    // Fallback when OS file-share is unavailable: download video + copy caption
    triggerVideoDownload(video.objectUrl, video.filename);
    await copyShareText(shareText);
    setStatusNotice(
      `Video saved (${video.filename}) and caption copied — attach it directly in WhatsApp, Instagram, or X.`
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm sm:p-5">
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[#F6F5F0] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E3DC] bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0 pr-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#30483E]">
              <Film className="h-3.5 w-3.5 text-[#172D27]" />
              Run Journey Flyover · {formatRunDateSafe(payload.finishedAt)}
            </p>
            <h3 className="truncate font-display text-base font-bold text-[#141F1B] sm:text-lg">
              {payload.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close journey video"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#5B6B64] hover:bg-[#F6F5F0]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Interactive Canvas Viewport */}
        <div className="overflow-y-auto p-3 sm:p-5">
          <div className="relative mx-auto aspect-square w-full max-w-[460px] overflow-hidden rounded-2xl border border-[#D9D7CE] bg-[#172D27] shadow-lg">
            <canvas
              ref={canvasRef}
              width={960}
              height={960}
              className="h-full w-full object-contain"
            />
            {tilesLoading && (
              <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-[#172D27]/90 px-2.5 py-1.5 text-[11px] font-semibold text-[#B8E8C7]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9AE62E]" />
                Loading map {tileProgressPct}%
              </div>
            )}
          </div>

          {payload.path.length < 2 && (
            <p className="mt-2.5 text-center text-xs text-[#5B6B64]">
              Minimal GPS trace recorded — showing Chandigarh summary progression.
            </p>
          )}

          {/* Playback Scrubber & Speed Controls */}
          <div className="mt-4 rounded-xl border border-[#E5E3DC] bg-white p-3.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#172D27] text-[#9AE62E]"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={handleReplay}
                aria-label="Replay from start"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#D9D7CE] text-[#141F1B] hover:bg-[#F6F5F0]"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              <div className="flex flex-1 flex-col gap-1">
                <input
                  type="range"
                  min={0}
                  max={1000}
                  value={Math.round(progress * 1000)}
                  onChange={(e) => handleScrub(Number(e.target.value))}
                  aria-label="Journey timeline scrubber"
                  className="h-2 w-full cursor-pointer accent-[#172D27]"
                />
                <div className="flex justify-between font-mono text-[10px] font-semibold text-[#5B6B64] tabular-nums">
                  <span>START</span>
                  <span>{Math.round(progress * 100)}%</span>
                  <span>FINISH</span>
                </div>
              </div>

              <div className="flex shrink-0 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] p-0.5">
                {([1, 1.5, 2] as const).map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setSpeed(rate)}
                    className={`min-h-[38px] rounded-lg px-2.5 font-mono text-xs font-bold ${
                      speed === rate
                        ? 'bg-[#172D27] text-[#9AE62E]'
                        : 'text-[#5B6B64] hover:text-[#141F1B]'
                    }`}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Notices & Export Progress */}
          {exporting && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[#30483E]/30 bg-[#EBF5EE] px-3.5 py-2.5 text-xs font-semibold text-[#172D27]">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Rendering Start-to-Finish Video ({exportProgressPct}%)...
              </span>
              <button
                type="button"
                onClick={() => exportAbortRef.current?.abort()}
                className="rounded-lg border border-[#30483E]/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#172D27]"
              >
                Cancel
              </button>
            </div>
          )}

          {statusNotice && !exporting && (
            <div className="mt-3 rounded-xl border border-[#30483E]/30 bg-[#EBF5EE] px-3.5 py-2.5 text-xs font-medium text-[#172D27]">
              {statusNotice}
            </div>
          )}

          {errorMsg && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-950">
              {errorMsg}
            </div>
          )}

          {!videoSupport && (
            <div className="mt-3 rounded-xl border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-xs text-[#5B6B64]">
              Interactive flyover replay works here, though direct video file encoding is not supported in this browser.
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col gap-2.5 border-t border-[#E5E3DC] bg-white px-4 py-3.5 sm:flex-row sm:px-5">
          <button
            type="button"
            disabled={exporting || !videoSupport}
            onClick={() => void handleDownloadVideo()}
            className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#172D27] px-4 text-sm font-semibold text-[#9AE62E] disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {recordedVideo
              ? `Save ${recordedVideo.extension.toUpperCase()} Video`
              : exporting
              ? `Rendering ${exportProgressPct}%...`
              : 'Save Video'}
          </button>

          <button
            type="button"
            disabled={exporting || !videoSupport}
            onClick={() => void handleShareVideo()}
            className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-4 text-sm font-semibold text-[#141F1B] hover:bg-[#F6F5F0] disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            {recordedVideo ? 'Share Video' : 'Render & Share Video'}
          </button>
        </div>
      </div>
    </div>
  );
};
