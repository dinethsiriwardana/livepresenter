"use client";

import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Upload, File, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { collection, doc, setDoc, addDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebaseClient";
import Link from "next/link";

export default function NewPresentationPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch default workspace ID
  useEffect(() => {
    if (!user) return;
    const fetchWorkspaces = async () => {
      const q = query(collection(db, "workspaces"), where("ownerId", "==", user.uid));
      const snap = await getDocs(q);
      if (!snap.empty) {
        setActiveWorkspaceId(snap.docs[0].id);
      }
    };
    fetchWorkspaces();
  }, [user]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setError("");
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    if (selectedFile.type !== "application/pdf" && !selectedFile.name.endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    if (selectedFile.size > 50 * 1024 * 1024) {
      setError("PDF size exceeds 50MB limit.");
      return;
    }
    setFile(selectedFile);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !user || !activeWorkspaceId) {
      setError("Active workspace not loaded yet. Try again in a second.");
      return;
    }

    setLoading(true);
    setError("");
    setProgress("Initializing PDF engine...");

    try {
      // 1. Load pdfjs dynamically to prevent SSR issues
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      // 2. Create entry in Firestore for the Presentation Template
      const presentationTitle = file.name.replace(/\.pdf$/i, "");
      const presentationsRef = collection(db, "presentations");
      
      const newDeckRef = doc(presentationsRef);
      const deckId = newDeckRef.id;

      // 3. Read PDF file as ArrayBuffer
      setProgress("Reading PDF file...");
      const fileReader = new FileReader();
      
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        fileReader.onload = () => resolve(fileReader.result as ArrayBuffer);
        fileReader.onerror = () => reject(new Error("Failed to read PDF file"));
        fileReader.readAsArrayBuffer(file);
      });

      // 4. Load PDF document
      setProgress("Loading PDF document pages...");
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;

      if (numPages === 0) {
        throw new Error("The uploaded PDF is empty.");
      }

      // Initialize the presentation entry in "processing" state
      await setDoc(newDeckRef, {
        workspaceId: activeWorkspaceId,
        title: presentationTitle,
        ownerId: user.uid,
        slideCount: numPages,
        status: "processing",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 5. Convert each page to high-res PNG and thumbnail
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        setProgress(`Processing page ${pageNum} of ${numPages}...`);
        
        const page = await pdfDoc.getPage(pageNum);
        
        // Render high-res slide (scale 2.0)
        const highResViewport = page.getViewport({ scale: 2.0 });
        const highResCanvas = document.createElement("canvas");
        highResCanvas.width = highResViewport.width;
        highResCanvas.height = highResViewport.height;
        const highResCtx = highResCanvas.getContext("2d");
        
        if (!highResCtx) throw new Error("Could not create high resolution canvas context");
        await page.render({ canvasContext: highResCtx, viewport: highResViewport, canvas: highResCanvas }).promise;
        
        const highResBlob = await new Promise<Blob | null>((resolve) => {
          highResCanvas.toBlob((blob) => resolve(blob), "image/png");
        });
        if (!highResBlob) throw new Error(`Failed to generate high-res image for slide ${pageNum}`);

        // Render low-res thumbnail (scale 0.4)
        const thumbViewport = page.getViewport({ scale: 0.4 });
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = thumbViewport.width;
        thumbCanvas.height = thumbViewport.height;
        const thumbCtx = thumbCanvas.getContext("2d");
        
        if (!thumbCtx) throw new Error("Could not create thumbnail canvas context");
        await page.render({ canvasContext: thumbCtx, viewport: thumbViewport, canvas: thumbCanvas }).promise;
        
        const thumbBlob = await new Promise<Blob | null>((resolve) => {
          thumbCanvas.toBlob((blob) => resolve(blob), "image/png");
        });
        if (!thumbBlob) throw new Error(`Failed to generate thumbnail for slide ${pageNum}`);

        // Upload both to Storage
        setProgress(`Uploading images for page ${pageNum}...`);
        const slideRef = ref(storage, `slides/${deckId}/slide_${pageNum}.png`);
        const thumbRef = ref(storage, `thumbnails/${deckId}/thumb_${pageNum}.png`);

        await uploadBytes(slideRef, highResBlob);
        await uploadBytes(thumbRef, thumbBlob);

        const slideUrl = await getDownloadURL(slideRef);
        const thumbUrl = await getDownloadURL(thumbRef);

        const aspectRatio = highResViewport.width / highResViewport.height;

        // Save individual slide metadata in Firestore sub-collection
        await setDoc(doc(db, "presentations", deckId, "slides", pageNum.toString()), {
          imageUrl: slideUrl,
          thumbnailUrl: thumbUrl,
          aspectRatio: aspectRatio,
          notes: "",
        });
      }

      // 6. Complete upload status update
      setProgress("Finalizing presentation configuration...");
      await setDoc(newDeckRef, {
        status: "ready",
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during PDF processing.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 p-6 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-30%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/5 blur-[120px]" />

      <div className="max-w-2xl w-full mx-auto z-10 flex-1 flex flex-col justify-center">
        {/* Back Link */}
        <div className="mb-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-all">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        {/* Card Body */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-850 rounded-3xl p-8 shadow-2xl shadow-black/40">
          <h2 className="text-2xl font-bold text-slate-100 mb-2">Upload New Presentation</h2>
          <p className="text-sm text-slate-500 mb-8">
            Upload your slide deck in PDF format. We will extract each slide as a standalone image to overlay interactions.
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm text-center">
              {error}
            </div>
          )}

          {success ? (
            <div className="py-12 flex flex-col items-center justify-center text-center gap-4">
              <CheckCircle2 className="h-16 w-16 text-emerald-500 animate-bounce" />
              <div>
                <h3 className="text-lg font-bold text-slate-100">Upload Complete!</h3>
                <p className="text-sm text-slate-500 mt-1">Redirecting you to the dashboard...</p>
              </div>
            </div>
          ) : loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-center gap-4">
              <Loader2 className="h-12 w-12 text-indigo-500 animate-spin" />
              <div>
                <h3 className="text-lg font-semibold text-slate-200">Processing Presentation</h3>
                <p className="text-sm text-indigo-400 font-medium mt-2">{progress}</p>
                <p className="text-xs text-slate-555 mt-1">Please keep this window open while processing.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUpload} className="space-y-6">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 bg-slate-950/40 rounded-2xl py-12 px-4 flex flex-col items-center text-center cursor-pointer transition-all"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".pdf"
                  className="hidden"
                />

                <div className="p-4 bg-slate-900 border border-slate-850 rounded-2xl mb-4 text-slate-400">
                  <Upload className="h-8 w-8" />
                </div>

                {file ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 justify-center">
                      <File className="h-4 w-4 text-indigo-400" />
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-555 font-medium">
                      {(file.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-slate-350">
                      Drag & drop your presentation PDF, or <span className="text-indigo-400">browse</span>
                    </p>
                    <p className="text-xs text-slate-555 mt-1.5">
                      Supports PDF up to 50MB
                    </p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!file}
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-xl py-3.5 font-semibold text-sm transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
              >
                Start Processing Deck
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
