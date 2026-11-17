import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCheck,
  Compass,
  Loader2,
  MapPin,
  MessageCircle,
  Search,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import { getWorkoutMeta } from '../data/workouts';
import {
  makePairId,
  respondPersonalRunInvite,
  sendDmMessage,
  subscribeDmMessages,
  subscribeMyDmThreads,
  subscribeMyFriendRequests,
  subscribeRunnerDirectory,
} from '../services/firestoreService';
import type {
  DmMessageDoc,
  DmThreadDoc,
  FriendRequestDoc,
  LiveBeaconDoc,
  RunnerDirectoryDoc,
  WorkoutType,
} from '../types/run';

interface MessagesViewProps {
  userId: string | null;
  userName: string;
  emailVerified: boolean;
  defaultWorkoutType: WorkoutType;
  liveFriends: LiveBeaconDoc[];
  onOpenAuth: () => void;
  onOpenSocialFriends: () => void;
}

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function formatChatTime(ts: unknown): string {
  const ms = toMillis(ts);
  if (!ms) return '';
  const date = new Date(ms);
  const diffMin = Math.floor((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffHr < 48) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatBubbleTime(ts: unknown): string {
  const ms = toMillis(ts);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AvatarCircle({
  name,
  photoUrl,
  size = 'md',
  isLive = false,
}: {
  name: string;
  photoUrl?: string;
  size?: 'sm' | 'md';
  isLive?: boolean;
}) {
  const dims = size === 'sm' ? 'h-9 w-9 text-xs' : 'h-11 w-11 text-sm';
  const initials = (name || 'R')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="relative shrink-0">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          className={`${dims} rounded-full object-cover border border-[#E5E3DC]`}
        />
      ) : (
        <div
          className={`${dims} flex items-center justify-center rounded-full bg-[#172D27] font-display font-bold text-[#9AE62E]`}
        >
          {initials || 'R'}
        </div>
      )}
      {isLive && (
        <span
          title="Currently on a live workout"
          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#9AE62E]"
        />
      )}
    </div>
  );
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  userId,
  userName,
  emailVerified,
  defaultWorkoutType,
  liveFriends,
  onOpenAuth,
  onOpenSocialFriends,
}) => {
  const [friendRequests, setFriendRequests] = useState<FriendRequestDoc[]>([]);
  const [directory, setDirectory] = useState<RunnerDirectoryDoc[]>([]);
  const [threads, setThreads] = useState<DmThreadDoc[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DmMessageDoc[]>([]);
  const [search, setSearch] = useState('');
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteTitle, setInviteTitle] = useState('');
  const [inviteDistanceKm, setInviteDistanceKm] = useState('5');
  const [inviteMeetingPoint, setInviteMeetingPoint] = useState('');
  const [inviteDateTime, setInviteDateTime] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setHours(6, 30, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userId) {
      setFriendRequests([]);
      setThreads([]);
      return;
    }
    const unsubFriends = subscribeMyFriendRequests(userId, setFriendRequests);
    const unsubThreads = subscribeMyDmThreads(userId, setThreads);
    const unsubDir = subscribeRunnerDirectory(setDirectory);
    return () => {
      unsubFriends();
      unsubThreads();
      unsubDir();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !activeThreadId) {
      setMessages([]);
      return;
    }
    const unsub = subscribeDmMessages(activeThreadId, userId, setMessages);
    return () => unsub();
  }, [userId, activeThreadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeThreadId]);

  const directoryByUid = useMemo(() => {
    const map = new Map<string, RunnerDirectoryDoc>();
    for (const r of directory) map.set(r.uid, r);
    return map;
  }, [directory]);

  const liveUidSet = useMemo(() => new Set(liveFriends.map((f) => f.uid)), [liveFriends]);

  const threadById = useMemo(() => {
    const map = new Map<string, DmThreadDoc>();
    for (const t of threads) map.set(t.id, t);
    return map;
  }, [threads]);

  const acceptedFriendships = useMemo(
    () => friendRequests.filter((r) => r.status === 'accepted'),
    [friendRequests]
  );

  const conversations = useMemo(() => {
    if (!userId) return [];
    const byThreadId = new Map<
      string,
      {
        threadId: string;
        friendship: FriendRequestDoc | null;
        otherUid: string;
        otherName: string;
        otherUsername?: string;
        otherPhotoUrl: string;
        otherCity?: string;
        isPrivate: boolean;
        isFriend: boolean;
        isLive: boolean;
        thread?: DmThreadDoc;
        lastMessageText: string;
        lastSenderId: string;
        updatedMs: number;
      }
    >();

    for (const fr of acceptedFriendships) {
      const otherUid = fr.fromUid === userId ? fr.toUid : fr.fromUid;
      const fallbackName = fr.fromUid === userId ? fr.toName : fr.fromName;
      const fallbackPhoto = fr.fromUid === userId ? fr.toPhotoUrl : fr.fromPhotoUrl;
      const dir = directoryByUid.get(otherUid);
      const thread = threadById.get(fr.id);
      byThreadId.set(fr.id, {
        threadId: fr.id,
        friendship: fr,
        otherUid,
        otherName: dir?.displayName || fallbackName || 'Runner',
        otherUsername: dir?.username,
        otherPhotoUrl: dir?.photoURL || fallbackPhoto || '',
        otherCity: dir?.city,
        isPrivate: Boolean(dir?.isPrivate),
        isFriend: true,
        isLive: liveUidSet.has(otherUid),
        thread,
        lastMessageText: thread?.lastMessageText || '',
        lastSenderId: thread?.lastSenderId || '',
        updatedMs: toMillis(thread?.updatedAt) || toMillis(fr.updatedAt) || toMillis(fr.createdAt),
      });
    }

    // Also include public profiles (anyone can DM a public profile)
    for (const dir of directory) {
      if (!dir.uid || dir.uid === userId) continue;
      const pairId = makePairId(userId, dir.uid);
      if (byThreadId.has(pairId)) continue;
      if (dir.isPrivate) continue;
      const thread = threadById.get(pairId);
      byThreadId.set(pairId, {
        threadId: pairId,
        friendship: null,
        otherUid: dir.uid,
        otherName: dir.displayName || 'Runner',
        otherUsername: dir.username,
        otherPhotoUrl: dir.photoURL || '',
        otherCity: dir.city,
        isPrivate: false,
        isFriend: false,
        isLive: liveUidSet.has(dir.uid),
        thread,
        lastMessageText: thread?.lastMessageText || 'Public profile · Tap to message',
        lastSenderId: thread?.lastSenderId || '',
        updatedMs: toMillis(thread?.updatedAt),
      });
    }

    const q = search.trim().toLowerCase();
    return Array.from(byThreadId.values())
      .filter(
        (c) =>
          !q ||
          c.otherName.toLowerCase().includes(q) ||
          (c.otherUsername || '').toLowerCase().includes(q) ||
          c.lastMessageText.toLowerCase().includes(q)
      )
      .sort((a, b) => b.updatedMs - a.updatedMs);
  }, [acceptedFriendships, directory, directoryByUid, liveUidSet, search, threadById, userId]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.threadId === activeThreadId) || null,
    [conversations, activeThreadId]
  );

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !activeConversation) return;
    const text = draftText.trim();
    if (!text) return;
    if (!emailVerified) {
      setError('Please verify your email to send direct messages.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendDmMessage(
        activeConversation.threadId,
        activeConversation.friendship,
        { uid: userId, displayName: userName },
        { messageType: 'text', text },
        { uid: activeConversation.otherUid, isPrivate: activeConversation.isPrivate }
      );
      setDraftText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !activeConversation) return;
    if (!emailVerified) {
      setError('Please verify your email to send workout invites.');
      return;
    }
    const dist = Math.max(1, Number(inviteDistanceKm) || 5);
    const title = inviteTitle.trim() || `${dist}K ${getWorkoutMeta(defaultWorkoutType).label} Together`;
    setSending(true);
    setError(null);
    try {
      await sendDmMessage(
        activeConversation.threadId,
        activeConversation.friendship,
        { uid: userId, displayName: userName },
        {
          messageType: 'run_invite',
          text: `Invited you to ${title} (${dist} km)`,
          workoutType: defaultWorkoutType,
          inviteDistanceKm: dist,
          inviteTitle: title,
          inviteDateTime: inviteDateTime || new Date(Date.now() + 86400000).toISOString().slice(0, 16),
          inviteMeetingPoint: inviteMeetingPoint.trim() || 'Main Park Gate',
        },
        { uid: activeConversation.otherUid, isPrivate: activeConversation.isPrivate }
      );
      setShowInviteForm(false);
      setInviteTitle('');
      setInviteMeetingPoint('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setSending(false);
    }
  };

  const handleShareLocation = async () => {
    if (!userId || !activeConversation) return;
    if (!emailVerified) {
      setError('Please verify your email to share location.');
      return;
    }
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.');
      return;
    }
    setSharingLocation(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await sendDmMessage(
            activeConversation.threadId,
            activeConversation.friendship,
            { uid: userId, displayName: userName },
            {
              messageType: 'location',
              text: 'Shared current GPS location',
              locationLat: pos.coords.latitude,
              locationLng: pos.coords.longitude,
              locationLabel: 'Current GPS Pin',
              locationIsLive: false,
            },
            { uid: activeConversation.otherUid, isPrivate: activeConversation.isPrivate }
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not share location.');
        } finally {
          setSharingLocation(false);
        }
      },
      () => {
        setSharingLocation(false);
        setError('Location permission denied.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (!userId) {
    return (
      <div className="rounded-2xl border border-[#E5E3DC] bg-white p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#172D27] text-[#9AE62E]">
          <MessageCircle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold text-[#141F1B]">Direct Messages</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-[#5B6B64]">
          Sign in to chat 1-on-1 with your running friends, send workout invites, and share live GPS locations.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-5 min-h-[46px] rounded-xl bg-[#172D27] px-6 text-sm font-semibold text-[#9AE62E]"
        >
          Sign In to Open Messages
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-148px)] min-h-[520px] overflow-hidden rounded-2xl border border-[#E5E3DC] bg-white shadow-sm lg:h-[calc(100dvh-64px)]">
      {/* Left Pane: Conversations List */}
      <aside
        className={`flex w-full flex-col border-r border-[#E5E3DC] md:w-80 lg:w-96 ${
          activeConversation ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#E5E3DC] px-4 py-3.5">
          <div>
            <h1 className="font-display text-lg font-bold text-[#141F1B]">Messages</h1>
            <p className="text-[11px] text-[#5B6B64]">
              {conversations.length} {conversations.length === 1 ? 'friend' : 'friends'}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSocialFriends}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-3 text-xs font-semibold text-[#172D27] hover:bg-[#E5E3DC]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add Friends
          </button>
        </div>

        <div className="border-b border-[#F0EFEA] p-3">
          <div className="flex items-center rounded-xl border border-[#D9D7CE] bg-[#F6F5F0]/70 px-3">
            <Search className="mr-2 h-4 w-4 text-[#5B6B64]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="h-9 w-full bg-transparent text-xs focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#F0EFEA]">
          {conversations.length === 0 ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm font-semibold text-[#141F1B]">No conversations yet</p>
              <p className="text-xs text-[#5B6B64]">
                Add friends in the Social tab to start chatting, planning runs, and sharing locations.
              </p>
              <button
                type="button"
                onClick={onOpenSocialFriends}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Find Runners
              </button>
            </div>
          ) : (
            conversations.map((conv) => {
              const selected = conv.threadId === activeThreadId;
              return (
                <button
                  key={conv.threadId}
                  type="button"
                  onClick={() => {
                    setActiveThreadId(conv.threadId);
                    setShowInviteForm(false);
                    setError(null);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                    selected ? 'bg-[#EBF5EE]' : 'hover:bg-[#F6F5F0]'
                  }`}
                >
                  <AvatarCircle
                    name={conv.otherName}
                    photoUrl={conv.otherPhotoUrl}
                    isLive={conv.isLive}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-bold text-[#141F1B]">{conv.otherName}</p>
                      <span className="shrink-0 text-[10px] font-medium text-[#5B6B64]">
                        {formatChatTime(conv.thread?.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[#5B6B64]">
                      {conv.lastMessageText
                        ? conv.lastSenderId === userId
                          ? `You: ${conv.lastMessageText}`
                          : conv.lastMessageText
                        : 'Tap to start chatting'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Pane: Active Chat */}
      <section
        className={`flex flex-1 flex-col min-w-0 bg-[#F6F5F0]/50 ${
          activeConversation ? 'flex' : 'hidden md:flex'
        }`}
      >
        {!activeConversation ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#172D27] text-[#9AE62E]">
              <MessageCircle className="h-8 w-8" />
            </div>
            <h2 className="mt-4 font-display text-xl font-bold text-[#141F1B]">Your Messages</h2>
            <p className="mt-1 max-w-xs text-xs text-[#5B6B64]">
              Select a friend from the left to send messages, share your GPS pin, or invite them to a workout.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="flex items-center justify-between gap-3 border-b border-[#E5E3DC] bg-white px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-label="Back to chats"
                  onClick={() => setActiveThreadId(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-[#141F1B] hover:bg-[#F6F5F0] md:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <AvatarCircle
                  name={activeConversation.otherName}
                  photoUrl={activeConversation.otherPhotoUrl}
                  size="sm"
                  isLive={activeConversation.isLive}
                />
                <div className="min-w-0">
                  <h2 className="truncate font-display text-sm font-bold text-[#141F1B]">
                    {activeConversation.otherName}
                  </h2>
                  <p className="truncate text-[11px] text-[#5B6B64]">
                    {activeConversation.isLive
                      ? 'Live workout in progress'
                      : activeConversation.otherUsername
                      ? `@${activeConversation.otherUsername}`
                      : activeConversation.otherCity || 'Friend'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowInviteForm((v) => !v)}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition ${
                    showInviteForm
                      ? 'bg-[#172D27] text-[#9AE62E]'
                      : 'border border-[#D9D7CE] bg-white text-[#141F1B] hover:bg-[#F6F5F0]'
                  }`}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Invite</span>
                </button>
                <button
                  type="button"
                  disabled={sharingLocation}
                  onClick={() => void handleShareLocation()}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0] disabled:opacity-50"
                >
                  {sharingLocation ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5 text-[#30483E]" />
                  )}
                  <span className="hidden sm:inline">Location</span>
                </button>
              </div>
            </header>

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
              {messages.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#5B6B64]">
                  Say hi to {activeConversation.otherName} or send a workout invite!
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.senderUid === userId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs ${
                          isMine
                            ? 'rounded-br-sm bg-[#172D27] text-white'
                            : 'rounded-bl-sm border border-[#E5E3DC] bg-white text-[#141F1B]'
                        }`}
                      >
                        {msg.messageType === 'run_invite' ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#9AE62E]">
                              <Calendar className="h-3.5 w-3.5" />
                              Workout Invite
                            </div>
                            <p className="font-display text-sm font-bold">
                              {msg.inviteTitle || 'Workout Invite'}
                            </p>
                            <p
                              className={`text-xs ${
                                isMine ? 'text-[#B8E8C7]' : 'text-[#5B6B64]'
                              }`}
                            >
                              {msg.inviteDistanceKm} km · {msg.inviteMeetingPoint}
                              {msg.inviteDateTime ? ` · ${msg.inviteDateTime.replace('T', ' ')}` : ''}
                            </p>
                            {msg.inviteStatus === 'pending' && !isMine ? (
                              <div className="flex gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void respondPersonalRunInvite(
                                      activeConversation.threadId,
                                      msg.id,
                                      'accepted'
                                    )
                                  }
                                  className="inline-flex min-h-[34px] flex-1 items-center justify-center gap-1 rounded-lg bg-[#172D27] px-3 text-xs font-semibold text-[#9AE62E]"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void respondPersonalRunInvite(
                                      activeConversation.threadId,
                                      msg.id,
                                      'declined'
                                    )
                                  }
                                  className="inline-flex min-h-[34px] flex-1 items-center justify-center gap-1 rounded-lg border border-[#D9D7CE] bg-white px-3 text-xs font-semibold text-[#5B6B64]"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Decline
                                </button>
                              </div>
                            ) : (
                              <span
                                className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                                  msg.inviteStatus === 'accepted'
                                    ? 'bg-[#9AE62E] text-[#172D27]'
                                    : msg.inviteStatus === 'declined'
                                    ? 'bg-red-100 text-red-700'
                                    : isMine
                                    ? 'bg-[#30483E] text-[#B8E8C7]'
                                    : 'bg-[#F6F5F0] text-[#5B6B64]'
                                }`}
                              >
                                {msg.inviteStatus || 'pending'}
                              </span>
                            )}
                          </div>
                        ) : msg.messageType === 'location' ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-bold">
                              <MapPin className="h-3.5 w-3.5 text-[#9AE62E]" />
                              <span>{msg.locationLabel || 'Shared GPS Location'}</span>
                            </div>
                            {typeof msg.locationLat === 'number' &&
                              typeof msg.locationLng === 'number' && (
                                <a
                                  href={`https://www.google.com/maps?q=${msg.locationLat},${msg.locationLng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-1 text-xs underline ${
                                    isMine ? 'text-[#9AE62E]' : 'text-[#172D27]'
                                  }`}
                                >
                                  <Compass className="h-3 w-3" />
                                  Open in Google Maps ({msg.locationLat.toFixed(4)},{' '}
                                  {msg.locationLng.toFixed(4)})
                                </a>
                              )}
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words leading-relaxed">
                            {msg.text}
                          </p>
                        )}

                        <div
                          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                            isMine ? 'text-[#B8E8C7]/80' : 'text-[#5B6B64]'
                          }`}
                        >
                          <span>{formatBubbleTime(msg.createdAt)}</span>
                          {isMine && <CheckCheck className="h-3 w-3 text-[#9AE62E]" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {error && (
              <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                {error}
              </div>
            )}

            {/* Quick Workout Invite Panel */}
            {showInviteForm && (
              <form
                onSubmit={handleSendInvite}
                className="mx-4 mb-2 rounded-2xl border border-[#E5E3DC] bg-white p-3.5 shadow-sm space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-[#141F1B]">Send Workout Invite</p>
                  <button
                    type="button"
                    onClick={() => setShowInviteForm(false)}
                    className="text-[#5B6B64] hover:text-[#141F1B]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={inviteTitle}
                    onChange={(e) => setInviteTitle(e.target.value)}
                    placeholder="Title (e.g. Morning 5K)"
                    className="h-9 rounded-xl border border-[#D9D7CE] px-3 text-xs focus:border-[#172D27] focus:outline-none"
                  />
                  <input
                    type="number"
                    min="1"
                    max="250"
                    step="0.5"
                    value={inviteDistanceKm}
                    onChange={(e) => setInviteDistanceKm(e.target.value)}
                    placeholder="Distance (km)"
                    className="h-9 rounded-xl border border-[#D9D7CE] px-3 text-xs focus:border-[#172D27] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={inviteMeetingPoint}
                    onChange={(e) => setInviteMeetingPoint(e.target.value)}
                    placeholder="Meeting point"
                    className="h-9 rounded-xl border border-[#D9D7CE] px-3 text-xs focus:border-[#172D27] focus:outline-none"
                  />
                  <input
                    type="datetime-local"
                    value={inviteDateTime}
                    onChange={(e) => setInviteDateTime(e.target.value)}
                    className="h-9 rounded-xl border border-[#D9D7CE] px-3 text-xs focus:border-[#172D27] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E] disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" />
                  Send Invite to {activeConversation.otherName}
                </button>
              </form>
            )}

            {/* Message Composer */}
            <form
              onSubmit={handleSendText}
              className="flex items-center gap-2 border-t border-[#E5E3DC] bg-white px-3 py-2.5"
            >
              <input
                type="text"
                maxLength={500}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={`Message ${activeConversation.otherName}...`}
                className="h-11 flex-1 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0]/60 px-3.5 text-sm text-[#141F1B] focus:border-[#172D27] focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !draftText.trim()}
                aria-label="Send message"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#172D27] text-[#9AE62E] transition hover:bg-[#224037] disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
};
