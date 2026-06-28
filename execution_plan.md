# InteractDeck (Live Presenter) Master Specification & Project Execution Plan

This is the single-source-of-truth document for the **InteractDeck** project. It consolidates all requirements from `originareq.md` and design/architectural specifications from `project.md`, incorporating a refined database schema and a 10-milestone project execution checklist.

---

## 1. Project Overview & Goals

### The Architectural Thesis
InteractDeck solves a complex business workflow problem by refusing to build the hardest part of presentation software: the presentation editor. Instead of building a PowerPoint or Google Slides competitor, **slides are imported as PDFs and converted into high-resolution slide images (Static Plane)**. The system then operates as an **event layer (Dynamic Plane)** that broadcasts JSON state machines over WebSockets/Firestore Listeners. This eliminates canvas-rendering and text-alignment nightmares while delivering rich, real-time audience engagement.

### Primary Goal
Allow presenters to upload a PDF presentation and overlay interactive features on individual slides without recreating them.

### Supported Engagement & Interaction Types:
1. **Live Polls:** Single or multiple choice options with real-time bar graphs.
2. **Quizzes:** Timed questions with correct answers and scoring.
3. **Word Clouds:** Real-time growing word grids based on participant entries.
4. **Open Text:** Long answers with dynamic wall layout and AI categorization.
5. **Rating Scales:** Star-based (1-5) ratings.
6. **Numeric Scales:** Slider-based (1-10) scoring.
7. **Ranking:** Drag-and-drop prioritization.
8. **Q&A:** Participant question boards with upvoting and presenter spotlight.
9. **Emoji Reactions:** Ephemeral floating reactions (❤️, 👏, 🔥, 😂, 😮).
10. **Leaderboards:** Standings based on Quiz speed and correctness.
11. **Surveys:** Multi-page forms submitted by participants.
12. **Countdown Timers:** Synced timers on presenter/audience screens.
13. **Drawing Board:** Real-time presenter annotation/drawing overlay.
14. **Live Announcements:** Flash alerts broadcast to all participants.
15. **Lottery Picker:** Selecting a random active participant.
16. **Live URL Overlay:** Redirecting/showing a specific link to participants.

---

## 2. High-Level System Architecture

The platform operates on a **Decoupled Dual-Plane** model:
1. **The Static Plane (Content):** High-resolution rasterized PDF pages served via Content Delivery Network (CDN) / Cloud Storage.
2. **The Dynamic Plane (State):** High-frequency, low-payload JSON state machine broadcasted over Firestore Listeners and Firebase Realtime Database (RTDB).

### System Topology

