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
  ThumbsUp,
  MessageSquare,
  Presentation,
  Sparkles,
  Square,
  Award
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
  increment,
  getDoc
} from "firebase/firestore";
import { ref as dbRef, push } from "firebase/database";
import { db, rtdb } from "@/lib/firebaseClient";
import { calculateLeaderboard } from "@/lib/leaderboard";

interface Session {
  id: string; // joinCode
  presentationId: string;
  presenterId: string;
  isActive: boolean;
  currentSlide: number;
  activeInteractionId: string | null;
  interactionStatus?: "active" | "stopped" | null;
  participantCount: number;
  quizState?: {
    activeQuestionId: string | null;
    timerEndsAt: any;
    showLeaderboard: boolean;
    showCorrectAnswer?: boolean;
  };
}

interface Interaction {
  id: string;
  type: string;
  question: string;
  config: any;
}

interface QnaQuestion {
  id: string;
  participantToken: string;
  participantName: string;
  question: string;
  upvotes: string[];
  status: string;
  createdAt: any;
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
  
  // Q&A panel states
  const [showQnaPopup, setShowQnaPopup] = useState(false);
  const [qnaList, setQnaList] = useState<QnaQuestion[]>([]);
  const [qnaText, setQnaText] = useState("");

  // Input states for interaction
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [textVal, setTextVal] = useState("");
  const [ratingVal, setRatingVal] = useState(0);

  // Active slide details & responses aggregation
  const [activeSlide, setActiveSlide] = useState<{ imageUrl?: string; isInteractive?: boolean } | null>(null);
  const [responses, setResponses] = useState<any[]>([]);
  const [totalSlides, setTotalSlides] = useState<number>(0);
  const [allResponses, setAllResponses] = useState<any[]>([]);

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

      if (sessionData.presentationId && !totalSlides) {
        getDoc(doc(db, "presentations", sessionData.presentationId)).then(presSnap => {
          if (presSnap.exists()) {
            setTotalSlides(presSnap.data()?.slideCount || 0);
          }
        });
      }
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
            where("slideId", "==", session.currentSlide.toString()),
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

  // Listen to Active Slide Details
  useEffect(() => {
    if (!session || !session.presentationId || !session.currentSlide) {
      setActiveSlide(null);
      return;
    }

    const slideRef = doc(db, "presentations", session.presentationId, "slides", session.currentSlide.toString());
    const unsubSlide = onSnapshot(slideRef, (snap) => {
      if (snap.exists()) {
        setActiveSlide(snap.data());
      } else {
        setActiveSlide(null);
      }
    });

    return () => unsubSlide();
  }, [session?.presentationId, session?.currentSlide]);

  // Listen to Responses for the active interaction
  useEffect(() => {
    if (!joinCode || !session?.activeInteractionId || !session?.currentSlide) {
      setResponses([]);
      return;
    }

    const responsesRef = collection(db, "sessions", joinCode, "responses");
    const q = query(
      responsesRef, 
      where("interactionId", "==", session.activeInteractionId),
      where("slideId", "==", session.currentSlide.toString())
    );
    
    const unsubResponses = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setResponses(list);
    });

