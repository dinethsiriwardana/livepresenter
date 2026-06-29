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
  Presentation
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
  const [activeTab, setActiveTab] = useState<"presentation" | "qna">("presentation");
  const [qnaList, setQnaList] = useState<QnaQuestion[]>([]);
  const [qnaText, setQnaText] = useState("");

  // Input states for interaction
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [textVal, setTextVal] = useState("");
  const [ratingVal, setRatingVal] = useState(0);

  // Active slide details & responses aggregation
  const [activeSlide, setActiveSlide] = useState<{ imageUrl?: string; isInteractive?: boolean } | null>(null);
  const [responses, setResponses] = useState<any[]>([]);

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
    if (!joinCode || !session?.activeInteractionId) {
      setResponses([]);
      return;
    }

    const responsesRef = collection(db, "sessions", joinCode, "responses");
    const q = query(responsesRef, where("interactionId", "==", session.activeInteractionId));
    
    const unsubResponses = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setResponses(list);
    });

    return () => unsubResponses();
  }, [joinCode, session?.activeInteractionId]);

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

      {/* Tab Selector */}
      <div className="w-full max-w-md mx-auto px-6 pt-4 flex gap-2">
        <button
          onClick={() => setActiveTab("presentation")}
          className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "presentation"
              ? "bg-indigo-500 border-indigo-400 text-white shadow-md shadow-indigo-500/10"
              : "bg-slate-900 border-slate-850 text-slate-400 hover:text-slate-300"
          }`}
        >
          <Presentation className="h-4 w-4" />
          Slide View
        </button>
        <button
          onClick={() => setActiveTab("qna")}
          className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "qna"
              ? "bg-indigo-500 border-indigo-400 text-white shadow-md shadow-indigo-500/10"
              : "bg-slate-900 border-slate-850 text-slate-400 hover:text-slate-300"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Q&A Board ({qnaList.length})
        </button>
      </div>

      {/* Main content viewport */}
      <main className="flex-1 max-w-md w-full mx-auto px-6 py-6 flex flex-col justify-start overflow-y-auto max-h-[calc(100vh-170px)]">
        {activeTab === "presentation" ? (
          /* Presentation & Interactive Question tab */
          <div className="flex-1 flex flex-col justify-start">
            {/* Live Slide Preview Card */}
            {activeSlide && !activeSlide.isInteractive && activeSlide.imageUrl && (
              <div className="w-full aspect-[16/9] relative rounded-2xl overflow-hidden border border-slate-800 bg-black mb-4 shadow-lg">
                <img 
                  src={activeSlide.imageUrl} 
                  alt="Live Slide Preview" 
                  className="w-full h-full object-contain pointer-events-none select-none"
                />
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg text-[9px] font-bold text-slate-350 tracking-wider flex items-center gap-1.5 border border-slate-850">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  LIVE SLIDE {session.currentSlide}
                </div>
              </div>
            )}

            {!activeInteraction ? (
              <div className="text-center py-12 px-6 bg-slate-900/40 backdrop-blur-sm border border-slate-850 rounded-3xl space-y-4">
                <div className="p-4 bg-slate-950 border border-slate-900 rounded-2xl w-fit mx-auto text-indigo-505 animate-pulse">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-slate-250">Eyes on the screen!</h3>
                <p className="text-sm text-slate-500 font-medium">
                  The presenter has no active questions right now. We will notify you here as soon as they trigger one.
                </p>
              </div>
            ) : hasSubmitted ? (
              <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-850 rounded-3xl p-6 shadow-xl space-y-6">
                <div className="text-center">
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl w-fit mx-auto text-emerald-450 mb-3">
                    <CheckCircle className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-200">Response Registered!</h3>
                  <p className="text-xs text-slate-500 mt-1">Showing real-time results below</p>
                </div>

                <div className="border-t border-slate-850 pt-4 space-y-4">
                  {/* Results: Polls / Quizzes */}
                  {(activeInteraction.type === "poll" || activeInteraction.type === "quiz") && (
                    <div className="space-y-3">
                      {aggregatedTallies.map((tally) => {
                        const isCorrectAnswer = 
                          activeInteraction.type === "quiz" && 
                          activeInteraction.config.correctOptionIndex === tally.index;
                        return (
                          <div key={tally.index} className="space-y-1">
                            <div className="flex justify-between text-xs font-semibold text-slate-400">
                              <span className={isCorrectAnswer ? "text-emerald-400 font-bold" : ""}>
                                {tally.option} {isCorrectAnswer && "✓"}
                              </span>
                              <span>{tally.count} votes ({tally.percent}%)</span>
                            </div>
                            <div className="w-full bg-slate-950 border border-slate-850 rounded-full h-3 overflow-hidden">
                              <div
                                style={{ width: `${tally.percent}%` }}
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isCorrectAnswer ? "bg-emerald-500" : "bg-indigo-500"
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Results: Word Cloud */}
                  {activeInteraction.type === "wordcloud" && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Popular Words
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center py-2 bg-slate-950/60 border border-slate-850/50 rounded-2xl p-4">
                        {wordCloudWords.length === 0 ? (
                          <span className="text-xs text-slate-550 italic">No words submitted...</span>
                        ) : (
                          wordCloudWords.map((item, idx) => (
                            <span 
                              key={idx} 
                              style={{ fontSize: `${Math.max(11, Math.min(22, 11 + item.count * 2))}px` }}
                              className="font-bold text-indigo-400 px-1"
                            >
                              {item.text} <span className="text-[9px] text-slate-500 font-normal">({item.count})</span>
                            </span>
                          ))
                        )}
                      </div>
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
                            className="bg-slate-950/50 border border-slate-850 rounded-xl p-3 text-xs text-slate-350"
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
                            <span key={idx} className={filled ? "text-yellow-450 fill-yellow-405 text-lg" : "text-lg"}>
                              ★
                            </span>
                          );
                        })}
                      </div>
                      <span className="text-[10px] text-slate-550">{responses.length} responses</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
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
                          placeholder="Enter 1-2 words..."
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
          </div>
        ) : (
          /* Q&A Board Tab */
          <div className="space-y-6 flex-1 flex flex-col justify-start">
            
            {/* Ask Question Form */}
            <form onSubmit={handleSubmitQuestion} className="bg-slate-900 border border-slate-850 rounded-2xl p-4 space-y-3 shadow-md">
              <textarea
                required
                placeholder="Ask an anonymous question..."
                rows={2}
                value={qnaText}
                onChange={(e) => setQnaText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!qnaText.trim()}
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xs py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                Post Question
              </button>
            </form>

            {/* Questions List */}
            <div className="space-y-3 overflow-y-auto">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Audience Questions ({qnaList.length})
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
                      className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex justify-between items-center gap-4 hover:border-slate-800 transition-all"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-200 leading-snug">{q.question}</p>
                        <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
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
                        <ThumbsUp className="h-3.5 w-3.5" />
                        <span className="text-[10px]">{q.upvotes?.length || 0}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating Reactions Tray */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-4 flex justify-around items-center sticky bottom-0 z-30">
        <button
          onClick={() => handleSendReaction("heart")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110 text-lg"
        >
          ❤️
        </button>
        <button
          onClick={() => handleSendReaction("clap")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110 text-lg"
        >
          👏
        </button>
        <button
          onClick={() => handleSendReaction("fire")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110 text-lg"
        >
          🔥
        </button>
        <button
          onClick={() => handleSendReaction("laugh")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110 text-lg"
        >
          😂
        </button>
        <button
          onClick={() => handleSendReaction("shock")}
          className="p-2.5 bg-slate-900 border border-slate-850 hover:bg-slate-800 rounded-2xl transition-all hover:scale-110 text-lg"
        >
          😮
        </button>
      </footer>

    </div>
  );
}
