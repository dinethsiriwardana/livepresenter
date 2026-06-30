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
  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlide, setActiveSlide] = useState<Slide | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<Interaction | null>(null);
  
  // Real-time Aggregated Responses in RAM (Firestore listen)
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  
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
      {activeSlide ? (
        <div
          ref={containerRef}
          className="relative border border-slate-900 bg-black overflow-hidden shadow-2xl transition-all duration-300 flex"
          style={{
            width: "90%",
            height: "90%",
            maxWidth: "1400px",
            aspectRatio: activeSlide.aspectRatio || 1.777,
          }}
        >
          {/* 1. LEFT PANEL: SLIDE IMAGE (Shown if NOT standalone interactive slide) */}
          {!activeSlide.isInteractive && (
            <div className={`relative bg-black flex items-center justify-center transition-all duration-300 ${activeInteraction ? "w-1/2 border-r border-slate-900" : "w-full h-full"}`}>
              <img
                src={activeSlide.imageUrl}
                alt="Current Slide View"
                className="w-full h-full object-contain pointer-events-none select-none"
              />

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
            </div>
          )}

          {/* 2. RIGHT PANEL (OR FULLSCREEN): INTERACTION RESULTS */}
          {activeInteraction && (
            <div
              className={`flex flex-col justify-center p-8 bg-slate-950/85 backdrop-blur-xl ${
                activeSlide.isInteractive
                  ? "w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 p-16"
                  : "w-1/2 h-full"
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-2 text-indigo-400">
                  {activeInteraction.type === "poll" && <BarChart2 className="h-5 w-5" />}
                  {activeInteraction.type === "quiz" && <HelpCircle className="h-5 w-5" />}
                  {activeInteraction.type === "wordcloud" && <Sparkles className="h-5 w-5 animate-pulse" />}
                  {activeInteraction.type === "opentext" && <MessageSquare className="h-5 w-5" />}
                  {activeInteraction.type === "rating" && <Star className="h-5 w-5 text-yellow-450 fill-yellow-450" />}
                  <span className="text-[10px] font-bold tracking-widest uppercase">{activeInteraction.type}</span>
                </div>
                <h2 className={`font-extrabold text-slate-100 leading-snug mb-8 ${activeSlide.isInteractive ? "text-3xl" : "text-lg"}`}>
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
                          <div className="flex justify-between text-xs font-semibold text-slate-355">
                            <span className={isCorrectAnswer ? "text-emerald-400 font-bold" : ""}>
                              {tally.option} {isCorrectAnswer && "✓"}
                            </span>
                            <span className="font-bold text-slate-300">{tally.count} votes ({tally.percent}%)</span>
                          </div>
                          <div className="w-full bg-slate-900 border border-slate-850 rounded-full h-4 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${tally.percent}%` }}
                              className={`h-full rounded-full ${
                                isCorrectAnswer
                                  ? "bg-emerald-500"
                                  : "bg-gradient-to-r from-indigo-500 to-purple-600"
                              }`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 2. SPARKING WORD CLOUDS (Golden Spiral Distribution) */}
                {activeInteraction.type === "wordcloud" && (
                  <div className="h-72 w-full relative flex items-center justify-center overflow-hidden">
                    {wordCloudWords.length === 0 ? (
                      <span className="text-xs text-slate-500 italic">Waiting for words...</span>
                    ) : (
                      wordCloudWords.map((item, idx) => {
                        const maxCount = wordCloudWords[0]?.count || 1;
                        const minSize = 12;
                        const maxSize = 42;
                        const size = minSize + (item.count / maxCount) * (maxSize - minSize);
                        
                        // Golden spiral distribution angles
                        const angle = (idx * 137.5) * (Math.PI / 180);
                        const radius = Math.sqrt(idx) * (activeSlide.isInteractive ? 40 : 25);
                        const tx = Math.cos(angle) * radius;
                        const ty = Math.sin(angle) * radius;
                        
                        const colors = ["text-indigo-400", "text-purple-400", "text-pink-400", "text-blue-400", "text-teal-400"];
                        const colorClass = colors[idx % colors.length];

                        return (
                          <motion.span
                            key={idx}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1, x: tx, y: ty }}
                            transition={{ type: "spring", stiffness: 80, delay: idx * 0.04 }}
                            style={{ 
                              fontSize: `${size}px`,
                              position: "absolute"
                            }}
                            className={`font-extrabold tracking-tight select-none leading-none drop-shadow ${colorClass}`}
                          >
                            {item.text}
                          </motion.span>
                        );
                      })
                    )}
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
                          className="bg-slate-900 border border-slate-850 rounded-2xl p-4 shadow-lg border-l-4 border-l-indigo-500 text-xs text-slate-200"
                        >
                          <p className="leading-relaxed mb-2 font-medium">"{note.value}"</p>
                          <p className="text-[10px] text-slate-500 text-right">- {note.participantName}</p>
                        </motion.div>
                      ))
                    )}
                  </div>
                )}

                {/* 4. RATING STACKS */}
                {activeInteraction.type === "rating" && (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <span className="text-5xl font-extrabold text-indigo-400 tracking-tight drop-shadow-md">
                      {(
                        responses.reduce((acc, curr) => acc + Number(curr.value), 0) / 
                        Math.max(responses.length, 1)
                      ).toFixed(1)}
                    </span>
                    <div className="flex gap-1.5 text-slate-700">
                      {[1, 2, 3, 4, 5].map((idx) => {
                        const average = responses.reduce((acc, curr) => acc + Number(curr.value), 0) / Math.max(responses.length, 1);
                        const filled = idx <= Math.round(average);
                        return (
                          <span key={idx} className={filled ? "text-yellow-450 fill-yellow-450 text-2xl" : "text-2xl"}>
                            ★
                          </span>
                        );
                      })}
                    </div>
                    <span className="text-xs text-slate-500 font-semibold">{responses.length} responses</span>
                  </div>
                )}
              </div>
            </div>
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
