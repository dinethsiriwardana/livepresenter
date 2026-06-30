"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Users, ArrowRight, Sparkles } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import Link from "next/link";

export default function JoinPage() {
  const { loginAnonymously } = useAuth();
  const router = useRouter();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formattedCode = code.trim().toUpperCase();
    if (!formattedCode || formattedCode.length !== 6) {
      setError("Please enter a valid 6-character room code.");
      setLoading(false);
      return;
    }

    if (!name.trim()) {
      setError("Please enter your display name.");
      setLoading(false);
      return;
    }

    try {
      // 1. Verify if room exists and is active in Firestore
      const sessionRef = doc(db, "sessions", formattedCode);
      const sessionDoc = await getDoc(sessionRef);

      if (!sessionDoc.exists()) {
        throw new Error("This room does not exist. Please check the code.");
      }

      const sessionData = sessionDoc.data();
      if (!sessionData.isActive) {
        throw new Error("This session is no longer active.");
      }

      // 2. Perform anonymous auth and set displayName
      await loginAnonymously(name.trim());

      // 3. Save name in sessionStorage for simple local identification
      sessionStorage.setItem("participantName", name.trim());

      // 4. Redirect to the live session
      router.push(`/live/${formattedCode}`);
    } catch (err: any) {
      setError(err.message || "Could not join the session.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-4 relative overflow-hidden bg-slate-950">
      {/* Dynamic Background Design Elements */}
      <div className="absolute top-[-30%] right-[-10%] w-[70%] h-[70%] rounded-full bg-violet-600/10 blur-[130px]" />
      <div className="absolute bottom-[-30%] left-[-10%] w-[70%] h-[70%] rounded-full bg-emerald-500/5 blur-[130px]" />

      <div className="w-full max-w-md z-10">
        {/* Brand Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-gradient-to-tr from-emerald-500 to-indigo-600 rounded-2xl shadow-lg shadow-emerald-500/15 mb-3">
            <Users className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-emerald-100 to-indigo-300 bg-clip-text text-transparent">
            Join Live Presentation
          </h1>
          <p className="text-sm text-slate-400 mt-1">Interact with polls, Q&A, and games</p>
        </div>

        {/* Join Card */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-black/40">
          {error && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Session Code
              </label>
              <input
                type="text"
                maxLength={6}
                required
                placeholder="e.g. A1B2C3"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-emerald-500 rounded-xl py-4 text-center font-bold text-2xl tracking-widest text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-slate-700 placeholder:text-base placeholder:tracking-normal"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Your Display Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-emerald-500 rounded-xl py-3 px-4 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-slate-600"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-500 to-indigo-600 hover:from-emerald-600 hover:to-indigo-700 text-white rounded-xl py-3.5 font-semibold text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Join Room
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Presenter Mode Link */}
        <div className="mt-8 text-center text-sm text-slate-500">
          Are you the presenter?{" "}
          <Link href="/login" className="text-indigo-400 font-semibold hover:underline flex items-center justify-center gap-1 mt-1">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            Go to Host Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
