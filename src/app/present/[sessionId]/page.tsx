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
  EyeOff,
  Maximize,
  Minimize,
  Sparkles,
  MessageSquare,
  ThumbsUp,
  Share2,
  Copy,
  Check,
  X,
  ChevronUp,
  ChevronDown
} from "lucide-react";
import { 
  doc, 
  collection, 
  onSnapshot, 
  updateDoc, 
  getDoc,
  getDocs,
  query,
  where,
  writeBatch
} from "firebase/firestore";
import { db, rtdb } from "@/lib/firebaseClient";
import { ref as dbRef, onChildAdded, off } from "firebase/database";
import { AnimatePresence, motion } from "framer-motion";
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
  const [responses, setResponses] = useState<any[]>([]);
  const [allResponses, setAllResponses] = useState<any[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reactions, setReactions] = useState<any[]>([]);
  const [qnaList, setQnaList] = useState<any[]>([]);
  const [showQnaOverlay, setShowQnaOverlay] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showSlidePickerPopup, setShowSlidePickerPopup] = useState(false);

  const leaderboard = React.useMemo(() => {
    const scores: Record<string, { name: string; score: number }> = {};
    
    // Group responses by participant and slide to keep only the latest response
    const latestResponses: Record<string, any> = {};
    allResponses.forEach(r => {
      if (!r.participantToken || !r.slideId || !r.interactionId) return;
      const key = `${r.participantToken}_${r.slideId}_${r.interactionId}`;
      const existing = latestResponses[key];
      
      const rTime = r.submittedAt?.seconds || (r.submittedAt?.toDate ? r.submittedAt.toDate().getTime() / 1000 : 0);
      const eTime = existing ? (existing.submittedAt?.seconds || (existing.submittedAt?.toDate ? existing.submittedAt.toDate().getTime() / 1000 : 0)) : 0;
      
      if (!existing || rTime > eTime) {
        latestResponses[key] = r;
      }
    });

    // Calculate score based on only the latest responses
    Object.values(latestResponses).forEach(r => {
      if (!scores[r.participantToken]) {
        scores[r.participantToken] = { name: r.participantName || "Anonymous", score: 0 };
      }
      if (r.isCorrect === true) {
        scores[r.participantToken].score += 100;
      }
    });

    return Object.values(scores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [allResponses]);

  const interactionLeaderboard = React.useMemo(() => {
    return calculateLeaderboard(allResponses, qnaList);
  }, [allResponses, qnaList]);

  const isLeaderboardSlide = session && slides.length > 0 && session.currentSlide === slides.length + 1;

  const handleCopyLink = () => {
    const joinUrl = `${window.location.protocol}//${window.location.host}/join?code=${sessionId}`;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sessionId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

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

  // Listen to Responses for the active interaction
  useEffect(() => {
    if (!sessionId || !session?.activeInteractionId || !session?.currentSlide) {
      setResponses([]);
      return;
    }

    const responsesRef = collection(db, "sessions", sessionId, "responses");
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
  }, [sessionId, session?.activeInteractionId, session?.currentSlide]);

  // Listen to ALL responses in the session (for leaderboard calculation)
  useEffect(() => {
    if (!sessionId) return;
    const responsesRef = collection(db, "sessions", sessionId, "responses");
    const unsubAllResponses = onSnapshot(responsesRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllResponses(list);
    });
    return () => unsubAllResponses();
  }, [sessionId]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error("Error enabling fullscreen:", err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Listen to Q&A List
  useEffect(() => {
    if (!sessionId) return;
    const qnaRef = collection(db, "sessions", sessionId, "qna");
    const unsubscribe = onSnapshot(qnaRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      list.sort((a, b) => {
        const vA = a.upvotes?.length || 0;
        const vB = b.upvotes?.length || 0;
        if (vB !== vA) return vB - vA;
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      });
      setQnaList(list);
    });
    return () => unsubscribe();
  }, [sessionId]);

  // Listen to ephemeral reactions for fullscreen remote overlay
  useEffect(() => {
    if (!sessionId || !isFullscreen) {
      setReactions([]);
      return;
    }

    const reactionsRef = dbRef(rtdb, `sessions/${sessionId}/reactions`);
    const unsubReactions = onChildAdded(reactionsRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const id = snapshot.key || Math.random().toString();
        const newReaction = {
          id,
          type: val.type,
          x: Math.random() * 80 + 10,
          y: 100,
        };
        setReactions((prev) => [...prev, newReaction]);

        setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 3000);
      }
    });

    return () => off(reactionsRef);
  }, [sessionId, isFullscreen]);

  // Keyboard navigation listener for fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFullscreen) return;
      if (e.key === "ArrowRight" || e.key === "Space" || e.key === " ") {
        handleNextSlide();
      } else if (e.key === "ArrowLeft") {
        handlePrevSlide();
      } else if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, session, slides]);

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
    if (!session || session.currentSlide >= slides.length + 1) return;
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
    const isSameInteraction = session.activeInteractionId === interactionId;
    
    if (!isSameInteraction) {
      updateSession({
        activeInteractionId: interactionId,
        interactionStatus: "active"
      });
    } else {
      if (session.interactionStatus === "active") {
        updateSession({
          interactionStatus: "stopped"
        });
      } else {
        updateSession({
          activeInteractionId: null,
          interactionStatus: null
        });
      }
    }
  };

  const handleClearResponses = async (interactionId: string) => {
    if (!sessionId || !session) return;
    if (!confirm("Are you sure you want to clear all responses for this interaction? This cannot be undone.")) return;
    
    try {
      const responsesRef = collection(db, "sessions", sessionId, "responses");
      const q = query(
        responsesRef, 
        where("interactionId", "==", interactionId),
        where("slideId", "==", session.currentSlide.toString())
      );
      const snap = await getDocs(q);
      
      const batch = writeBatch(db);
      snap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    } catch (err) {
      console.error("Error clearing responses:", err);
    }
  };

  const handleToggleLeaderboard = () => {
    if (!session) return;
    const currentShow = session.quizState?.showLeaderboard || false;
    updateSession({
      "quizState.showLeaderboard": !currentShow
    } as any);
  };

  const handleToggleCorrectAnswer = () => {
    if (!session) return;
    const currentShow = session.quizState?.showCorrectAnswer || false;
    updateSession({
      "quizState.showCorrectAnswer": !currentShow
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
      {isFullscreen ? (
        /* FULLSCREEN PRESENTER PRESENTATION LAYOUT */
        <div className="relative w-screen h-screen bg-slate-950 flex items-center justify-center overflow-hidden animate-in fade-in duration-300">
          
          {/* Active slide or Leaderboard */}
          {isLeaderboardSlide ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950 p-8 overflow-y-auto w-full h-full">
              {/* Background Glow */}
              <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-indigo-500/10 to-purple-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

              <div className="text-center mb-10 z-10">
                <div className="flex justify-center items-center gap-3 mb-2 animate-in slide-in-from-top duration-300">
                  <Award className="h-12 w-12 text-yellow-400 animate-bounce" />
                  <h1 className="text-5xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 via-slate-100 to-purple-200">
                    Session Leaderboard
                  </h1>
                </div>
                <p className="text-sm text-slate-400">
                  Top engaged participants based on responses and Q&A interactions
                </p>
              </div>

              {interactionLeaderboard.length === 0 ? (
                <div className="text-center py-12 bg-slate-900/40 border border-slate-850 rounded-3xl p-8 max-w-md w-full z-10">
                  <Users className="h-12 w-12 text-slate-600 mx-auto mb-4 animate-pulse" />
                  <h3 className="text-lg font-bold text-slate-350">No Interactions Yet</h3>
                  <p className="text-xs text-slate-500 mt-2">
                    Waiting for participants to answer quiz questions or ask Q&A questions.
                  </p>
                </div>
              ) : (
                <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-12 gap-10 items-stretch z-10">
                  {/* Left Podium (top 3) */}
                  <div className="md:col-span-5 flex flex-col items-center justify-end gap-4 pt-12 min-h-[320px] bg-slate-900/20 border border-slate-900/60 rounded-3xl p-6">
                    <div className="flex items-end justify-center w-full gap-3 h-full">
                      {/* 2nd Place */}
                      {interactionLeaderboard[1] && (
                        <div className="flex flex-col items-center flex-1 animate-in slide-in-from-bottom duration-500 delay-150">
                          <div className="text-xs font-bold text-slate-300 text-center truncate max-w-[90px] mb-2">
                            {interactionLeaderboard[1].name}
                          </div>
                          <div className="h-28 w-24 bg-gradient-to-t from-slate-900 to-slate-800/80 border border-slate-700/30 rounded-t-2xl flex flex-col items-center justify-between p-3 shadow-lg relative">
                            <span className="absolute -top-6 text-2xl">🥈</span>
                            <div className="text-lg font-extrabold text-slate-300">2nd</div>
                            <div className="text-xs font-bold text-indigo-300">{interactionLeaderboard[1].score} pts</div>
                          </div>
                        </div>
                      )}

                      {/* 1st Place */}
                      {interactionLeaderboard[0] && (
                        <div className="flex flex-col items-center flex-1 animate-in slide-in-from-bottom duration-500">
                          <div className="text-sm font-black text-yellow-450 text-center truncate max-w-[100px] mb-2">
                            {interactionLeaderboard[0].name}
                          </div>
                          <div className="h-36 w-28 bg-gradient-to-t from-indigo-950/70 to-indigo-900/50 border-2 border-yellow-500/40 rounded-t-3xl flex flex-col items-center justify-between p-4 shadow-xl relative">
                            <span className="absolute -top-8 text-4xl animate-bounce">👑</span>
                            <div className="text-xl font-black text-yellow-405">1st</div>
                            <div className="text-sm font-black text-yellow-300">{interactionLeaderboard[0].score} pts</div>
                          </div>
                        </div>
                      )}

                      {/* 3rd Place */}
                      {interactionLeaderboard[2] && (
                        <div className="flex flex-col items-center flex-1 animate-in slide-in-from-bottom duration-500 delay-300">
                          <div className="text-xs font-bold text-orange-355 text-center truncate max-w-[90px] mb-2">
                            {interactionLeaderboard[2].name}
                          </div>
                          <div className="h-22 w-24 bg-gradient-to-t from-slate-900 to-slate-800/80 border border-slate-700/30 rounded-t-2xl flex flex-col items-center justify-between p-2.5 shadow-lg relative">
                            <span className="absolute -top-6 text-2xl">🥉</span>
                            <div className="text-base font-bold text-orange-400">3rd</div>
                            <div className="text-xs font-bold text-indigo-300">{interactionLeaderboard[2].score} pts</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Table standings (4-10) */}
                  <div className="md:col-span-7 bg-slate-900/45 backdrop-blur-sm border border-slate-850 rounded-3xl p-6 shadow-xl w-full flex flex-col justify-between max-h-[450px]">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
                      Standings
                    </h3>
                    <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
                      {interactionLeaderboard.slice(0, 8).map((player, idx) => {
                        const rank = idx + 1;
                        return (
                          <div 
                            key={player.token}
                            className={`flex items-center justify-between p-3 rounded-xl border text-sm transition-all animate-in fade-in duration-300 delay-${idx * 50} ${
                              rank === 1 
                                ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300" 
                                : rank === 2 
                                ? "bg-slate-300/10 border-slate-300/20 text-slate-200" 
                                : rank === 3 
                                ? "bg-orange-555/10 border-orange-500/20 text-orange-300" 
                                : "bg-slate-950/45 border-slate-900 text-slate-350 hover:bg-slate-900/25"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-5 font-black text-center text-xs text-slate-500">{rank}</span>
                              <span className="font-bold truncate max-w-[180px]">{player.name}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs font-semibold text-slate-455">
                              <span title="Quizzes Correct" className="flex items-center gap-0.5">🎯 {player.quizCorrectCount}</span>
                              <span title="Total Responses" className="flex items-center gap-0.5">🗳️ {player.responsesCount}</span>
                              <span title="Questions Asked" className="flex items-center gap-0.5">❓ {player.questionsAskedCount}</span>
                              <span className="font-extrabold text-sm text-slate-200 min-w-[70px] text-right">
                                {player.score} pts
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : currentSlideData ? (
            currentSlideData.imageUrl ? (
              <img 
                src={currentSlideData.imageUrl} 
                alt={`Slide ${session.currentSlide}`}
                className="w-full h-full object-contain pointer-events-none select-none animate-in zoom-in-95 duration-300"
              />
            ) : (
              <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                <span className="text-sm text-slate-500 italic">Interactive Slide Content</span>
              </div>
            )
          ) : (
            <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
          )}

          {/* Dynamic Spreading Word Cloud / Rating Overlay directly on top of the slide page */}
          {session.activeInteractionId && interactions.length > 0 && (
            (() => {
              const activeInter = interactions.find(i => i.id === session.activeInteractionId);
              if (activeInter && activeInter.type === "wordcloud") {
                // Compute word frequency inside overlay
                const words: Record<string, number> = {};
                responses.forEach(r => {
                  const w = String(r.value || "").trim();
                  if (w) words[w] = (words[w] || 0) + 1;
                });
                const sortedWords = Object.entries(words)
                  .map(([text, count]) => ({ text, count }))
                  .sort((a, b) => b.count - a.count);

                return (
                  <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-black/45 backdrop-blur-[2px]">
                    {sortedWords.length === 0 ? (
                      <div className="text-center space-y-2">
                        <Sparkles className="h-8 w-8 text-indigo-400 animate-pulse mx-auto" />
                        <span className="text-xs text-slate-500 italic block">Waiting for words...</span>
                      </div>
                    ) : (
                      sortedWords.map((item, idx) => {
                        const maxCount = sortedWords[0]?.count || 1;
                        const minSize = 16;
                        const maxSize = 64; // Responsive, massive font size
                        const size = minSize + (item.count / maxCount) * (maxSize - minSize);
                        
                        // Spiral distribution angles spreading from the middle
                        const angle = (idx * 137.5) * (Math.PI / 180);
                        const radius = Math.sqrt(idx + 1) * 85; 
                        const tx = Math.cos(angle) * radius;
                        const ty = Math.sin(angle) * radius;
                        
                        const colors = [
                          "text-indigo-300", 
                          "text-purple-300", 
                          "text-pink-300", 
                          "text-blue-300", 
                          "text-teal-300", 
                          "text-yellow-250", 
                          "text-emerald-300",
                          "text-rose-300 font-extrabold"
                        ];
                        const colorClass = colors[idx % colors.length];

                        return (
                          <motion.span
                            key={idx}
                            initial={{ scale: 0, opacity: 0, x: 0, y: 0 }}
                            animate={{ scale: 1, opacity: 1, x: tx, y: ty }}
                            transition={{ 
                              type: "spring", 
                              stiffness: 45, 
                              damping: 12,
                              delay: idx * 0.03 
                            }}
                            style={{ 
                              fontSize: `${size}px`,
                              position: "absolute"
                            }}
                            className={`font-black tracking-tight select-none leading-none text-center filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] ${colorClass}`}
                          >
                            {item.text}
                          </motion.span>
                        );
                      })
                    )}
                  </div>
                );
              }

              if (activeInter && activeInter.type === "rating") {
                const total = responses.length;
                const average = total > 0 
                  ? responses.reduce((acc, curr) => acc + Number(curr.value), 0) / total 
                  : 0;

                return (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden bg-black/50 backdrop-blur-[4px] text-center">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 50, damping: 15 }}
                      className="bg-slate-900/90 border border-slate-800 p-8 rounded-3xl shadow-2xl max-w-sm w-full space-y-4"
                    >
                      <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest block">
                        Live Rating Results
                      </span>
                      <h3 className="text-sm font-extrabold text-slate-300 line-clamp-2 px-4 leading-snug">
                        {activeInter.question}
                      </h3>
                      
                      <div className="py-2 space-y-1">
                        {/* Big Rating Number */}
                        <span className="text-7xl font-black text-indigo-400 block tracking-tight">
                          {average.toFixed(1)}
                        </span>
                        
                        {/* Gold Stars */}
                        <div className="flex justify-center gap-1 text-slate-700">
                          {[1, 2, 3, 4, 5].map((idx) => {
                            const filled = idx <= Math.round(average);
                            return (
                              <span key={idx} className={filled ? "text-yellow-400 fill-yellow-400 text-3xl" : "text-3xl"}>
                                ★
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      <span className="text-xs text-slate-500 font-semibold block">
                        {total} responses
                      </span>
                    </motion.div>
                  </div>
                );
              }

              if (activeInter && activeInter.type === "poll") {
                const total = responses.length;
                const options = activeInter.config?.options || [];

                return (
                  <div className="absolute inset-0 z-20 flex flex-col justify-between bg-slate-950/95 backdrop-blur-[8px] p-12 text-left overflow-y-auto">
                    {/* Decorative ambient background glows */}
                    <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
                    <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />
                    
                    {/* Header */}
                    <div className="space-y-2 z-10">
                      <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest block">
                        Live Poll Results
                      </span>
                      <h3 className="text-3xl lg:text-4xl font-black text-slate-100 tracking-tight leading-tight max-w-4xl">
                        {activeInter.question}
                      </h3>
                    </div>

                    {/* Full screen Chart Area */}
                    <div className="flex-1 flex flex-col justify-center gap-6 py-10 max-w-5xl w-full mx-auto z-10">
                      {options.map((option: string, idx: number) => {
                        const count = responses.filter(r => Number(r.value) === idx).length;
                        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                        
                        // Sleek gradient colors
                        const barColors = [
                          "from-indigo-500 via-indigo-600 to-indigo-700 shadow-indigo-500/20",
                          "from-purple-500 via-purple-600 to-purple-700 shadow-purple-500/20",
                          "from-pink-500 via-pink-600 to-pink-700 shadow-pink-500/20",
                          "from-blue-500 via-blue-600 to-blue-700 shadow-blue-500/20",
                          "from-teal-500 via-teal-600 to-teal-700 shadow-teal-500/20"
                        ];
                        const bgGradient = barColors[idx % barColors.length];

                        return (
                          <div key={idx} className="space-y-2">
                            {/* Option Label and Count Info */}
                            <div className="flex justify-between items-end text-sm lg:text-base font-extrabold">
                              <span className="text-slate-300 truncate max-w-[75%] leading-none pb-0.5">
                                {option}
                              </span>
                              <span className="text-indigo-300 shrink-0 bg-slate-900 border border-slate-800 px-3 py-1 rounded-xl shadow-inner font-mono text-xs">
                                {count} votes ({percent}%)
                              </span>
                            </div>
                            
                            {/* Giant Animated Bar */}
                            <div className="w-full bg-slate-900/60 h-10 rounded-2xl overflow-hidden border border-slate-800 p-1 flex items-center shadow-inner">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${percent}%` }}
                                transition={{ type: "spring", stiffness: 40, damping: 10, delay: idx * 0.05 }}
                                className={`h-full rounded-xl bg-gradient-to-r ${bgGradient} shadow-lg`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer Info */}
                    <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-900/80 pt-6 z-10 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Broadcasting live results</span>
                      </div>
                      <span>Total Submissions: {total} responses</span>
                    </div>
                  </div>
                );
              }

              if (activeInter && activeInter.type === "quiz") {
                const total = responses.length;
                const options = activeInter.config?.options || [];
                const correctIdx = activeInter.config?.correctOptionIndex;
                const showLeaderboard = session.quizState?.showLeaderboard || false;

                return (
                  <div className="absolute inset-0 z-20 flex flex-col justify-between bg-slate-950/95 backdrop-blur-[8px] p-12 text-left overflow-y-auto">
                    {/* Decorative ambient background glows */}
                    <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
                    <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />
                    
                    {/* Header */}
                    <div className="space-y-2 z-10">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                          Live Quiz Results
                        </span>
                        {showLeaderboard && (
                          <>
                            <span className="text-slate-700 font-bold">•</span>
                            <span className="text-xs font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1">
                              <Award className="h-3 w-3" /> Standings Active
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="text-3xl lg:text-4xl font-black text-slate-100 tracking-tight leading-tight max-w-4xl">
                        {activeInter.question}
                      </h3>
                    </div>

                    {/* Main Split Layout */}
                    <div className="flex-1 flex flex-col lg:flex-row gap-12 py-8 items-stretch w-full mx-auto z-10">
                      
                      {/* Left: Quiz Chart */}
                      <div className="flex-1 flex flex-col justify-center gap-5">
                        {options.map((option: string, idx: number) => {
                          const count = responses.filter(r => Number(r.value) === idx).length;
                          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                          const isCorrect = idx === correctIdx;
                          const revealCorrect = session.quizState?.showCorrectAnswer || false;
                          const showAsCorrect = isCorrect && revealCorrect;
                          const showAsIncorrect = !isCorrect && revealCorrect && count > 0;
                          
                          // Style gradient: Green for correct, Red for incorrect (with votes), standard purple/blue gradient otherwise
                          const bgGradient = showAsCorrect
                            ? "from-emerald-500 via-emerald-600 to-emerald-700 shadow-emerald-500/20"
                            : showAsIncorrect
                              ? "from-red-500 via-red-600 to-red-700 shadow-red-500/20"
                              : "from-indigo-550 via-indigo-600 to-indigo-700 shadow-indigo-500/10";

                          return (
                            <div key={idx} className="space-y-1.5">
                              {/* Option Label and Count Info */}
                              <div className="flex justify-between items-end text-sm font-extrabold">
                                <span className={`flex items-center gap-2 truncate max-w-[75%] leading-none pb-0.5 ${
                                  showAsCorrect 
                                    ? "text-emerald-400 font-black" 
                                    : showAsIncorrect
                                      ? "text-red-400 font-black"
                                      : "text-slate-350"
                                }`}>
                                  {showAsCorrect && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
                                  {showAsIncorrect && <X className="h-4 w-4 text-red-400 shrink-0" />}
                                  {option}
                                </span>
                                <span className={`shrink-0 border px-3 py-1 rounded-xl shadow-inner font-mono text-xs ${
                                  showAsCorrect 
                                    ? "bg-emerald-950/40 border-emerald-800 text-emerald-400" 
                                    : showAsIncorrect
                                      ? "bg-red-950/40 border-red-800 text-red-400"
                                      : "bg-slate-900 border-slate-800 text-slate-400"
                                }`}>
                                  {count} votes ({percent}%)
                                </span>
                              </div>
                              
                              {/* Bar */}
                              <div className={`w-full bg-slate-900/60 h-8 rounded-2xl overflow-hidden border p-1 flex items-center shadow-inner ${
                                showAsCorrect 
                                  ? "border-emerald-500/30" 
                                  : showAsIncorrect
                                    ? "border-red-500/30"
                                    : "border-slate-800"
                              }`}>
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${percent}%` }}
                                  transition={{ type: "spring", stiffness: 40, damping: 10, delay: idx * 0.05 }}
                                  className={`h-full rounded-xl bg-gradient-to-r ${bgGradient} shadow-lg`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Right: Leaderboard Standings (only if showLeaderboard is true) */}
                      {showLeaderboard && (
                        <motion.div
                          initial={{ opacity: 0, x: 50, scale: 0.95 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          transition={{ type: "spring", stiffness: 70, damping: 15 }}
                          className="w-full lg:w-96 bg-slate-900/40 border border-slate-850 p-6 rounded-3xl flex flex-col gap-6 shrink-0 relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 blur-[35px] pointer-events-none rounded-full" />
                          
                          <div className="border-b border-slate-850/80 pb-3 flex items-center gap-2">
                            <Award className="h-5 w-5 text-amber-400" />
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                              Leaderboard Standings
                            </h4>
                          </div>

                          {leaderboard.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2">
                              <Award className="h-8 w-8 text-slate-700 animate-pulse" />
                              <p className="text-xs text-slate-500 italic">No correct submissions yet.</p>
                            </div>
                          ) : (
                            <div className="flex-1 flex flex-col justify-center gap-3">
                              {leaderboard.map((player: any, idx: number) => {
                                const medals = ["🥇", "🥈", "🥉"];
                                return (
                                  <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.1 }}
                                    key={idx}
                                    className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                                      idx === 0 
                                        ? "bg-amber-500/10 border-amber-500/30 text-amber-300 shadow-md shadow-amber-500/5" 
                                        : "bg-slate-950/40 border-slate-850 text-slate-300"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <span className="text-base font-bold w-6 shrink-0 text-center">
                                        {idx < 3 ? medals[idx] : `${idx + 1}`}
                                      </span>
                                      <span className="text-xs font-black truncate max-w-[140px]">
                                        {player.name}
                                      </span>
                                    </div>
                                    <span className="font-mono text-xs font-extrabold text-indigo-400 bg-indigo-500/5 border border-indigo-500/15 px-2.5 py-0.5 rounded-lg">
                                      {player.score} pts
                                    </span>
                                  </motion.div>
                                );
                              })}
                            </div>
                          )}
                        </motion.div>
                      )}

                    </div>

                    {/* Footer Info */}
                    <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-900/80 pt-6 z-10 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Broadcasting live results</span>
                      </div>
                      <span>Total Submissions: {total} responses</span>
                    </div>
                  </div>
                );
              }

              if (activeInter && activeInter.type === "opentext") {
                const total = responses.length;

                return (
                  <div className="absolute inset-0 z-20 flex flex-col justify-between bg-slate-955/95 backdrop-blur-[8px] p-12 text-left overflow-y-auto">
                    {/* Decorative ambient background glows */}
                    <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
                    <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

                    {/* Header */}
                    <div className="space-y-2 z-10">
                      <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest block">
                        Live Audience Responses
                      </span>
                      <h3 className="text-3xl lg:text-4xl font-black text-slate-100 tracking-tight leading-tight max-w-4xl">
                        {activeInter.question}
                      </h3>
                    </div>

                    {/* Main Content Area - Grid of Sticky Notes */}
                    <div className="flex-1 py-10 z-10">
                      {responses.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
                          <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-full animate-pulse">
                            <MessageSquare className="h-10 w-10 text-indigo-400" />
                          </div>
                          <div>
                            <p className="text-slate-200 font-bold">Waiting for responses...</p>
                            <p className="text-xs text-slate-500 max-w-xs mt-1">Submit your thoughts on your phone to see them posted here live!</p>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 max-w-7xl mx-auto items-start">
                          <AnimatePresence>
                            {responses.map((note: any, idx: number) => {
                              // Nice gradient left borders for cards
                              const borders = [
                                "border-l-indigo-500",
                                "border-l-purple-500",
                                "border-l-pink-500",
                                "border-l-blue-500",
                                "border-l-teal-500",
                                "border-l-amber-500"
                              ];
                              const leftBorder = borders[idx % borders.length];

                              return (
                                <motion.div
                                  key={note.id}
                                  initial={{ opacity: 0, y: 30, scale: 0.9 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.9 }}
                                  transition={{ type: "spring", stiffness: 80, damping: 14, delay: (idx % 10) * 0.05 }}
                                  className={`bg-slate-900/60 border border-slate-800 border-l-4 ${leftBorder} rounded-2xl p-5 shadow-lg relative overflow-hidden backdrop-blur-sm group hover:border-slate-700/80 hover:bg-slate-900/80 transition-all duration-200`}
                                >
                                  <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.01] rounded-bl-full pointer-events-none" />
                                  <p className="text-slate-200 text-sm font-medium leading-relaxed italic pr-2">
                                    "{note.value}"
                                  </p>
                                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-850/60">
                                    <div className="h-6 w-6 rounded-full bg-slate-800 border border-slate-750 flex items-center justify-center text-[10px] font-bold text-indigo-400 capitalize">
                                      {note.participantName ? note.participantName.charAt(0) : "A"}
                                    </div>
                                    <span className="text-[10px] text-slate-505 font-extrabold truncate">
                                      {note.participantName || "Anonymous"}
                                    </span>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>

                    {/* Footer Info */}
                    <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-900/80 pt-6 z-10 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Broadcasting responses feed</span>
                      </div>
                      <span>Total Submissions: {total} responses</span>
                    </div>
                  </div>
                );
              }
              return null;
            })()
          )}

          {/* Floating Reactions Tray overlay */}
          <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
            <AnimatePresence>
              {reactions.map((react) => (
                <motion.div
                  key={react.id}
                  initial={{ y: "105vh", opacity: 1, scale: 0.8, x: `${react.x}vw` }}
                  animate={{ 
                    y: "-10vh", 
                    opacity: 0, 
                    scale: 1.5,
                    x: `${react.x + (Math.random() * 10 - 5)}vw` 
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 3.5, ease: "easeOut" }}
                  className="absolute text-4xl"
                >
                  {react.type === "heart" && "❤️"}
                  {react.type === "clap" && "👏"}
                  {react.type === "fire" && "🔥"}
                  {react.type === "laugh" && "😂"}
                  {react.type === "shock" && "😮"}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Floating Quick Slide Navigation Popover */}
          {showSlidePickerPopup && (
            <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-50 bg-slate-950/95 backdrop-blur-xl border border-slate-800 p-4 rounded-3xl shadow-2xl w-80 max-h-72 overflow-y-auto flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-3 duration-200">
              <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-1">
                <span className="text-[10px] font-bold text-slate-550 uppercase tracking-wider">Quick Navigation</span>
                <button onClick={() => setShowSlidePickerPopup(false)} className="text-slate-500 hover:text-slate-350">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 overflow-y-auto pr-1">
                {slides.map((slide, idx) => {
                  const slideNum = idx + 1;
                  const isCurrent = session.currentSlide === slideNum;
                  return (
                    <button
                      key={slide.id}
                      onClick={() => {
                        const autoInteractId = (slide && slide.isInteractive) ? "primary" : null;
                        updateSession({ currentSlide: slideNum, activeInteractionId: autoInteractId });
                        setShowSlidePickerPopup(false);
                      }}
                      className={`aspect-square rounded-xl border flex flex-col items-center justify-center font-extrabold text-xs transition-all ${
                        isCurrent
                          ? "bg-indigo-500/10 border-indigo-500 text-indigo-300 shadow-lg shadow-indigo-500/5"
                          : "bg-slate-900/40 border-slate-850 text-slate-400 hover:bg-slate-900/80 hover:text-slate-200"
                      }`}
                    >
                      <span className="text-[8px] text-slate-500 font-semibold mb-0.5">SLIDE</span>
                      <span className="text-sm">{slideNum}</span>
                      {slide.isInteractive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 mt-1" />
                      )}
                    </button>
                  );
                })}
                
                <button
                  onClick={() => {
                    updateSession({ currentSlide: slides.length + 1, activeInteractionId: null });
                    setShowSlidePickerPopup(false);
                  }}
                  className={`col-span-4 rounded-xl border py-2 px-3 font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                    session.currentSlide === slides.length + 1
                      ? "bg-indigo-500/10 border-indigo-500 text-indigo-300"
                      : "bg-slate-900/40 border-slate-850 text-slate-400 hover:bg-slate-900/80 hover:text-slate-200"
                  }`}
                >
                  <Award className="h-4 w-4" />
                  Session Leaderboard
                </button>
              </div>
            </div>
          )}

          {/* Floating Remote Toolbar */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-40 bg-slate-955/90 backdrop-blur-md border border-slate-800 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-4 transition-all opacity-30 hover:opacity-100 hover:scale-105 duration-200">
            <button
              onClick={handlePrevSlide}
              disabled={session.currentSlide <= 1}
              className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            
            <button
              onClick={() => setShowSlidePickerPopup(!showSlidePickerPopup)}
              className="text-xs font-bold text-slate-300 hover:text-white bg-slate-900/40 border border-slate-800/85 hover:border-slate-700 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 group select-none"
            >
              <span>
                {isLeaderboardSlide ? "Leaderboard" : `Slide ${session.currentSlide} of ${slides.length}`}
              </span>
              {showSlidePickerPopup ? (
                <ChevronDown className="h-3 w-3 text-slate-500 group-hover:text-slate-350" />
              ) : (
                <ChevronUp className="h-3 w-3 text-slate-500 group-hover:text-slate-350" />
              )}
            </button>

            <button
              onClick={handleNextSlide}
              disabled={session.currentSlide >= slides.length + 1}
              className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="w-px h-4 bg-slate-800" />

            {/* Interaction Action Button */}
            {interactions.length > 0 && (
              (() => {
                const slideInter = interactions[0];
                const isActive = session.activeInteractionId === slideInter.id;
                const status = session.interactionStatus || "active";
                return (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleInteraction(slideInter.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                        isActive
                          ? status === "active"
                            ? "bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30"
                            : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                          : "bg-indigo-500 hover:bg-indigo-600 text-white"
                      }`}
                    >
                      {isActive ? (
                        status === "active" ? (
                          <Square className="h-3.5 w-3.5 fill-red-450 text-red-400" />
                        ) : (
                          <Minimize className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-white text-white" />
                      )}
                      {isActive ? (status === "active" ? "Stop Interaction" : "Hide Results") : `Start ${slideInter.type}`}
                    </button>

                    {isActive && (
                      <button
                        onClick={() => handleClearResponses(slideInter.id)}
                        className="bg-red-500/10 hover:bg-red-550/20 text-red-400 border border-red-500/20 rounded-xl px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Clear Responses
                      </button>
                    )}

                    {slideInter.type === "quiz" && isActive && (
                      <button
                        onClick={handleToggleCorrectAnswer}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                          session.quizState?.showCorrectAnswer
                            ? "bg-emerald-500/15 border-emerald-500 text-emerald-400 font-extrabold"
                            : "bg-slate-800 border-slate-700 text-slate-350 hover:bg-slate-700"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {session.quizState?.showCorrectAnswer ? "Correct Answer: Shown" : "Correct Answer: Hidden"}
                      </button>
                    )}
                  </div>
                );
              })()
            )}

            {/* Q&A Button */}
            <button
              onClick={() => setShowQnaOverlay(true)}
              className="relative p-1.5 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition-all"
            >
              <MessageSquare className="h-5 w-5" />
              {qnaList.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-indigo-650 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-slate-950">
                  {qnaList.length}
                </span>
              )}
            </button>

            <div className="w-px h-4 bg-slate-800" />

            <button
              onClick={() => setShowShareModal(true)}
              className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition-all"
              title="Share Session"
            >
              <Share2 className="h-5 w-5" />
            </button>

            <div className="w-px h-4 bg-slate-800" />

            <button
              onClick={toggleFullscreen}
              className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition-all"
              title="Exit Fullscreen"
            >
              <Minimize className="h-5 w-5" />
            </button>
          </div>

          {/* Fullscreen Interaction Results Overlay */}
          {session.activeInteractionId && interactions.length > 0 && (
            (() => {
              const activeInter = interactions.find(i => i.id === session.activeInteractionId);
              if (!activeInter || activeInter.type === "wordcloud" || activeInter.type === "rating" || activeInter.type === "poll" || activeInter.type === "quiz" || activeInter.type === "opentext") return null;
              return (
                <div className="absolute right-6 top-6 bottom-24 w-80 z-30 bg-slate-955/90 backdrop-blur-md border border-slate-850 rounded-3xl p-5 shadow-2xl flex flex-col justify-center gap-4 text-left animate-in fade-in slide-in-from-right-4 duration-200">
                  <div>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-1">
                      {activeInter.type} Live Results
                    </span>
                    <h3 className="text-sm font-extrabold text-slate-200 line-clamp-2">
                      {activeInter.question}
                    </h3>
                  </div>

                  <div className="flex-1 flex flex-col justify-center max-h-[50vh] overflow-y-auto pr-1 scrollbar-thin">
                    {/* Word Cloud Results */}
                    {activeInter.type === "wordcloud" && (
                      <div className="flex flex-wrap gap-1">
                        {responses.length === 0 ? (
                          <p className="text-xs text-slate-500 italic">Waiting for words...</p>
                        ) : (
                          (() => {
                            const words: Record<string, number> = {};
                            responses.forEach(r => {
                              const w = String(r.value || "").trim();
                              if (w) words[w] = (words[w] || 0) + 1;
                            });
                            return Object.entries(words)
                              .map(([text, count]) => ({ text, count }))
                              .sort((a, b) => b.count - a.count)
                              .map((item, idx) => (
                                <span key={idx} className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-lg text-xs font-semibold">
                                  {item.text} <span className="text-[9px] text-slate-500">({item.count})</span>
                                </span>
                              ));
                          })()
                        )}
                      </div>
                    )}

                    {/* Poll/Quiz Results */}
                    {(activeInter.type === "poll" || activeInter.type === "quiz") && (
                      <div className="space-y-2">
                        {activeInter.config?.options?.map((option: string, idx: number) => {
                          const count = responses.filter(r => Number(r.value) === idx).length;
                          const percent = responses.length > 0 ? Math.round((count / responses.length) * 100) : 0;
                          const isCorrect = activeInter.type === "quiz" && activeInter.config.correctOptionIndex === idx;
                          return (
                            <div key={idx} className="space-y-1">
                              <div className="flex justify-between text-[11px] text-slate-400">
                                <span className={`truncate max-w-[150px] ${isCorrect ? "text-emerald-400 font-bold" : ""}`}>
                                  {option} {isCorrect && "✓"}
                                </span>
                                <span>{count} ({percent}%)</span>
                              </div>
                              <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-850/40">
                                <div 
                                  style={{ width: `${percent}%` }} 
                                  className={`h-full rounded-full ${isCorrect ? "bg-emerald-500" : "bg-indigo-500"}`} 
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Open Text Results */}
                    {activeInter.type === "opentext" && (
                      <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1 scrollbar-thin">
                        {responses.length === 0 ? (
                          <p className="text-xs text-slate-500 italic">Waiting for responses...</p>
                        ) : (
                          responses.map((note) => (
                            <div 
                              key={note.id} 
                              className="bg-slate-955/40 border border-slate-850 rounded-xl p-3 text-xs text-slate-300"
                            >
                              <p className="leading-relaxed mb-1">"{note.value}"</p>
                              <p className="text-[9px] text-slate-500 text-right">- {note.participantName}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* Rating Results */}
                    {activeInter.type === "rating" && (
                      <div className="flex flex-col items-center justify-center py-4 gap-2 text-center">
                        <span className="text-4xl font-black text-indigo-400">
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
                        <span className="text-[10px] text-slate-500">{responses.length} responses</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          )}

          {/* Q&A Drawer Modal Overlay */}
          {showQnaOverlay && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-slate-950/95 border border-slate-855 rounded-3xl p-6 shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col relative animate-in fade-in zoom-in-95 duration-200">
                <button
                  onClick={() => setShowQnaOverlay(false)}
                  className="absolute top-4 right-4 p-1.5 hover:bg-slate-900 border border-slate-900 text-slate-400 hover:text-slate-200 rounded-xl transition-all"
                >
                  ✕
                </button>

                <h3 className="text-base font-bold text-slate-250 mb-4 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-indigo-400" />
                  Audience Questions ({qnaList.length})
                </h3>

                <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
                  {qnaList.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic">
                      No questions asked yet.
                    </div>
                  ) : (
                    qnaList.map((q: any) => (
                      <div 
                        key={q.id} 
                        className="bg-slate-900/40 border border-slate-900 rounded-2xl p-4 flex justify-between items-center gap-4"
                      >
                        <div className="flex-1 text-left">
                          <p className="text-xs font-semibold text-slate-200 leading-snug">{q.question}</p>
                          <p className="text-[9px] text-slate-500 mt-1">Asked by {q.participantName}</p>
                        </div>
                        <div className="flex items-center gap-1.5 text-indigo-400 text-xs font-bold bg-indigo-500/10 px-2 py-1 rounded-xl">
                          <ThumbsUp className="h-3 w-3" />
                          <span>{q.upvotes?.length || 0}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
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

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowShareModal(true)}
            className="bg-indigo-650 hover:bg-indigo-705 text-white border border-indigo-500/20 rounded-xl px-4 py-2 text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-indigo-500/10"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>

          <button
            onClick={toggleFullscreen}
            className="bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 rounded-xl px-4 py-2 text-xs font-bold transition-all flex items-center gap-1.5"
          >
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
          
          <button
            onClick={handleEndSession}
            className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 rounded-xl px-4 py-2 text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <Square className="h-3.5 w-3.5 fill-red-405" />
            End Session
          </button>
        </div>
      </header>

      {/* Main remote dashboard split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Slide list Sidebar (20% width) */}
        <aside className="hidden md:flex w-56 border-r border-slate-900 bg-slate-950/40 flex-col p-4 gap-3 select-none shrink-0">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Slides List ({slides.length})
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
            {slides.map((slide, index) => {
              const isActive = session.currentSlide === index + 1;
              return (
                <button
                  key={slide.id}
                  onClick={() => {
                    const autoInteractId = (slide && slide.isInteractive) ? "primary" : null;
                    updateSession({ currentSlide: index + 1, activeInteractionId: autoInteractId });
                  }}
                  className={`w-full relative rounded-xl border overflow-hidden transition-all text-left group ${
                    isActive
                      ? "border-indigo-500 shadow-md shadow-indigo-500/10 bg-indigo-500/5"
                      : "border-slate-850 hover:border-slate-800 bg-slate-900/10"
                  }`}
                >
                  <div className="aspect-[16/9] w-full bg-slate-950 relative">
                    {slide.thumbnailUrl ? (
                      <img
                        src={slide.thumbnailUrl}
                        alt={`Slide ${index + 1}`}
                        className="w-full h-full object-contain pointer-events-none"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-slate-900 to-indigo-950 flex flex-col items-center justify-center text-[10px] text-slate-400 font-bold p-2 text-center">
                        {slide.isInteractive && (
                          <div className="flex flex-col items-center gap-1">
                            <Sparkles className="h-4 w-4 text-indigo-400 animate-pulse" />
                            <span className="capitalize">{slide.interactionType}</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Slide Number Badge */}
                    <div className="absolute bottom-1.5 left-1.5 h-4 px-1.5 bg-black/60 backdrop-blur-sm rounded flex items-center justify-center text-[9px] font-semibold text-slate-300">
                      {index + 1}
                    </div>

                    {/* Interactive Badge (Top Right) */}
                    {slide.isInteractive && (
                      <div className="absolute top-1.5 right-1.5 h-4 w-4 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-md">
                        <Sparkles className="h-2.5 w-2.5" />
                      </div>
                    )}
                  </div>
                  
                  {/* Slide details / title or question snippet */}
                  <div className="p-2 border-t border-slate-900 bg-slate-950/20">
                    <p className="text-[10px] text-slate-400 truncate font-semibold">
                      {slide.isInteractive 
                        ? slide.notes ? slide.notes.replace(/^Interactive \w+:\s*/i, "") : "Interactive Slide"
                        : `Slide ${index + 1}`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center Control Column (remaining space) */}
        <main className="flex-1 flex flex-col p-6 overflow-y-auto gap-6 border-r border-slate-900">
          
          {/* Main Slide Navigation Controller */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Active Slide
              </span>
              <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-extrabold">
                {isLeaderboardSlide ? "Leaderboard" : `${session.currentSlide} / ${slides.length}`}
              </span>
            </div>

            {/* Current Slide Frame Preview */}
            <div className="aspect-[16/9] w-full max-w-lg bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-xl mb-6 relative">
              {isLeaderboardSlide ? (
                <div className="w-full h-full bg-gradient-to-br from-indigo-950/70 to-purple-950/80 flex flex-col items-center justify-center p-4 text-center">
                  <Award className="h-8 w-8 text-yellow-400 mb-2 animate-bounce" />
                  <span className="text-sm font-black text-slate-200">Session Leaderboard</span>
                  <span className="text-[10px] text-slate-555 mt-1">
                    {interactionLeaderboard.length} participants registered
                  </span>
                  {interactionLeaderboard[0] && (
                    <div className="mt-3 text-xs bg-slate-900/60 border border-slate-800 px-3 py-1 rounded-full text-yellow-300 font-bold">
                      👑 1st: {interactionLeaderboard[0].name} ({interactionLeaderboard[0].score} pts)
                    </div>
                  )}
                </div>
              ) : currentSlideData && currentSlideData.imageUrl ? (
                <img
                  src={currentSlideData.imageUrl}
                  alt="Current slide"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-600">
                  {currentSlideData ? "Interactive Slide" : "Loading slide preview..."}
                </div>
              )}
            </div>

            {/* Giant Navigation Buttons */}
            <div className="flex flex-col gap-3 w-full max-w-md">
              <div className="flex gap-4 w-full">
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
                  disabled={session.currentSlide >= slides.length + 1}
                  className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-650 hover:from-indigo-650 hover:to-purple-750 text-white rounded-2xl py-4 font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-indigo-500/15 active:scale-98 disabled:opacity-30 disabled:pointer-events-none"
                >
                  Next
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              <button
                onClick={() => updateSession({ currentSlide: slides.length + 1, activeInteractionId: null })}
                disabled={session.currentSlide === slides.length + 1}
                className="w-full bg-slate-900/60 hover:bg-indigo-950/30 border border-slate-800 hover:border-indigo-500/30 text-indigo-400 rounded-2xl py-3.5 font-bold flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-30 disabled:pointer-events-none shadow-md shadow-indigo-950/20"
              >
                <Award className="h-4.5 w-4.5 text-indigo-400 animate-pulse" />
                Jump to Session Leaderboard
              </button>
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
              <div className="space-y-3">
                {interactions.map((inter) => {
                  const isActive = session.activeInteractionId === inter.id;
                  
                  return (
                    <div key={inter.id} className="space-y-2 bg-slate-950/20 p-2.5 border border-slate-900 rounded-2xl">
                      <button
                        onClick={() => handleToggleInteraction(inter.id)}
                        className={`w-full flex items-center justify-between p-3 border rounded-xl transition-all text-left ${
                          isActive
                            ? "bg-indigo-500/15 border-indigo-500/30 text-indigo-300 font-semibold"
                            : "bg-slate-950/40 border-slate-850 text-slate-350 hover:border-slate-800"
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className={`p-1.5 rounded-lg ${isActive ? "bg-indigo-500 text-white" : "bg-slate-900 border border-slate-800 text-slate-500"}`}>
                            {inter.type === "poll" && <BarChart2 className="h-4 w-4" />}
                            {inter.type === "quiz" && <HelpCircle className="h-4 w-4" />}
                            {inter.type === "wordcloud" && <Sparkles className="h-4 w-4" />}
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500 capitalize">{inter.type}</p>
                            <p className="text-xs font-semibold truncate max-w-[150px]">{inter.question}</p>
                          </div>
                        </div>
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-md border ${
                          isActive 
                            ? session.interactionStatus === "active" 
                              ? "bg-red-500/10 border-red-500/25 text-red-400" 
                              : "bg-slate-900 border-slate-800 text-slate-500"
                            : "bg-indigo-500/10 border-indigo-500/25 text-indigo-400"
                        }`}>
                          {isActive ? (session.interactionStatus === "active" ? "STOP" : "HIDE") : "START"}
                        </span>
                      </button>

                      {/* Live results for Word Cloud on Presenter screen */}
                      {isActive && inter.type === "wordcloud" && (
                        <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">
                              Live Words ({responses.length})
                            </span>
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                          </div>
                          {responses.length === 0 ? (
                            <p className="text-[10px] text-slate-500 italic">Waiting for submissions...</p>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto pr-1">
                              {(() => {
                                const words: Record<string, number> = {};
                                responses.forEach(r => {
                                  const w = String(r.value || "").trim();
                                  if (w) words[w] = (words[w] || 0) + 1;
                                });
                                return Object.entries(words)
                                  .map(([text, count]) => ({ text, count }))
                                  .sort((a, b) => b.count - a.count)
                                  .map((item, idx) => (
                                    <span 
                                      key={idx} 
                                      className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-lg text-[10px] font-semibold flex items-center gap-1"
                                    >
                                      {item.text}
                                      <span className="text-[9px] text-slate-505 font-normal">({item.count})</span>
                                    </span>
                                  ));
                              })()}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Live results for Polls / Quizzes on Presenter screen */}
                      {isActive && (inter.type === "poll" || inter.type === "quiz") && (
                        <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                            <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">
                              Live Results ({responses.length} votes)
                            </span>
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                          </div>
                          {responses.length === 0 ? (
                            <p className="text-[10px] text-slate-500 italic">Waiting for votes...</p>
                          ) : (
                            <div className="space-y-2">
                              {inter.config?.options?.map((option: string, idx: number) => {
                                const count = responses.filter(r => Number(r.value) === idx).length;
                                const percent = responses.length > 0 ? Math.round((count / responses.length) * 100) : 0;
                                const revealCorrect = session.quizState?.showCorrectAnswer || false;
                                const isCorrect = inter.type === "quiz" && revealCorrect && inter.config.correctOptionIndex === idx;
                                return (
                                  <div key={idx} className="space-y-1">
                                    <div className="flex justify-between text-[10px] text-slate-400">
                                      <span className={`truncate max-w-[150px] ${isCorrect ? "text-emerald-400 font-bold" : ""}`}>
                                        {option} {isCorrect && "✓"}
                                      </span>
                                      <span>{count} ({percent}%)</span>
                                    </div>
                                    <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-850/40">
                                      <div 
                                        style={{ width: `${percent}%` }} 
                                        className={`h-full rounded-full ${isCorrect ? "bg-emerald-500" : "bg-indigo-500"}`} 
                                      />
                                    </div>
                                  </div>
                                );
                              })}

                              {inter.type === "quiz" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleCorrectAnswer();
                                  }}
                                  className={`w-full mt-2 py-2 px-3 border rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                                    session.quizState?.showCorrectAnswer
                                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                                  }`}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  {session.quizState?.showCorrectAnswer ? "Hide Correct Answer" : "Reveal Correct Answer"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Live results for Open Text on Presenter screen */}
                      {isActive && inter.type === "opentext" && (
                        <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                            <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">
                              Live Responses ({responses.length})
                            </span>
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                          </div>
                          {responses.length === 0 ? (
                            <p className="text-[10px] text-slate-500 italic">Waiting for responses...</p>
                          ) : (
                            <div className="space-y-2 max-h-36 overflow-y-auto pr-1 scrollbar-thin">
                              {responses.map((note) => (
                                <div key={note.id} className="bg-slate-900 border border-slate-850 rounded-xl p-2.5 text-[10px] text-slate-355">
                                  <p className="leading-relaxed">"{note.value}"</p>
                                  <p className="text-[8px] text-slate-500 text-right mt-1">- {note.participantName}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Live results for Star Rating on Presenter screen */}
                      {isActive && inter.type === "rating" && (
                        <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                            <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">
                              Live Average
                            </span>
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="text-2xl font-black text-indigo-400">
                                {(
                                  responses.reduce((acc, curr) => acc + Number(curr.value), 0) / 
                                  Math.max(responses.length, 1)
                                ).toFixed(1)}
                              </span>
                              <span className="text-[9px] text-slate-500">{responses.length} responses</span>
                            </div>
                            <div className="flex gap-0.5 text-slate-700">
                              {[1, 2, 3, 4, 5].map((idx) => {
                                const average = responses.reduce((acc, curr) => acc + Number(curr.value), 0) / Math.max(responses.length, 1);
                                const filled = idx <= Math.round(average);
                                return (
                                  <span key={idx} className={filled ? "text-yellow-400 fill-yellow-400 text-base" : "text-base"}>
                                    ★
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearResponses(inter.id);
                        }}
                        className="w-full mt-2 bg-red-500/10 hover:bg-red-550/20 text-red-400 border border-red-500/20 rounded-xl py-2 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Clear Responses
                      </button>
                    </div>
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
        </>
      )}

      {/* SHARE MODAL POPUP */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShareModal(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="relative bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl z-10 flex flex-col items-center text-center space-y-6 overflow-hidden"
            >
              {/* Decorative glows */}
              <div className="absolute top-[-30%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/10 blur-[80px] pointer-events-none" />
              <div className="absolute bottom-[-30%] left-[-10%] w-[60%] h-[60%] rounded-full bg-emerald-500/5 blur-[80px] pointer-events-none" />

              {/* Close Button */}
              <button
                onClick={() => setShowShareModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-all"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="space-y-1">
                <h3 className="text-xl font-black bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent flex items-center justify-center gap-2">
                  <Share2 className="h-5 w-5 text-indigo-400" />
                  Share Session
                </h3>
                <p className="text-xs text-slate-500">Invite participants to interact live</p>
              </div>

              {/* Code Display Card */}
              <div className="w-full bg-slate-950/80 border border-slate-850 rounded-2xl p-4 flex items-center justify-between">
                <div className="text-left">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Room Code</span>
                  <span className="text-2xl font-black text-indigo-400 tracking-wider uppercase leading-none">{sessionId}</span>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl px-3 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  {copiedCode ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* QR Code Container */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/10 shadow-lg shadow-black/40 flex items-center justify-center aspect-square w-52 max-w-full">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(
                    typeof window !== "undefined"
                      ? `${window.location.protocol}//${window.location.host}/join?code=${sessionId}`
                      : `https://interactdeck.com/join?code=${sessionId}`
                  )}`}
                  alt="Session Join QR Code"
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Link Copy Input */}
              <div className="w-full space-y-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block text-left px-1">Join Link</span>
                <div className="flex gap-1.5 w-full">
                  <div className="flex-1 bg-slate-950/80 border border-slate-850 rounded-xl px-3 py-2 text-xs font-medium text-slate-400 truncate text-left select-all flex items-center">
                    {typeof window !== "undefined"
                      ? `${window.location.host}/join?code=${sessionId}`
                      : `interactdeck.com/join?code=${sessionId}`}
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="bg-indigo-600 hover:bg-indigo-750 text-white rounded-xl px-3 py-2 text-xs font-bold transition-all shadow-md shadow-indigo-500/10 flex items-center justify-center shrink-0"
                  >
                    {copied ? "Copied!" : "Copy URL"}
                  </button>
                </div>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
