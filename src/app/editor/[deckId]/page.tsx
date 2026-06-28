"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { 
  ArrowLeft, 
  Plus, 
  HelpCircle, 
  Trash2, 
  Save, 
  ChevronRight, 
  Settings, 
  BarChart2, 
  Clock, 
  MessageSquare, 
  Star, 
  Globe, 
  Shuffle, 
  Type,
  Video,
  PenTool,
  Loader2
} from "lucide-react";
import { 
  doc, 
  collection, 
  onSnapshot, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  addDoc, 
  updateDoc, 
  orderBy, 
  query 
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";

interface Slide {
  id: string; // slideNumber
  imageUrl: string;
  thumbnailUrl: string;
  aspectRatio: number;
  notes: string;
}

interface Interaction {
  id: string;
  type: string;
  question: string;
  position: { x: number; y: number };
  config: {
    options?: string[];
    correctOptionIndex?: number | null;
    scaleMax?: number;
    iconType?: "star" | "heart" | "thumbs-up";
    durationSeconds?: number;
    url?: string;
  };
}

export default function SlideEditorPage() {
  const { deckId } = useParams() as { deckId: string };
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [deckTitle, setDeckTitle] = useState("Loading presentation...");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [selectedSlideId, setSelectedSlideId] = useState<string>("1");
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [slideNotes, setSlideNotes] = useState("");
  
  // Selected interaction for settings panel
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null);
  
  // New interaction modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [clickPos, setClickPos] = useState({ x: 0, y: 0 });
  const [newType, setNewType] = useState("poll");
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState<string[]>(["Option A", "Option B"]);
  const [newCorrectIndex, setNewCorrectIndex] = useState<number | null>(null);
  const [newScaleMax, setNewScaleMax] = useState(5);
  const [newTimerDuration, setNewTimerDuration] = useState(30);
  const [newUrl, setNewUrl] = useState("");

  const canvasRef = useRef<HTMLDivElement>(null);
  const [generatingAi, setGeneratingAi] = useState(false);

  const handleAiGenerateQuiz = async () => {
    if (!deckId || !selectedSlideId || !slideNotes.trim()) {
      alert("Please write some slide notes first so the AI can read them!");
      return;
    }

    setGeneratingAi(true);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-questions",
          payload: slideNotes
        })
      });

      const resData = await response.json();
      if (resData.success && resData.questions) {
        const interactionsRef = collection(db, "presentations", deckId, "slides", selectedSlideId, "interactions");
        
        for (const [idx, q] of resData.questions.entries()) {
          const x = 0.3 + (idx * 0.25);
          const y = 0.55;
          
          await addDoc(interactionsRef, {
            type: "quiz",
            question: q.question,
            position: { x, y },
            config: {
              options: q.options,
              correctOptionIndex: q.correctOptionIndex
            }
          });
        }
        alert("AI generated questions placed on slide!");
      } else {
        throw new Error(resData.error || "Failed to generate questions");
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Error generating AI quiz questions.");
    } finally {
      setGeneratingAi(false);
    }
  };

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Load Presentation & Slides
  useEffect(() => {
    if (!deckId) return;

    // Fetch deck meta
    const deckRef = doc(db, "presentations", deckId);
    const unsubDeck = onSnapshot(deckRef, (docSnap) => {
      if (docSnap.exists()) {
        setDeckTitle(docSnap.data().title || "Untitled Presentation");
      } else {
        router.push("/dashboard");
      }
    });

    // Fetch slides
    const slidesRef = collection(db, "presentations", deckId, "slides");
    const unsubSlides = onSnapshot(slidesRef, (snap) => {
      const slideList = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Slide[];
      
      // Sort slides numerically by document ID (which represents slide number)
      slideList.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      setSlides(slideList);
      setLoading(false);
    });

    return () => {
      unsubDeck();
      unsubSlides();
    };
  }, [deckId, router]);

  // Load Selected Slide Notes & Interactions
  useEffect(() => {
    if (!deckId || !selectedSlideId) return;
    setSelectedInteraction(null);

    // Fetch Notes
    const slideDocRef = doc(db, "presentations", deckId, "slides", selectedSlideId);
    getDocs(collection(db, "presentations", deckId, "slides")).then((snap) => {
      const match = snap.docs.find(d => d.id === selectedSlideId);
      if (match) {
        setSlideNotes(match.data().notes || "");
      }
    });

    // Fetch Interactions
    const interactionsRef = collection(db, "presentations", deckId, "slides", selectedSlideId, "interactions");
    const unsubscribe = onSnapshot(interactionsRef, (snap) => {
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Interaction[];
      setInteractions(list);
    });

    return () => unsubscribe();
  }, [deckId, selectedSlideId]);

  const activeSlide = slides.find(s => s.id === selectedSlideId);

  // Canvas Click Handler: Calculates relative coordinates
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || showAddModal) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setClickPos({ x, y });
    setNewQuestion("");
    setNewOptions(["Option A", "Option B"]);
    setNewCorrectIndex(null);
    setNewType("poll");
    setShowAddModal(true);
  };

  const handleAddInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deckId || !selectedSlideId) return;

    const config: any = {};
    if (newType === "poll" || newType === "quiz") {
      config.options = newOptions.filter(opt => opt.trim() !== "");
      config.correctOptionIndex = newType === "quiz" ? newCorrectIndex : null;
    } else if (newType === "rating" || newType === "numeric") {
      config.scaleMax = newScaleMax;
      config.iconType = "star";
    } else if (newType === "timer") {
      config.durationSeconds = newTimerDuration;
    } else if (newType === "liveurl") {
      config.url = newUrl;
    }

    try {
      const interactionsRef = collection(db, "presentations", deckId, "slides", selectedSlideId, "interactions");
      await addDoc(interactionsRef, {
        type: newType,
        question: newQuestion.trim() || `Place active ${newType}`,
        position: clickPos,
        config: config,
      });

      setShowAddModal(false);
    } catch (err) {
      console.error("Error creating interaction:", err);
    }
  };

  const handleDeleteInteraction = async (id: string) => {
    if (!deckId || !selectedSlideId) return;
    try {
      await deleteDoc(doc(db, "presentations", deckId, "slides", selectedSlideId, "interactions", id));
      setSelectedInteraction(null);
    } catch (err) {
      console.error("Error deleting interaction:", err);
    }
  };

  const handleSaveNotes = async () => {
    if (!deckId || !selectedSlideId) return;
    try {
      const slideDocRef = doc(db, "presentations", deckId, "slides", selectedSlideId);
      await updateDoc(slideDocRef, { notes: slideNotes });
      alert("Presenter notes saved!");
    } catch (err) {
      console.error("Error saving notes:", err);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 max-h-screen overflow-hidden">
      {/* Editor Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="p-2 hover:bg-slate-900 rounded-xl transition-all border border-slate-800 text-slate-400 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-slate-200 truncate max-w-md">{deckTitle}</h1>
            <p className="text-xs text-slate-500">Overlay Builder Mode</p>
          </div>
        </div>
      </header>

      {/* Editor Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Thumbnails Panel (20% width) */}
        <aside className="w-56 border-r border-slate-900 bg-slate-900/10 flex flex-col overflow-y-auto p-4 gap-3 select-none">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Slides Layout ({slides.length})
          </div>
          <div className="space-y-3">
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                onClick={() => setSelectedSlideId(slide.id)}
                className={`w-full relative group rounded-2xl border-2 overflow-hidden transition-all ${
                  selectedSlideId === slide.id
                    ? "border-indigo-500 shadow-md shadow-indigo-500/10 bg-indigo-500/5"
                    : "border-slate-850 hover:border-slate-700 bg-slate-900/35"
                }`}
              >
                <div className="aspect-[16/9] w-full bg-slate-950 relative">
                  <img
                    src={slide.thumbnailUrl}
                    alt={`Slide ${index + 1}`}
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute bottom-2 left-2 h-5 min-w-[20px] px-1 bg-black/60 backdrop-blur-sm rounded-lg flex items-center justify-center text-[10px] font-semibold text-slate-350">
                    {index + 1}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Center Sandbox Canvas Workspace (60% width) */}
        <main className="flex-1 bg-slate-950/20 flex flex-col items-center justify-center p-8 overflow-y-auto relative border-r border-slate-900">
          <div className="absolute top-4 text-xs text-slate-500 text-center">
            💡 Click anywhere on the slide canvas below to overlay a new interaction question.
          </div>

          {activeSlide ? (
            <div 
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="relative shadow-2xl border border-slate-850 bg-black rounded-xl overflow-hidden cursor-crosshair slide-container transition-all"
              style={{
                width: "100%",
                maxWidth: "800px",
                aspectRatio: activeSlide.aspectRatio || 1.777,
              }}
            >
              {/* Background Slide Image */}
              <img
                src={activeSlide.imageUrl}
                alt="Active Slide Preview"
                className="w-full h-full object-contain pointer-events-none select-none"
              />

              {/* Overlaid Interaction Badges */}
              {interactions.map((inter) => {
                const isSelected = selectedInteraction?.id === inter.id;
                
                return (
                  <button
                    key={inter.id}
                    onClick={(e) => {
                      e.stopPropagation(); // Avoid triggering canvas click
                      setSelectedInteraction(inter);
                    }}
                    className={`absolute z-10 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-lg border transition-all hover:scale-105 active:scale-100 ${
                      isSelected
                        ? "bg-indigo-500 text-white border-indigo-400 scale-105"
                        : "bg-slate-900/90 text-indigo-400 border-slate-700 backdrop-blur-md"
                    }`}
                    style={{
                      left: `${inter.position.x * 100}%`,
                      top: `${inter.position.y * 100}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {inter.type === "poll" && <BarChart2 className="h-3.5 w-3.5" />}
                    {inter.type === "quiz" && <HelpCircle className="h-3.5 w-3.5" />}
                    {inter.type === "wordcloud" && <Type className="h-3.5 w-3.5" />}
                    {inter.type === "opentext" && <MessageSquare className="h-3.5 w-3.5" />}
                    {inter.type === "rating" && <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />}
                    {inter.type === "timer" && <Clock className="h-3.5 w-3.5" />}
                    {inter.type === "liveurl" && <Globe className="h-3.5 w-3.5" />}
                    {inter.type === "lottery" && <Shuffle className="h-3.5 w-3.5" />}
                    <span className="truncate max-w-[120px]">{inter.question}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-slate-500 text-sm">No slide active. Select a slide from the sidebar.</div>
          )}
        </main>

        {/* Right Settings/Actions Panel (20% width) */}
        <aside className="w-80 bg-slate-950 flex flex-col p-6 overflow-y-auto">
          {/* Interaction Editor Panel */}
          {selectedInteraction ? (
            <div className="space-y-6 flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                  <h3 className="text-sm font-bold text-slate-350 uppercase tracking-wide">
                    Edit Interaction
                  </h3>
                  <button
                    onClick={() => handleDeleteInteraction(selectedInteraction.id)}
                    className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                    title="Delete Question"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    Type
                  </label>
                  <span className="bg-slate-900 border border-slate-800 text-indigo-400 px-3 py-1.5 rounded-xl text-xs font-bold inline-block capitalize">
                    {selectedInteraction.type}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    Question / Title
                  </label>
                  <textarea
                    value={selectedInteraction.question}
                    onChange={async (e) => {
                      const updatedQ = e.target.value;
                      setSelectedInteraction(prev => prev ? { ...prev, question: updatedQ } : null);
                      const docRef = doc(db, "presentations", deckId, "slides", selectedSlideId, "interactions", selectedInteraction.id);
                      await updateDoc(docRef, { question: updatedQ });
                    }}
                    rows={2}
                    className="w-full bg-slate-950 border border-slate-850 focus:border-indigo-500 rounded-xl py-2 px-3 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>

                {(selectedInteraction.type === "poll" || selectedInteraction.type === "quiz") && (
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                      Options
                    </label>
                    <div className="space-y-2">
                      {selectedInteraction.config.options?.map((option, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={option}
                            onChange={async (e) => {
                              const newOpts = [...(selectedInteraction.config.options || [])];
                              newOpts[idx] = e.target.value;
                              
                              setSelectedInteraction(prev => {
                                if (!prev) return null;
                                return {
                                  ...prev,
                                  config: { ...prev.config, options: newOpts }
                                };
                              });

                              const docRef = doc(db, "presentations", deckId, "slides", selectedSlideId, "interactions", selectedInteraction.id);
                              await updateDoc(docRef, { "config.options": newOpts });
                            }}
                            className="flex-1 bg-slate-950 border border-slate-850 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                          />
                          {selectedInteraction.type === "quiz" && (
                            <button
                              type="button"
                              onClick={async () => {
                                const correctIdx = idx;
                                setSelectedInteraction(prev => {
                                  if (!prev) return null;
                                  return {
                                    ...prev,
                                    config: { ...prev.config, correctOptionIndex: correctIdx }
                                  };
                                });
                                const docRef = doc(db, "presentations", deckId, "slides", selectedSlideId, "interactions", selectedInteraction.id);
                                await updateDoc(docRef, { "config.correctOptionIndex": correctIdx });
                              }}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold ${
                                selectedInteraction.config.correctOptionIndex === idx
                                  ? "bg-emerald-500 text-white"
                                  : "bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-400"
                              }`}
                            >
                              Correct
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedInteraction(null)}
                className="w-full border border-slate-850 hover:border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold py-2.5 rounded-xl transition-all"
              >
                Close Settings
              </button>
            </div>
          ) : (
            // Presenter Notes Panel
            <div className="space-y-6 flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="border-b border-slate-900 pb-3">
                  <h3 className="text-sm font-bold text-slate-350 uppercase tracking-wide">
                    Presenter Notes
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">These notes will show on your remote screen.</p>
                </div>

                <textarea
                  value={slideNotes}
                  onChange={(e) => setSlideNotes(e.target.value)}
                  placeholder="Type slide notes or reminders here..."
                  rows={12}
                  className="w-full bg-slate-950 border border-slate-850 focus:border-indigo-500 rounded-xl py-3 px-4 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-700"
                />
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleSaveNotes}
                  className="w-full bg-slate-900 hover:bg-slate-850 border border-slate-800 text-indigo-400 font-semibold text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-1.5"
                >
                  <Save className="h-4 w-4" />
                  Save Slide Notes
                </button>

                <button
                  type="button"
                  onClick={handleAiGenerateQuiz}
                  disabled={generatingAi || !slideNotes.trim()}
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-750 hover:to-indigo-750 text-white font-bold text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {generatingAi ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "🪄 AI Generate Quiz Questions"
                  )}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Click-to-Place New Interaction Popup Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl shadow-black/80">
            <h3 className="text-lg font-bold text-slate-200 mb-4">Add Interaction Overlay</h3>
            
            <form onSubmit={handleAddInteraction} className="space-y-4">
              {/* Type Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Interaction Type
                </label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-2 px-3 text-slate-200 text-sm focus:outline-none"
                >
                  <option value="poll">Poll (Multiple Choice)</option>
                  <option value="quiz">Quiz (Scored Choice)</option>
                  <option value="wordcloud">Word Cloud</option>
                  <option value="opentext">Open Text Wall</option>
                  <option value="rating">Rating scale (1-5 Stars)</option>
                  <option value="timer">Countdown Timer</option>
                  <option value="liveurl">Redirect Web Link</option>
                </select>
              </div>

              {/* Question Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Question / Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Which framework is best?"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 px-3 text-slate-200 text-sm focus:outline-none"
                />
              </div>

              {/* Custom Configurations based on type */}
              {(newType === "poll" || newType === "quiz") && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Choice Options
                  </label>
                  <div className="space-y-2 max-h-36 overflow-y-auto">
                    {newOptions.map((opt, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          required
                          placeholder={`Option ${idx + 1}`}
                          value={opt}
                          onChange={(e) => {
                            const copy = [...newOptions];
                            copy[idx] = e.target.value;
                            setNewOptions(copy);
                          }}
                          className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-250 focus:outline-none"
                        />
                        {newType === "quiz" && (
                          <button
                            type="button"
                            onClick={() => setNewCorrectIndex(idx)}
                            className={`px-2 py-1 rounded-md text-[10px] font-bold ${
                              newCorrectIndex === idx
                                ? "bg-emerald-500 text-white"
                                : "bg-slate-950 border border-slate-800 text-slate-500"
                            }`}
                          >
                            Correct
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setNewOptions(newOptions.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-500 text-xs p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewOptions([...newOptions, ""])}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 mt-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Choice
                  </button>
                </div>
              )}

              {newType === "timer" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Duration (seconds)
                  </label>
                  <input
                    type="number"
                    required
                    min={5}
                    max={600}
                    value={newTimerDuration}
                    onChange={(e) => setNewTimerDuration(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-2 px-3 text-slate-200 text-sm focus:outline-none"
                  />
                </div>
              )}

              {newType === "liveurl" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Target URL
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://example.com"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 px-3 text-slate-200 text-sm focus:outline-none"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 border border-slate-800 hover:border-slate-700 text-slate-450 hover:text-slate-300 py-2.5 rounded-xl text-sm font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white py-2.5 rounded-xl text-sm font-semibold transition-all shadow-md shadow-indigo-500/15"
                >
                  Place Overlay
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
