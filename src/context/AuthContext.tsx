"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  updateProfile,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, db } from "@/lib/firebaseClient";
import { doc, setDoc, getDoc } from "firebase/firestore";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  loginWithGoogle: () => Promise<User>;
  loginWithEmail: (email: string, pass: string) => Promise<User>;
  registerWithEmail: (email: string, pass: string, name: string) => Promise<User>;
  loginAnonymously: (displayName: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          document.cookie = `session-token=${token}; path=/; max-age=86400; SameSite=Lax; Secure`;
        } catch (err) {
          console.error("Error setting session cookie:", err);
        }
      } else {
        document.cookie = "session-token=; path=/; max-age=0; SameSite=Lax; Secure";
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    
    // Provision user document in firestore
    const userDocRef = doc(db, "users", result.user.uid);
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
      await setDoc(userDocRef, {
        email: result.user.email,
        role: "presenter",
        createdAt: new Date(),
      });
    }

    return result.user;
  };

  const loginWithEmail = async (email: string, pass: string) => {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    return result.user;
  };

  const registerWithEmail = async (email: string, pass: string, name: string) => {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(result.user, { displayName: name });
    
    // Provision user document in firestore
    await setDoc(doc(db, "users", result.user.uid), {
      email,
      role: "presenter",
      createdAt: new Date(),
    });

    return result.user;
  };

  const loginAnonymously = async (displayName: string) => {
    const result = await signInAnonymously(auth);
    await updateProfile(result.user, { displayName });
    
    // Provision anonymous user in session storage or responses context
    return result.user;
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        loginWithGoogle,
        loginWithEmail,
        registerWithEmail,
        loginAnonymously,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
