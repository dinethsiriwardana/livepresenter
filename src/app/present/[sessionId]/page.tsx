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
  X
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reactions, setReactions] = useState<any[]>([]);
  const [qnaList, setQnaList] = useState<any[]>([]);
  const [showQnaOverlay, setShowQnaOverlay] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

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
    if (!sessionId || !session?.activeInteractionId) {
      setResponses([]);
      return;
    }

    const responsesRef = collection(db, "sessions", sessionId, "responses");
    const q = query(responsesRef, where("interactionId", "==", session.activeInteractionId));
    
    const unsubResponses = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setResponses(list);
    });

    return () => unsubResponses();
  }, [sessionId, session?.activeInteractionId]);

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
    if (!sessionId) return;
    if (!confirm("Are you sure you want to clear all responses for this interaction? This cannot be undone.")) return;
    
    try {
      const responsesRef = collection(db, "sessions", sessionId, "responses");
      const q = query(responsesRef, where("interactionId", "==", interactionId));
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
          
          {/* Active slide image */}
          {currentSlideData ? (
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

          {/* Dynamic Spreading Word Cloud Overlay directly on top of the slide page */}
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

          {/* Floating Remote Toolbar */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-40 bg-slate-955/90 backdrop-blur-md border border-slate-800 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-4 transition-all opacity-30 hover:opacity-100 hover:scale-105 duration-200">
            <button
              onClick={handlePrevSlide}
              disabled={session.currentSlide <= 1}
              className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            
            <span className="text-xs font-bold text-slate-300 select-none">
              Slide {session.currentSlide} of {slides.length}
            </span>

            <button
              onClick={handleNextSlide}
              disabled={session.currentSlide >= slides.length}
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

                    {isActive && status === "stopped" && (
                      <button
                        onClick={() => handleClearResponses(slideInter.id)}
                        className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 rounded-xl px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-200"
                      >
                        <Trash2 className="h-3.5 w-3.5 animate-pulse" />
                        Clear Responses
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
              if (!activeInter || activeInter.type === "wordcloud") return null;
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
              {currentSlideData && currentSlideData.imageUrl ? (
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
                                const isCorrect = inter.type === "quiz" && inter.config.correctOptionIndex === idx;
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
                            </div>
                          )}
                        </div>
                      )}
                      {isActive && session.interactionStatus === "stopped" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearResponses(inter.id);
                          }}
                          className="w-full mt-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 rounded-xl py-2 text-xs font-bold transition-all flex items-center justify-center gap-1.5 animate-in fade-in zoom-in-95 duration-200"
                        >
                          <Trash2 className="h-3.5 w-3.5 animate-pulse" />
                          Clear Responses
                        </button>
                      )}
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
