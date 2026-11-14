import React, { useEffect, useState } from 'react';
import { Award, CheckCircle2, LogOut, Shield, Trophy, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ACHIEVEMENTS, CHALLENGES } from '../services/challengesService';
import {
  getSafetySettings,
  saveSafetySettings,
  updateUserProfile,
} from '../services/firestoreService';
import type { CityName } from '../types/run';

interface ProfileViewProps {
  onOpenAuth: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ onOpenAuth }) => {
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
  const [unit, setUnit] = useState<'km' | 'mi'>(profile?.preferredUnit || 'km');
  const [city, setCity] = useState<CityName>(profile?.city || 'Chandigarh');
  const [terrain, setTerrain] = useState(profile?.preferredTerrain || 'Parks & Paved Paths');
  const [savingPref, setSavingPref] = useState(false);
  const [prefSavedMsg, setPrefSavedMsg] = useState<string | null>(null);

  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [trustedShare, setTrustedShare] = useState(false);
  const [savingSafety, setSavingSafety] = useState(false);
  const [safetyMsg, setSafetyMsg] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setUnit(profile.preferredUnit);
      setCity(profile.city || 'Chandigarh');
      setTerrain(profile.preferredTerrain || 'Parks & Paved Paths');
    }
  }, [profile]);

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

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingPref(true);
    setPrefSavedMsg(null);
    try {
      await updateUserProfile(user.uid, {
        displayName: displayName.trim() || 'Tricity Runner',
        preferredUnit: unit,
        city,
        preferredTerrain: terrain,
      });
      await refreshProfile();
      setPrefSavedMsg('Preferences updated.');
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={profile?.displayName || 'Runner avatar'}
                  referrerPolicy="no-referrer"
                  className="h-14 w-14 rounded-full object-cover border border-[#E5E3DC]"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#172D27] text-[#9AE62E]">
                  <User className="h-6 w-6" />
                </div>
              )}
              <div>
                <h1 className="font-display text-xl font-bold text-[#141F1B]">
                  {profile?.displayName || user.displayName || 'Tricity Runner'}
                </h1>
                <p className="text-xs text-[#5B6B64]">
                  {user.email} · {city} · {runs.length} runs logged
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] px-4 text-xs font-semibold text-[#141F1B] hover:bg-[#F6F5F0]"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
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

      {/* Preferences & Privacy / Safety */}
      {user && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleSavePreferences}
            className="rounded-2xl border border-[#E5E3DC] bg-white p-5 space-y-4"
          >
            <h2 className="font-display text-lg font-bold text-[#141F1B]">Running Preferences</h2>
            <div>
              <label className="text-xs font-semibold text-[#5B6B64]">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
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
                <label className="text-xs font-semibold text-[#5B6B64]">Running City</label>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value as CityName)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3 text-sm"
                >
                  <option value="Chandigarh">Chandigarh</option>
                </select>
              </div>
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

            {prefSavedMsg && <p className="text-xs font-semibold text-[#30483E]">{prefSavedMsg}</p>}
            <button
              type="submit"
              disabled={savingPref}
              className="min-h-[44px] rounded-xl bg-[#172D27] px-5 text-xs font-semibold text-[#9AE62E]"
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
