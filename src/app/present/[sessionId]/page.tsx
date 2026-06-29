"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight, 
  Play, 
  Square, 
  Users, 
  BarChart2, 
  Award, 
  FileText,
  Trash2,
  Loader2,
  HelpCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { 
  doc, 
  collection, 
  onSnapshot, 
  updateDoc, 
  getDoc,
  getDocs
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";

interface Session {
  id: string; // joinCode
  presentationId: string;
  presenterId: string;
  isActive: boolean;
  currentSlide: number;
  activeInteractionId: string | null;
  participantCount: number;
  quizState?: {
    activeQuestionId: string | null;
    timerEndsAt: any;
    showLeaderboard: boolean;
  };
}

interface Slide {
  id: string;
  imageUrl: string;
  thumbnailUrl: string;
  notes: string;
  isInteractive?: boolean;
  interactionType?: string;
}

interface Interaction {
  id: string;
  type: string;
  question: string;
  config: any;
}

export default function PresenterRemotePage() {
  const { sessionId } = useParams() as { sessionId: string };
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Load Session details
  useEffect(() => {
    if (!sessionId) return;

    const sessionRef = doc(db, "sessions", sessionId);
    const unsubscribe = onSnapshot(sessionRef, async (docSnap) => {
      if (!docSnap.exists()) {
        router.push("/dashboard");
        return;
      }
      
      const sessionData = { id: docSnap.id, ...docSnap.data() } as Session;
      setSession(sessionData);

      // Load slides if not loaded yet
      if (slides.length === 0) {
        const slidesRef = collection(db, "presentations", sessionData.presentationId, "slides");
        const snap = await getDocs(slidesRef);
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Slide[];
        list.sort((a, b) => parseInt(a.id) - parseInt(b.id));
        setSlides(list);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [sessionId, router, slides.length]);

  // Load Interactions for current slide
  useEffect(() => {
    if (!session || !session.presentationId || !session.currentSlide) return;

    const slideId = session.currentSlide.toString();
    const interactionsRef = collection(
      db, 
      "presentations", 
      session.presentationId, 
      "slides", 
      slideId, 
      "interactions"
    );

    const unsubscribe = onSnapshot(interactionsRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Interaction[];
      setInteractions(list);
    });

    return () => unsubscribe();
  }, [session?.presentationId, session?.currentSlide]);

  const updateSession = async (fields: Partial<Session>) => {
    if (!sessionId) return;
    try {
      const sessionRef = doc(db, "sessions", sessionId);
      await updateDoc(sessionRef, fields);
    } catch (err) {
      console.error("Error updating session:", err);
    }
  };

  const handleNextSlide = () => {
    if (!session || session.currentSlide >= slides.length) return;
    const targetIdx = session.currentSlide; // 0-indexed next index
    const nextSlide = slides[targetIdx];
    const autoInteractId = (nextSlide && nextSlide.isInteractive) ? "primary" : null;
    updateSession({ 
      currentSlide: session.currentSlide + 1,
      activeInteractionId: autoInteractId
    });
  };

  const handlePrevSlide = () => {
    if (!session || session.currentSlide <= 1) return;
    const targetIdx = session.currentSlide - 2; // 0-indexed prev index
    const prevSlide = slides[targetIdx];
    const autoInteractId = (prevSlide && prevSlide.isInteractive) ? "primary" : null;
    updateSession({ 
      currentSlide: session.currentSlide - 1,
      activeInteractionId: autoInteractId
    });
  };

  const handleToggleInteraction = (interactionId: string) => {
    if (!session) return;
    const isCurrentlyActive = session.activeInteractionId === interactionId;
    updateSession({
      activeInteractionId: isCurrentlyActive ? null : interactionId
    });
  };

  const handleToggleLeaderboard = () => {
    if (!session) return;
    const currentShow = session.quizState?.showLeaderboard || false;
    updateSession({
      "quizState.showLeaderboard": !currentShow
    } as any);
  };

  const handleEndSession = async () => {
    if (!confirm("Are you sure you want to end this presentation session?")) return;
    await updateSession({ isActive: false });
    router.push("/dashboard");
  };

  if (authLoading || loading || !session) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  const currentSlideData = slides.find(s => parseInt(s.id) === session.currentSlide);

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 max-h-screen overflow-hidden">
      {/* Remote Header */}
      <header className="border-b border-slate-900 bg-slate-905 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.push("/dashboard")}
            className="p-2 hover:bg-slate-900 rounded-xl transition-all border border-slate-800 text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-slate-400">SESSION HOST</h1>
            <div className="flex items-center gap-2">
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2.5 py-0.5 rounded-lg text-xs font-extrabold tracking-wider">
                CODE: {sessionId}
              </span>
              <span className="text-slate-500">•</span>
              <span className="text-xs text-slate-300 flex items-center gap-1">
                <Users className="h-3.5 w-3.5 text-indigo-450" />
                {session.participantCount} active participants
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleEndSession}
          className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 rounded-xl px-4 py-2 text-xs font-bold transition-all flex items-center gap-1.5"
        >
          <Square className="h-3.5 w-3.5 fill-red-405" />
          End Session
        </button>
      </header>

      {/* Main remote dashboard split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Control Column (60% width) */}
        <main className="flex-1 flex flex-col p-6 overflow-y-auto gap-6 border-r border-slate-900">
          
          {/* Main Slide Navigation Controller */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Active Slide
              </span>
              <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-extrabold">
                {session.currentSlide} / {slides.length}
              </span>
            </div>

            {/* Current Slide Frame Preview */}
            <div className="aspect-[16/9] w-full max-w-lg bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-xl mb-6 relative">
              {currentSlideData ? (
                <img
                  src={currentSlideData.imageUrl}
                  alt="Current slide"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-600">
                  Loading slide preview...
                </div>
              )}
            </div>

            {/* Giant Navigation Buttons */}
            <div className="flex gap-4 w-full max-w-md">
              <button
                onClick={handlePrevSlide}
                disabled={session.currentSlide <= 1}
                className="flex-1 bg-slate-905 hover:bg-slate-850 border border-slate-800 text-slate-300 rounded-2xl py-4 font-bold flex items-center justify-center gap-1.5 transition-all active:scale-98 disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft className="h-5 w-5" />
                Previous
              </button>
              <button
                onClick={handleNextSlide}
                disabled={session.currentSlide >= slides.length}
                className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-2xl py-4 font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-indigo-500/15 active:scale-98 disabled:opacity-30 disabled:pointer-events-none"
              >
                Next
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Quick Slide Jump Select Panel */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
              Jump directly to slide
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
              {slides.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => {
                    const targetSlide = slides[idx];
                    const autoInteractId = (targetSlide && targetSlide.isInteractive) ? "primary" : null;
                    updateSession({ currentSlide: idx + 1, activeInteractionId: autoInteractId });
                  }}
                  className={`aspect-square rounded-xl text-xs font-extrabold transition-all border flex items-center justify-center ${
                    session.currentSlide === idx + 1
                      ? "bg-indigo-500 text-white border-indigo-400"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>
        </main>

        {/* Right Interactions & Notes Column (40% width) */}
        <aside className="w-96 flex flex-col overflow-y-auto p-6 gap-6">
          
          {/* Active Overlay Interactions Controller */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 space-y-4">
            <div className="border-b border-slate-850/80 pb-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Interaction Overlay controls
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Activate/Broadcast interactive questions placed on this slide.
              </p>
            </div>

            {interactions.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center italic">
                No interaction overlays configured on this slide. Place them in the editor first.
              </div>
            ) : (
              <div className="space-y-2.5">
                {interactions.map((inter) => {
                  const isActive = session.activeInteractionId === inter.id;
                  
                  return (
                    <button
                      key={inter.id}
                      onClick={() => handleToggleInteraction(inter.id)}
                      className={`w-full flex items-center justify-between p-3.5 border rounded-2xl transition-all text-left ${
                        isActive
                          ? "bg-indigo-500/10 border-indigo-500 text-indigo-300 font-semibold"
                          : "bg-slate-950/40 border-slate-850 text-slate-350 hover:border-slate-800"
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className={`p-1.5 rounded-lg ${isActive ? "bg-indigo-500 text-white" : "bg-slate-900 border border-slate-800 text-slate-500"}`}>
                          {inter.type === "poll" && <BarChart2 className="h-4 w-4" />}
                          {inter.type === "quiz" && <HelpCircle className="h-4 w-4" />}
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 capitalize">{inter.type}</p>
                          <p className="text-sm font-medium truncate max-w-[180px]">{inter.question}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-slate-900/50 border border-slate-800">
                        {isActive ? "LIVE" : "START"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Quiz Leaderboard control */}
            {interactions.some(i => i.type === "quiz") && (
              <button
                onClick={handleToggleLeaderboard}
                className={`w-full flex items-center justify-center gap-2 border py-3 rounded-2xl text-xs font-bold transition-all ${
                  session.quizState?.showLeaderboard
                    ? "bg-amber-500/15 border-amber-500 text-amber-400"
                    : "bg-slate-950/40 border-slate-850 text-slate-400 hover:border-slate-850"
                }`}
              >
                <Award className="h-4 w-4" />
                {session.quizState?.showLeaderboard ? "Hide Leaderboard" : "Show Quiz Leaderboard"}
              </button>
            )}
          </div>

          {/* Notes display */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 space-y-3 flex-1">
            <div className="border-b border-slate-850/80 pb-3 flex items-center gap-2 text-slate-400">
              <FileText className="h-4 w-4 text-indigo-400" />
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Slide Notes
              </h3>
            </div>
            
            <div className="text-sm text-slate-350 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
              {currentSlideData?.notes ? (
                currentSlideData.notes
              ) : (
                <span className="italic text-slate-600">No notes set for this slide.</span>
              )}
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
}
