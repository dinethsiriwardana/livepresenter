"use client";

import React from "react";
import Link from "next/link";
import { 
  Presentation, 
  Users, 
  Sparkles, 
  ArrowRight, 
  BarChart2, 
  HelpCircle, 
  Type, 
  MessageSquare, 
  Heart 
} from "lucide-react";

export default function Home() {
  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 relative overflow-hidden">
      
      {/* Background Orbs */}
      <div className="absolute top-[-30%] left-[-15%] w-[80%] h-[80%] rounded-full bg-indigo-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-30%] right-[-15%] w-[80%] h-[80%] rounded-full bg-purple-500/10 blur-[130px] pointer-events-none" />

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-20 flex flex-col justify-center items-center z-10 text-center gap-12">
        
        {/* Brand Banner */}
        <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900 border border-slate-800 rounded-full text-xs font-semibold text-indigo-400 shadow-md">
          <Sparkles className="h-3.5 w-3.5" />
          The Modern Live Presenter Platform
        </div>

        {/* Hero Copy */}
        <div className="space-y-4 max-w-3xl">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-100 to-purple-300 bg-clip-text text-transparent">
            InteractDeck
          </h1>
          <p className="text-lg md:text-xl text-slate-400 font-medium leading-relaxed max-w-2xl mx-auto">
            Refuse to waste time building presentations. Upload your existing PDFs as static content, and overlay real-time engagement widgets for your audience.
          </p>
        </div>

        {/* Action Call to Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md justify-center">
          <Link 
            href="/dashboard"
            className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-650 hover:from-indigo-600 hover:to-purple-750 text-white rounded-2xl py-4 font-bold text-sm transition-all shadow-xl shadow-indigo-500/25 flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0"
          >
            <Presentation className="h-4.5 w-4.5" />
            Host Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>

          <Link 
            href="/join"
            className="flex-1 border border-slate-850 hover:border-slate-750 bg-slate-900/40 text-slate-300 hover:text-slate-105 rounded-2xl py-4 font-bold text-sm transition-all flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0"
          >
            <Users className="h-4.5 w-4.5 text-indigo-400" />
            Join Presentation
          </Link>
        </div>

        {/* Dynamic Feature Cards Showcase Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 w-full max-w-4xl mt-12 text-left">
          
          <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 space-y-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl w-fit">
              <BarChart2 className="h-4 w-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Live Polls</h4>
            <p className="text-[10px] text-slate-500">Instant multi-choice feedback and real-time bar graphs.</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 space-y-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl w-fit">
              <HelpCircle className="h-4 w-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Quizzes</h4>
            <p className="text-[10px] text-slate-500">Timed trivia challenges with scoring and live standings.</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 space-y-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl w-fit">
              <Type className="h-4 w-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Word Cloud</h4>
            <p className="text-[10px] text-slate-500">Real-time keyword arrays sized dynamically by frequency.</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 space-y-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl w-fit">
              <MessageSquare className="h-4 w-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Live Q&A</h4>
            <p className="text-[10px] text-slate-500">Audience boards with voting queues and spotlights.</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 space-y-3 col-span-2 md:col-span-1">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl w-fit">
              <Heart className="h-4 w-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Reactions</h4>
            <p className="text-[10px] text-slate-500">Streaming floating reactions synced across screens instantly.</p>
          </div>

        </div>

      </main>
    </div>
  );
}
