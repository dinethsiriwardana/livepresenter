"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { 
  Users, 
  HelpCircle, 
  BarChart2, 
  CheckCircle, 
  Send,
  Loader2,
  Heart,
  Flame,
  Laugh,
  AlertCircle
} from "lucide-react";
import { 
  doc, 
  collection, 
  onSnapshot, 
  addDoc, 
  query, 
  where, 
  getDocs,
  updateDoc,
  increment
} from "firebase/firestore";
import { ref as dbRef, push } from "firebase/database";
import { db, rtdb } from "@/lib/firebaseClient";

interface Session {
  id: string; // joinCode
  presentationId: string;
  presenterId: string;
  isActive: boolean;
  currentSlide: number;
  activeInteractionId: string | null;
  participantCount: number;
}

interface Interaction {
  id: string;
  type: string;
  question: string;
  config: any;
}

export default function AudienceLivePage() {
  const { joinCode } = useParams() as { joinCode: string };
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<Interaction | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Input states
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [textVal, setTextVal] = useState("");
  const [ratingVal, setRatingVal] = useState(0);

  // Check anonymous participant state
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push(`/join?code=${joinCode}`);
    }
  }, [user, authLoading, router, joinCode]);

  // Load Session and increment participant count on mount
  useEffect(() => {
    if (!joinCode || !user) return;

    const sessionRef = doc(db, "sessions", joinCode);
    const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
      if (!docSnap.exists()) {
        router.push("/join");
        return;
      }
      
      const sessionData = { id: docSnap.id, ...docSnap.data() } as Session;
      setSession(sessionData);
      setLoading(false);
    });

    // Simple increment participant count once
    updateDoc(sessionRef, { participantCount: increment(1) }).catch(err => {
      console.warn("Could not increment participantCount:", err);
    });

    return () => {
      unsubscribe();
      // Decrement on unmount
      updateDoc(sessionRef, { participantCount: increment(-1) }).catch(() => {});
    };
  }, [joinCode, user, router]);

  // Listen to active interaction
  useEffect(() => {
    if (!session || !session.activeInteractionId) {
      setActiveInteraction(null);
      setHasSubmitted(false);
      setSelectedChoice(null);
      setTextVal("");
      setRatingVal(0);
      return;
    }

    const slideId = session.currentSlide.toString();
    const interactionRef = doc(
      db, 
      "presentations", 
      session.presentationId, 
      "slides", 
      slideId, 
      "interactions", 
      session.activeInteractionId
    );

    const unsubInteract = onSnapshot(interactionRef, async (docSnap) => {
      if (docSnap.exists()) {
        const interactData = { id: docSnap.id, ...docSnap.data() } as Interaction;
        setActiveInteraction(interactData);

        // Check if user already submitted a response
        if (user) {
          const q = query(
            collection(db, "sessions", joinCode, "responses"),
            where("interactionId", "==", session.activeInteractionId),
            where("participantToken", "==", user.uid)
          );
          const snap = await getDocs(q);
          setHasSubmitted(!snap.empty);
        }
      } else {
        setActiveInteraction(null);
      }
    });

    return () => unsubInteract();
  }, [session?.activeInteractionId, session?.currentSlide, session?.presentationId, joinCode, user]);

  const handleSubmitResponse = async (value: any) => {
    if (!session || !activeInteraction || !user) return;
    setSubmitting(true);

    try {
      const responsesRef = collection(db, "sessions", joinCode, "responses");
      const participantName = sessionStorage.getItem("participantName") || "Anonymous";

      let isCorrect = null;
      if (activeInteraction.type === "quiz") {
        isCorrect = value === activeInteraction.config.correctOptionIndex;
      }

      await addDoc(responsesRef, {
        interactionId: activeInteraction.id,
        participantToken: user.uid,
        participantName,
        value,
        isCorrect,
        submittedAt: new Date(),
      });

      setHasSubmitted(true);
    } catch (err) {
      console.error("Error submitting response:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Flying reactions RTDB trigger
  const handleSendReaction = (type: string) => {
    if (!joinCode) return;
    try {
      const reactionsRef = dbRef(rtdb, `sessions/${joinCode}/reactions`);
      push(reactionsRef, {
        type,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Error pushing reaction:", err);
    }
  };

  if (authLoading || loading || !session) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 min-h-screen relative overflow-hidden justify-between">
      
      {/* Session Top Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">
            Audience Live View
          </span>
          <span className="text-sm font-bold text-slate-200">
            Room Code: <span className="text-indigo-400 font-extrabold">{joinCode}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full text-xs font-bold text-slate-350">
          <Users className="h-3.5 w-3.5 text-indigo-400" />
          {session.participantCount} users
        </div>
      </header>

      {/* Main interaction screen */}
      <main className="flex-1 max-w-md w-full mx-auto px-6 py-8 flex flex-col justify-center">
        {!activeInteraction ? (
          /* Waiting Screen (No active questions) */
          <div className="text-center py-12 px-6 bg-slate-900/40 backdrop-blur-sm border border-slate-850 rounded-3xl space-y-4">
            <div className="p-4 bg-slate-950 border border-slate-900 rounded-2xl w-fit mx-auto text-indigo-500 animate-pulse">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
            <h3 className="text-lg font-bold text-slate-250">Eyes on the big screen!</h3>
            <p className="text-sm text-slate-500">
              The presenter has no active questions right now. We will notify you here as soon as they trigger one.
            </p>
          </div>
        ) : hasSubmitted ? (
          /* Submitted response state */
          <div className="text-center py-12 px-6 bg-slate-900/40 backdrop-blur-sm border border-slate-850 rounded-3xl space-y-4">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl w-fit mx-auto text-emerald-400">
              <CheckCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-200">Response Submitted!</h3>
            <p className="text-sm text-slate-500">
              Your answer has been registered on the projector. Waiting for the presenter to show results or move slides.
            </p>
          </div>
        ) : (
          /* Interactive Questions Panel */
          <div className="bg-slate-900/70 border border-slate-850 rounded-3xl p-6 shadow-xl space-y-6">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-indigo-400 mb-2 font-bold uppercase tracking-wider">
                {activeInteraction.type === "poll" && <BarChart2 className="h-4 w-4" />}
                {activeInteraction.type === "quiz" && <HelpCircle className="h-4 w-4" />}
                {activeInteraction.type === "opentext" && <Send className="h-4 w-4" />}
                <span>Active {activeInteraction.type}</span>
              </div>
              <h2 className="text-lg font-bold text-slate-100">{activeInteraction.question}</h2>
            </div>

            {/* Dynamic Options Input Fields */}
            <div className="space-y-3">
              
              {/* 1. Poll / Quiz choice selections */}
              {(activeInteraction.type === "poll" || activeInteraction.type === "quiz") && (
                <div className="space-y-2.5">
                  {activeInteraction.config.options?.map((option: string, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedChoice(idx)}
                      disabled={submitting}
                      className={`w-full text-left p-4 rounded-2xl border text-sm font-semibold transition-all hover:bg-slate-850/60 ${
                        selectedChoice === idx
                          ? "bg-indigo-500/10 border-indigo-500 text-indigo-300"
                          : "bg-slate-950/40 border-slate-850 text-slate-350"
                      }`}
                    >
                      {option}
                    </button>
                  ))}

                  <button
                    onClick={() => selectedChoice !== null && handleSubmitResponse(selectedChoice)}
                    disabled={selectedChoice === null || submitting}
                    className="w-full mt-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white rounded-xl py-3.5 font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit Answer"}
                  </button>
                </div>
              )}

              {/* 2. Word Cloud / Open Text submissions */}
              {(activeInteraction.type === "wordcloud" || activeInteraction.type === "opentext") && (
                <div className="space-y-4">
                  {activeInteraction.type === "wordcloud" ? (
                    <input
                      type="text"
                      maxLength={20}
                      placeholder="Enter 1-2 words..."
                      value={textVal}
                      onChange={(e) => setTextVal(e.target.value)}
                      disabled={submitting}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-3 px-4 text-slate-200 text-sm focus:outline-none"
                    />
                  ) : (
                    <textarea
                      placeholder="Write your sticky note response here..."
                      rows={4}
                      value={textVal}
                      onChange={(e) => setTextVal(e.target.value)}
                      disabled={submitting}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-3 px-4 text-slate-200 text-sm focus:outline-none"
                    />
                  )}

                  <button
                    onClick={() => textVal.trim() && handleSubmitResponse(textVal.trim())}
                    disabled={!textVal.trim() || submitting}
                    className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl py-3.5 font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit Response"}
                  </button>
                </div>
              )}

              {/* 3. Star rating scales */}
              {activeInteraction.type === "rating" && (
                <div className="space-y-6 text-center">
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setRatingVal(val)}
                        disabled={submitting}
                        className="text-4xl text-slate-700 hover:scale-110 active:scale-100 transition-all focus:outline-none"
                      >
                        <span className={val <= ratingVal ? "text-yellow-450 fill-yellow-405" : ""}>
                          ★
                        </span>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => ratingVal > 0 && handleSubmitResponse(ratingVal)}
                    disabled={ratingVal === 0 || submitting}
                    className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl py-3.5 font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit Stars"}
                  </button>
                </div>
              )}

            </div>
          </div>
        )}
      </main>

      {/* Floating ephemeral reactions tray */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-4 flex justify-around items-center sticky bottom-0 z-30">
        <button
          onClick={() => handleSendReaction("heart")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110"
        >
          ❤️
        </button>
        <button
          onClick={() => handleSendReaction("clap")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110"
        >
          👏
        </button>
        <button
          onClick={() => handleSendReaction("fire")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110"
        >
          🔥
        </button>
        <button
          onClick={() => handleSendReaction("laugh")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110"
        >
          😂
        </button>
        <button
          onClick={() => handleSendReaction("shock")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110"
        >
          😮
        </button>
      </footer>

    </div>
  );
}