```
 [ PRESENTERS / CO-HOSTS ]             [ AUDIENCE MEMBERS ]            [ PROJECTOR DISPLAY ]
           │                                    │                               │
           ▼ (HTTPS Admin Actions)              ▼ (Scan QR / Enter Code)        ▼ (Read-Only Token)
┌───────────────────────┐             ┌────────────────────┐          ┌────────────────────┐
│   Next.js Admin UI    │             │ Next.js Mobile UI  │          │ Next.js Cast View  │
└──────────┬────────────┘             └─────────┬──────────┘          └─────────┬──────────┘
           │                                    │                               │
           ▼ (APIs / Server Actions / Next Auth)│                               │
┌───────────────────────────────────────────────┼───────────────────────────────┘
│                 API GATEWAY & AUTHENTICATION MATRIX                           │
└──────────┬────────────────────────────────────┼───────────────────────────────┘
           │                                    ▼ (Anonymous Tokens)
           ▼ (Raw PDF Uploads)           ┌──────────────┐
┌───────────────────────┐                │Firebase Auth │
│   Firebase Storage    │                └──────────────┘
└──────────┬────────────┘
           │ (Object Created Trigger)
           ▼
┌───────────────────────┐
│  Cloud Function (V2)  │
│   (pdf2pic engine)    │
└──────────┬────────────┘
           │
           ▼ (PNGs, Aspect Ratio, Thumbnails)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                FIRESTORE DATABASE (State)                              │
│         [Workspaces] ──► [Presentations] ──► [Slides] ──► [Sessions] ◄── [Q&A]         │
└───────────────────────────────────────────────┬────────────────────────────────────────┘
                                                │
                                                ▼ (Ephemeral / High-Frequency)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          FIREBASE REALTIME DATABASE (RTDB)                             │
│                  [Flying Emojis] ◄──► [Live Drawings / Pointer Coords]                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### High-Scale Concurrency Strategy

* **The Bottleneck:** Firestore has a hard limit of **1 write per second per document**. If 500 audience members click "Option A" on a poll simultaneously, updating the presentation document directly will trigger write conflicts, locking up the database.
* **The Architectural Fix:**
  1. Audience members **never** write directly to the interaction or session documents. Instead, they write individual documents to the `sessions/{joinCode}/responses/{responseId}` sub-collection.
  2. The **Projector Display View** runs a client-side `onSnapshot()` listener against the responses sub-collection, aggregating the results in the user's browser RAM.
  3. *For scale > 1,000 users:* Deploy a **Firebase Distributed Counter Extension** to shard response counters across 10 hidden sub-documents, or handle transient tallies through Firebase Realtime Database.

---

## 3. Database, Realtime, & Storage Schemas

### Firestore Schema

#### Root: `users/{userId}`
* `email`: String
* `role`: String *("admin" | "presenter")*
* `createdAt`: Timestamp

#### Root: `workspaces/{workspaceId}`
* `name`: String
* `ownerId`: String
* `members`: Map of `{ [userId]: "admin" | "editor" | "viewer" }`
* `createdAt`: Timestamp

#### Root: `presentations/{presentationId}`
* `workspaceId`: String | null *(If null, belongs to personal space)*
* `title`: String
* `ownerId`: String *(Indexed)*
* `pdfUrl`: String
* `slideCount`: Number
* `status`: String *("processing" | "ready" | "failed")*
* `createdAt`: Timestamp
* `updatedAt`: Timestamp

#### Sub-collection: `presentations/{presentationId}/slides/{slideNumber}`
* `imageUrl`: String
* `thumbnailUrl`: String
* `aspectRatio`: Number *(e.g., 1.777 for 16:9)*
* `notes`: String *(Presenter notes)*

#### Sub-collection: `presentations/{presentationId}/slides/{slideNumber}/interactions/{interactionId}`
* `type`: String *("poll" | "quiz" | "wordcloud" | "opentext" | "rating" | "numeric" | "ranking" | "qna" | "survey" | "truefalse" | "imagechoice" | "brainstorm" | "drawing" | "liveurl" | "timer" | "lottery")*
* `question`: String
* `position`: Map `{ x: Number, y: Number }` *(Normalized coordinates 0.0–1.0 for responsive resizing)*
* `required`: Boolean
* `config`: Map:
  * *For Multiple Choice / Quiz / True-False / Image Choice:* `{ options: String[], correctOptionIndex: Number | null, timeLimit: Number | null, points: Number | null }`
  * *For Rating / Scale:* `{ scaleMax: Number, iconType: "star" | "heart" | "thumbs-up" }`
  * *For Brainstorm:* `{ categories: String[] }`
  * *For Live URL:* `{ url: String }`
  * *For Countdown Timer:* `{ durationSeconds: Number }`

#### Root: `sessions/{joinCode}` *(The Live Event Instance)*
* `presentationId`: String
* `presenterId`: String
* `coHosts`: Array of Strings *(User IDs)*
* `isActive`: Boolean
* `currentSlide`: Number
* `activeInteractionId`: String | null
* `participantCount`: Number
* `quizState`: Map:
  * `activeQuestionId`: String | null
  * `timerEndsAt`: Timestamp | null
  * `showLeaderboard`: Boolean
* `createdAt`: Timestamp

#### Sub-collection: `sessions/{joinCode}/responses/{responseId}`
* `interactionId`: String *(Indexed)*
* `participantToken`: String *(Anonymous Auth UID)*
* `participantName`: String *(For leaderboards / identification)*
* `value`: Any *(Depends on interaction: selected index, drawing vector string, rating scale, brainstorm note object)*
* `isCorrect`: Boolean | null *(For quizzes)*
* `score`: Number *(Points awarded)*
* `submittedAt`: Timestamp

#### Sub-collection: `sessions/{joinCode}/qna/{qnaId}`
* `participantToken`: String
* `participantName`: String
* `question`: String
* `upvotes`: Array of Strings *(List of participant tokens to prevent duplicate voting)*
* `status`: String *("pending" | "approved" | "answered" | "archived")*
* `createdAt`: Timestamp

#### Root: `analytics/{sessionId}`
* `presentationId`: String
* `attendanceCount`: Number
* `averageResponseTime`: Number
* `correctAnswersRatio`: Number
* `engagementGraph`: Map of `{ slideNumber: Number of reactions/responses }`
* `responseHeatmap`: Map of `{ hour: Number }`
* `exportedUrl`: String | null
* `createdAt`: Timestamp

---

### Firebase Realtime Database (RTDB) Schema
RTDB is used for ephemeral, high-frequency, low-latency syncing.

```json
{
  "sessions": {
    "$joinCode": {
      "reactions": {
        "$reactionId": {
          "type": "heart | clap | fire | laugh | shock",
          "timestamp": 1718201201230
        }
      },
      "drawing": {
        "paths": {
          "$pathId": {
            "color": "#FF0000",
            "width": 3,
            "points": "x1,y1 x2,y2 x3,y3"
          }
        },
        "laserPointer": {
          "x": 0.45,
          "y": 0.82,
          "active": true
        }
      }
    }
  }
}
```

---

### Firebase Storage Directory Structure

```
/pdf/{userId}/{presentationId}.pdf                  <-- Raw uploaded slide deck
/slides/{presentationId}/slide_{pageNo}.png          <-- Rasterized slides (1920x1080)
/thumbnails/{presentationId}/thumb_{pageNo}.png      <-- Low-resolution preview thumbnails
/exports/{presentationId}/{sessionId}_report.xlsx   <-- Exported reports
/avatars/{userId}.png                                <-- Presenter profile pictures
/presentation-assets/{presentationId}/               <-- Image Choice assets
```

---

## 4. Authentication Matrix

| User Type | Auth Provider | Gateway Path | Session Access Level |
| --- | --- | --- | --- |
| **System Admin** | Firebase (Email/Google) | `/admin/*` | Create, edit, launch, and delete all decks and user settings. |
| **Presenter** | Firebase (Email/Google/Microsoft) | `/dashboard/*` | Create, edit, and launch owned decks and personal workspaces. |
| **Co-host** | Firebase (Email/Google/Microsoft) | `/dashboard/cohost/*` | Control active session slides and moderate Q&A/sticky notes. |
| **Audience** | Firebase Anonymous Auth | `/join/[code]` | Read slide state, write response nodes, submit questions. |
| **Projector Display**| Read-Only Token URL | `/cast/[sessionId]` | Listen to current slide state, fetch live aggregated results. |

---

## 5. Local Environment Setup & Pre-Flight Checklist

### Local Environment Setup

Create the Next.js foundation initialized with strict typing:

```bash
npx create-next-app@latest interact-deck --typescript --tailwind --eslint --app
cd interact-deck
npm install firebase firebase-admin canvas pdf2pic uuid clsx framer-motion lucide-react exceljs pdfkit d3
npm install -D @types/canvas @types/uuid @types/d3
```

### Pre-Flight Checklist
* [ ] Set up Firebase Project with the **Blaze** (Pay-as-you-go) plan.
* [ ] Provision Firestore (Production Mode) and Realtime Database instances.
* [ ] Configure Firebase Storage CORS to allow canvas rendering of stored PNGs from other origins:
  ```json
  [
    {
      "origin": ["*"],
      "method": ["GET"],
      "maxAgeSeconds": 3600
    }
  ]
  ```
* [ ] Write Firestore Security Rules protecting presentation metadata while allowing anonymous write access to session responses.
* [ ] Configure Google Cloud Secret Manager for automated Cloud Function service accounts.

---

## 6. Developer Gotcha Ledger

### 1. The Aspect Ratio Trap
* **The Issue:** A PDF created on an iPad is 4:3; a PDF created in Canva is 16:9. If your display screen is a standard 16:9 monitor, 4:3 slides will stretch or get cropped.
* **The Resolution:** In the Cloud Function PDF processor, extract the native width/height of the first page, calculate the exact decimal aspect ratio, and store it on the presentation slide documents. On the frontend, enforce the container aspect-ratio:
  ```css
  .slide-container {
    aspect-ratio: var(--aspect-ratio);
  }
  ```

### 2. The "Ghost Session" billing drain
* **The Issue:** Presenters close their laptop lids without clicking "End Session". If you keep Firestore listeners open on 500 dead audience phones sitting in pockets, you will be billed for millions of empty document reads.
* **The Resolution:** Deploy a Cloud Function Cron Job running every 60 minutes that finds all sessions where `updatedAt` is greater than 4 hours old, and sets `isActive: false`.

### 3. Apple iOS Safari PDF Canvas Bug
* **The Issue:** Attempting to render uploaded PDFs directly in the browser using client-side `pdf.js` to save server costs will crash mobile Safari. iOS caps canvas memory allocations, and multi-page vector-heavy decks will exhaust browser RAM by slide 10-15.
* **The Resolution:** Server-side PNG rasterization is mandatory. Keep slide assets under 2MB each and serve them via CDN.

---

## 7. Step-by-Step Project Execution Checklist

```markdown
- [ ] Milestone 1: Project Setup & Cloud Infrastructure
- [ ] Milestone 2: Multi-Role Auth & Workspace Management
- [ ] Milestone 3: PDF Ingestion & Slide Conversion Pipeline
- [ ] Milestone 4: Interactive Slide Editor & Overlay Builder
- [ ] Milestone 5: Session Lifecycle & QR Join Gateway
- [ ] Milestone 6: Multi-Screen Real-Time Sync Engine
- [ ] Milestone 7: Implementing the Core Interactions (15+ Types)
- [ ] Milestone 8: Live Q&A, Chat, Leaderboards, & Reactions
- [ ] Milestone 9: Analytics Dashboard & Reports Export Engine
- [ ] Milestone 10: AI Features, Security, & Launch Polish
```

---

### Milestone 1: Project Setup & Cloud Infrastructure
* [ ] Initialize Next.js 14 App Router project with TypeScript, Tailwind CSS, Framer Motion, and Lucide React.
* [ ] Create Firebase Project, upgrade to **Blaze Plan**.
* [ ] Provision Firestore, Storage, and Realtime Database (RTDB) instances in the designated region.
* [ ] Enable Google, Email/Password, and Microsoft sign-in methods in Firebase Auth.
* [ ] Configure Firebase Storage CORS to allow local and production canvas operations.
* [ ] Set up environment variable schemas (`.env.local` and `.env.production`) for Firebase Client SDK keys.
* [ ] Create Github Repository with branch protection rules (`main` and `develop`).

### Milestone 2: Multi-Role Auth & Workspace Management
* [ ] Set up client-side Firebase Auth context provider in `/src/context/AuthContext.tsx`.
* [ ] Implement Next.js Server-Side Middleware (`middleware.ts`) to restrict dashboard routes to authorized sessions.
* [ ] Build `/app/login` page supporting Google, Microsoft, and Email/Password credentials.
* [ ] Create Firestore user provisioning Cloud Function to register new presenters under `users/`.
* [ ] Implement the Workspace schema (`workspaces/` collection) and workspace switcher in the header.
* [ ] Build workspace settings page to invite other users to a workspace via email (updating the `members` map).
* [ ] Add access validation helper functions to check if the current user is a Presenter or Co-host of a deck.

### Milestone 3: PDF Processing Pipeline (Cloud Functions)
* [ ] Build the file drop zone component (`/app/dashboard/new`) with PDF validation and size limits.
* [ ] Set up Firebase Storage bucket structures for `/pdf`, `/slides`, and `/thumbnails`.
* [ ] Write 2nd-Gen Firebase Cloud Function `processUploadedPdf` triggered by Storage upload:
  * [ ] Stream PDF file into local ephemeral container memory (`/tmp`).
  * [ ] Use `pdf2pic` to render pages to high-res PNG (1920px width, 150 DPI).
  * [ ] Extract aspect ratio of the first slide to lock layout scaling.
  * [ ] Generate lightweight compressed thumbnails (400px width) for dashboard previews.
  * [ ] Upload converted images to Firebase Storage.
  * [ ] Create entries in Firestore under `presentations/{deckId}` and sub-collection `slides/` containing slide URLs and aspects.
  * [ ] Clean up local container `/tmp` directory.
  * [ ] Send real-time completion state updates to Firestore (`presentations/{deckId}` status `"ready"`).

### Milestone 4: Slide Editor & Interactive Overlay Builder
* [ ] Create `/app/editor/[deckId]` layout displaying slide list thumbnail bar on the left, canvas in the center, and settings on the right.
* [ ] Build the canvas slide container with CSS aspect-ratio matching the uploaded deck.
* [ ] Create drag-and-drop tool palettes for interactions (Poll, Quiz, Q&A, Word Cloud, Rating, Open Text, Brainstorm).
* [ ] Write the **Relative Coordinates Calculator** to register drop locations on the slide canvas:
  ```typescript
  const clickX = e.nativeEvent.offsetX;
  const clickY = e.nativeEvent.offsetY;
  const x = clickX / containerWidth;
  const y = clickY / containerHeight;
  ```
* [ ] Save interaction config schemas to the Firestore slide's sub-collection `interactions/`.
* [ ] Build interaction setting panel variations:
  * [ ] Poll/Quiz choice adding/editing with correct-answer toggling.
  * [ ] Countdown timers settings.
  * [ ] Word Cloud validation rules (e.g. limit to 1-3 words).
  * [ ] Brainstorm category tag manager.

### Milestone 5: Session Lifecycle & QR Join Gateway
* [ ] Implement a room-code generation utility returning a unique, human-readable 6-digit code.
* [ ] Create `/app/present/[sessionId]` dashboard page for launching the presenter remote control.
* [ ] Write server action to spin up Firestore document in `sessions/{joinCode}` containing active presentation state.
* [ ] Embed client-side QR Code generator displaying the join URL on the projector cast view: `https://interactdeck.com/join?code=XYZ123`.
* [ ] Create audience entry page `/app/join`:
  * [ ] Verify room exists and is active.
  * [ ] Enable anonymous participant creation using Firebase Auth Anonymous Sign-In.
  * [ ] Prompt participant to enter their display name (for Quizzes/Q&A) or support joining anonymously.
  * [ ] Save credentials in local state and redirect to active room view: `/app/live/[joinCode]`.

### Milestone 6: Multi-Screen Real-Time Sync Engine
* [ ] **Presenter Remote View (`/app/presenter/[joinCode]`):**
  * [ ] Bind active session listeners using `onSnapshot` to view current slide and interactive statuses.
  * [ ] Implement navigation buttons (Next, Back, Jump-to-Slide).
  * [ ] Add buttons to trigger active interactions or toggle visibility of results.
* [ ] **Projector Cast View (`/app/cast/[joinCode]`):**
  * [ ] Listen to changes in the active session document.
  * [ ] Fetch slide slide number and render background image from Firebase Storage.
  * [ ] Implement Framer Motion transitions (fade/slide) between slides.
  * [ ] Render interactive result components on top of slides at normalized overlay coordinates.
* [ ] **Audience Live View (`/app/live/[joinCode]`):**
  * [ ] Render the presenter's active slide state (in read-only viewport).
  * [ ] If `activeInteractionId` is set in the session, slide up the interaction modal instantly.
  * [ ] Write user submission server action to create a response doc under `sessions/{code}/responses/`.

### Milestone 7: Implementing the Core Interactions (15+ Types)
* [ ] **Poll & True/False:** Render bar charts of aggregate results on the projector view in real-time.
* [ ] **Quizzes:**
  * [ ] Implement countdown timer syncing on the participant screen.
  * [ ] Lock response inputs once timer expires.
  * [ ] Calculate quiz scores based on correctness and speed (using response timestamp offset).
* [ ] **Word Cloud:** Implement a real-time D3-based word-cloud generator grouping terms and styling font sizes dynamically based on frequency.
* [ ] **Open Text & Brainstorm:**
  * [ ] Render dynamic masonry grid of sticky notes on the projector.
  * [ ] Add co-host dashboard moderation tool to flag, hide, or group notes.
* [ ] **Rating & Scale:** Display real-time average stars, bell-curve distributions, and median scales.
* [ ] **Ranking:** Add drag-and-drop sortable interface. Output normalized ranking scores.
* [ ] **Drawing Board (Ephemeral Canvas):**
  * [ ] Enable pointer stream in RTDB to broadcast live cursor movements and canvas paths.
  * [ ] Sync drawings to the Projector View Canvas in real-time.
* [ ] **Lottery Picker:** Display spinning names on the projector, fetching random name from `sessions/{code}/responses`.

### Milestone 8: Live Q&A, Chat, Leaderboards, & Reactions
* [ ] **Live Q&A Module:**
  * [ ] Create anonymous submission box for questions.
  * [ ] Enable upvoting (storing list of voter UIDs to prevent duplicate votes).
  * [ ] Build presenter/co-host moderation panel to approve, archive, or highlight active questions.
* [ ] **Flying Reactions Engine (RTDB):**
  * [ ] Add reaction buttons tray for participants (❤️, 👏, 🔥, 😂, 😮).
  * [ ] On click, write ephemeral trigger node to RTDB: `/sessions/{code}/reactions/{randomId}`.
  * [ ] Projector view listens to RTDB, renders floating animation paths using canvas API, and cleans up old nodes.
* [ ] **Quiz Leaderboard:**
  * [ ] Run transaction query to aggregate scores from `responses/`.
  * [ ] Generate sorted leaderboards.
  * [ ] Build animated ranking transition component on the projector screen.

### Milestone 9: Analytics Dashboard & Reports Export Engine
* [ ] Create session wrap-up action which sets `isActive: false` and triggers aggregation cloud function.
* [ ] Build Cloud Function `aggregateSessionAnalytics` to:
  * [ ] Scan responses, questions, attendance, and duration.
  * [ ] Save aggregate summary under `analytics/{sessionId}`.
* [ ] Create Presenter Reports dashboard showing engagement graphs, correct answers, and feedback.
* [ ] Write report export cloud functions using `exceljs` (for CSV/Excel) and `pdfkit` (for styled PDF charts).
* [ ] Set Firebase storage lifecycle policy to auto-expire raw exports after 30 days.

### Milestone 10: AI Features, Security, & Launch Polish
* [ ] **AI Integration:**
  * [ ] Integrate Google Gemini API inside Cloud Functions.
  * [ ] Write function to cluster brainstorm notes or open text responses into topic themes.
  * [ ] Create AI slide question builder (reading slide notes to generate MCQs/Quizzes).
* [ ] **Database & Security Hardening:**
  * [ ] Implement strict Firestore Rules:
    * [ ] Write-only permissions for anonymous participants on responses.
    * [ ] Read-only access for participants on active session states.
    * [ ] Full access restricted to deck owners & listed co-hosts.
  * [ ] Set up Firebase App Check (reCAPTCHA) to protect join endpoints from bot submission spam.
* [ ] **System Maintenance:**
  * [ ] Deploy standard Cloud Function Cron Job to auto-close sessions inactive for >4 hours.
* [ ] **Deployment & Testing:**
  * [ ] Set up Vercel hosting for the Next.js frontend app.
  * [ ] Configure Firebase Hosting or Cloud Functions endpoints.
  * [ ] Conduct performance stress test (simulating 500 concurrent connections submitting responses).