    return () => unsubResponses();
  }, [joinCode, session?.activeInteractionId, session?.currentSlide]);

  // Compute tallies and word frequency
  const aggregatedTallies = React.useMemo(() => {
    if (!activeInteraction || !activeInteraction.config?.options) return [];
    const options = activeInteraction.config.options as string[];
    const tallies = options.map((opt, idx) => {
      const count = responses.filter(r => Number(r.value) === idx).length;
      return { option: opt, index: idx, count };
    });
    const total = tallies.reduce((sum, t) => sum + t.count, 0);
    return tallies.map(t => ({
      ...t,
      percent: total > 0 ? Math.round((t.count / total) * 100) : 0
    }));
  }, [activeInteraction, responses]);

  const wordCloudWords = React.useMemo(() => {
    const words: Record<string, number> = {};
    responses.forEach(r => {
      const w = String(r.value || "").trim().toLowerCase();
      if (w) {
        words[w] = (words[w] || 0) + 1;
      }
    });
    return Object.entries(words)
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count);
  }, [responses]);

  // Listen to Q&A List
  useEffect(() => {
    if (!joinCode) return;
    const qnaRef = collection(db, "sessions", joinCode, "qna");
    const unsubscribe = onSnapshot(qnaRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as QnaQuestion[];
      // Sort in memory by upvotes length descending
      list.sort((a, b) => {
        const vA = a.upvotes?.length || 0;
        const vB = b.upvotes?.length || 0;
        if (vB !== vA) return vB - vA;
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      });
      setQnaList(list);
    });
    return () => unsubscribe();
  }, [joinCode]);

  // Listen to ALL responses in the session (for leaderboard calculation)
  useEffect(() => {
    if (!joinCode) return;
    const responsesRef = collection(db, "sessions", joinCode, "responses");
    const unsubAllResponses = onSnapshot(responsesRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllResponses(list);
    });
    return () => unsubAllResponses();
  }, [joinCode]);

  const interactionLeaderboard = React.useMemo(() => {
    return calculateLeaderboard(allResponses, qnaList);
  }, [allResponses, qnaList]);

  const isLeaderboardSlide = session && totalSlides > 0 && session.currentSlide === totalSlides + 1;

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
        slideId: session.currentSlide.toString(),
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

  const handleSubmitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qnaText.trim() || !user) return;
    try {
      const qnaRef = collection(db, "sessions", joinCode, "qna");
      const name = sessionStorage.getItem("participantName") || "Anonymous";
      await addDoc(qnaRef, {
        participantToken: user.uid,
        participantName: name,
        question: qnaText.trim(),
        upvotes: [],
        status: "approved",
        createdAt: new Date(),
      });
      setQnaText("");
    } catch (err) {
      console.error("Error creating question:", err);
    }
  };

  const handleUpvoteQuestion = async (qnaId: string, currentUpvotes: string[]) => {
    if (!user) return;
    try {
      const docRef = doc(db, "sessions", joinCode, "qna", qnaId);
      const upvoted = currentUpvotes.includes(user.uid);
      const newUpvotes = upvoted 
        ? currentUpvotes.filter(id => id !== user.uid)
        : [...currentUpvotes, user.uid];

      await updateDoc(docRef, { upvotes: newUpvotes });
    } catch (err) {
      console.error("Error upvoting question:", err);
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

  if (!session.isActive) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-slate-100 min-h-screen p-6 text-center space-y-6 animate-in fade-in duration-300">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500 rounded-full blur-xl opacity-20 animate-pulse" />
          <div className="relative p-6 bg-slate-900 border border-slate-800 rounded-3xl text-indigo-400 w-fit mx-auto shadow-2xl">
            <Presentation className="h-10 w-10 animate-bounce" />
          </div>
        </div>
        <div className="space-y-2 max-w-sm">
          <h2 className="text-2xl font-extrabold text-slate-200">Session Ended</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            The presenter has closed this live session. Thank you for your active participation and feedback!
          </p>
        </div>
        <button
          onClick={() => router.push("/")}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-600/15 active:scale-95 z-10"
        >
          Go back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-black text-slate-100 min-h-screen relative overflow-hidden justify-between">
      
      {/* 1. Full Screen Slide Background Layer */}
      <div className="fixed inset-0 z-0 bg-slate-950 flex items-center justify-center">
        {activeSlide ? (
          activeSlide.isInteractive ? (
            <div className="w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950" />
          ) : activeSlide.imageUrl ? (
            <img 
              src={activeSlide.imageUrl} 
              alt={`Slide ${session.currentSlide}`}
              className="w-full h-full object-contain pointer-events-none select-none"
            />
          ) : (
            <div className="w-full h-full bg-slate-950" />
          )
        ) : (
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
            <span className="text-xs text-slate-500">Syncing with presenter...</span>
          </div>
        )}
      </div>

      {/* 2. Top Header Overlay (Glassmorphism, floating) */}
      <header className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex flex-col bg-slate-950/80 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-slate-900 shadow-lg pointer-events-auto">
          <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider mb-0.5">
            LIVE PRESENTATION
          </span>
          <span className="text-xs font-bold text-slate-200">
            Room Code: <span className="text-indigo-400 font-extrabold">{joinCode}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md border border-slate-900 px-3.5 py-2.5 rounded-2xl text-xs font-bold text-slate-350 shadow-lg pointer-events-auto">
          <Users className="h-3.5 w-3.5 text-indigo-400" />
          <span>{session.participantCount}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse ml-0.5" />
        </div>
      </header>

      {/* 3. Main Center Overlay (Interactive questions / results) */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4">
        {isLeaderboardSlide ? (
          <div className="bg-slate-955/90 backdrop-blur-md border border-slate-850 rounded-3xl p-6 shadow-2xl max-w-md w-full overflow-y-auto max-h-[80vh] space-y-6 animate-in fade-in zoom-in-95 duration-205">
            <div className="text-center space-y-2">
              <Award className="h-10 w-10 text-yellow-400 mx-auto animate-bounce" />
              <h2 className="text-xl font-extrabold tracking-tight text-slate-105">
                Presentation Concluded
              </h2>
              <p className="text-xs text-slate-500">
                Here are the final standings for this live session.
              </p>
            </div>

            {/* Personal Performance Card */}
            {(() => {
              const myRankIndex = interactionLeaderboard.findIndex(p => p.token === user?.uid);
              if (myRankIndex === -1) {
                return (
                  <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 text-center">
                    <p className="text-xs text-slate-450">
                      No interactions recorded for you in this session.
                    </p>
                  </div>
                );
              }
              const myRank = myRankIndex + 1;
              const myInfo = interactionLeaderboard[myRankIndex];
              const medal = myRank === 1 ? "👑" : myRank === 2 ? "🥈" : myRank === 3 ? "🥉" : "🎖️";

              return (
                <div className="bg-gradient-to-br from-indigo-955/40 via-slate-900/30 to-purple-955/40 border border-indigo-500/20 rounded-2xl p-5 text-center space-y-3 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
                  <div className="text-3xl">{medal}</div>
                  <div>
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Your Standing</h4>
                    <p className="text-2xl font-black text-slate-100 mt-1">Rank #{myRank}</p>
                    <p className="text-xs font-bold text-slate-400 mt-0.5">{myInfo.score} total points</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-slate-900 pt-3 mt-1 text-[10px] text-slate-455 font-semibold">
                    <div className="space-y-1">
                      <span className="block text-slate-550">🎯 Quiz Correct</span>
                      <span className="text-xs font-bold text-emerald-455">{myInfo.quizCorrectCount}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="block text-slate-550">🗳️ Responses</span>
                      <span className="text-xs font-bold text-slate-205">{myInfo.responsesCount}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="block text-slate-550">❓ Q&A Asked</span>
                      <span className="text-xs font-bold text-indigo-305">{myInfo.questionsAskedCount}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Standings List */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Top Standings
              </h3>
              {interactionLeaderboard.length === 0 ? (
                <p className="text-xs text-slate-650 text-center py-4 italic">No rankings registered</p>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {interactionLeaderboard.slice(0, 10).map((player, idx) => {
                    const rank = idx + 1;
                    const isMe = player.token === user?.uid;
                    return (
                      <div 
                        key={player.token}
                        className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-all ${
                          isMe 
                            ? "bg-indigo-500/10 border-indigo-500/35 text-indigo-305 font-bold shadow-md shadow-indigo-500/5" 
                            : rank === 1 
                            ? "bg-yellow-500/5 border-yellow-500/10 text-yellow-350"
                            : "bg-slate-950/50 border-slate-900 text-slate-350"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-4 font-black text-center text-[10px] text-slate-500">{rank}</span>
                          <span className="truncate max-w-[120px]">{player.name} {isMe && "(You)"}</span>
                        </div>
                        <div className="flex items-center gap-2.5 font-medium text-slate-550">
                          <span>🎯 {player.quizCorrectCount}</span>
                          <span>🗳️ {player.responsesCount}</span>
                          <span className={`font-bold ${isMe ? "text-indigo-300 text-sm" : "text-slate-300"}`}>
                            {player.score} pts
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : activeInteraction ? (
          <div className="bg-slate-955/90 backdrop-blur-md border border-slate-850 rounded-3xl p-6 shadow-2xl max-w-md w-full overflow-y-auto max-h-[70vh] space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {hasSubmitted ? (
              activeInteraction.type === "wordcloud" ? (
                <div className="text-center py-6 space-y-4">
                  <div className="p-3 bg-indigo-500/10 border border-indigo-500/25 rounded-2xl w-fit mx-auto text-indigo-400 mb-2">
                    <Sparkles className="h-6 w-6 animate-pulse" />
                  </div>
                  <h3 className="text-base font-bold text-slate-200">Word Submitted!</h3>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                    Your response has been registered. Watch the presenter's screen to see it appear live in the word cloud!
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setHasSubmitted(false);
                      setTextVal("");
                    }}
                    className="mt-2 text-xs font-bold text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 px-4 py-2 rounded-xl transition-all"
                  >
                    Submit Another Word
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl w-fit mx-auto text-emerald-450 mb-3">
                      <CheckCircle className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-bold text-slate-200">Response Registered!</h3>
                    <p className="text-xs text-slate-500 mt-1">Showing real-time results below</p>
                  </div>

                  {/* Correct / Incorrect Status Card for Quiz */}
                  {activeInteraction.type === "quiz" && session?.quizState?.showCorrectAnswer && (() => {
                    const myResponse = responses.find(r => r.participantToken === user?.uid);
                    if (!myResponse) return null;
                    const isCorrect = myResponse.isCorrect === true;
                    
                    const correctIdx = activeInteraction.config?.correctOptionIndex;
                    const correctOptionText = activeInteraction.config?.options?.[correctIdx] || "Correct Option";
                    const myOptionText = activeInteraction.config?.options?.[myResponse.value] || "Your Option";

                    return (
                      <div className={`p-4 rounded-2xl border text-center space-y-2 animate-in fade-in slide-in-from-top-2 duration-300 ${
                        isCorrect 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-450" 
                          : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}>
                        <div className="flex items-center justify-center gap-2 font-black text-sm">
                          {isCorrect ? (
                            <>
                              <span className="text-xl">🎉</span>
                              <span>Correct Answer! (+100 pts)</span>
                            </>
                          ) : (
                            <>
                              <span className="text-xl">❌</span>
                              <span>Incorrect Answer</span>
                            </>
                          )}
                        </div>
                        {!isCorrect && (
                          <p className="text-[10px] text-slate-500 font-medium">
                            You chose <span className="text-red-450 font-bold">"{myOptionText}"</span>. 
                            The correct answer is <span className="text-emerald-450 font-bold">"{correctOptionText}"</span>.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  <div className="border-t border-slate-900 pt-4 space-y-4">
                    {/* Results: Polls / Quizzes */}
                    {(activeInteraction.type === "poll" || activeInteraction.type === "quiz") && (
                      <div className="space-y-3">
                        {aggregatedTallies.map((tally) => {
                          const isCorrectAnswer = 
                            activeInteraction.type === "quiz" && 
                            session?.quizState?.showCorrectAnswer && 
                            activeInteraction.config.correctOptionIndex === tally.index;
                          
                          const isIncorrectAnswer = 
                            activeInteraction.type === "quiz" && 
                            session?.quizState?.showCorrectAnswer && 
                            !isCorrectAnswer && 
                            tally.count > 0;
                          return (
                            <div key={tally.index} className="space-y-1">
                              <div className="flex justify-between text-xs font-semibold text-slate-400">
                                <span className={
                                  isCorrectAnswer 
                                    ? "text-emerald-400 font-bold" 
                                    : isIncorrectAnswer 
                                      ? "text-red-400 font-bold" 
                                      : ""
                                }>
                                  {tally.option} {isCorrectAnswer && "✓"} {isIncorrectAnswer && "✗"}
                                </span>
                                <span>{tally.count} votes ({tally.percent}%)</span>
                              </div>
                              <div className="w-full bg-slate-900 border border-slate-800 rounded-full h-3 overflow-hidden">
                                <div
                                  style={{ width: `${tally.percent}%` }}
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    isCorrectAnswer 
                                      ? "bg-emerald-500" 
                                      : isIncorrectAnswer 
                                        ? "bg-red-500" 
                                        : "bg-indigo-500"
                                  }`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Results: Open Text Sticky Notes */}
                    {activeInteraction.type === "opentext" && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                          Responses Feed ({responses.length})
                        </div>
                        <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                          {responses.map((note) => (
                            <div 
                              key={note.id} 
                              className="bg-slate-900/50 border border-slate-805 rounded-xl p-3 text-xs text-slate-350"
                            >
                              <p className="leading-relaxed">"{note.value}"</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Results: Star Rating */}
                    {activeInteraction.type === "rating" && (
                      <div className="flex flex-col items-center justify-center py-2 gap-2 text-center">
                        <span className="text-3xl font-extrabold text-indigo-400">
                          {(
                            responses.reduce((acc, curr) => acc + Number(curr.value), 0) / 
                            Math.max(responses.length, 1)
                          ).toFixed(1)}
                        </span>
                        <div className="flex gap-1 text-slate-700">
                          {[1, 2, 3, 4, 5].map((idx) => {
                            const average = responses.reduce((acc, curr) => acc + Number(curr.value), 0) / Math.max(responses.length, 1);
                            const filled = idx <= Math.round(average);
                            return (
                              <span key={idx} className={filled ? "text-yellow-400 fill-yellow-400 text-lg" : "text-lg"}>
                                ★
                              </span>
                            );
                          })}
                        </div>
                        <span className="text-[10px] text-slate-555">{responses.length} responses</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : session.interactionStatus === "stopped" ? (
              <div className="text-center py-8 px-4 space-y-4">
                <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-2xl w-fit mx-auto text-red-400 mb-2">
                  <Square className="h-6 w-6 fill-red-400/20" />
                </div>
                <h3 className="text-base font-bold text-slate-200">Submissions Closed</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  The presenter has closed submissions for this question. Keep an eye on the presentation screen for results!
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-indigo-400 mb-2 font-bold uppercase tracking-wider">
                    {activeInteraction.type === "poll" && <BarChart2 className="h-4 w-4" />}
                    {activeInteraction.type === "quiz" && <HelpCircle className="h-4 w-4" />}
                    {activeInteraction.type === "opentext" && <Send className="h-4 w-4" />}
                    {activeInteraction.type === "wordcloud" && <Sparkles className="h-4 w-4" />}
                    <span>Active {activeInteraction.type}</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-100">{activeInteraction.question}</h2>
                </div>

                <div className="space-y-3">
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
                        className="w-full mt-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white rounded-xl py-3.5 font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit Answer"}
                      </button>
                    </div>
                  )}

                  {(activeInteraction.type === "wordcloud" || activeInteraction.type === "opentext") && (
                    <div className="space-y-4">
                      {activeInteraction.type === "wordcloud" ? (
                        <input
                          type="text"
                          maxLength={20}
                          placeholder="Enter a word..."
                          value={textVal}
                          onChange={(e) => setTextVal(e.target.value)}
                          disabled={submitting}
                          className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-3 px-4 text-slate-200 text-sm focus:outline-none"
                        />
                      ) : (
                        <textarea
                          placeholder="Write your response here..."
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
                            <span className={val <= ratingVal ? "text-yellow-400 fill-yellow-400" : ""}>
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
          </div>
        ) : (
          /* Simple overlay showing the active slide visually */
          <div className="absolute top-20 bg-slate-955/65 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-900 text-[10px] font-semibold text-indigo-350 flex items-center gap-2 shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping" />
            <span>{isLeaderboardSlide ? "Leaderboard" : `Slide ${session.currentSlide} of Presentation`}</span>
          </div>
        )}
      </main>

      {/* 4. Floating Action Controls (Bottom Right corner) */}
      <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3">
        {/* Q&A Popup Toggle Button */}
        <button
          onClick={() => setShowQnaPopup(true)}
          className="relative p-3.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-indigo-400 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-1.5"
        >
          <MessageSquare className="h-5 w-5" />
          {qnaList.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-indigo-650 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-slate-950">
              {qnaList.length}
            </span>
          )}
        </button>

        {/* Reactions Floating Tray Control */}
        <div className="relative group">
          <button
            className="p-3.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-indigo-400 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
            title="Reactions"
          >
            <ThumbsUp className="h-5 w-5" />
          </button>
          
          {/* Reaction Emojis Panel (Reveals on Hover/Focus) */}
          <div className="absolute right-0 bottom-full mb-3 bg-slate-950/95 border border-slate-800/80 backdrop-blur-md p-2 rounded-2xl shadow-2xl flex gap-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all transform translate-y-2 group-hover:translate-y-0 duration-200">
            <button
              onClick={() => handleSendReaction("heart")}
              className="p-2 hover:bg-slate-900 rounded-xl transition-all hover:scale-115 text-base active:scale-90"
            >
              ❤️
            </button>
            <button
              onClick={() => handleSendReaction("clap")}
              className="p-2 hover:bg-slate-900 rounded-xl transition-all hover:scale-115 text-base active:scale-90"
            >
              👏
            </button>
            <button
              onClick={() => handleSendReaction("fire")}
              className="p-2 hover:bg-slate-900 rounded-xl transition-all hover:scale-115 text-base active:scale-90"
            >
              🔥
            </button>
            <button
              onClick={() => handleSendReaction("laugh")}
              className="p-2 hover:bg-slate-900 rounded-xl transition-all hover:scale-115 text-base active:scale-90"
            >
              😂
            </button>
            <button
              onClick={() => handleSendReaction("shock")}
              className="p-2 hover:bg-slate-900 rounded-xl transition-all hover:scale-115 text-base active:scale-90"
            >
              😮
            </button>
          </div>
        </div>
      </div>

      {/* 5. Q&A Popup Modal overlay */}
      {showQnaPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-955/95 border border-slate-850 rounded-3xl p-6 shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col relative animate-in fade-in zoom-in-95 duration-200">
            {/* Close Button */}
            <button
              onClick={() => setShowQnaPopup(false)}
              className="absolute top-4 right-4 p-1.5 hover:bg-slate-900 border border-slate-900 text-slate-400 hover:text-slate-200 rounded-xl transition-all"
            >
              ✕
            </button>

            <h3 className="text-base font-bold text-slate-250 mb-4 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-indigo-400" />
              Audience Q&A Board
            </h3>

            {/* Scrollable Questions list & post area */}
            <div className="flex-1 flex flex-col overflow-hidden gap-4">
              
              {/* Question list (scrollable) */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
                <div className="text-[9px] font-bold text-slate-550 uppercase tracking-wider mb-2">
                  Questions Feed ({qnaList.length})
                </div>

                {qnaList.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic">
                    No questions asked yet. Be the first to ask!
                  </div>
                ) : (
                  qnaList.map((q) => {
                    const hasUpvoted = user ? q.upvotes?.includes(user.uid) : false;
                    return (
                      <div 
                        key={q.id} 
                        className="bg-slate-900/40 border border-slate-900 rounded-2xl p-4 flex justify-between items-center gap-4 hover:border-slate-850 transition-all"
                      >
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-slate-200 leading-snug">{q.question}</p>
                          <p className="text-[9px] text-slate-500 mt-1 flex items-center gap-1">
                            <span>Asked by {q.participantName}</span>
                          </p>
                        </div>
                        <button
                          onClick={() => handleUpvoteQuestion(q.id, q.upvotes || [])}
                          className={`flex flex-col items-center gap-0.5 border rounded-xl px-2.5 py-1.5 transition-all focus:outline-none ${
                            hasUpvoted
                              ? "bg-indigo-500/10 border-indigo-500 text-indigo-400 font-bold"
                              : "bg-slate-950 border-slate-850 text-slate-550 hover:text-slate-400"
                          }`}
                        >
                          <ThumbsUp className="h-3 w-3" />
                          <span className="text-[9px]">{q.upvotes?.length || 0}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Form to submit question */}
              <form onSubmit={handleSubmitQuestion} className="bg-slate-900/60 border border-slate-900 rounded-2xl p-3 space-y-2.5 shadow-md shrink-0">
                <textarea
                  required
                  placeholder="Ask an anonymous question..."
                  rows={2}
                  value={qnaText}
                  onChange={(e) => setQnaText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-855 focus:border-indigo-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!qnaText.trim()}
                  className="w-full bg-indigo-500 hover:bg-indigo-650 text-white font-bold text-xs py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  Post Question
                </button>
              </form>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
