import React, { useRef, useState } from 'react';
import { Award, Camera, Check, CloudOff, Download, Film, Footprints, Home, ImagePlus, Loader2, Plus, RefreshCw, Share2, Sparkles, Trash2, X } from 'lucide-react';
import { MAX_RUN_PHOTOS, processRunPhotoFile } from '../lib/avatarUpload';
import {
  estimateCaloriesKcal,
  formatSpeed,
  formatWorkoutPrimaryRate,
  getWorkoutMeta,
  normalizeWorkoutType,
} from '../data/workouts';
import {
  buildCompletedKmCheckpoints,
  computeKmMarkers,
  decodePolyline,
  formatDistance,
  formatDuration,
  formatElevationGain,
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
import type {
  ElevationProfilePoint,
  GeneratedRouteCandidate,
  RunActivityDoc,
  RunningShoeItem,
} from '../types/run';
import {
  ElevationProfileCard,
  type ElevationFetchStatus,
} from './ElevationProfileCard';
import { HydrationLossCard } from './HydrationLossCard';
import { RunVideoModal } from './RunVideoModal';
import { ShareCardModal } from './ShareCardModal';
import { TricityMap } from './TricityMap';
import { WorkoutIcon } from './WorkoutIcon';

export type AutoSaveStatus = 'saving' | 'saved' | 'local_only' | 'error';

interface RunSummaryModalProps {
  summary: Omit<RunActivityDoc, 'id' | 'userId' | 'createdAt'>;
  elevationStatus?: ElevationFetchStatus;
  elevationProfile?: ElevationProfilePoint[];
  previousRuns: RunActivityDoc[];
  preferredUnit: 'km' | 'mi';
  savedShoes?: RunningShoeItem[];
  isAuthenticated: boolean;
  saveStatus: AutoSaveStatus;
  saveError?: string | null;
  onRetrySync: () => Promise<void>;
  onSaveJournal?: (
    notes: string,
    photos: string[],
    shoeBrand?: string,
    shoeName?: string
  ) => Promise<void>;
  onDiscardRun: () => Promise<void>;
  onPostDailyRun?: () => void;
  onAddStory?: () => void;
  onOpenAuth: () => void;
  onCloseHome: () => void;
}

export const RunSummaryModal: React.FC<RunSummaryModalProps> = ({
  summary,
  elevationStatus = 'ready',
  elevationProfile,
  previousRuns,
  preferredUnit,
  savedShoes = [],
  isAuthenticated,
  saveStatus,
  saveError,
  onRetrySync,
  onSaveJournal,
  onDiscardRun,
  onPostDailyRun,
  onAddStory,
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

  const primaryShoe = savedShoes.find((s) => s.isPrimary) || savedShoes[0];
  const [notes, setNotes] = useState(summary.notes || '');
  const [shoeBrand, setShoeBrand] = useState(summary.shoeBrand || primaryShoe?.brand || '');
  const [shoeName, setShoeName] = useState(summary.shoeName || primaryShoe?.name || '');
  const [photos, setPhotos] = useState<string[]>(summary.photos || []);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingJournal, setSavingJournal] = useState(false);
  const [journalSaved, setJournalSaved] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const persistJournal = async (
    nextNotes: string,
    nextPhotos: string[],
    nextShoeBrand = shoeBrand,
    nextShoeName = shoeName
  ) => {
    if (!onSaveJournal) return;
    setSavingJournal(true);
    setJournalError(null);
    try {
      await onSaveJournal(nextNotes, nextPhotos, nextShoeBrand, nextShoeName);
      setJournalSaved(true);
      setTimeout(() => setJournalSaved(false), 3000);
    } catch (err) {
      setJournalError(err instanceof Error ? err.message : 'Unable to save notes and photos.');
    } finally {
      setSavingJournal(false);
    }
  };

  const handlePhotoFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    const remainingSlots = MAX_RUN_PHOTOS - photos.length;
    if (remainingSlots <= 0) {
      setJournalError(`You can attach up to ${MAX_RUN_PHOTOS} photos per activity.`);
      return;
    }

    setUploadingPhoto(true);
    setJournalError(null);
    const added: string[] = [];
    try {
      for (const file of files.slice(0, remainingSlots)) {
        const compressed = await processRunPhotoFile(file);
        added.push(compressed);
      }
      if (added.length > 0) {
        const nextPhotos = [...photos, ...added].slice(0, MAX_RUN_PHOTOS);
        setPhotos(nextPhotos);
        await persistJournal(notes, nextPhotos);
      }
    } catch (err) {
      setJournalError(err instanceof Error ? err.message : 'Could not process selected photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async (index: number) => {
    const nextPhotos = photos.filter((_, idx) => idx !== index);
    setPhotos(nextPhotos);
    await persistJournal(notes, nextPhotos);
  };

  const workoutType = normalizeWorkoutType(summary.workoutType);
  const workoutMeta = getWorkoutMeta(workoutType);
  const isSpeedPrimary = workoutMeta.primaryMetric === 'speed';
  const caloriesKcal =
    typeof summary.caloriesKcal === 'number' && summary.caloriesKcal > 0
      ? summary.caloriesKcal
      : estimateCaloriesKcal(workoutType, summary.durationSec, summary.distanceMeters);

  const sameSportRuns = previousRuns.filter(
    (r) => normalizeWorkoutType(r.workoutType) === workoutType
  );
  const prevBestDist = sameSportRuns.reduce((m, r) => Math.max(m, r.distanceMeters), 0);
  const isLongestPR = sameSportRuns.length > 0 && summary.distanceMeters > prevBestDist;

  const decodedPath = summary.encodedPolyline ? decodePolyline(summary.encodedPolyline) : [];
  const completedKmMarkers = buildCompletedKmCheckpoints(decodedPath, summary.splits);
  const splitAnalytics = buildSplitShareSummary(summary.splits);
  const previewRoute: GeneratedRouteCandidate | null =
    decodedPath.length > 1
      ? {
          id: 'summary-preview',
          label: 'Best Match',
          name: summary.routeName,
          workoutType,
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
      setError(err instanceof Error ? err.message : 'Unable to sync workout.');
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
      setError(err instanceof Error ? err.message : 'Unable to remove workout.');
      setDeleting(false);
    }
  };

  const buildCardPayload = (style: ShareCardStyle = 'route') => ({
    style,
    workoutType,
    title: summary.routeName || workoutMeta.fullLabel,
    subtitle: `OPEN RUN  ·  ${workoutMeta.fullLabel.toUpperCase()}`,
    path: decodedPath,
    primaryStatValue: formatDistance(summary.distanceMeters, preferredUnit),
    secondaryLine: isSpeedPrimary
      ? `TIME ${formatDuration(summary.durationSec)}   ·   SPEED ${formatSpeed(summary.avgSpeedKmh, preferredUnit)}`
      : `TIME ${formatDuration(summary.durationSec)}   ·   PACE ${formatPace(summary.avgPaceSecPerKm, preferredUnit)}/${preferredUnit}`,
    footerText: `${formatRunDateSafe(summary.finishedAt)} · ${summary.startName || 'GPS Track'}`,
    unit: preferredUnit,
    distanceMeters: summary.distanceMeters,
    durationSec: summary.durationSec,
    avgPaceSecPerKm: summary.avgPaceSecPerKm,
    avgSpeedKmh: summary.avgSpeedKmh,
    caloriesKcal,
    elevationGainMeters: summary.elevationGainMeters ?? null,
    splits: summary.splits,
  });

  const handleDownloadCard = () => {
    const rendered = renderRunShareCardSync(buildCardPayload('route'));
    if (!rendered) return;
    triggerPngDownload(rendered.dataUrl, `open-run-${workoutType}-${Date.now()}.png`);
    setShareNotice('Activity PNG saved to your device.');
  };

  const openShareStudio = (initialStyle: ShareCardStyle = 'route') => {
    setShareNotice(null);
    const routeTitle = summary.routeName || workoutMeta.fullLabel;
    const rateLabel = formatWorkoutPrimaryRate({
      workoutType,
      avgPaceSecPerKm: summary.avgPaceSecPerKm,
      avgSpeedKmh: summary.avgSpeedKmh,
      unit: preferredUnit,
    });
    const shareText = `Completed a ${formatDistance(summary.distanceMeters, preferredUnit)} ${workoutMeta.pastNoun.toLowerCase()} in ${formatDuration(summary.durationSec)} (${rateLabel}, ${caloriesKcal} kcal burnt) on ${routeTitle} — OPEN RUN.`;
    const prepared = prepareShareCardSync({
      filename: `open-run-${workoutType}-${Date.now()}.png`,
      shareTitle: `OPEN RUN: ${routeTitle}`,
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
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#B8E8C7]">
            <WorkoutIcon type={workoutType} className="h-3.5 w-3.5 text-[#9AE62E]" />
            <span className="font-semibold text-[#9AE62E]">{workoutMeta.fullLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRunDateSafe(summary.finishedAt)} · {summary.startName}</span>
          </div>
          <h2 className="mt-1 font-display text-2xl font-bold">{summary.routeName}</h2>

          {isLongestPR && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#30483E] px-3 py-1.5 text-xs font-semibold text-[#9AE62E]">
              <Award className="h-4 w-4" />
              New Personal Record — Longest Logged {workoutMeta.pastNoun}
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
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
            {isSpeedPrimary ? (
              <>
                <div>
                  <p className="text-xs text-[#B8E8C7]/80">Avg Speed</p>
                  <p className="mt-0.5 font-mono text-2xl font-bold text-[#9AE62E] tabular-nums">
                    {formatSpeed(summary.avgSpeedKmh, preferredUnit)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#B8E8C7]/80">Average Pace</p>
                  <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
                    {formatPace(summary.avgPaceSecPerKm, preferredUnit)}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs text-[#B8E8C7]/80">Average Pace</p>
                  <p className="mt-0.5 font-mono text-2xl font-bold text-[#9AE62E] tabular-nums">
                    {formatPace(summary.avgPaceSecPerKm, preferredUnit)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#B8E8C7]/80">Avg Speed</p>
                  <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
                    {formatSpeed(summary.avgSpeedKmh, preferredUnit)}
                  </p>
                </div>
              </>
            )}
            <div>
              <p className="text-xs text-[#B8E8C7]/80">Elev Gain</p>
              <p className="mt-0.5 font-mono text-2xl font-bold text-[#9AE62E] tabular-nums">
                {elevationStatus === 'loading'
                  ? '...'
                  : formatElevationGain(summary.elevationGainMeters, preferredUnit)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#B8E8C7]/80">Calories</p>
              <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
                {caloriesKcal} <span className="text-xs font-semibold text-[#B8E8C7]">kcal</span>
              </p>
            </div>
          </div>
        </div>

        <ElevationProfileCard
          workoutLabel={workoutMeta.fullLabel}
          routeName={summary.routeName || workoutMeta.fullLabel}
          startName={summary.startName}
          distanceMeters={summary.distanceMeters}
          durationSec={summary.durationSec}
          rateText={formatWorkoutPrimaryRate({
            workoutType,
            avgPaceSecPerKm: summary.avgPaceSecPerKm,
            avgSpeedKmh: summary.avgSpeedKmh,
            unit: preferredUnit,
          })}
          caloriesKcal={caloriesKcal}
          elevationGainMeters={summary.elevationGainMeters}
          elevationLossMeters={summary.elevationLossMeters}
          minElevationMeters={summary.minElevationMeters}
          maxElevationMeters={summary.maxElevationMeters}
          profile={elevationProfile}
          status={elevationStatus}
          unit={preferredUnit}
        />

        <HydrationLossCard
          durationSec={summary.durationSec}
          caloriesKcal={caloriesKcal}
          avgPaceSecPerKm={summary.avgPaceSecPerKm}
          workoutType={workoutType}
          lat={decodedPath[0]?.lat}
          lng={decodedPath[0]?.lng}
        />

        {/* Post-Run Description & Photos */}
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-[#141F1B]">
                <Camera className="h-4 w-4 text-[#30483E]" />
                {workoutMeta.pastNoun} Description &amp; Photos
              </h3>
              <p className="text-xs text-[#5B6B64]">
                Add how it felt and upload up to {MAX_RUN_PHOTOS} photos (sunrise, sunset, trail views)
              </p>
            </div>
            {journalSaved && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-[#EBF5EE] px-2.5 py-1 text-xs font-semibold text-[#172D27]">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
          </div>

          <div>
            <textarea
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                if (journalSaved) setJournalSaved(false);
              }}
              placeholder={`How did your ${workoutMeta.pastNoun.toLowerCase()} feel? Describe the sunrise or sunset view, weather, or highlights...`}
              className="w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0]/50 px-3.5 py-2.5 text-sm text-[#141F1B] placeholder:text-[#5B6B64]/70 focus:border-[#172D27] focus:bg-white focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-[#5B6B64]">
              <span>Saved to your activity log</span>
              <span className="font-mono tabular-nums">{notes.length}/500</span>
            </div>
          </div>

          <div className="space-y-3">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoFilesSelected}
              className="hidden"
            />

            {photos.length > 0 && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {photos.map((photoSrc, idx) => (
                  <div
                    key={idx}
                    className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#E5E3DC] bg-[#F6F5F0]"
                  >
                    <img
                      src={photoSrc}
                      alt={`${workoutMeta.pastNoun} view ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove photo ${idx + 1}`}
                      onClick={() => void handleRemovePhoto(idx)}
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {journalError && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {journalError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={uploadingPhoto || photos.length >= MAX_RUN_PHOTOS}
                onClick={() => photoInputRef.current?.click()}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-4 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0] disabled:opacity-50"
              >
                {uploadingPhoto ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#172D27]" />
                ) : (
                  <ImagePlus className="h-4 w-4 text-[#30483E]" />
                )}
                {uploadingPhoto
                  ? 'Processing photo...'
                  : photos.length >= MAX_RUN_PHOTOS
                  ? `Max ${MAX_RUN_PHOTOS} Photos Added`
                  : `Upload Photos (${photos.length}/${MAX_RUN_PHOTOS})`}
              </button>

              {onSaveJournal && (
                <button
                  type="button"
                  disabled={savingJournal || uploadingPhoto}
                  onClick={() => void persistJournal(notes, photos, shoeBrand, shoeName)}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E] disabled:opacity-60"
                >
                  {savingJournal ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {savingJournal ? 'Saving...' : 'Save Description'}
                </button>
              )}
            </div>

            {/* Running Shoe Brand & Model */}
            <div className="border-t border-[#ECEAE2] pt-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5B6B64]">
                  <Footprints className="h-3.5 w-3.5 text-[#172D27]" />
                  Running Shoe Used (optional)
                </span>
              </div>

              {savedShoes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {savedShoes.map((shoe) => {
                    const selected =
                      shoeName.trim().toLowerCase() === shoe.name.trim().toLowerCase() &&
                      shoeBrand.trim().toLowerCase() === (shoe.brand || '').trim().toLowerCase();
                    return (
                      <button
                        key={shoe.id}
                        type="button"
                        onClick={() => {
                          setShoeBrand(shoe.brand || '');
                          setShoeName(shoe.name);
                        }}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                          selected
                            ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                            : 'border-[#D9D7CE] bg-[#F6F5F0] text-[#141F1B] hover:border-[#30483E]'
                        }`}
                      >
                        {shoe.brand ? `${shoe.brand} ${shoe.name}` : shoe.name}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="text"
                  maxLength={40}
                  value={shoeBrand}
                  onChange={(e) => setShoeBrand(e.target.value)}
                  placeholder="Shoe Brand (e.g. Nike)"
                  className="min-h-[38px] rounded-xl border border-[#D9D7CE] bg-[#F6F5F0]/60 px-3 text-xs text-[#141F1B] focus:border-[#172D27] focus:bg-white focus:outline-none"
                />
                <input
                  type="text"
                  maxLength={80}
                  value={shoeName}
                  onChange={(e) => setShoeName(e.target.value)}
                  placeholder="Shoe Model (e.g. Pegasus 41)"
                  className="min-h-[38px] rounded-xl border border-[#D9D7CE] bg-[#F6F5F0]/60 px-3 text-xs text-[#141F1B] focus:border-[#172D27] focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {previewRoute && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1 text-xs font-semibold text-[#5B6B64]">
              <span>Recorded {workoutMeta.pastNoun} Snapshot (Start · KM Splits · Finish)</span>
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
            {error || saveError} — Your workout stays safely saved on this device until synced.
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
                ? 'Automatically saved to your Workout History'
                : saveStatus === 'saving'
                ? 'Auto-saving workout to your history...'
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
            Done · View Workout History
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

          {onPostDailyRun && (
            <button
              type="button"
              onClick={onPostDailyRun}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-[#172D27]/30 bg-[#EBF5EE] px-4 text-sm font-semibold text-[#172D27]"
            >
              <Sparkles className="h-4 w-4" />
              Post Activity
            </button>
          )}

          {onAddStory && (
            <button
              type="button"
              onClick={onAddStory}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-white px-4 text-sm font-semibold text-[#141F1B]"
            >
              <Plus className="h-4 w-4" />
              Add Story
            </button>
          )}

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
