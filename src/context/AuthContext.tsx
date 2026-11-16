import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, testFirestoreConnection } from '../lib/firebase';
import {
  ensureUserProfile,
  subscribeRunArtDesigns,
  subscribeSavedRoutes,
  subscribeUserRuns,
} from '../services/firestoreService';
import type { RunActivityDoc, RunArtDesignDoc, SavedRouteDoc, UserProfileDoc } from '../types/run';

interface AuthContextValue {
  user: User | null;
  profile: UserProfileDoc | null;
  runs: RunActivityDoc[];
  savedRoutes: SavedRouteDoc[];
  artDesigns: RunArtDesignDoc[];
  loading: boolean;
  firebaseConnected: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileDoc | null>(null);
  const [runs, setRuns] = useState<RunActivityDoc[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteDoc[]>([]);
  const [artDesigns, setArtDesigns] = useState<RunArtDesignDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [firebaseConnected, setFirebaseConnected] = useState(true);

  useEffect(() => {
    testFirestoreConnection().then(setFirebaseConnected);

    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        try {
          const prof = await ensureUserProfile(
            nextUser.uid,
            nextUser.displayName || nextUser.email?.split('@')[0] || 'Open Runner',
            nextUser.photoURL
          );
          setProfile(prof);
        } catch {
          // Keep profile null if Firestore unavailable
        }
      } else {
        setProfile(null);
        setRuns([]);
        setSavedRoutes([]);
        setArtDesigns([]);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubRuns = subscribeUserRuns(user.uid, setRuns);
    const unsubRoutes = subscribeSavedRoutes(user.uid, setSavedRoutes);
    const unsubArt = subscribeRunArtDesigns(user.uid, setArtDesigns);
    return () => {
      unsubRuns();
      unsubRoutes();
      unsubArt();
    };
  }, [user]);

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const registerWithEmail = async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await sendEmailVerification(cred.user);
    await ensureUserProfile(cred.user.uid, name, null);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const resendVerification = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const deleteAccount = async () => {
    if (auth.currentUser) {
      await deleteUser(auth.currentUser);
    }
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    const prof = await ensureUserProfile(
      auth.currentUser.uid,
      auth.currentUser.displayName || 'Open Runner',
      auth.currentUser.photoURL
    );
    setProfile(prof);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        runs,
        savedRoutes,
        artDesigns,
        loading,
        firebaseConnected,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        resetPassword,
        resendVerification,
        logout,
        deleteAccount,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
