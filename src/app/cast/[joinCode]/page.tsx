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
  Loader2
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

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 flex flex-col relative overflow-hidden h-screen w-screen justify-center items-center">
      
      {/* Laser Pointer overlay */}
      {laserPointer?.active && (
        <div
          className="absolute h-5 w-5 bg-red-500 rounded-full blur-[2px] shadow-lg shadow-red-500/80 animate-ping z-40 transition-all duration-75 pointer-events-none"
          style={{
            left: `${laserPointer.x * 100}%`,
            top: `${laserPointer.y * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
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
          className="relative border border-slate-900 bg-black overflow-hidden shadow-2xl transition-all duration-300"
          style={{
            width: "90%",
            height: "90%",
            maxWidth: "1400px",
            aspectRatio: activeSlide.aspectRatio || 1.777,
          }}
        >
          {/* Slide Content Image */}
          <img
            src={activeSlide.imageUrl}
            alt="Current Slide View"
            className="w-full h-full object-contain pointer-events-none select-none"
          />

          {/* REALTIME QUESTION WIDGET OVERLAY */}
          {activeInteraction && (
            <div
              className="absolute z-20 bg-slate-950/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between max-w-xl min-w-[320px] max-h-[80%] overflow-y-auto"
              style={{
                left: `${activeInteraction.position.x * 100}%`,
                top: `${activeInteraction.position.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div>
                <div className="flex items-center gap-2 mb-2 text-indigo-400">
                  {activeInteraction.type === "poll" && <BarChart2 className="h-4 w-4" />}
                  {activeInteraction.type === "quiz" && <HelpCircle className="h-4 w-4" />}
                  {activeInteraction.type === "wordcloud" && <Sparkles className="h-4 w-4" />}
                  {activeInteraction.type === "opentext" && <MessageSquare className="h-4 w-4" />}
                  <span className="text-[10px] font-bold tracking-widest uppercase">{activeInteraction.type}</span>
                </div>
                <h2 className="text-lg font-bold text-slate-100 mb-4">{activeInteraction.question}</h2>
              </div>

              {/* RENDER DYNAMIC AGGREGATED INTERACTION COMPONENT */}
              <div className="space-y-3.5 flex-1">
                {/* 1. POLLS / QUIZ OPTION RESULTS */}
                {(activeInteraction.type === "poll" || activeInteraction.type === "quiz") && (
                  <div className="space-y-3">
                    {aggregatedTallies.map((tally) => {
                      const isCorrectAnswer = 
                        activeInteraction.type === "quiz" && 
                        activeInteraction.config.correctOptionIndex === tally.index;
                        
                      return (
                        <div key={tally.index} className="space-y-1">
                          <div className="flex justify-between text-xs font-semibold text-slate-350">
                            <span className={isCorrectAnswer ? "text-emerald-400 font-bold" : ""}>
                              {tally.option} {isCorrectAnswer && "✓"}
                            </span>
                            <span>{tally.count} votes ({tally.percent}%)</span>
                          </div>
                          <div className="w-full bg-slate-900 border border-slate-850 rounded-full h-3.5 overflow-hidden">
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

                {/* 2. WORD CLOUDS */}
                {activeInteraction.type === "wordcloud" && (
                  <div className="flex flex-wrap gap-2.5 justify-center py-4">
                    {wordCloudWords.length === 0 ? (
                      <span className="text-xs text-slate-500 italic">Waiting for words...</span>
                    ) : (
                      wordCloudWords.map((item, idx) => {
                        // Calculate sizes dynamically based on tally counts
                        const minSize = 12;
                        const maxSize = 32;
                        const maxCount = wordCloudWords[0]?.count || 1;
                        const size = minSize + (item.count / maxCount) * (maxSize - minSize);
                        
                        return (
                          <span
                            key={idx}
                            style={{ fontSize: `${size}px` }}
                            className="font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent px-1.5 transition-all"
                          >
                            {item.text}
                          </span>
                        );
                      })
                    )}
                  </div>
                )}

                {/* 3. OPEN TEXT STICKY NOTES */}
                {activeInteraction.type === "opentext" && (
                  <div className="grid grid-cols-2 gap-3.5 max-h-56 overflow-y-auto">
                    {responses.length === 0 ? (
                      <div className="col-span-2 text-xs text-slate-500 text-center py-8 italic">
                        Waiting for audience inputs...
                      </div>
                    ) : (
                      responses.map((note) => (
                        <div 
                          key={note.id} 
                          className="bg-slate-900 border border-slate-850 rounded-xl p-3 shadow-md border-l-4 border-l-indigo-500 text-xs text-slate-200"
                        >
                          <p className="leading-normal mb-1">"{note.value}"</p>
                          <p className="text-[10px] text-slate-550 text-right">- {note.participantName}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* 4. RATING STACKS */}
                {activeInteraction.type === "rating" && (
                  <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <span className="text-4xl font-extrabold text-indigo-400">
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
                          <span key={idx} className={filled ? "text-yellow-450 fill-yellow-405 text-xl" : "text-xl"}>
                            ★
                          </span>
                        );
                      })}
                    </div>
                    <span className="text-xs text-slate-500">{responses.length} responses</span>
                  </div>
                )}
              </div>

              {/* Aggregation statistics footer */}
              <div className="border-t border-slate-800 pt-3 flex justify-between text-[10px] text-slate-500 mt-4">
                <span>Total Responses: {responses.length}</span>
                <span>Realtime aggregate RAM sync</span>
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
