"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Users, 
  HelpCircle, 
  BarChart2, 
  Clock, 
  Award,
  MessageSquare,
  Sparkles,
  QrCode,
  Loader2,
  Star,
  Maximize,
  Minimize,
  Presentation
} from "lucide-react";
import { 
  doc, 
  collection, 
  onSnapshot, 
  getDoc,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { ref as dbRef, onValue, onChildAdded, off } from "firebase/database";
import { db, rtdb } from "@/lib/firebaseClient";
import { AnimatePresence, motion } from "framer-motion";
import { calculateLeaderboard } from "@/lib/leaderboard";
import { getTheme } from "@/lib/theme";

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
  aspectRatio: number;
  isInteractive?: boolean;
  interactionType?: string;
}

interface Interaction {
  id: string;
  type: string;
  question: string;
  position: { x: number; y: number };
  config: any;
}

interface ResponseItem {
  id: string;
  interactionId: string;
  participantToken: string;
  participantName: string;
  value: any;
  isCorrect: boolean | null;
  score: number;
}

interface FloatingEmoji {
  id: string;
  type: string;
  x: number;
  y: number;
}

export default function ProjectorCastPage() {
  const { joinCode } = useParams() as { joinCode: string };
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [presentationTheme, setPresentationTheme] = useState<string>("dark-indigo");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlide, setActiveSlide] = useState<Slide | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<Interaction | null>(null);

  // Load presentation theme
  useEffect(() => {
    if (!session?.presentationId) return;
    getDoc(doc(db, "presentations", session.presentationId)).then((snap) => {
      if (snap.exists()) {
        setPresentationTheme(snap.data()?.colorTheme || "dark-indigo");
      }
    });
  }, [session?.presentationId]);
  
  // Real-time Aggregated Responses in RAM (Firestore listen)
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [allResponses, setAllResponses] = useState<any[]>([]);
  const [qnaList, setQnaList] = useState<any[]>([]);
  
  // Ephemeral Floating Reactions (RTDB listen)
  const [reactions, setReactions] = useState<FloatingEmoji[]>([]);
  
  // Realtime Laser Pointer Coordinates (RTDB listen)
  const [laserPointer, setLaserPointer] = useState<{ x: number; y: number; active: boolean } | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // 1. Fetch Session & Slide Metadata
  useEffect(() => {
    if (!joinCode) return;

    const sessionRef = doc(db, "sessions", joinCode);
    const unsubscribe = onSnapshot(sessionRef, async (docSnap) => {
      if (!docSnap.exists()) {
        router.push("/join");
        return;
      }
      
      const sessionData = { id: docSnap.id, ...docSnap.data() } as Session;
      setSession(sessionData);

      // Load slides if empty
      if (slides.length === 0) {
        const slidesRef = collection(db, "presentations", sessionData.presentationId, "slides");
        const snap = await getDocs(slidesRef);
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Slide[];
        list.sort((a, b) => parseInt(a.id) - parseInt(b.id));
        setSlides(list);
      }
    });

    return () => unsubscribe();
  }, [joinCode, router, slides.length]);

  // Update active slide when session slide changes
  useEffect(() => {
    if (!session || slides.length === 0) return;
    const current = slides.find(s => parseInt(s.id) === session.currentSlide);
    setActiveSlide(current || null);
  }, [session?.currentSlide, slides]);

  // 2. Listen to Active Interaction Metadata
  useEffect(() => {
    if (!session || !session.activeInteractionId || !session.currentSlide) {
      setActiveInteraction(null);
      setResponses([]);
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

    const unsubInteract = onSnapshot(interactionRef, (docSnap) => {
      if (docSnap.exists()) {
        setActiveInteraction({ id: docSnap.id, ...docSnap.data() } as Interaction);
      } else {
        setActiveInteraction(null);
      }
    });

    // 3. Listen to Responses for this Session/Interaction (Aggregated in browser RAM)
    const responsesRef = collection(db, "sessions", joinCode, "responses");
    const q = query(responsesRef, where("interactionId", "==", session.activeInteractionId));
    const unsubResponses = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as ResponseItem[];
      setResponses(list);
    });

    return () => {
      unsubInteract();
      unsubResponses();
    };
  }, [session?.activeInteractionId, session?.currentSlide, session?.presentationId, joinCode]);

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

  // Listen to Q&A List (for leaderboard calculation)
  useEffect(() => {
    if (!joinCode) return;
    const qnaRef = collection(db, "sessions", joinCode, "qna");
    const unsubscribe = onSnapshot(qnaRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setQnaList(list);
    });
    return () => unsubscribe();
  }, [joinCode]);

  const interactionLeaderboard = React.useMemo(() => {
    return calculateLeaderboard(allResponses, qnaList);
  }, [allResponses, qnaList]);

  const isLeaderboardSlide = session && slides.length > 0 && session.currentSlide === slides.length + 1;

  // 4. Connect Ephemeral RTDB Listeners (reactions & laser pointer)
  useEffect(() => {
    if (!joinCode) return;

    // Listen to flying reactions
    const reactionsRef = dbRef(rtdb, `sessions/${joinCode}/reactions`);
    const unsubReactions = onChildAdded(reactionsRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const id = snapshot.key || Math.random().toString();
        const emojiType = val.type;
        const newReaction: FloatingEmoji = {
          id,
          type: emojiType,
          x: Math.random() * 80 + 10, // Random bottom horizontal offset (10% - 90%)
          y: 100, // Starts at bottom
        };
        
        setReactions((prev) => [...prev, newReaction]);

        // Auto-remove reaction from local memory after animation finishes
        setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 3000);
      }
    });

    // Listen to laser pointer
    const pointerRef = dbRef(rtdb, `sessions/${joinCode}/drawing/laserPointer`);
    const unsubPointer = onValue(pointerRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        setLaserPointer(val);
      } else {
        setLaserPointer(null);
      }
    });

    return () => {
      off(reactionsRef);
      off(pointerRef);
    };
  }, [joinCode]);

  // Aggregate Poll/Quiz options
  const getAggregatedData = () => {
    if (!activeInteraction || !activeInteraction.config.options) return [];
    const options = activeInteraction.config.options as string[];
    const tallies = options.map((opt, index) => {
      const count = responses.filter(r => r.value === index).length;
      return {
        option: opt,
        index,
        count,
        percent: responses.length > 0 ? Math.round((count / responses.length) * 100) : 0
      };
    });
    return tallies;
  };

  // Aggregate word cloud items
  const getWordCloudData = () => {
    const frequencyMap: Record<string, number> = {};
    responses.forEach(r => {
      const text = String(r.value).trim().toLowerCase();
      if (text) {
        frequencyMap[text] = (frequencyMap[text] || 0) + 1;
      }
    });
    return Object.entries(frequencyMap).map(([text, count]) => ({
      text,
      count
    })).sort((a, b) => b.count - a.count);
  };

  const aggregatedTallies = getAggregatedData();
  const wordCloudWords = getWordCloudData();

  if (session && !session.isActive) {
    return (
      <div className="flex-1 bg-slate-950 text-slate-100 flex flex-col relative overflow-hidden h-screen w-screen justify-center items-center p-12 text-center space-y-8 animate-in fade-in duration-300">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-650 rounded-full blur-3xl opacity-30 animate-pulse" style={{ width: "200px", height: "200px", transform: "translate(-50%, -50%)", left: "50%", top: "50%" }} />
          <div className="relative p-8 bg-slate-900 border border-slate-800 rounded-full text-indigo-400 w-fit mx-auto shadow-2xl">
            <Presentation className="h-16 w-16 animate-pulse" />
          </div>
        </div>
        <div className="space-y-3 max-w-lg z-10">
          <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 via-slate-200 to-indigo-200">
            Presentation Concluded
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Thank you for attending. The live session is now closed.
          </p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 backdrop-blur-md px-6 py-3 rounded-2xl text-xs font-bold text-slate-400 flex items-center gap-2 shadow-xl z-10">
          <Users className="h-4 w-4 text-indigo-400" />
          <span>Room Code: {joinCode}</span>
        </div>
      </div>
    );
  }

  const theme = getTheme(presentationTheme);

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 flex flex-col relative overflow-hidden h-screen w-screen justify-center items-center">
      
      {/* Fullscreen Toggle Button in Top-Left Corner */}
      <button
        onClick={toggleFullscreen}
        className="absolute top-6 left-6 z-20 p-3 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl text-slate-400 hover:text-white shadow-2xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      >
        {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
      </button>

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

      {/* Join QR Card overlay in Top-Right Corner */}
      <div className="absolute top-6 right-6 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex items-center gap-4 z-20 shadow-2xl">
        <div className="bg-white p-1 rounded-lg">
          {/* Simple Mock QR using Lucide icon */}
          <QrCode className="h-10 w-10 text-slate-950" />
        </div>
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Join session</p>
          <p className="text-sm font-bold text-slate-200">interactdeck.com/join</p>
          <p className="text-lg font-extrabold text-indigo-400 leading-none">Code: {joinCode}</p>
        </div>
      </div>

      {/* Main aspect-locked slides panel */}
      {isLeaderboardSlide || activeSlide ? (
        <div
          ref={containerRef}
          className="relative border border-slate-900 bg-black overflow-hidden shadow-2xl transition-all duration-300 flex"
          style={{
            width: "90%",
            height: "90%",
            maxWidth: "1400px",
            aspectRatio: activeSlide?.aspectRatio || 1.777,
          }}
        >
          {isLeaderboardSlide ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-955 p-8 overflow-y-auto w-full h-full">
              {/* Background Glow */}
              <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-indigo-500/10 to-purple-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

              <div className="text-center mb-6 z-10">
                <div className="flex justify-center items-center gap-3 mb-2 animate-in slide-in-from-top duration-300">
                  <Award className="h-10 w-10 text-yellow-405 animate-bounce" />
                  <h1 className="text-4xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 via-slate-100 to-purple-200">
                    Session Leaderboard
                  </h1>
                </div>
                <p className="text-xs text-slate-400">
                  Top engaged participants based on responses and Q&A interactions
                </p>
              </div>

              {interactionLeaderboard.length === 0 ? (
                <div className="text-center py-10 bg-slate-900/40 border border-slate-855 rounded-3xl p-6 max-w-sm w-full z-10">
                  <Users className="h-10 w-10 text-slate-650 mx-auto mb-3 animate-pulse" />
                  <h3 className="text-sm font-bold text-slate-350">No Interactions Yet</h3>
                  <p className="text-[11px] text-slate-550 mt-1.5">
                    Waiting for participants to answer quiz questions or ask Q&A questions.
                  </p>
                </div>
              ) : (
                <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch z-10">
                  {/* Left Podium (top 3) */}
                  <div className="md:col-span-5 flex flex-col items-center justify-end gap-3 pt-8 min-h-[260px] bg-slate-900/20 border border-slate-900/60 rounded-2xl p-5">
                    <div className="flex items-end justify-center w-full gap-3 h-full">
                      {/* 2nd Place */}
                      {interactionLeaderboard[1] && (
                        <div className="flex flex-col items-center flex-1 animate-in slide-in-from-bottom duration-500 delay-150">
                          <div className="text-[10px] font-bold text-slate-300 text-center truncate max-w-[80px] mb-1.5">
                            {interactionLeaderboard[1].name}
                          </div>
                          <div className="h-24 w-20 bg-gradient-to-t from-slate-900 to-slate-800/80 border border-slate-700/30 rounded-t-xl flex flex-col items-center justify-between p-2.5 shadow-lg relative">
                            <span className="absolute -top-5 text-xl">🥈</span>
                            <div className="text-base font-extrabold text-slate-300">2nd</div>
                            <div className="text-[10px] font-bold text-indigo-305">{interactionLeaderboard[1].score} pts</div>
                          </div>
                        </div>
                      )}

                      {/* 1st Place */}
                      {interactionLeaderboard[0] && (
                        <div className="flex flex-col items-center flex-1 animate-in slide-in-from-bottom duration-500">
                          <div className="text-xs font-black text-yellow-450 text-center truncate max-w-[90px] mb-1.5">
                            {interactionLeaderboard[0].name}
                          </div>
                          <div className="h-32 w-24 bg-gradient-to-t from-indigo-950/70 to-indigo-900/50 border-2 border-yellow-500/40 rounded-t-2xl flex flex-col items-center justify-between p-3.5 shadow-xl relative">
                            <span className="absolute -top-7 text-3xl animate-bounce">👑</span>
                            <div className="text-lg font-black text-yellow-405">1st</div>
                            <div className="text-xs font-black text-yellow-300">{interactionLeaderboard[0].score} pts</div>
                          </div>
                        </div>
                      )}

                      {/* 3rd Place */}
                      {interactionLeaderboard[2] && (
                        <div className="flex flex-col items-center flex-1 animate-in slide-in-from-bottom duration-500 delay-300">
                          <div className="text-[10px] font-bold text-orange-355 text-center truncate max-w-[80px] mb-1.5">
                            {interactionLeaderboard[2].name}
                          </div>
                          <div className="h-20 w-20 bg-gradient-to-t from-slate-900 to-slate-800/80 border border-slate-700/30 rounded-t-xl flex flex-col items-center justify-between p-2 shadow-lg relative">
                            <span className="absolute -top-5 text-xl">🥉</span>
                            <div className="text-sm font-bold text-orange-400">3rd</div>
                            <div className="text-[10px] font-bold text-indigo-305">{interactionLeaderboard[2].score} pts</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Table standings (4-10) */}
                  <div className="md:col-span-7 bg-slate-900/45 backdrop-blur-sm border border-slate-850 rounded-2xl p-5 shadow-xl w-full flex flex-col justify-between max-h-[350px]">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                      Standings
                    </h3>
                    <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                      {interactionLeaderboard.slice(0, 8).map((player, idx) => {
                        const rank = idx + 1;
                        return (
                          <div 
                            key={player.token}
                            className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all animate-in fade-in duration-300 delay-${idx * 50} ${
                              rank === 1 
                                ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300" 
                                : rank === 2 
                                ? "bg-slate-300/10 border-slate-300/20 text-slate-200" 
                                : rank === 3 
                                ? "bg-orange-555/10 border-orange-500/20 text-orange-300" 
                                : "bg-slate-950/45 border-slate-900 text-slate-350 hover:bg-slate-900/25"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-4 font-black text-center text-[10px] text-slate-550">{rank}</span>
                              <span className="font-bold truncate max-w-[150px]">{player.name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-455">
                              <span title="Quizzes Correct" className="flex items-center gap-0.5">🎯 {player.quizCorrectCount}</span>
                              <span title="Total Responses" className="flex items-center gap-0.5">🗳️ {player.responsesCount}</span>
                              <span title="Questions Asked" className="flex items-center gap-0.5">❓ {player.questionsAskedCount}</span>
                              <span className="font-extrabold text-xs text-slate-200 min-w-[60px] text-right">
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
          ) : (
            <>
              {/* 1. LEFT PANEL: SLIDE IMAGE / DYNAMIC GRADIENT */}
              {(!activeSlide?.isInteractive || (activeSlide?.isInteractive && activeInteraction?.type === "wordcloud")) && (
                <div className={`relative flex items-center justify-center transition-all duration-300 ${activeInteraction && activeInteraction.type !== "wordcloud" ? "w-1/2 border-r border-slate-900" : "w-full h-full"} ${activeSlide?.isInteractive ? theme.gradientClass : "bg-black"}`}>
                  {activeSlide?.isInteractive ? (
                    <div className="absolute inset-0 pointer-events-none" />
                  ) : (
                    <img
                      src={activeSlide?.imageUrl}
                      alt="Current Slide View"
                      className="w-full h-full object-contain pointer-events-none select-none"
                    />
                  )}

                  {/* Laser Pointer overlay - bound within the slide aspect-ratio container */}
                  {laserPointer?.active && (
                    <div
                      className="absolute h-5 w-5 bg-red-500 rounded-full blur-[2px] shadow-lg shadow-red-500/80 animate-ping z-45 transition-all duration-75 pointer-events-none"
                      style={{
                        left: `${laserPointer.x * 100}%`,
                        top: `${laserPointer.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    />
                  )}

                  {/* Dynamic Spreading Word Cloud Overlay directly on top of the slide page */}
                  {activeInteraction && activeInteraction.type === "wordcloud" && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-black/45 backdrop-blur-[2px]">
                      {wordCloudWords.length === 0 ? (
                        <div className="text-center space-y-2">
                          <Sparkles className="h-8 w-8 text-indigo-400 animate-pulse mx-auto" />
                          <span className="text-xs text-slate-500 italic block">Waiting for words...</span>
                        </div>
                      ) : (
                        wordCloudWords.map((item, idx) => {
                          const maxCount = Math.max(...wordCloudWords.map(w => w.count), 1);
                          const minSize = 16;
                          const maxSize = 52;
                          const size = minSize + (item.count / maxCount) * (maxSize - minSize);
                          
                          // Spiral distribution angles spreading from the middle
                          const angle = (idx * 137.5) * (Math.PI / 180);
                          const radius = Math.sqrt(idx + 1) * 85; 
                          const tx = Math.cos(angle) * radius;
                          const ty = Math.sin(angle) * radius;
                          
                          const colors = [
                            "text-indigo-350", 
                            "text-purple-300", 
                            "text-pink-300", 
                            "text-blue-300", 
                            "text-teal-300", 
                            "text-yellow-200", 
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
                  )}
                </div>
              )}

              {/* 2. RIGHT PANEL (OR FULLSCREEN): INTERACTION RESULTS */}
              {activeInteraction && activeInteraction.type !== "wordcloud" && (
                <div
                  className={`flex flex-col justify-center p-8 backdrop-blur-xl ${
                    activeSlide?.isInteractive
                      ? `${theme.gradientClass} p-16 w-full h-full`
                      : "w-1/2 h-full bg-slate-950/85"
                  }`}
                >
                  <div>
                    <div className={`flex items-center gap-2 mb-2 ${theme.isLight && activeSlide?.isInteractive ? "text-indigo-650" : "text-indigo-400"}`}>
                      {activeInteraction.type === "poll" && <BarChart2 className="h-5 w-5" />}
                      {activeInteraction.type === "quiz" && <HelpCircle className="h-5 w-5" />}
                      {activeInteraction.type === "opentext" && <MessageSquare className="h-5 w-5" />}
                      {activeInteraction.type === "rating" && <Star className="h-5 w-5 text-yellow-400 fill-yellow-400" />}
                      <span className="text-[10px] font-bold tracking-widest uppercase">{activeInteraction.type}</span>
                    </div>
                    <h2 className={`font-extrabold leading-snug mb-8 ${activeSlide?.isInteractive ? `text-3xl ${theme.textClass}` : "text-lg text-slate-100"}`}>
                      {activeInteraction.question}
                    </h2>
                  </div>

                  {/* RENDER DYNAMIC AGGREGATED INTERACTION COMPONENT */}
                  <div className="space-y-4 flex-1 flex flex-col justify-center">
                    {/* 1. POLLS / QUIZ OPTION RESULTS */}
                    {(activeInteraction.type === "poll" || activeInteraction.type === "quiz") && (
                      <div className="space-y-4">
                        {aggregatedTallies.map((tally) => {
                          const isCorrectAnswer = 
                            activeInteraction.type === "quiz" && 
                            activeInteraction.config.correctOptionIndex === tally.index;
                            
                          return (
                            <div key={tally.index} className="space-y-1.5">
                              <div className={`flex justify-between text-xs font-semibold ${theme.isLight && activeSlide?.isInteractive ? "text-slate-800" : "text-slate-350"}`}>
                                <span className={isCorrectAnswer ? "text-emerald-500 font-bold" : ""}>
                                  {tally.option} {isCorrectAnswer && "✓"}
                                </span>
                                <span className={`font-bold ${theme.isLight && activeSlide?.isInteractive ? "text-slate-700" : "text-slate-300"}`}>{tally.count} votes ({tally.percent}%)</span>
                              </div>
                              <div className={`w-full ${theme.isLight && activeSlide?.isInteractive ? "bg-slate-200/80 border border-slate-300" : "bg-slate-900 border border-slate-850"} rounded-full h-4 overflow-hidden`}>
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${tally.percent}%` }}
                                  className={`h-full rounded-full ${
                                    isCorrectAnswer
                                      ? "bg-emerald-500"
                                      : "bg-gradient-to-r from-indigo-500 to-purple-650"
                                  }`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 3. OPEN TEXT STICKY NOTES */}
                    {activeInteraction.type === "opentext" && (
                      <div className="grid grid-cols-2 gap-4 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
                        {responses.length === 0 ? (
                          <div className="col-span-2 text-xs text-slate-500 text-center py-12 italic">
                            Waiting for audience inputs...
                          </div>
                        ) : (
                          responses.map((note) => (
                            <motion.div 
                              key={note.id} 
                              initial={{ scale: 0.9, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className={`${theme.isLight && activeSlide?.isInteractive ? "bg-white border-slate-200 text-slate-800 shadow-md" : "bg-slate-900 border border-slate-855 text-slate-200"} border rounded-2xl p-4 shadow-lg border-l-4 border-l-indigo-500 text-xs`}
                        >
                              <p className="leading-relaxed mb-2 font-medium">"{note.value}"</p>
                              <p className={`text-[10px] ${theme.isLight && activeSlide?.isInteractive ? "text-slate-500" : "text-slate-500"} text-right`}>- {note.participantName}</p>
                            </motion.div>
                          ))
                        )}
                      </div>
                    )}

                    {/* 4. RATING STACKS */}
                    {activeInteraction.type === "rating" && (
                      <div className="flex flex-col items-center justify-center py-8 gap-3">
                        <span className={`text-5xl font-extrabold ${theme.isLight && activeSlide?.isInteractive ? "text-indigo-650" : "text-indigo-400"} tracking-tight drop-shadow-md`}>
                          {(
                            responses.reduce((acc, curr) => acc + Number(curr.value), 0) / 
                            Math.max(responses.length, 1)
                          ).toFixed(1)}
                        </span>
                        <div className={`flex gap-1.5 ${theme.isLight && activeSlide?.isInteractive ? "text-slate-400" : "text-slate-700"}`}>
                          {[1, 2, 3, 4, 5].map((idx) => {
                            const average = responses.reduce((acc, curr) => acc + Number(curr.value), 0) / Math.max(responses.length, 1);
                            const filled = idx <= Math.round(average);
                            return (
                              <span key={idx} className={filled ? "text-yellow-400 fill-yellow-400 text-2xl" : "text-2xl"}>
                                ★
                              </span>
                            );
                          })}
                        </div>
                        <span className={`text-xs ${theme.isLight && activeSlide?.isInteractive ? "text-slate-700 font-bold" : "text-slate-500 font-semibold"}`}>{responses.length} responses</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-500">Connecting Cast Screen...</p>
        </div>
      )}
    </div>
  );
}
