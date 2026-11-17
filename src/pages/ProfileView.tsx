import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AtSign,
  Award,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  FileText,
  Footprints,
  Globe,
  Globe2,
  Heart,
  Loader2,
  Lock,
  LogOut,
  Medal,
  Moon,
  Palette,
  Plus,
  Shield,
  Star,
  Sun,
  Tag,
  Trash2,
  Trophy,
  User,
  X,
} from 'lucide-react';
import { PlaceSearchInput } from '../components/PlaceSearchInput';
import { WorkoutIcon, WorkoutSelector } from '../components/WorkoutIcon';
import { WorldCityMapPicker } from '../components/WorldCityMapPicker';
import { useAuth } from '../context/AuthContext';
import { processProfilePhotoFile } from '../lib/avatarUpload';
import {
  MAX_BIO_LENGTH,
  MAX_BIO_TAG_LENGTH,
  MAX_BIO_TAGS,
  OPTIONAL_BIO_TAGS,
  sanitizeBioTags,
} from '../data/bioTags';
import { getWorkoutMeta, normalizeWorkoutType } from '../data/workouts';
import {
  findWorldCityPreset,
  resolveRunningCity,
  WORLD_RUNNING_CITIES,
  type ActiveRunningCity,
} from '../data/worldCities';
import {
  loadFavoriteIds,
  MOTIVATIONAL_QUOTES,
  saveFavoriteIds,
} from '../components/BrutalQuoteOverlay';
import { ACHIEVEMENTS, CHALLENGES } from '../services/challengesService';
import {
  checkUsernameAvailability,
  claimUsername,
  getSafetySettings,
  isValidUsernameFormat,
  normalizeUsername,
  saveSafetySettings,
  updateUserProfile,
} from '../services/firestoreService';
import { APP_THEMES, type AppThemeId } from '../lib/theme';
import { computeCategoryRanks } from '../lib/ranks';
import type { CityName, RunningShoeItem, WorkoutType } from '../types/run';

