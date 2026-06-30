"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { 
  Plus, 
  Presentation, 
  Settings, 
  ChevronDown, 
  LogOut, 
  Play, 
  Edit3, 
  Trash2, 
  FolderPlus,
  Loader2,
  Users,
  X,
  Check
} from "lucide-react";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  deleteDoc,
  doc, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch
} from "firebase/firestore";
import { db, rtdb } from "@/lib/firebaseClient";
import { ref as dbRef, remove as rtdbRemove } from "firebase/database";
import { THEME_GRADIENTS, getTheme } from "@/lib/theme";

interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  members: Record<string, string>;
}

interface PresentationDeck {
  id: string;
  title: string;
  slideCount: number;
  status: "processing" | "ready" | "failed";
  pdfUrl?: string;
  joinCode?: string;
  createdAt: any;
}

const generate6DigitCode = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export default function DashboardPage() {
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [decks, setDecks] = useState<PresentationDeck[]>([]);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  // Presentation Creation popup states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPresName, setNewPresName] = useState("");
  const [newPresDescription, setNewPresDescription] = useState("");
  const [newPresTheme, setNewPresTheme] = useState("dark-indigo");
  const [creatingPres, setCreatingPres] = useState(false);
  const [createError, setCreateError] = useState("");

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Load Workspaces or create a default one
  useEffect(() => {
    if (!user) return;

    const workspacesRef = collection(db, "workspaces");
    // Query where user is owner
    const qOwner = query(workspacesRef, where("ownerId", "==", user.uid));

    const unsubscribe = onSnapshot(qOwner, async (snapshot) => {
      let workspaceList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Workspace[];

      // If no workspaces exist, create a default "Personal Workspace"
      if (workspaceList.length === 0 && !snapshot.metadata.fromCache) {
        try {
          const defaultWS = {
            name: "Personal Workspace",
            ownerId: user.uid,
            members: { [user.uid]: "admin" },
            createdAt: serverTimestamp(),
          };
          const docRef = await addDoc(workspacesRef, defaultWS);
          workspaceList = [{ id: docRef.id, ...defaultWS } as Workspace];
        } catch (err) {
          console.error("Error creating default workspace:", err);
        }
      }

      setWorkspaces(workspaceList);
      if (!activeWorkspace && workspaceList.length > 0) {
        setActiveWorkspace(workspaceList[0]);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Load Decks for Active Workspace
  useEffect(() => {
    if (!activeWorkspace) return;
    setLoading(true);

    const presentationsRef = collection(db, "presentations");
    const q = query(
      presentationsRef, 
      where("workspaceId", "==", activeWorkspace.id),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const deckList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PresentationDeck[];
      setDecks(deckList);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching presentations:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [activeWorkspace]);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim() || !user) return;

    try {
      const workspacesRef = collection(db, "workspaces");
      const docRef = await addDoc(workspacesRef, {
        name: newWorkspaceName.trim(),
        ownerId: user.uid,
        members: { [user.uid]: "admin" },
        createdAt: serverTimestamp(),
      });
      setNewWorkspaceName("");
      setShowWorkspaceModal(false);
    } catch (err) {
      console.error("Error creating workspace:", err);
    }
  };

  const handleCreateSession = async (deckId: string) => {
    if (!user) return;
    try {
      // 1. Get presentation doc to check if it has joinCode
      const presentationRef = doc(db, "presentations", deckId);
      const presentationSnap = await getDoc(presentationRef);
      let joinCode = presentationSnap.exists() ? presentationSnap.data()?.joinCode : null;

      // 2. If it does not have a joinCode, generate one, save it to the presentation doc
      if (!joinCode) {
        let uniqueCode = "";
        let attempts = 0;
        while (attempts < 5) {
          const tempCode = generate6DigitCode();
          const q = query(collection(db, "presentations"), where("joinCode", "==", tempCode));
          const snap = await getDocs(q);
          if (snap.empty) {
            uniqueCode = tempCode;
            break;
          }
          attempts++;
        }
        joinCode = uniqueCode || generate6DigitCode();
        await updateDoc(presentationRef, { joinCode });
      }

      // 3. Clear any existing qna for this joinCode (in case we are reusing it)
      const qnaRef = collection(db, "sessions", joinCode, "qna");
      const qnaSnap = await getDocs(qnaRef);

      const batch = writeBatch(db);
      qnaSnap.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();

      // 4. Clear reactions & drawings in RTDB for this joinCode
      try {
        await rtdbRemove(dbRef(rtdb, `sessions/${joinCode}`));
      } catch (err) {
        console.error("Error clearing RTDB session node:", err);
      }

      // 5. Initialize/reset session document directly with setDoc (avoiding duplicate addDoc write)
      await setDoc(doc(db, "sessions", joinCode), {
        presentationId: deckId,
        presenterId: user.uid,
        coHosts: [],
        isActive: true,
        currentSlide: 1,
        activeInteractionId: null,
        participantCount: 0,
        createdAt: new Date(),
      });

      router.push(`/present/${joinCode}`);
    } catch (err) {
      console.error("Error starting session:", err);
    }
  };

  const handleDeleteDeck = async (deckId: string) => {
    if (!confirm("Are you sure you want to delete this presentation? This cannot be undone.")) return;

    try {
      // 1. Fetch the presentation to get its joinCode
      const presRef = doc(db, "presentations", deckId);
      const presSnap = await getDoc(presRef);
      const joinCode: string | undefined = presSnap.exists() ? presSnap.data()?.joinCode : undefined;

      // 2. Delete all interactions under each slide (subcollection depth-2)
      const slidesRef = collection(db, "presentations", deckId, "slides");
      const slidesSnap = await getDocs(slidesRef);

      for (const slideDoc of slidesSnap.docs) {
        const interactionsRef = collection(db, "presentations", deckId, "slides", slideDoc.id, "interactions");
        const interactionsSnap = await getDocs(interactionsRef);
        const batch = writeBatch(db);
        interactionsSnap.docs.forEach(d => batch.delete(d.ref));
        if (interactionsSnap.docs.length > 0) await batch.commit();
      }

      // 3. Delete all slide documents
      const slidesBatch = writeBatch(db);
      slidesSnap.docs.forEach(d => slidesBatch.delete(d.ref));
      if (slidesSnap.docs.length > 0) await slidesBatch.commit();

      // 4. Delete the presentation document itself
      await deleteDoc(presRef);

      // 5. Clean up session data if joinCode exists
      if (joinCode) {
        // Delete QnA subcollection under the session
        const qnaRef = collection(db, "sessions", joinCode, "qna");
        const qnaSnap = await getDocs(qnaRef);
        const qnaBatch = writeBatch(db);
        qnaSnap.docs.forEach(d => qnaBatch.delete(d.ref));
        if (qnaSnap.docs.length > 0) await qnaBatch.commit();

        // Delete the session document itself
        await deleteDoc(doc(db, "sessions", joinCode));

        // 6. Wipe RTDB node for this session (reactions, laser pointer, drawings)
        try {
          await rtdbRemove(dbRef(rtdb, `sessions/${joinCode}`));
        } catch (err) {
          console.warn("RTDB cleanup failed (non-critical):", err);
        }
      }

    } catch (err) {
      console.error("Error deleting presentation:", err);
      alert("Failed to delete the presentation. Please try again.");
    }
  };

  const generateUniqueJoinCode = async (): Promise<string> => {
    let attempts = 0;
    while (attempts < 5) {
      const code = generate6DigitCode();
      const q = query(collection(db, "presentations"), where("joinCode", "==", code));
      const snap = await getDocs(q);
      if (snap.empty) {
        return code;
      }
      attempts++;
    }
    return generate6DigitCode();
  };

  const handleCreatePresentation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresName.trim() || !user || !activeWorkspace) {
      setCreateError("Workspace or user details not loaded yet.");
      return;
    }

    setCreatingPres(true);
    setCreateError("");

    try {
      const uniqueCode = await generateUniqueJoinCode();
      const presentationsRef = collection(db, "presentations");
      const newDeckRef = doc(presentationsRef);
      const deckId = newDeckRef.id;

      // 1. Create presentation document
      await setDoc(newDeckRef, {
        workspaceId: activeWorkspace.id,
        title: newPresName.trim(),
        description: newPresDescription.trim(),
        colorTheme: newPresTheme,
        ownerId: user.uid,
        slideCount: 1,
        status: "ready", // ready instantly
        joinCode: uniqueCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2. Create the first slide document (Interactive Welcome Poll)
      const firstSlideRef = doc(db, "presentations", deckId, "slides", "1");
      await setDoc(firstSlideRef, {
        imageUrl: "",
        thumbnailUrl: "/next.svg",
        aspectRatio: 1.7778, // default 16:9
        notes: "Welcome to our presentation!",
        isInteractive: true,
        interactionType: "poll",
      });

      // 3. Create the primary interaction sub-document
      const primaryInteractRef = doc(db, "presentations", deckId, "slides", "1", "interactions", "primary");
      await setDoc(primaryInteractRef, {
        type: "poll",
        question: "Welcome! Are you ready to get started?",
        position: { x: 0.5, y: 0.5 },
        config: {
          options: ["Yes!", "Absolutely!"],
          durationSeconds: 30,
          correctOptionIndex: null
        }
      });

      // Reset state & close modal
      setNewPresName("");
      setNewPresDescription("");
      setNewPresTheme("dark-indigo");
      setShowCreateModal(false);
    } catch (err: any) {
      console.error("Error creating presentation:", err);
      setCreateError(err.message || "An error occurred while creating presentation.");
    } finally {
      setCreatingPres(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100">
      {/* Top Header Navigation */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Presentation className="h-6 w-6 text-indigo-500" />
            <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              InteractDeck
            </span>
          </div>

          {/* Workspace Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowWorkspaceModal(!showWorkspaceModal)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-850 px-3.5 py-1.5 rounded-xl border border-slate-800 text-sm font-medium transition-all"
            >
              <span className="text-slate-300">{activeWorkspace?.name || "Loading..."}</span>
              <ChevronDown className="h-4 w-4 text-slate-500" />
            </button>
            
            {showWorkspaceModal && (
              <div className="absolute left-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-2 z-50">
                <div className="text-xs font-semibold text-slate-500 px-3 py-1.5 uppercase tracking-wider">
                  Workspaces
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => {
                        setActiveWorkspace(ws);
                        setShowWorkspaceModal(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all ${
                        activeWorkspace?.id === ws.id
                          ? "bg-indigo-500/10 text-indigo-400 font-semibold"
                          : "hover:bg-slate-800 text-slate-300"
                      }`}
                    >
                      {ws.name}
                    </button>
                  ))}
                </div>

                <div className="border-t border-slate-800 my-1"></div>
                
                {/* Create Workspace Input */}
                <form onSubmit={handleCreateWorkspace} className="p-2 flex gap-1">
                  <input
                    type="text"
                    required
                    placeholder="New workspace..."
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-650 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="bg-indigo-500 hover:bg-indigo-650 p-1.5 rounded-lg text-white transition-all"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* User profile dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className="h-9 w-9 rounded-full bg-indigo-500 flex items-center justify-center font-bold text-white text-sm shadow-md hover:opacity-90 transition-all uppercase"
          >
            {user.email?.charAt(0) || "U"}
          </button>

          {showUserDropdown && (
            <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-2 z-50">
              <div className="px-3 py-2">
                <p className="text-xs text-slate-500 font-medium truncate">Logged in as</p>
                <p className="text-sm font-semibold text-slate-300 truncate">{user.email}</p>
              </div>
              <div className="border-t border-slate-800 my-1"></div>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-xl text-sm transition-all text-left"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {/* Workspace Title & Add Deck Button */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              {activeWorkspace?.name || "Active Workspace"}
            </h2>
            <p className="text-sm text-slate-500">Manage and host your interactive presentation decks</p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-xl px-4 py-2.5 font-semibold text-sm transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2 hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" />
            Create Presentation
          </button>
        </div>

        {/* Decks Grid List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
            <p className="text-sm text-slate-500">Loading presentations...</p>
          </div>
        ) : decks.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-3xl py-16 px-4 flex flex-col items-center text-center max-w-lg mx-auto bg-slate-900/10 backdrop-blur-sm mt-8">
            <div className="p-4 bg-slate-900 border border-slate-850 rounded-2xl mb-4 text-slate-450">
              <Presentation className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-200">No presentations found</h3>
            <p className="text-sm text-slate-500 mt-2 max-w-sm">
              Create a presentation deck with custom color themes. You can then add interactive engagement questions and slide overlays.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-6 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-indigo-400 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all"
            >
              Create Your First Presentation
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {decks.map((deck) => (
              <div 
                key={deck.id} 
                className="bg-slate-900/50 backdrop-blur-xl border border-slate-850 hover:border-slate-800 rounded-3xl p-6 transition-all hover:shadow-xl hover:shadow-black/20 flex flex-col justify-between"
              >
                <div>
                  {/* Status Indicator */}
                  <div className="flex items-center justify-between mb-4">
                    <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                      deck.status === "ready" 
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                        : deck.status === "failed" 
                        ? "bg-red-500/10 text-red-400 border border-red-500/20"
                        : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse"
                    }`}>
                      {deck.status}
                    </span>
                    <span className="text-xs text-slate-500">
                      {deck.slideCount ? `${deck.slideCount} slides` : "0 slides"}
                    </span>
                  </div>

                  <h4 className="text-lg font-bold text-slate-200 mb-2 truncate">
                    {deck.title}
                  </h4>
                  <p className="text-xs text-slate-500 mb-6">
                    Created: {deck.createdAt ? new Date(deck.createdAt.seconds * 1000).toLocaleDateString() : "Just now"}
                  </p>
                </div>

                <div className="flex items-center gap-2 border-t border-slate-850/80 pt-4">
                  {deck.status === "ready" ? (
                    <button
                      onClick={() => handleCreateSession(deck.id)}
                      className="flex-1 bg-indigo-500 hover:bg-indigo-650 text-white py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-indigo-500/15"
                    >
                      <Play className="h-3.5 w-3.5 fill-white" />
                      Go Live
                    </button>
                  ) : (
                    <button
                      disabled
                      className="flex-1 bg-slate-850 text-slate-600 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-not-allowed"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Processing
                    </button>
                  )}

                  <button
                    onClick={() => router.push(`/editor/${deck.id}`)}
                    className="p-2 border border-slate-800 hover:border-slate-700 bg-slate-950/20 text-slate-400 hover:text-slate-200 rounded-xl transition-all"
                    title="Edit Overlay Interactions"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => handleDeleteDeck(deck.id)}
                    className="p-2 border border-slate-800 hover:border-slate-700 bg-slate-950/20 text-red-500/80 hover:text-red-500 rounded-xl transition-all"
                    title="Delete Presentation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Presentation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-850 rounded-3xl p-6 w-full max-w-2xl shadow-2xl relative animate-in fade-in zoom-in-95 duration-200 my-8">
            {/* Close Button */}
            <button 
              onClick={() => {
                setShowCreateModal(false);
                setCreateError("");
              }}
              className="absolute top-4 right-4 p-1.5 hover:bg-slate-800 text-slate-500 hover:text-slate-350 rounded-xl transition-all"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-xl font-bold text-slate-100 mb-1">Create New Presentation</h3>
            <p className="text-xs text-slate-500 mb-6">Set up your presentation details and choose a starting interactive theme.</p>

            {createError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs text-center font-medium">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreatePresentation} className="space-y-6">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Presentation Name</label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. Q3 Sales Sync or Trivia Night"
                  value={newPresName}
                  onChange={(e) => setNewPresName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-3 px-4 text-slate-200 text-sm focus:outline-none"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Description</label>
                <textarea 
                  rows={2}
                  placeholder="What is this presentation about? (optional)"
                  value={newPresDescription}
                  onChange={(e) => setNewPresDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl py-3 px-4 text-slate-200 text-sm focus:outline-none resize-none"
                />
              </div>

              {/* Theme selector */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Color Theme (Background & Slides Style)</label>
                
                <div className="space-y-4">
                  {/* Light Themes */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Light Themes (Select 1 of 2)</span>
                    <div className="grid grid-cols-2 gap-4">
                      {Object.values(THEME_GRADIENTS).filter(t => t.isLight).map((theme) => {
                        const isSelected = newPresTheme === theme.id;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            onClick={() => setNewPresTheme(theme.id)}
                            className={`relative text-left rounded-2xl border-2 transition-all overflow-hidden flex flex-col p-4 aspect-[16/10] ${
                              theme.gradientClass
                            } ${
                              isSelected 
                                ? "border-indigo-500 ring-2 ring-indigo-500/20 scale-102" 
                                : "border-slate-800 hover:border-slate-700 opacity-90 hover:opacity-100"
                            }`}
                          >
                            <div className="flex-1 flex flex-col justify-between w-full pointer-events-none">
                              <div>
                                <span className={`text-[10px] font-bold tracking-widest uppercase block ${theme.textClass === 'text-slate-900' ? 'text-indigo-650' : 'text-indigo-400'}`}>
                                  POLL SLIDE
                                </span>
                                <h4 className={`text-xs font-extrabold ${theme.textClass} mt-1 truncate`}>
                                  Interactive Question?
                                </h4>
                              </div>
                              <div className="space-y-1.5 mt-2">
                                <div className={`h-4 rounded-lg bg-white/40 border border-black/5 flex items-center px-2 text-[8px] font-bold ${theme.textClass}`}>
                                  Option A
                                </div>
                                <div className={`h-4 rounded-lg bg-white/40 border border-black/5 flex items-center px-2 text-[8px] font-bold ${theme.textClass}`}>
                                  Option B
                                </div>
                              </div>
                            </div>

                            {/* Theme Badge */}
                            <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-md text-[9px] font-semibold text-white">
                              {theme.name}
                              {isSelected && <Check className="h-3 w-3 text-indigo-400" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Dark Themes */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Dark Themes (Select 1 of 3)</span>
                    <div className="grid grid-cols-3 gap-3">
                      {Object.values(THEME_GRADIENTS).filter(t => !t.isLight).map((theme) => {
                        const isSelected = newPresTheme === theme.id;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            onClick={() => setNewPresTheme(theme.id)}
                            className={`relative text-left rounded-2xl border-2 transition-all overflow-hidden flex flex-col p-3.5 aspect-[16/11] ${
                              theme.gradientClass
                            } ${
                              isSelected 
                                ? "border-indigo-500 ring-2 ring-indigo-500/20 scale-102" 
                                : "border-slate-800 hover:border-slate-700 opacity-90 hover:opacity-100"
                            }`}
                          >
                            <div className="flex-1 flex flex-col justify-between w-full pointer-events-none">
                              <div>
                                <span className="text-[8px] font-bold tracking-widest uppercase block text-indigo-400">
                                  POLL SLIDE
                                </span>
                                <h4 className={`text-[10px] font-extrabold ${theme.textClass} mt-0.5 truncate`}>
                                  Interactive Question?
                                </h4>
                              </div>
                              <div className="space-y-1 mt-1">
                                <div className={`h-3.5 rounded-md bg-white/10 border border-white/5 flex items-center px-1.5 text-[7px] font-bold ${theme.textClass}`}>
                                  Option A
                                </div>
                                <div className={`h-3.5 rounded-md bg-white/10 border border-white/5 flex items-center px-1.5 text-[7px] font-bold ${theme.textClass}`}>
                                  Option B
                                </div>
                              </div>
                            </div>

                            {/* Theme Badge */}
                            <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-semibold text-white">
                              {theme.name.split(" ")[0]}
                              {isSelected && <Check className="h-2.5 w-2.5 text-indigo-400" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError("");
                  }}
                  className="flex-1 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-350 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingPres}
                  className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-650 hover:from-indigo-600 hover:to-purple-750 text-white rounded-xl py-3 font-semibold text-sm transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                >
                  {creatingPres ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Presentation"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
