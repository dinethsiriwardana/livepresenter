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
  Users
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
    if (!confirm("Are you sure you want to delete this deck?")) return;
    try {
      await deleteDoc(doc(db, "presentations", deckId));
    } catch (err) {
      console.error("Error deleting deck:", err);
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
            onClick={() => router.push("/dashboard/new")}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-xl px-4 py-2.5 font-semibold text-sm transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2 hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" />
            Upload PDF
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
              Upload your first PDF slides deck. We will split it into high-resolution images so you can overlay engagement elements.
            </p>
            <button
              onClick={() => router.push("/dashboard/new")}
              className="mt-6 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-indigo-400 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all"
            >
              Upload Your First Deck
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
    </div>
  );
}