interface ProfileViewProps {
  activeCity: ActiveRunningCity;
  selectedWorkout?: WorkoutType;
  onSelectWorkout?: (workout: WorkoutType) => void;
  onSelectCity: (city: ActiveRunningCity) => void;
  activeTheme?: AppThemeId;
  onSelectTheme?: (theme: AppThemeId) => void;
  onOpenAuth: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  activeCity,
  selectedWorkout = 'running',
  onSelectWorkout,
  onSelectCity,
  activeTheme = 'light',
  onSelectTheme,
  onOpenAuth,
}) => {
  const {
    user,
    profile,
    runs,
    artDesigns,
    logout,
    resendVerification,
    deleteAccount,
    refreshProfile,
  } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [usernameInput, setUsernameInput] = useState(profile?.username || '');
  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'idle' | 'checking' | 'available' | 'taken' | 'own' | 'invalid';
    message?: string;
  }>({ state: 'idle' });
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [unit, setUnit] = useState<'km' | 'mi'>(profile?.preferredUnit || 'km');
  const [preferredWorkout, setPreferredWorkout] = useState<WorkoutType>(
    normalizeWorkoutType(profile?.preferredWorkout ?? selectedWorkout)
  );
  const [city, setCity] = useState<CityName>(profile?.city || activeCity.name);
  const [cityCoords, setCityCoords] = useState<{ lat: number; lng: number }>({
    lat: profile?.cityLat ?? activeCity.lat,
    lng: profile?.cityLng ?? activeCity.lng,
  });
  const [terrain, setTerrain] = useState(profile?.preferredTerrain || 'Parks & Paved Paths');
  const [savingPref, setSavingPref] = useState(false);
  const [prefSavedMsg, setPrefSavedMsg] = useState<string | null>(null);
  const [prefErrorMsg, setPrefErrorMsg] = useState<string | null>(null);
  const [guestCityMsg, setGuestCityMsg] = useState<string | null>(null);

  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [trustedShare, setTrustedShare] = useState(false);
  const [savingSafety, setSavingSafety] = useState(false);
  const [safetyMsg, setSafetyMsg] = useState<string | null>(null);

  // Profile Privacy (Public vs Private)
  const [isPrivateProfile, setIsPrivateProfile] = useState<boolean>(Boolean(profile?.isPrivate));
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState<string | null>(null);

  // Running Shoes & Mileage
  const [shoes, setShoes] = useState<RunningShoeItem[]>(profile?.shoes || []);
  const [showAddShoe, setShowAddShoe] = useState(false);
  const [shoeName, setShoeName] = useState('');
  const [shoeBrand, setShoeBrand] = useState('');
  const [shoeDistanceKm, setShoeDistanceKm] = useState('0');
  const [shoeMaxKm, setShoeMaxKm] = useState('600');
  const [savingShoes, setSavingShoes] = useState(false);
  const [shoeMsg, setShoeMsg] = useState<string | null>(null);
  const [editingShoeId, setEditingShoeId] = useState<string | null>(null);
  const [editingShoeKm, setEditingShoeKm] = useState('');

  useEffect(() => {
    setIsPrivateProfile(Boolean(profile?.isPrivate));
    setShoes(Array.isArray(profile?.shoes) ? profile.shoes : []);
  }, [profile?.isPrivate, profile?.shoes]);

  const handleTogglePrivacy = async (nextPrivate: boolean) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setIsPrivateProfile(nextPrivate);
    setSavingPrivacy(true);
    setPrivacyMsg(null);
    try {
      await updateUserProfile(user.uid, { isPrivate: nextPrivate });
      await refreshProfile();
      setPrivacyMsg(
        nextPrivate
          ? 'Profile is now Private — only accepted friends can see your posts and DM you.'
          : 'Profile is now Public — anyone can see your posts and send you DMs.'
      );
    } catch {
      setIsPrivateProfile(!nextPrivate);
      setPrivacyMsg('Could not update privacy setting. Please try again.');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const persistShoes = async (nextShoes: RunningShoeItem[], feedback: string) => {
    if (!user) return;
    setSavingShoes(true);
    setShoeMsg(null);
    try {
      await updateUserProfile(user.uid, { shoes: nextShoes });
      await refreshProfile();
      setShoes(nextShoes);
      setShoeMsg(feedback);
    } catch {
      setShoeMsg('Could not save running shoes. Please try again.');
    } finally {
      setSavingShoes(false);
    }
  };

  const handleAddShoe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const cleanName = shoeName.trim();
    if (!cleanName) return;
    const dist = Math.max(0, Number(shoeDistanceKm) || 0);
    const max = Math.max(100, Math.round(Number(shoeMaxKm) || 600));
    const newShoe: RunningShoeItem = {
      id: `shoe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName.slice(0, 80),
      brand: shoeBrand.trim() ? shoeBrand.trim().slice(0, 40) : undefined,
      distanceKm: Number(dist.toFixed(2)),
      maxKm: max,
      isPrimary: shoes.length === 0,
    };
    const next = [...shoes, newShoe];
    await persistShoes(next, `Added ${cleanName} to your rotation.`);
    setShoeName('');
    setShoeBrand('');
    setShoeDistanceKm('0');
    setShoeMaxKm('600');
    setShowAddShoe(false);
  };

  const handleSetPrimaryShoe = async (shoeId: string) => {
    const next = shoes.map((s) => ({ ...s, isPrimary: s.id === shoeId }));
    await persistShoes(next, 'Primary running shoe updated.');
  };

  const handleQuickAddKm = async (shoeId: string, deltaKm: number) => {
    const next = shoes.map((s) =>
      s.id === shoeId
        ? { ...s, distanceKm: Number(Math.max(0, (s.distanceKm || 0) + deltaKm).toFixed(2)) }
        : s
    );
    await persistShoes(next, `Added +${deltaKm} km.`);
  };

  const handleSaveEditedKm = async (shoeId: string) => {
    const parsed = Math.max(0, Number(editingShoeKm) || 0);
    const next = shoes.map((s) =>
      s.id === shoeId ? { ...s, distanceKm: Number(parsed.toFixed(2)) } : s
    );
    setEditingShoeId(null);
    await persistShoes(next, 'Shoe mileage updated.');
  };

  const handleDeleteShoe = async (shoeId: string) => {
    const remaining = shoes.filter((s) => s.id !== shoeId);
    if (remaining.length > 0 && !remaining.some((s) => s.isPrimary)) {
      remaining[0] = { ...remaining[0], isPrimary: true };
    }
    await persistShoes(remaining, 'Removed shoe from rotation.');
  };
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);

  const [bioInput, setBioInput] = useState(profile?.bio || '');
  const [bioTags, setBioTags] = useState<string[]>(profile?.bioTags || []);
  const [customBioTagInput, setCustomBioTagInput] = useState('');
  const [savingBio, setSavingBio] = useState(false);

  const [favoriteQuoteIds, setFavoriteQuoteIds] = useState<string[]>(() => loadFavoriteIds());
  const favoriteQuotes = MOTIVATIONAL_QUOTES.filter((q) => favoriteQuoteIds.includes(q.id));

  const handleRemoveFavoriteQuote = (quoteId: string) => {
    setFavoriteQuoteIds((prev) => {
      const next = prev.filter((id) => id !== quoteId);
      saveFavoriteIds(next);
      return next;
    });
  };
  const [bioSavedMsg, setBioSavedMsg] = useState<string | null>(null);
  const [bioErrorMsg, setBioErrorMsg] = useState<string | null>(null);
  const bioSectionRef = useRef<HTMLElement>(null);
  const bioTextareaRef = useRef<HTMLTextAreaElement>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  const effectivePhotoUrl =
    user && profile && typeof profile.photoURL === 'string'
      ? profile.photoURL
      : user?.photoURL || '';

  useEffect(() => {
    setAvatarLoadError(false);
  }, [effectivePhotoUrl]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setUsernameInput(profile.username || '');
      setUnit(profile.preferredUnit);
      setPreferredWorkout(normalizeWorkoutType(profile.preferredWorkout ?? selectedWorkout));
      const resolved = resolveRunningCity(profile.city, profile.cityLat, profile.cityLng);
      setCity(resolved.name);
      setCityCoords({ lat: resolved.lat, lng: resolved.lng });
      setTerrain(profile.preferredTerrain || 'Parks & Paved Paths');
      setBioInput(profile.bio || '');
      setBioTags(sanitizeBioTags(profile.bioTags || []));
    } else {
      setPreferredWorkout(normalizeWorkoutType(selectedWorkout));
      setCity(activeCity.name);
      setCityCoords({ lat: activeCity.lat, lng: activeCity.lng });
      setBioInput('');
      setBioTags([]);
    }
  }, [profile, activeCity, selectedWorkout]);

  useEffect(() => {
    if (!user) {
      setUsernameStatus({ state: 'idle' });
      return;
    }
    const norm = normalizeUsername(usernameInput);
    if (!norm) {
      setUsernameStatus({ state: 'idle' });
      return;
    }
    if (norm === (profile?.username || '')) {
      setUsernameStatus({ state: 'own', message: `@${norm} is your active username.` });
      return;
    }
    if (!isValidUsernameFormat(norm)) {
      setUsernameStatus({
        state: 'invalid',
        message: 'Use 3–24 lowercase letters, numbers, or underscores.',
      });
      return;
    }
    let cancelled = false;
    setUsernameStatus({ state: 'checking', message: `Checking @${norm}...` });
    const timer = window.setTimeout(() => {
      checkUsernameAvailability(norm, user.uid)
        .then((res) => {
          if (cancelled) return;
          if (res.available) {
            setUsernameStatus({ state: 'available', message: `@${res.normalized} is available!` });
          } else {
            setUsernameStatus({ state: 'taken', message: res.reason || `@${res.normalized} is taken.` });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setUsernameStatus({ state: 'idle' });
          }
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [usernameInput, profile?.username, user]);

  useEffect(() => {
    if (!user) return;
    getSafetySettings(user.uid)
      .then((s) => {
        if (s) {
          setEmergencyName(s.emergencyContactName || '');
          setEmergencyPhone(s.emergencyContactPhone || '');
          setTrustedShare(Boolean(s.trustedShareEnabled));
        }
      })
      .catch(() => {});
  }, [user]);

  const handleCopyUsername = () => {
    if (!profile?.username || !navigator.clipboard) return;
    void navigator.clipboard.writeText(`@${profile.username}`).then(() => {
      setCopiedUsername(true);
      window.setTimeout(() => setCopiedUsername(false), 2000);
    });
  };

  const applySelectedCity = (name: string, lat: number, lng: number, country?: string) => {
    const next = resolveRunningCity(name, lat, lng);
    setCity(next.name);
    setCityCoords({ lat: next.lat, lng: next.lng });
    setPrefSavedMsg(null);
    setPrefErrorMsg(null);
    if (!user) {
      onSelectCity({ ...next, country: country || next.country });
      setGuestCityMsg(`Running City updated to ${next.name}. Maps & planner now stay inside ${next.name}.`);
      window.setTimeout(() => setGuestCityMsg(null), 4000);
    }
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    setUploadingPhoto(true);
    setPhotoFeedback(null);
    setPhotoError(null);
    try {
      const compressedDataUrl = await processProfilePhotoFile(file);
      await updateUserProfile(user.uid, { photoURL: compressedDataUrl });
      await refreshProfile();
      setPhotoFeedback('Profile photo uploaded!');
      window.setTimeout(() => setPhotoFeedback(null), 3500);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not upload profile photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user) return;
    setUploadingPhoto(true);
    setPhotoFeedback(null);
    setPhotoError(null);
    try {
      await updateUserProfile(user.uid, { photoURL: '' });
      await refreshProfile();
      setPhotoFeedback('Profile photo removed.');
      window.setTimeout(() => setPhotoFeedback(null), 3000);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not remove photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleUseGooglePhoto = async () => {
    if (!user || !user.photoURL) return;
    setUploadingPhoto(true);
    setPhotoFeedback(null);
    setPhotoError(null);
    try {
      await updateUserProfile(user.uid, { photoURL: user.photoURL });
      await refreshProfile();
      setPhotoFeedback('Restored Google profile photo.');
      window.setTimeout(() => setPhotoFeedback(null), 3000);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not restore photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingPref(true);
    setPrefSavedMsg(null);
    setPrefErrorMsg(null);
    try {
      const nextName = displayName.trim() || 'Runner';
      const normHandle = normalizeUsername(usernameInput);
      if (normHandle && normHandle !== (profile?.username || '')) {
        await claimUsername(user.uid, normHandle, nextName);
      }
      const resolved = resolveRunningCity(city, cityCoords.lat, cityCoords.lng);
      await updateUserProfile(user.uid, {
        displayName: nextName,
        preferredUnit: unit,
        preferredWorkout,
        city: resolved.name,
        cityLat: resolved.lat,
        cityLng: resolved.lng,
        preferredTerrain: terrain,
      });
      onSelectWorkout?.(preferredWorkout);
      onSelectCity(resolved);
      await refreshProfile();
      setPrefSavedMsg(
        `Preferences saved. Default sport: ${getWorkoutMeta(preferredWorkout).fullLabel} · City: ${resolved.name}.`
      );
    } catch (err) {
      setPrefErrorMsg(err instanceof Error ? err.message : 'Could not save preferences.');
    } finally {
      setSavingPref(false);
    }
  };

  const handleSaveSafety = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingSafety(true);
    setSafetyMsg(null);
    try {
      await saveSafetySettings(user.uid, {
        emergencyContactName: emergencyName.trim(),
        emergencyContactPhone: emergencyPhone.trim(),
        trustedShareEnabled: trustedShare,
        checkInIntervalMin: 30,
      });
      setSafetyMsg('Private safety settings saved.');
    } finally {
      setSavingSafety(false);
    }
  };

  const toggleBioTag = (tag: string) => {
    setBioSavedMsg(null);
    setBioErrorMsg(null);
    setBioTags((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (exists) {
        return prev.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      }
      if (prev.length >= MAX_BIO_TAGS) {
        setBioErrorMsg(`You can select up to ${MAX_BIO_TAGS} optional tags.`);
        return prev;
      }
      return sanitizeBioTags([...prev, tag]);
    });
  };

  const handleAddCustomBioTag = () => {
    const trimmed = customBioTagInput.trim().slice(0, MAX_BIO_TAG_LENGTH);
    if (!trimmed) return;
    setBioSavedMsg(null);
    setBioErrorMsg(null);
    if (bioTags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setCustomBioTagInput('');
      return;
    }
    if (bioTags.length >= MAX_BIO_TAGS) {
      setBioErrorMsg(`You can add up to ${MAX_BIO_TAGS} optional tags.`);
      return;
    }
    setBioTags((prev) => sanitizeBioTags([...prev, trimmed]));
    setCustomBioTagInput('');
  };

  const handleSaveBio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingBio(true);
    setBioSavedMsg(null);
    setBioErrorMsg(null);
    try {
      const cleanBio = bioInput.trim().slice(0, MAX_BIO_LENGTH);
      const cleanTags = sanitizeBioTags(bioTags);
      await updateUserProfile(user.uid, {
        bio: cleanBio,
        bioTags: cleanTags,
      });
      await refreshProfile();
      setBioInput(cleanBio);
      setBioTags(cleanTags);
      setBioSavedMsg('Bio and optional tags saved.');
    } catch (err) {
      setBioErrorMsg(err instanceof Error ? err.message : 'Could not save bio.');
    } finally {
      setSavingBio(false);
    }
  };

  const scrollToBioEditor = () => {
    bioSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => bioTextareaRef.current?.focus(), 250);
  };

  const customSelectedTags = bioTags.filter(
    (tag) => !OPTIONAL_BIO_TAGS.some((preset) => preset.toLowerCase() === tag.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Identity Header */}
      <div className="rounded-2xl border border-[#E5E3DC] bg-white p-5 sm:p-6">
        {!user ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-[#141F1B]">Runner Profile</h1>
              <p className="mt-1 text-sm text-[#5B6B64]">
                Sign in with Google or Email to store your running stats, challenges, and safety contacts securely.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAuth}
              className="min-h-[48px] shrink-0 rounded-xl bg-[#172D27] px-6 text-sm font-semibold text-[#9AE62E]"
            >
              Sign In / Register
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  {effectivePhotoUrl && !avatarLoadError ? (
                    <img
                      src={effectivePhotoUrl}
                      alt={profile?.displayName || 'Runner avatar'}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarLoadError(true)}
                      className="h-16 w-16 rounded-full object-cover border-2 border-[#172D27]"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#172D27] text-[#9AE62E]">
                      <User className="h-7 w-7" />
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                    aria-label="Upload profile photo"
                    title="Upload profile photo"
                    className="absolute -right-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#172D27] text-[#9AE62E] shadow hover:bg-[#30483E] disabled:opacity-60"
                  >
                    {uploadingPhoto ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/*"
                    onChange={handlePhotoFileChange}
                    className="hidden"
                  />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-display text-xl font-bold text-[#141F1B]">
                      {profile?.displayName || user.displayName || 'Runner'}
                    </h1>
                    {profile?.username && (
                      <button
                        type="button"
                        onClick={handleCopyUsername}
                        title="Copy @username"
                        className="inline-flex items-center gap-1 rounded-lg bg-[#EBF5EE] px-2 py-0.5 font-mono text-xs font-bold text-[#172D27] hover:bg-[#DCEFE2]"
                      >
                        <span>@{profile.username}</span>
                        {copiedUsername ? (
                          <Check className="h-3 w-3 text-[#30483E]" />
                        ) : (
                          <Copy className="h-3 w-3 text-[#5B6B64]" />
                        )}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[#5B6B64]">
                    {user.email} · {city} · {runs.length} activities · {getWorkoutMeta(preferredWorkout).fullLabel}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => photoInputRef.current?.click()}
                      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[#D9D7CE] bg-[#F6F5F0] px-2.5 text-[11px] font-semibold text-[#172D27] hover:bg-[#EBF5EE] disabled:opacity-50"
                    >
                      <Camera className="h-3 w-3" />
                      {uploadingPhoto
                        ? 'Saving photo...'
                        : effectivePhotoUrl
                        ? 'Change Photo'
                        : 'Upload Photo'}
                    </button>
                    {user.photoURL && effectivePhotoUrl !== user.photoURL && (
                      <button
                        type="button"
                        disabled={uploadingPhoto}
                        onClick={() => void handleUseGooglePhoto()}
                        className="inline-flex min-h-[32px] items-center rounded-lg border border-[#D9D7CE] bg-white px-2.5 text-[11px] font-semibold text-[#30483E] hover:bg-[#F6F5F0] disabled:opacity-50"
                      >
                        Use Google Photo
                      </button>
                    )}
                    {effectivePhotoUrl && (
                      <button
                        type="button"
                        disabled={uploadingPhoto}
                        onClick={() => void handleRemovePhoto()}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-[#D9D7CE] bg-white px-2.5 text-[11px] font-semibold text-[#5B6B64] hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={scrollToBioEditor}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-4 text-xs font-semibold text-[#172D27] hover:bg-[#EBF5EE]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit Bio
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] px-4 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>

            {photoError && <p className="text-xs font-semibold text-red-700">{photoError}</p>}
            {photoFeedback && <p className="text-xs font-semibold text-[#30483E]">{photoFeedback}</p>}
          </div>
        )}

        {/* Saved Bio & Optional Tags Summary directly under individual profile */}
        {user && (
          <div className="mt-4 border-t border-[#ECEAE2] pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#5B6B64]">
                <FileText className="h-3.5 w-3.5 text-[#172D27]" />
                Bio
              </span>
              {profile?.bioTags && profile.bioTags.length > 0 && (
                <span className="text-[11px] font-medium text-[#5B6B64]">
                  {profile.bioTags.length} {profile.bioTags.length === 1 ? 'tag' : 'tags'}
                </span>
              )}
            </div>

            {profile?.bio && profile.bio.trim() ? (
              <p className="mt-1.5 text-sm leading-relaxed text-[#141F1B]">{profile.bio}</p>
            ) : (
              <p className="mt-1.5 text-xs italic text-[#5B6B64]">
                No bio added yet. Add a short description and optional tags below so other runners know your pace and style.
              </p>
            )}

            {profile?.bioTags && profile.bioTags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {profile.bioTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md bg-[#EBF5EE] px-2.5 py-1 text-[11px] font-semibold text-[#172D27]"
                  >
                    <Tag className="h-3 w-3 text-[#30483E]" />
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {user && !user.emailVerified && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Your email is not yet verified. Verify your email address to enable cloud saves for routes and runs.
            </span>
            <button
              type="button"
              onClick={() => resendVerification()}
              className="shrink-0 font-semibold underline"
            >
              Resend Verification Email
            </button>
          </div>
        )}
      </div>

      {/* Bio Description & Optional Tags Editor */}
      <section
        ref={bioSectionRef}
        className="rounded-2xl border border-[#E5E3DC] bg-white p-5 sm:p-6"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#172D27]" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#141F1B]">Bio</h2>
              <p className="text-xs text-[#5B6B64]">
                Add a description under your profile and pick optional tags for your running style.
              </p>
            </div>
          </div>
          {user && (
            <span className="font-mono text-[11px] font-semibold text-[#5B6B64] tabular-nums">
              {bioTags.length}/{MAX_BIO_TAGS} optional tags
            </span>
          )}
        </div>

        {!user ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl bg-[#F6F5F0] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#5B6B64]">
              Sign in to write your runner bio and choose optional tags such as Morning Runner, Trail &amp; Parks, or Pace Buddy Wanted.
            </p>
            <button
              type="button"
              onClick={onOpenAuth}
              className="min-h-[40px] shrink-0 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
            >
              Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSaveBio} className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="runner-bio-textarea" className="text-xs font-semibold text-[#5B6B64]">
                  Description
                </label>
                <span className="font-mono text-[11px] text-[#5B6B64] tabular-nums">
                  {bioInput.length} / {MAX_BIO_LENGTH}
                </span>
              </div>
              <textarea
                id="runner-bio-textarea"
                ref={bioTextareaRef}
                rows={3}
                maxLength={MAX_BIO_LENGTH}
                value={bioInput}
                onChange={(e) => {
                  setBioInput(e.target.value);
                  setBioSavedMsg(null);
                  setBioErrorMsg(null);
                }}
                placeholder="e.g. Morning 5K–10K runner looking for easy conversational pace partners, weekend long runs, and new city loops."
                className="mt-1.5 w-full rounded-xl border border-[#D9D7CE] bg-[#F6F5F0]/50 px-3.5 py-2.5 text-sm text-[#141F1B] placeholder:text-[#8A9690] focus:border-[#172D27] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#5B6B64]">
                  Optional Tags <span className="font-normal">(tap to toggle up to {MAX_BIO_TAGS})</span>
                </span>
                {bioTags.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBioTags([]);
                      setBioSavedMsg(null);
                      setBioErrorMsg(null);
                    }}
                    className="text-[11px] font-semibold text-[#5B6B64] hover:text-[#141F1B] hover:underline"
                  >
                    Clear selected
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {OPTIONAL_BIO_TAGS.map((tag) => {
                  const selected = bioTags.some((t) => t.toLowerCase() === tag.toLowerCase());
                  const atLimit = !selected && bioTags.length >= MAX_BIO_TAGS;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleBioTag(tag)}
                      disabled={atLimit}
                      aria-pressed={selected}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        selected
                          ? 'border-[#172D27] bg-[#172D27] text-[#9AE62E]'
                          : 'border-[#D9D7CE] bg-[#F6F5F0] text-[#141F1B] hover:border-[#30483E] disabled:cursor-not-allowed disabled:opacity-45'
                      }`}
                    >
                      {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3 text-[#5B6B64]" />}
                      <span>{tag}</span>
                    </button>
                  );
                })}
              </div>

              {customSelectedTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] font-semibold text-[#5B6B64]">Custom:</span>
                  {customSelectedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#172D27] bg-[#172D27] px-2.5 py-1 text-xs font-semibold text-[#9AE62E]"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => toggleBioTag(tag)}
                        aria-label={`Remove tag ${tag}`}
                        className="rounded hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <input
                  type="text"
                  value={customBioTagInput}
                  maxLength={MAX_BIO_TAG_LENGTH}
                  onChange={(e) => setCustomBioTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomBioTag();
                    }
                  }}
                  placeholder="Add a custom optional tag (e.g. Dog Runner, Track Tuesdays)..."
                  className="min-h-[40px] flex-1 rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs text-[#141F1B] focus:border-[#172D27] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddCustomBioTag}
                  disabled={!customBioTagInput.trim() || bioTags.length >= MAX_BIO_TAGS}
                  className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-4 text-xs font-semibold text-[#141F1B] hover:bg-[#EBF5EE] disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Tag
                </button>
              </div>
            </div>

            {bioErrorMsg && <p className="text-xs font-semibold text-red-700">{bioErrorMsg}</p>}
            {bioSavedMsg && <p className="text-xs font-semibold text-[#30483E]">{bioSavedMsg}</p>}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={savingBio}
                className="min-h-[44px] rounded-xl bg-[#172D27] px-5 text-xs font-semibold text-[#9AE62E] disabled:opacity-50"
              >
                {savingBio ? 'Saving Bio...' : 'Save Bio'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Profile Privacy (Public vs Private) */}
      <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isPrivateProfile ? (
              <Lock className="h-5 w-5 text-[#172D27]" />
            ) : (
              <Globe className="h-5 w-5 text-[#172D27]" />
            )}
            <div>
              <h2 className="font-display text-lg font-bold text-[#141F1B]">
                Profile Privacy
              </h2>
              <p className="text-xs text-[#5B6B64]">
                Control who can see your daily workout posts and send you direct messages.
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold ${
              isPrivateProfile
                ? 'bg-amber-100 text-amber-900'
                : 'bg-[#EBF5EE] text-[#172D27]'
            }`}
          >
            {isPrivateProfile ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
            {isPrivateProfile ? 'Private Account' : 'Public Account'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={savingPrivacy}
            onClick={() => void handleTogglePrivacy(false)}
            className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition ${
              !isPrivateProfile
                ? 'border-[#172D27] bg-[#EBF5EE] ring-1 ring-[#172D27]'
                : 'border-[#E5E3DC] bg-[#F6F5F0] hover:border-[#D9D7CE]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#141F1B]">
                <Globe className="h-4 w-4 text-[#172D27]" />
                Public
              </span>
              {!isPrivateProfile && <CheckCircle2 className="h-4 w-4 text-[#172D27]" />}
            </div>
            <p className="text-xs text-[#5B6B64]">
              Anybody can see your workout posts and send you direct messages.
            </p>
          </button>

          <button
            type="button"
            disabled={savingPrivacy}
            onClick={() => void handleTogglePrivacy(true)}
            className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition ${
              isPrivateProfile
                ? 'border-[#172D27] bg-[#EBF5EE] ring-1 ring-[#172D27]'
                : 'border-[#E5E3DC] bg-[#F6F5F0] hover:border-[#D9D7CE]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#141F1B]">
                <Lock className="h-4 w-4 text-[#172D27]" />
                Private
              </span>
              {isPrivateProfile && <CheckCircle2 className="h-4 w-4 text-[#172D27]" />}
            </div>
            <p className="text-xs text-[#5B6B64]">
              Only accepted friends can see your posts and send you direct messages.
            </p>
          </button>
        </div>

        {privacyMsg && <p className="text-xs font-semibold text-[#30483E]">{privacyMsg}</p>}
      </section>

      {/* Running Shoes & Mileage Tracker */}
      <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Footprints className="h-5 w-5 text-[#172D27]" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#141F1B]">
                Running Shoes &amp; Mileage
              </h2>
              <p className="text-xs text-[#5B6B64]">
                Track how many km you&apos;ve logged on each pair. Your Primary shoe updates automatically after every run.
              </p>
            </div>
          </div>
          {user && (
            <button
              type="button"
              onClick={() => setShowAddShoe((v) => !v)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#172D27] px-3.5 text-xs font-semibold text-[#9AE62E] hover:bg-[#1F3C34]"
            >
              <Plus className="h-3.5 w-3.5" />
              {showAddShoe ? 'Cancel' : 'Add Shoe'}
            </button>
          )}
        </div>

        {!user ? (
          <div className="flex flex-col gap-3 rounded-xl bg-[#F6F5F0] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#5B6B64]">
              Sign in to list your running shoes and track their mileage automatically.
            </p>
            <button
              type="button"
              onClick={onOpenAuth}
              className="min-h-[40px] shrink-0 rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E]"
            >
              Sign In
            </button>
          </div>
        ) : (
          <>
            {showAddShoe && (
              <form
                onSubmit={handleAddShoe}
                className="rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] p-4 space-y-3"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-[#5B6B64]">Shoe Model *</label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={shoeName}
                      onChange={(e) => setShoeName(e.target.value)}
                      placeholder="e.g. Pegasus 41, Novablast 4"
                      className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs text-[#141F1B]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#5B6B64]">Brand (optional)</label>
                    <input
                      type="text"
                      maxLength={40}
                      value={shoeBrand}
                      onChange={(e) => setShoeBrand(e.target.value)}
                      placeholder="e.g. Nike, ASICS, Adidas"
                      className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-xs text-[#141F1B]"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-[#5B6B64]">Current Distance (km)</label>
                    <input
                      type="number"
                      min={0}
                      max={50000}
                      step="0.1"
                      value={shoeDistanceKm}
                      onChange={(e) => setShoeDistanceKm(e.target.value)}
                      className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 font-mono text-xs text-[#141F1B]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#5B6B64]">Target Retirement (km)</label>
                    <input
                      type="number"
                      min={100}
                      max={5000}
                      step="50"
                      value={shoeMaxKm}
                      onChange={(e) => setShoeMaxKm(e.target.value)}
                      className="mt-1 min-h-[40px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 font-mono text-xs text-[#141F1B]"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={savingShoes || !shoeName.trim()}
                  className="min-h-[40px] rounded-xl bg-[#172D27] px-4 text-xs font-semibold text-[#9AE62E] disabled:opacity-50"
                >
                  {savingShoes ? 'Saving...' : 'Save Running Shoe'}
                </button>
              </form>
            )}

            {shoes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#D9D7CE] bg-[#F6F5F0]/60 p-5 text-center text-xs text-[#5B6B64]">
                No running shoes added yet. Tap <strong>Add Shoe</strong> to log your daily trainers or race-day shoes.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {shoes.map((shoe) => {
                  const pct = Math.min(100, Math.round(((shoe.distanceKm || 0) / (shoe.maxKm || 600)) * 100));
                  const barColor =
                    pct >= 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-[#172D27]';
                  const isEditing = editingShoeId === shoe.id;

                  return (
                    <div
                      key={shoe.id}
                      className={`rounded-xl border p-4 space-y-3 ${
                        shoe.isPrimary
                          ? 'border-[#172D27] bg-[#EBF5EE]/50'
                          : 'border-[#E5E3DC] bg-[#F6F5F0]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-bold text-[#141F1B]">
                              {shoe.brand ? `${shoe.brand} ${shoe.name}` : shoe.name}
                            </p>
                            {shoe.isPrimary && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-[#172D27] px-1.5 py-0.5 text-[10px] font-bold text-[#9AE62E]">
                                <Star className="h-2.5 w-2.5 fill-current" />
                                Primary
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 font-mono text-xs font-bold text-[#172D27] tabular-nums">
                            {shoe.distanceKm.toFixed(1)} / {shoe.maxKm} km ({pct}%)
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={savingShoes}
                          onClick={() => void handleDeleteShoe(shoe.id)}
                          aria-label={`Remove ${shoe.name}`}
                          className="rounded-lg p-1.5 text-[#5B6B64] hover:bg-white hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E0D7]">
                        <div
                          className={`h-full transition-all ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={50000}
                            step="0.1"
                            value={editingShoeKm}
                            onChange={(e) => setEditingShoeKm(e.target.value)}
                            className="min-h-[32px] w-24 rounded-lg border border-[#D9D7CE] bg-white px-2 font-mono text-xs"
                          />
                          <button
                            type="button"
                            disabled={savingShoes}
                            onClick={() => void handleSaveEditedKm(shoe.id)}
                            className="rounded-lg bg-[#172D27] px-2.5 py-1 text-[11px] font-semibold text-[#9AE62E]"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingShoeId(null)}
                            className="rounded-lg border border-[#D9D7CE] bg-white px-2 py-1 text-[11px] font-semibold text-[#5B6B64]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={savingShoes}
                            onClick={() => void handleQuickAddKm(shoe.id, 5)}
                            className="rounded-lg border border-[#D9D7CE] bg-white px-2 py-1 font-mono text-[11px] font-semibold text-[#172D27] hover:bg-[#EBF5EE]"
                          >
                            +5 km
                          </button>
                          <button
                            type="button"
                            disabled={savingShoes}
                            onClick={() => {
                              setEditingShoeId(shoe.id);
                              setEditingShoeKm(String(shoe.distanceKm));
                            }}
                            className="rounded-lg border border-[#D9D7CE] bg-white px-2 py-1 text-[11px] font-semibold text-[#5B6B64] hover:text-[#141F1B]"
                          >
                            Edit km
                          </button>
                          {!shoe.isPrimary && (
                            <button
                              type="button"
                              disabled={savingShoes}
                              onClick={() => void handleSetPrimaryShoe(shoe.id)}
                              className="rounded-lg border border-[#D9D7CE] bg-white px-2 py-1 text-[11px] font-semibold text-[#172D27] hover:bg-[#EBF5EE]"
                            >
                              Set Primary
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {shoeMsg && <p className="text-xs font-semibold text-[#30483E]">{shoeMsg}</p>}
          </>
        )}
      </section>

      {/* Workout Category Ranks (Bronze I-III -> Legend 1000+ km) */}
      {(() => {
        const { overall, categories } = computeCategoryRanks(runs);
        return (
          <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Medal className="h-5 w-5 text-[#172D27]" />
                <div>
                  <h2 className="font-display text-lg font-bold text-[#141F1B]">
                    Athlete Ranks by Workout Category
                  </h2>
                  <p className="text-xs text-[#5B6B64]">
                    Bronze I–III · Silver · Gold · Platinum · Emerald · Diamond · Pro · Ultra · Legend (1,000+ km)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold ${overall.current.badgeClass}`}
                >
                  Overall: {overall.current.label}
                </span>
                <span className="font-mono text-xs font-bold text-[#172D27] tabular-nums">
                  {overall.totalKm} km
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((cat) => (
                <div
                  key={cat.workoutType}
                  className="rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#172D27] text-[#9AE62E]">
                        <WorkoutIcon type={cat.workoutType} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#141F1B]">{cat.label}</p>
                        <p className="text-[11px] text-[#5B6B64]">
                          {cat.sessions} {cat.sessions === 1 ? 'session' : 'sessions'} · {cat.rank.totalKm} km
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-bold ${cat.rank.current.badgeClass}`}
                    >
                      {cat.rank.current.label}
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E0D7]">
                    <div
                      className={`h-full transition-all ${cat.rank.current.barClass}`}
                      style={{ width: `${cat.rank.progressPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#5B6B64] font-mono tabular-nums">
                    {cat.rank.next ? (
                      <>
                        <span>{cat.rank.kmToNext} km to {cat.rank.next.label}</span>
                        <span>{cat.rank.progressPct}%</span>
                      </>
                    ) : (
                      <span className="font-bold text-[#172D27]">Max Rank Achieved · Legend</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Challenges & Achievements */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 lg:col-span-7">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[#172D27]" />
            <h2 className="font-display text-lg font-bold text-[#141F1B]">Personal Challenges</h2>
          </div>
          <div className="mt-4 space-y-3">
            {CHALLENGES.map((ch) => {
              const progress = ch.computeProgress(runs, artDesigns);
              const pct = Math.min(100, Math.round((progress / ch.target) * 100));
              const done = progress >= ch.target;
              return (
                <div key={ch.key} className="rounded-xl bg-[#F6F5F0] p-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-[#141F1B]">{ch.title}</p>
                      <p className="text-xs text-[#5B6B64]">{ch.description}</p>
                    </div>
                    <span className="font-mono text-xs font-bold text-[#172D27] tabular-nums">
                      {done ? 'Completed' : `${progress}/${ch.target} ${ch.unit}`}
                    </span>
                  </div>
                  <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#E2E0D7]">
                    <div
                      className={`h-full transition-all ${done ? 'bg-[#30483E]' : 'bg-[#172D27]'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 lg:col-span-5">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-[#172D27]" />
            <h2 className="font-display text-lg font-bold text-[#141F1B]">Achievements</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {ACHIEVEMENTS.map((ach) => {
              const unlocked = ach.unlocked(runs, artDesigns);
              return (
                <div
                  key={ach.key}
                  className={`rounded-xl border p-3.5 ${
                    unlocked
                      ? 'border-[#172D27] bg-[#172D27] text-white'
                      : 'border-[#E5E3DC] bg-[#F6F5F0] text-[#5B6B64]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{ach.title}</span>
                    {unlocked && <CheckCircle2 className="h-4 w-4 text-[#9AE62E]" />}
                  </div>
                  <p className={`mt-1 text-[11px] ${unlocked ? 'text-[#B8E8C7]' : 'text-[#5B6B64]'}`}>
                    {ach.subtitle}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Favorite Quotes */}
      <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-rose-500 fill-rose-500" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#141F1B]">
                Favorite Quotes
              </h2>
              <p className="text-xs text-[#5B6B64]">
                Quotes you hearted on the startup motivation screen
              </p>
            </div>
          </div>
          <span className="rounded-lg bg-[#EBF5EE] px-2.5 py-1 font-mono text-xs font-bold text-[#172D27]">
            {favoriteQuotes.length} saved
          </span>
        </div>

        {favoriteQuotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#D9D7CE] bg-[#F6F5F0]/60 p-5 text-center text-xs text-[#5B6B64]">
            No favorite quotes saved yet. Tap the heart icon on any quote when you open the app to save it here.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {favoriteQuotes.map((q) => (
              <div
                key={q.id}
                className="flex flex-col justify-between rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-4 space-y-3"
              >
                <p className="font-display text-sm font-bold leading-snug text-[#141F1B]">
                  &ldquo;{q.text}&rdquo;
                </p>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    {q.author ? (
                      <>
                        <p className="truncate text-xs font-bold text-[#172D27]">— {q.author}</p>
                        {q.role && (
                          <p className="truncate text-[10px] text-[#5B6B64]">{q.role}</p>
                        )}
                      </>
                    ) : (
                      q.subline && (
                        <p className="truncate font-mono text-[11px] font-semibold text-[#30483E]">
                          {q.subline}
                        </p>
                      )
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Remove quote from favorites"
                    title="Remove from favorites"
                    onClick={() => handleRemoveFavoriteQuote(q.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-rose-500 border border-[#E5E3DC] hover:bg-rose-50"
                  >
                    <Heart className="h-4 w-4 fill-current" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Appearance & UI Theme Settings */}
      <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[#172D27]" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#141F1B]">
                Appearance &amp; UI Theme
              </h2>
              <p className="text-xs text-[#5B6B64]">
                Switch between Light, Dark, and custom color themes anytime.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#EBF5EE] px-2.5 py-1 text-[11px] font-bold text-[#172D27]">
            {APP_THEMES.find((t) => t.id === activeTheme)?.mode === 'dark' ? (
              <Moon className="h-3.5 w-3.5" />
            ) : (
              <Sun className="h-3.5 w-3.5" />
            )}
            {APP_THEMES.find((t) => t.id === activeTheme)?.name || 'Open Forest'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {APP_THEMES.map((theme) => {
            const isSelected = activeTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onSelectTheme?.(theme.id)}
                className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
                  isSelected
                    ? 'border-[#172D27] bg-[#EBF5EE] ring-1 ring-[#172D27]'
                    : 'border-[#E5E3DC] bg-[#F6F5F0] hover:border-[#D9D7CE]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-5 w-5 rounded-full border border-black/15"
                      style={{ backgroundColor: theme.swatches.canvas }}
                    />
                    <span
                      className="h-5 w-5 rounded-full border border-black/15"
                      style={{ backgroundColor: theme.swatches.brand }}
                    />
                    <span
                      className="h-5 w-5 rounded-full border border-black/15"
                      style={{ backgroundColor: theme.swatches.accent }}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-[#5B6B64]">
                      {theme.mode}
                    </span>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-[#172D27]" />}
                  </div>
                </div>
                <div className="mt-2.5">
                  <p className="text-sm font-bold text-[#141F1B]">{theme.name}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[#5B6B64]">
                    {theme.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Preferences & Privacy / Safety */}
      {!user ? (
        <section className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-[#172D27]" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#141F1B]">
                Activity Preferences · Sport &amp; City
              </h2>
              <p className="text-xs text-[#5B6B64]">
                Choose your default workout mode (run, cycle, walk, hike, trail) and a single city worldwide.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#5B6B64]">
              Default Workout Mode
            </label>
            <WorkoutSelector
              value={preferredWorkout}
              onChange={(next) => {
                setPreferredWorkout(next);
                onSelectWorkout?.(next);
                setGuestCityMsg(
                  `Default workout mode set to ${getWorkoutMeta(next).fullLabel}.`
                );
                window.setTimeout(() => setGuestCityMsg(null), 3500);
              }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Popular World Cities</label>
              <select
                value={findWorldCityPreset(city)?.name || '__custom__'}
                onChange={(e) => {
                  const preset = WORLD_RUNNING_CITIES.find((c) => c.name === e.target.value);
                  if (preset) {
                    applySelectedCity(preset.name, preset.lat, preset.lng, preset.country);
                  }
                }}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-sm"
              >
                {!findWorldCityPreset(city) && (
                  <option value="__custom__">{city} (Custom Search)</option>
                )}
                {WORLD_RUNNING_CITIES.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}, {c.country}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">
                Or Search Any City Worldwide
              </label>
              <div className="mt-1">
                <PlaceSearchInput
                  mode="city"
                  value={city}
                  placeholder="Type any city (e.g. Austin, Kyoto, Vienna)..."
                  onSelect={(loc) => applySelectedCity(loc.city || loc.name, loc.lat, loc.lng)}
                />
              </div>
            </div>
          </div>

          <WorldCityMapPicker
            selectedCity={{ name: city, lat: cityCoords.lat, lng: cityCoords.lng }}
            onPickCity={(picked) =>
              applySelectedCity(picked.name, picked.lat, picked.lng, picked.country)
            }
            heightClass="h-[260px] sm:h-[300px]"
          />

          <div className="rounded-xl bg-[#F6F5F0] px-3.5 py-2.5 text-xs text-[#30483E]">
            Active Running City: <strong className="text-[#172D27]">{city}</strong>{' '}
            <span className="font-mono text-[11px] text-[#5B6B64]">
              ({cityCoords.lat.toFixed(3)}, {cityCoords.lng.toFixed(3)})
            </span>
            <span className="block mt-0.5 text-[11px] text-[#5B6B64]">
              All routes, Run Art shapes, and map measurements stay strictly inside {city}.
            </span>
          </div>

          {guestCityMsg && <p className="text-xs font-semibold text-[#30483E]">{guestCityMsg}</p>}
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleSavePreferences}
            className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4"
          >
            <h2 className="font-display text-lg font-bold text-[#141F1B]">Running Preferences</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">
                  Unique Username (for friends to find you)
                </label>
                <div className="mt-1 flex min-h-[44px] items-center rounded-xl border border-[#D9D7CE] bg-white px-3 focus-within:border-[#172D27]">
                  <AtSign className="mr-1.5 h-4 w-4 shrink-0 text-[#5B6B64]" />
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) =>
                      setUsernameInput(
                        e.target.value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '')
                      )
                    }
                    placeholder="your_handle"
                    maxLength={24}
                    className="w-full bg-transparent font-mono text-sm text-[#141F1B] focus:outline-none"
                  />
                </div>
                {usernameStatus.state !== 'idle' && usernameStatus.message && (
                  <p
                    className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${
                      usernameStatus.state === 'available' || usernameStatus.state === 'own'
                        ? 'text-[#30483E]'
                        : usernameStatus.state === 'checking'
                        ? 'text-[#5B6B64]'
                        : 'text-red-700'
                    }`}
                  >
                    {(usernameStatus.state === 'taken' || usernameStatus.state === 'invalid') && (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {(usernameStatus.state === 'available' || usernameStatus.state === 'own') && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {usernameStatus.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Distance Units</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as 'km' | 'mi')}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
                >
                  <option value="km">Kilometres (km)</option>
                  <option value="mi">Miles (mi)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">
                  Running City (Preset or Search Any City)
                </label>
                <select
                  value={findWorldCityPreset(city)?.name || '__custom__'}
                  onChange={(e) => {
                    const preset = WORLD_RUNNING_CITIES.find((c) => c.name === e.target.value);
                    if (preset) {
                      applySelectedCity(preset.name, preset.lat, preset.lng, preset.country);
                    }
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] bg-white px-3 text-sm"
                >
                  {!findWorldCityPreset(city) && (
                    <option value="__custom__">{city} (Custom Search)</option>
                  )}
                  {WORLD_RUNNING_CITIES.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}, {c.country}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">
                Search Any Single City Worldwide
              </label>
              <div className="mt-1">
                <PlaceSearchInput
                  mode="city"
                  value={city}
                  placeholder="Type any city in the world (e.g. Paris, Austin, Tokyo)..."
                  onSelect={(loc) => applySelectedCity(loc.city || loc.name, loc.lat, loc.lng)}
                />
              </div>
              <p className="mt-1 text-[11px] text-[#5B6B64]">
                Selected city: <strong className="text-[#172D27]">{city}</strong> (
                {cityCoords.lat.toFixed(3)}, {cityCoords.lng.toFixed(3)}) · Routes stay inside {city}.
              </p>
              {profile?.city && city !== profile.city && (
                <p className="mt-1 text-[11px] font-semibold text-amber-800">
                  Unsaved city change — click Save Preferences below to apply {city}.
                </p>
              )}
            </div>

            <WorldCityMapPicker
              selectedCity={{ name: city, lat: cityCoords.lat, lng: cityCoords.lng }}
              onPickCity={(picked) =>
                applySelectedCity(picked.name, picked.lat, picked.lng, picked.country)
              }
              heightClass="h-[250px] sm:h-[280px]"
            />

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#5B6B64]">
                Default Workout Mode
              </label>
              <WorkoutSelector
                value={preferredWorkout}
                onChange={(next) => {
                  setPreferredWorkout(next);
                  onSelectWorkout?.(next);
                  setPrefSavedMsg(null);
                  setPrefErrorMsg(null);
                }}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Preferred Terrain</label>
              <input
                type="text"
                value={terrain}
                onChange={(e) => setTerrain(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>

            {prefErrorMsg && <p className="text-xs font-semibold text-red-700">{prefErrorMsg}</p>}
            {prefSavedMsg && <p className="text-xs font-semibold text-[#30483E]">{prefSavedMsg}</p>}
            <button
              type="submit"
              disabled={
                savingPref ||
                usernameStatus.state === 'taken' ||
                usernameStatus.state === 'invalid' ||
                usernameStatus.state === 'checking'
              }
              className="min-h-[44px] rounded-xl bg-[#172D27] px-5 text-xs font-semibold text-[#9AE62E] disabled:opacity-50"
            >
              {savingPref ? 'Saving...' : 'Save Preferences'}
            </button>
          </form>

          <form
            onSubmit={handleSaveSafety}
            className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[#172D27]" />
              <h2 className="font-display text-lg font-bold text-[#141F1B]">Privacy & Safety</h2>
            </div>
            <p className="text-xs leading-relaxed text-[#5B6B64]">
              Your runs and saved routes stay private by default. Location is requested only when you tap GPS or start a live run. No automated safety guarantee is implied—always check local lighting and traffic.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Emergency Contact</label>
                <input
                  type="text"
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                  placeholder="Contact name"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5B6B64]">Phone Number</label>
                <input
                  type="tel"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  placeholder="+91 ..."
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-[#141F1B]">
              <input
                type="checkbox"
                checked={trustedShare}
                onChange={(e) => setTrustedShare(e.target.checked)}
                className="h-4 w-4 accent-[#172D27]"
              />
              Enable share prompt for trusted contact before long runs
            </label>

            {safetyMsg && <p className="text-xs font-semibold text-[#30483E]">{safetyMsg}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="submit"
                disabled={savingSafety}
                className="min-h-[44px] rounded-xl bg-[#172D27] px-5 text-xs font-semibold text-[#9AE62E]"
              >
                {savingSafety ? 'Saving...' : 'Save Safety Settings'}
              </button>

              {!confirmDeleteAccount ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAccount(true)}
                  className="text-xs font-semibold text-red-700 hover:underline"
                >
                  Delete Account
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => deleteAccount()}
                  className="min-h-[40px] rounded-xl bg-red-600 px-3 text-xs font-semibold text-white"
                >
                  Confirm Permanent Deletion
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
