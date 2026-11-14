import React, { useState } from 'react';
import { Award, Check, CloudOff, Download, Film, Home, Loader2, RefreshCw, Share2, Trash2 } from 'lucide-react';
import {
  buildCompletedKmCheckpoints,
  computeKmMarkers,
  decodePolyline,
  formatDistance,
  formatDuration,
  formatPace,
} from '../lib/geo';
import { buildVideoPayloadFromSummary } from '../services/runVideoService';
import {
  buildSplitShareSummary,
  formatRunDateSafe,
  prepareShareCardSync,
  renderRunShareCardSync,
  triggerPngDownload,
  type PreparedShareCard,
  type ShareCardStyle,
} from '../services/shareCardService';
import type { GeneratedRouteCandidate, RunActivityDoc } from '../types/run';
import { RunVideoModal } from './RunVideoModal';
import { ShareCardModal } from './ShareCardModal';
import { TricityMap } from './TricityMap';

export type AutoSaveStatus = 'saving' | 'saved' | 'local_only' | 'error';

interface RunSummaryModalProps {
  summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>;
  previousRuns: RunActivityDoc[];
  preferredUnit: 'km' | 'mi';
  isAuthenticated: boolean;
  saveStatus: AutoSaveStatus;
  saveError?: string | null;
  onRetrySync: () => Promise<void>;
  onDiscardRun: () => Promise<void>;
  onOpenAuth: () => void;
  onCloseHome: () => void;
}

