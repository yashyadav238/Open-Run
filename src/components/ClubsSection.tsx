import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  Loader2,
  MapPin,
  Megaphone,
  Plus,
  Search,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  checkUserJoinedClubs,
  createOpenRunInvite,
  createRunClub,
  deleteRunClub,
  joinRunClub,
  leaveRunClub,
  subscribeRunClubs,
} from '../services/firestoreService';
import type { OpenEventType, RunClubDoc, WorkoutType } from '../types/run';

const CLUB_TAG_PRESETS = [
  'Morning Crew',
  'Marathon Prep',
  '5K / 10K',
  'Trail Runners',
  'Beginner Friendly',
  'Weekend Long Runs',
  'Speedwork',
  'Social & Coffee',
  'Cycling Peloton',
  'Night Runners',
];

interface ClubsSectionProps {
  userId: string | null;
  userName: string;
  emailVerified: boolean;
  defaultCity: string;
  defaultWorkoutType?: WorkoutType;
  onOpenAuth: () => void;
  onNotify?: (kind: 'ok' | 'err', text: string) => void;
}

function defaultTomorrowIso(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setHours(6, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const ClubsSection: React.FC<ClubsSectionProps> = ({
  userId,
  userName,
  emailVerified,
  defaultCity,
  defaultWorkoutType = 'running',
  onOpenAuth,
  onNotify,
}) => {
  const [clubs, setClubs] = useState<RunClubDoc[]>([]);
  const [joinedClubIds, setJoinedClubIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create Club Form
  const [clubName, setClubName] = useState('');
  const [clubCity, setClubCity] = useState(defaultCity || 'Chandigarh');
  const [clubDescription, setClubDescription] = useState('');
  const [clubTags, setClubTags] = useState<string[]>(['Morning Crew', 'Beginner Friendly']);
  const [customTagInput, setCustomTagInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyClubId, setBusyClubId] = useState<string | null>(null);

  // Organize Open Run / Marathon from Club
  const [organizingClub, setOrganizingClub] = useState<RunClubDoc | null>(null);
  const [eventType, setEventType] = useState<OpenEventType>('fun_run');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDistanceKm, setEventDistanceKm] = useState('10');
  const [eventDateTime, setEventDateTime] = useState(defaultTomorrowIso);
  const [eventMeetingPoint, setEventMeetingPoint] = useState('');
  const [eventCity, setEventCity] = useState(defaultCity || 'Chandigarh');
  const [eventMaxParticipants, setEventMaxParticipants] = useState('100');
  const [eventDescription, setEventDescription] = useState('');
  const [publishingEvent, setPublishingEvent] = useState(false);

  useEffect(() => {
    const unsub = subscribeRunClubs(setClubs);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userId || clubs.length === 0) {
      setJoinedClubIds(new Set());
      return;
    }
    let cancelled = false;
    void checkUserJoinedClubs(
      clubs.map((c) => c.id),
      userId
    ).then((set) => {
      if (!cancelled) setJoinedClubIds(set);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, clubs]);

  const filteredClubs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [clubs, search]);

  const toggleClubTag = (tag: string) => {
    setClubTags((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (exists) return prev.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      if (prev.length >= 8) return prev;
      return [...prev, tag];
    });
  };

  const handleAddCustomTag = () => {
    const clean = customTagInput.trim().slice(0, 32);
    if (!clean || clubTags.length >= 8) return;
    if (!clubTags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setClubTags((prev) => [...prev, clean]);
    }
    setCustomTagInput('');
  };

  const handleCreateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      onOpenAuth();
      return;
    }
    if (!emailVerified) {
      onNotify?.('err', 'Verify your email in Profile before creating a club.');
      return;
    }
    if (clubName.trim().length < 3 || clubDescription.trim().length < 5) {
      onNotify?.('err', 'Please enter a club name (3+ chars) and description (5+ chars).');
      return;
    }
    setCreating(true);
    try {
      await createRunClub(
        { uid: userId, displayName: userName },
        {
          name: clubName,
          description: clubDescription,
          city: clubCity || defaultCity || 'Chandigarh',
          tags: clubTags,
        }
      );
      setClubName('');
      setClubDescription('');
      setClubTags(['Morning Crew', 'Beginner Friendly']);
      setShowCreateForm(false);
      onNotify?.('ok', 'Your running club is now live!');
    } catch (err) {
      onNotify?.('err', err instanceof Error ? err.message : 'Could not create club.');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinOrLeave = async (club: RunClubDoc) => {
    if (!userId) {
      onOpenAuth();
      return;
    }
    if (!emailVerified) {
      onNotify?.('err', 'Verify your email in Profile to join clubs.');
      return;
    }
    setBusyClubId(club.id);
    try {
      if (joinedClubIds.has(club.id)) {
        await leaveRunClub(club.id, userId);
        setJoinedClubIds((prev) => {
          const next = new Set(prev);
          next.delete(club.id);
          return next;
        });
        onNotify?.('ok', `Left ${club.name}.`);
      } else {
        await joinRunClub(club.id, userId, userName);
        setJoinedClubIds((prev) => new Set(prev).add(club.id));
        onNotify?.('ok', `Joined ${club.name}!`);
      }
    } catch (err) {
      onNotify?.('err', err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyClubId(null);
    }
  };

  const handleDeleteClub = async (club: RunClubDoc) => {
    setBusyClubId(club.id);
    try {
      await deleteRunClub(club.id);
      onNotify?.('ok', `Deleted ${club.name}.`);
    } catch (err) {
      onNotify?.('err', err instanceof Error ? err.message : 'Could not delete club.');
    } finally {
      setBusyClubId(null);
    }
  };

  const openOrganizeModal = (club: RunClubDoc) => {
    if (!userId) {
      onOpenAuth();
      return;
    }
    setOrganizingClub(club);
    setEventType('fun_run');
    setEventTitle(`${club.name} Open Run`);
    setEventDistanceKm('10');
    setEventDateTime(defaultTomorrowIso());
    setEventMeetingPoint(`${club.city} Main Park Gate`);
    setEventCity(club.city);
    setEventMaxParticipants('100');
    setEventDescription(`Organized by ${club.name}. All paces welcome!`);
  };

  const handlePublishClubEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !organizingClub) return;
    if (!emailVerified) {
      onNotify?.('err', 'Verify your email in Profile to organize open runs & marathons.');
      return;
    }
    setPublishingEvent(true);
    try {
      const hostLabel = `${organizingClub.name} · ${userName}`.slice(0, 80);
      await createOpenRunInvite(userId, hostLabel, {
        eventType,
        workoutType: defaultWorkoutType,
        title: eventTitle.trim() || `${organizingClub.name} Open Run`,
        description: eventDescription.trim(),
        distanceKm: Math.max(1, Number(eventDistanceKm) || 5),
        eventDateTime,
        meetingPoint: eventMeetingPoint.trim() || `${organizingClub.city} Main Gate`,
        city: eventCity.trim() || organizingClub.city,
        maxParticipants: Math.max(2, Math.round(Number(eventMaxParticipants) || 100)),
      });
      setOrganizingClub(null);
      onNotify?.(
        'ok',
        `${eventType === 'marathon' ? 'Marathon' : 'Open Run'} published globally to Open Runs!`
      );
    } catch (err) {
      onNotify?.('err', err instanceof Error ? err.message : 'Could not publish event.');
    } finally {
      setPublishingEvent(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header + Search + Create Club Button */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#E5E3DC] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-[#141F1B]">Running Clubs</h2>
          <p className="text-xs text-[#5B6B64]">
            Create a club with tags &amp; description, join local crews, and organize open runs &amp; marathons anywhere.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (userId ? setShowCreateForm((v) => !v) : onOpenAuth())}
          className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E] hover:bg-[#1F3C34]"
        >
          <Plus className="h-4 w-4" />
          {showCreateForm ? 'Close Form' : 'Create Club'}
        </button>
      </div>

      {/* Create Club Form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateClub}
          className="rounded-2xl border border-[#172D27]/20 bg-white p-5 space-y-4 shadow-sm"
        >
          <h3 className="font-display text-base font-bold text-[#141F1B]">Start a New Running Club</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Club Name *</label>
              <input
                type="text"
                required
                minLength={3}
                maxLength={80}
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                placeholder="e.g. Sukhna Sunrise Striders"
                className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">City / Region *</label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={clubCity}
                onChange={(e) => setClubCity(e.target.value)}
                placeholder="e.g. Chandigarh, Mumbai, London"
                className="mt-1 min-h-[42px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#5B6B64]">Club Description *</label>
            <textarea
              rows={3}
              required
              minLength={5}
              maxLength={400}
              value={clubDescription}
              onChange={(e) => setClubDescription(e.target.value)}
              placeholder="Tell runners about your weekly schedule, pace groups, and community vibe..."
              className="mt-1 w-full rounded-xl border border-[#D9D7CE] p-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#5B6B64]">
              Club Tags ({clubTags.length}/8)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CLUB_TAG_PRESETS.map((tag) => {
                const selected = clubTags.some((t) => t.toLowerCase() === tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleClubTag(tag)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                      selected
                        ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                        : 'border-[#D9D7CE] bg-[#F6F5F0] text-[#141F1B] hover:border-[#30483E]'
                    }`}
                  >
                    {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3 text-[#5B6B64]" />}
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                maxLength={32}
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomTag();
                  }
                }}
                placeholder="Add custom tag..."
                className="min-h-[38px] flex-1 rounded-xl border border-[#D9D7CE] px-3 text-xs"
              />
              <button
                type="button"
                onClick={handleAddCustomTag}
                className="rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-xs font-semibold text-[#172D27]"
              >
                Add Tag
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#172D27] px-5 text-xs font-semibold text-[#9AE62E] disabled:opacity-50"
          >
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {creating ? 'Creating Club...' : 'Publish Running Club'}
          </button>
        </form>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B6B64]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clubs by name, city, or tag..."
          className="min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-white pl-10 pr-4 text-sm text-[#141F1B]"
        />
      </div>

      {/* Club Cards Grid */}
      {filteredClubs.length === 0 ? (
        <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
          <p className="font-display text-base font-bold text-[#141F1B]">No clubs found yet</p>
          <p className="mt-1 text-xs text-[#5B6B64]">
            Be the first to start a running club in {defaultCity} and host open runs or marathons!
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredClubs.map((club) => {
            const isOwner = Boolean(userId && club.ownerUid === userId);
            const isMember = isOwner || joinedClubIds.has(club.id);
            const isBusy = busyClubId === club.id;
            return (
              <div
                key={club.id}
                className="flex flex-col justify-between rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-[#141F1B] truncate">
                        {club.name}
                      </h3>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#5B6B64]">
                        <MapPin className="h-3.5 w-3.5 text-[#30483E]" />
                        {club.city} · Hosted by {club.ownerName}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#EBF5EE] px-2.5 py-1 font-mono text-xs font-bold text-[#172D27]">
                      <Users className="h-3.5 w-3.5" />
                      {club.memberCount}
                    </span>
                  </div>

                  <p className="text-xs leading-relaxed text-[#30483E]">{club.description}</p>

                  {club.tags && club.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {club.tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-md bg-[#F6F5F0] px-2 py-0.5 text-[11px] font-semibold text-[#172D27]"
                        >
                          <Tag className="h-2.5 w-2.5 text-[#30483E]" />
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[#ECEAE2] pt-3">
                  {!isOwner && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleJoinOrLeave(club)}
                      className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition ${
                        isMember
                          ? 'border border-[#D9D7CE] bg-[#F6F5F0] text-[#141F1B] hover:bg-red-50 hover:text-red-700'
                          : 'bg-[#172D27] text-[#9AE62E] hover:bg-[#1F3C34]'
                      }`}
                    >
                      {isMember ? 'Joined (Leave)' : 'Join Club'}
                    </button>
                  )}

                  {isMember && (
                    <button
                      type="button"
                      onClick={() => openOrganizeModal(club)}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#9AE62E] px-3.5 text-xs font-bold text-[#172D27] hover:bg-[#8CD625]"
                    >
                      <Megaphone className="h-3.5 w-3.5" />
                      Organize Open Run / Marathon
                    </button>
                  )}

                  {isOwner && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDeleteClub(club)}
                      aria-label={`Delete ${club.name}`}
                      className="ml-auto rounded-lg p-2 text-[#5B6B64] hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Organize Open Run / Marathon Modal */}
      {organizingClub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handlePublishClubEvent}
            className="w-full max-w-lg rounded-2xl bg-white p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#141F1B]">
                  Organize Open Run / Marathon
                </h3>
                <p className="text-xs text-[#5B6B64]">Hosted by {organizingClub.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setOrganizingClub(null)}
                className="rounded-lg p-1.5 text-[#5B6B64] hover:bg-[#F6F5F0]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEventType('fun_run')}
                className={`min-h-[40px] rounded-xl border text-xs font-bold ${
                  eventType === 'fun_run'
                    ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                    : 'border-[#D9D7CE] bg-[#F6F5F0] text-[#141F1B]'
                }`}
              >
                Open Fun Run
              </button>
              <button
                type="button"
                onClick={() => {
                  setEventType('marathon');
                  if (Number(eventDistanceKm) < 21) setEventDistanceKm('21.1');
                }}
                className={`min-h-[40px] rounded-xl border text-xs font-bold ${
                  eventType === 'marathon'
                    ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                    : 'border-[#D9D7CE] bg-[#F6F5F0] text-[#141F1B]'
                }`}
              >
                Marathon Event
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Event Title *</label>
              <input
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Distance (km) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={250}
                  step="0.1"
                  value={eventDistanceKm}
                  onChange={(e) => setEventDistanceKm(e.target.value)}
                  className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] px-3 font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Max Participants</label>
                <input
                  type="number"
                  required
                  min={2}
                  max={1000}
                  value={eventMaxParticipants}
                  onChange={(e) => setEventMaxParticipants(e.target.value)}
                  className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] px-3 font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Date &amp; Time *</label>
                <div className="relative mt-1">
                  <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5B6B64]" />
                  <input
                    type="datetime-local"
                    required
                    value={eventDateTime}
                    onChange={(e) => setEventDateTime(e.target.value)}
                    className="min-h-[40px] w-full rounded-xl border border-[#D9D7CE] pl-8 pr-2 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">City *</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={eventCity}
                  onChange={(e) => setEventCity(e.target.value)}
                  className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Meeting Point *</label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={140}
                value={eventMeetingPoint}
                onChange={(e) => setEventMeetingPoint(e.target.value)}
                className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Event Description</label>
              <textarea
                rows={2}
                maxLength={500}
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#D9D7CE] p-2.5 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={publishingEvent}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#172D27] text-xs font-bold text-[#9AE62E] disabled:opacity-50"
            >
              {publishingEvent && <Loader2 className="h-4 w-4 animate-spin" />}
              {publishingEvent ? 'Publishing...' : 'Publish to Global Open Runs & Marathons'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
