"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { 
  ArrowLeft, 
  Download, 
  Users, 
  BarChart2, 
  Award, 
  MessageSquare, 
  Clock, 
  FileText, 
  Loader2 
} from "lucide-react";
import { 
  doc, 
  collection, 
  getDoc, 
  getDocs, 
  query, 
  where 
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import Link from "next/link";

interface ResponseItem {
  id: string;
  interactionId: string;
  participantToken: string;
  participantName: string;
  value: any;
  isCorrect: boolean | null;
  score: number;
  submittedAt: any;
}

interface QnaQuestion {
  id: string;
  question: string;
  upvotes: string[];
  participantName: string;
}

export default function AnalyticsReportPage() {
  const { sessionId } = useParams() as { sessionId: string };
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [deckTitle, setDeckTitle] = useState("Presentation Deck");
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [qna, setQna] = useState<QnaQuestion[]>([]);
  
  // Aggregated Stats
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [averageQuizScore, setAverageQuizScore] = useState(0);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Load Session and Responses
  useEffect(() => {
    if (!sessionId) return;

    const loadAnalyticsData = async () => {
      try {
        // 1. Fetch Session Info
        const sessionRef = doc(db, "sessions", sessionId);
        const sessionSnap = await getDoc(sessionRef);
        
        if (sessionSnap.exists()) {
          const sessionData = sessionSnap.data();
          setTotalParticipants(sessionData.participantCount || 0);

          // Fetch Presentation Title
          const deckSnap = await getDoc(doc(db, "presentations", sessionData.presentationId));
          if (deckSnap.exists()) {
            setDeckTitle(deckSnap.data().title || "Untitled Presentation");
          }
        }

        // 2. Fetch all responses for this session
        const responsesSnap = await getDocs(collection(db, "sessions", sessionId, "responses"));
        const responseList = responsesSnap.docs.map(d => ({
          id: d.id,
          ...d.data()
        })) as ResponseItem[];
        setResponses(responseList);

        // Calculate average score for quizzes
        const quizResponses = responseList.filter(r => r.isCorrect !== null);
        if (quizResponses.length > 0) {
          const correctCount = quizResponses.filter(r => r.isCorrect === true).length;
          setAverageQuizScore(Math.round((correctCount / quizResponses.length) * 100));
        }

        // 3. Fetch Q&A questions
        const qnaSnap = await getDocs(collection(db, "sessions", sessionId, "qna"));
        const qnaList = qnaSnap.docs.map(d => ({
          id: d.id,
          ...d.data()
        })) as QnaQuestion[];
        setQna(qnaList);

        setLoading(false);
      } catch (err) {
        console.error("Error loading analytics:", err);
        setLoading(false);
      }
    };

    loadAnalyticsData();
  }, [sessionId]);

  // Export report to CSV
  const handleExportCSV = () => {
    if (responses.length === 0) {
      alert("No responses recorded to export.");
      return;
    }

    const headers = ["Response ID", "Question ID", "Participant Name", "Answer Value", "Is Correct", "Submitted At"];
    const rows = responses.map(r => [
      r.id,
      r.interactionId,
      r.participantName,
      typeof r.value === "object" ? JSON.stringify(r.value) : r.value,
      r.isCorrect === null ? "N/A" : r.isCorrect ? "Yes" : "No",
      r.submittedAt ? new Date(r.submittedAt.seconds * 1000).toISOString() : "N/A"
    ]);

    const csvContent = 
      "data:text/csv;charset=utf-8," + 
      [headers.join(","), ...rows.map(e => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `InteractDeck_Session_${sessionId}_Report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (authLoading || loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-955 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="p-2 hover:bg-slate-900 rounded-xl transition-all border border-slate-800 text-slate-400 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-sm font-bold text-slate-400">SESSION ANALYTICS</h1>
            <p className="text-lg font-bold text-slate-200">{deckTitle}</p>
          </div>
        </div>

        <button
          onClick={handleExportCSV}
          className="bg-indigo-500 hover:bg-indigo-650 text-white rounded-xl px-4 py-2 text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-500/25"
        >
          <Download className="h-3.5 w-3.5" />
          Export Report (CSV)
        </button>
      </header>

      {/* Main Stats Grid */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-8">
        
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-slate-900/50 border border-slate-850 rounded-3xl p-6 flex items-center gap-4">
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Participants Joined</p>
              <h3 className="text-2xl font-extrabold text-slate-200">{totalParticipants}</h3>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-850 rounded-3xl p-6 flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 text-purple-400 rounded-2xl">
              <BarChart2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Total Responses</p>
              <h3 className="text-2xl font-extrabold text-slate-200">{responses.length}</h3>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-850 rounded-3xl p-6 flex items-center gap-4">
            <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl">
              <Award className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Avg. Quiz Score</p>
              <h3 className="text-2xl font-extrabold text-slate-200">
                {responses.some(r => r.isCorrect !== null) ? `${averageQuizScore}%` : "N/A"}
              </h3>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-850 rounded-3xl p-6 flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Q&A Questions</p>
              <h3 className="text-2xl font-extrabold text-slate-200">{qna.length}</h3>
            </div>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel: Responses Breakdown */}
          <div className="lg:col-span-2 bg-slate-900/40 border border-slate-850 rounded-3xl p-6 space-y-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-850 pb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-400" />
              Audience Submissions
            </h3>

            {responses.length === 0 ? (
              <div className="text-center py-20 text-slate-500 text-sm italic">
                No audience responses were recorded during this session.
              </div>
            ) : (
              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-2">
                {responses.map((resp) => (
                  <div 
                    key={resp.id} 
                    className="bg-slate-950/40 border border-slate-850 rounded-2xl p-4 flex justify-between items-center text-sm"
                  >
                    <div>
                      <p className="font-semibold text-slate-200">
                        {resp.participantName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Answer: <span className="text-slate-350">{typeof resp.value === "object" ? JSON.stringify(resp.value) : resp.value}</span>
                      </p>
                    </div>

                    {resp.isCorrect !== null && (
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                        resp.isCorrect 
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" 
                          : "bg-red-500/10 text-red-400 border border-red-500/25"
                      }`}>
                        {resp.isCorrect ? "Correct" : "Incorrect"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right panel: Q&A Breakdown */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 space-y-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-850 pb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-indigo-400" />
              Q&A Highlights
            </h3>

            {qna.length === 0 ? (
              <div className="text-center py-20 text-slate-550 text-xs italic">
                No questions were submitted during this session.
              </div>
            ) : (
              <div className="space-y-3.5 max-h-[480px] overflow-y-auto pr-2">
                {qna
                  .sort((a, b) => (b.upvotes?.length || 0) - (a.upvotes?.length || 0))
                  .map((q) => (
                    <div 
                      key={q.id} 
                      className="bg-slate-950/40 border border-slate-850 rounded-2xl p-4 space-y-2 text-xs"
                    >
                      <p className="font-semibold text-slate-250 leading-relaxed">"{q.question}"</p>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>By {q.participantName}</span>
                        <span className="font-bold text-indigo-400">{q.upvotes?.length || 0} Upvotes</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