export const RunSummaryModal: React.FC<RunSummaryModalProps> = ({
  summary,
  previousRuns,
  preferredUnit,
  isAuthenticated,
  saveStatus,
  saveError,
  onRetrySync,
  onDiscardRun,
  onOpenAuth,
  onCloseHome,
}) => {
  const [retrying, setRetrying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [shareModalCard, setShareModalCard] = useState<PreparedShareCard | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevBestDist = previousRuns.reduce((m, r) => Math.max(m, r.distanceMeters), 0);
  const isLongestPR = previousRuns.length > 0 && summary.distanceMeters > prevBestDist;

  const decodedPath = summary.encodedPolyline ? decodePolyline(summary.encodedPolyline) : [];
  const completedKmMarkers = buildCompletedKmCheckpoints(decodedPath, summary.splits);
  const splitAnalytics = buildSplitShareSummary(summary.splits);
  const previewRoute: GeneratedRouteCandidate | null =
    decodedPath.length > 1
      ? {
          id: 'summary-preview',
          label: 'Best Match',
          name: summary.routeName,
          routeType: summary.routeType === 'free_run' ? 'circular' : summary.routeType,
          distanceMeters: summary.distanceMeters,
          targetDistanceMeters: summary.distanceMeters,
          durationSec: summary.durationSec,
          elevationGainMeters: summary.elevationGainMeters ?? null,
          start: { name: summary.startName, ...decodedPath[0] },
          end: { name: summary.startName, ...decodedPath[decodedPath.length - 1] },
          encodedPolyline: summary.encodedPolyline,
          path: decodedPath,
          steps: [],
          kmMarkers: computeKmMarkers(decodedPath),
          characteristics: [],
          surfaceSummary: '',
          preferences: [],
          difficulty: 'moderate',
          toleranceDiffPct: 0,
        }
      : null;

  const handleRetry = async () => {
    if (!isAuthenticated) {
      onOpenAuth();
      return;
    }
    setRetrying(true);
    setError(null);
    try {
      await onRetrySync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sync run.');
    } finally {
      setRetrying(false);
    }
  };

  const handleDiscard = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDiscardRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove run.');
      setDeleting(false);
    }
  };

  const buildCardPayload = (style: ShareCardStyle = 'route') => ({
    style,
    title: summary.routeName || 'Chandigarh Run',
    subtitle: 'TRICITY RUN  ·  CHANDIGARH ACTIVITY',
    path: decodedPath,
    primaryStatValue: formatDistance(summary.distanceMeters, preferredUnit),
    secondaryLine: `TIME ${formatDuration(summary.durationSec)}   ·   PACE ${formatPace(summary.avgPaceSecPerKm, preferredUnit)}/${preferredUnit}`,
    footerText: `${formatRunDateSafe(summary.finishedAt)} · ${summary.startName || 'Chandigarh'}`,
    unit: preferredUnit,
    distanceMeters: summary.distanceMeters,
    durationSec: summary.durationSec,
    avgPaceSecPerKm: summary.avgPaceSecPerKm,
    avgSpeedKmh: summary.avgSpeedKmh,
    splits: summary.splits,
  });

  const handleDownloadCard = () => {
    const rendered = renderRunShareCardSync(buildCardPayload('route'));
    if (!rendered) return;
    triggerPngDownload(rendered.dataUrl, `tricity-run-${Date.now()}.png`);
    setShareNotice('Activity PNG saved to your device.');
  };

  const openShareStudio = (initialStyle: ShareCardStyle = 'route') => {
    setShareNotice(null);
    const routeTitle = summary.routeName || 'Chandigarh Run';
    const shareText = `Ran ${formatDistance(summary.distanceMeters, preferredUnit)} in ${formatDuration(summary.durationSec)} (${formatPace(summary.avgPaceSecPerKm, preferredUnit)}/${preferredUnit}) on ${routeTitle} — TRICITY RUN Chandigarh.`;
    const prepared = prepareShareCardSync({
      filename: `tricity-run-${Date.now()}.png`,
      shareTitle: `TRICITY RUN: ${routeTitle}`,
      shareText,
      card: buildCardPayload(initialStyle),
    });
    if (!prepared) {
      setError('Unable to generate share card image.');
      return;
    }
    setShareModalCard(prepared);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#F6F5F0] p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl bg-[#172D27] p-6 text-white">
          <p className="text-xs font-medium text-[#B8E8C7]">
            {formatRunDateSafe(summary.finishedAt)} · {summary.startName}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold">{summary.routeName}</h2>

          {isLongestPR && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#30483E] px-3 py-1.5 text-xs font-semibold text-[#9AE62E]">
              <Award className="h-4 w-4" />
              New Personal Record — Longest Logged Run
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-[#B8E8C7]/80">Distance</p>
              <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
                {formatDistance(summary.distanceMeters, preferredUnit)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#B8E8C7]/80">Duration</p>
              <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
                {formatDuration(summary.durationSec)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#B8E8C7]/80">Average Pace</p>
              <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
                {formatPace(summary.avgPaceSecPerKm, preferredUnit)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#B8E8C7]/80">Avg Speed</p>
              <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
                {summary.avgSpeedKmh.toFixed(1)} km/h
              </p>
            </div>
          </div>
        </div>

        {previewRoute && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1 text-xs font-semibold text-[#5B6B64]">
              <span>Recorded Run Snapshot (Start · KM Splits · Finish)</span>
              <span className="font-mono">{summary.sampleCount > 1 ? `${summary.sampleCount} GPS pts` : 'Route Trace'}</span>
            </div>
            <TricityMap
              routes={[previewRoute]}
              selectedRouteId={previewRoute.id}
              completedKmMarkers={completedKmMarkers}
              preferredUnit={preferredUnit}
              heightClass="h-[260px]"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowVideoModal(true)}
          className="flex min-h-[52px] w-full items-center justify-between rounded-2xl border border-[#30483E]/30 bg-[#172D27] px-5 text-left text-white shadow-sm transition-colors hover:bg-[#1f3b33]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#9AE62E] text-[#172D27]">
              <Film className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Watch & Export Journey Video</p>
              <p className="text-[11px] text-[#B8E8C7]">
                Animated Start → Finish map flyover with live stats &amp; video download
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-lg bg-[#30483E] px-3 py-1.5 font-mono text-xs font-bold text-[#9AE62E]">
            PLAY
          </span>
        </button>

        {splitAnalytics.bars.length > 0 && (
          <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-[#141F1B]">Kilometre Splits</h3>
                {splitAnalytics.fastestKm !== null && (
                  <p className="text-xs text-[#5B6B64]">
                    Fastest split: KM {splitAnalytics.fastestKm} ({formatPace(splitAnalytics.fastestPaceSec, preferredUnit)}/{preferredUnit})
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => openShareStudio('splits')}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E]"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share Splits PNG
              </button>
            </div>
            <div className="mt-4 space-y-2.5">
              {splitAnalytics.bars.map((b) => (
                <div key={b.km} className="grid grid-cols-[54px_1fr_auto] items-center gap-3 text-xs tabular-nums">
                  <span className={`font-mono font-bold ${b.isFastest ? 'text-[#172D27]' : 'text-[#5B6B64]'}`}>
                    KM {b.km}
                  </span>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#F0EFEA]">
                    <div
                      className={`h-full rounded-full ${b.isFastest ? 'bg-[#9AE62E]' : 'bg-[#30483E]'}`}
                      style={{ width: `${Math.round(b.speedRatio * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono font-semibold text-[#141F1B]">
                    {formatPace(b.paceSecPerKm, preferredUnit)}/{preferredUnit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(error || saveError) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error || saveError} — Your run stays safely saved on this device until synced.
          </div>
        )}

        {/* Automatic Save Status Banner */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold ${
            saveStatus === 'saved'
              ? 'border-[#30483E]/30 bg-[#EBF5EE] text-[#172D27]'
              : saveStatus === 'saving'
              ? 'border-[#D9D7CE] bg-white text-[#172D27]'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveStatus === 'saved' && <Check className="h-4 w-4 text-[#172D27]" />}
            {saveStatus === 'saving' && <Loader2 className="h-4 w-4 animate-spin text-[#172D27]" />}
            {(saveStatus === 'local_only' || saveStatus === 'error') && (
              <CloudOff className="h-4 w-4 text-amber-700" />
            )}
            <span>
              {saveStatus === 'saved'
                ? 'Automatically saved to your Run History'
                : saveStatus === 'saving'
                ? 'Auto-saving run to your history...'
                : saveStatus === 'local_only'
                ? isAuthenticated
                  ? 'Saved on this device — verify email to sync to cloud'
                  : 'Saved on this device (won’t be deleted) · Sign in to sync to cloud'
                : 'Saved on this device — cloud sync failed'}
            </span>
          </div>

          {(saveStatus === 'local_only' || saveStatus === 'error') && (
            <button
              type="button"
              disabled={retrying}
              onClick={handleRetry}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
              {isAuthenticated ? 'Retry Sync' : 'Sign in & Sync'}
            </button>
          )}
        </div>

        {shareNotice && (
          <div className="rounded-xl border border-[#30483E]/30 bg-[#EBF5EE] px-4 py-2.5 text-xs font-medium text-[#172D27]">
            {shareNotice}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCloseHome}
            className="flex min-h-[48px] flex-[1.3] items-center justify-center gap-2 rounded-xl bg-[#172D27] px-5 text-sm font-semibold text-[#9AE62E]"
          >
            <Home className="h-4 w-4" />
            Done · View Run History
          </button>

          <button
            type="button"
            onClick={handleDownloadCard}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-5 text-sm font-semibold text-[#141F1B]"
          >
            <Download className="h-4 w-4" />
            Save PNG
          </button>

          <button
            type="button"
            onClick={() => openShareStudio('route')}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-4 text-sm font-semibold text-[#141F1B]"
          >
            <Share2 className="h-4 w-4" />
            Share PNG Types
          </button>

          {confirmDelete ? (
            <button
              type="button"
              disabled={deleting}
              onClick={handleDiscard}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 text-xs font-semibold text-white disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? 'Deleting...' : 'Confirm Delete'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-white px-4 text-xs font-semibold text-[#5B6B64] hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      <ShareCardModal card={shareModalCard} onClose={() => setShareModalCard(null)} />
      <RunVideoModal
        open={showVideoModal}
        payload={showVideoModal ? buildVideoPayloadFromSummary(summary) : null}
        preferredUnit={preferredUnit}
        onClose={() => setShowVideoModal(false)}
      />
    </div>
  );
};
