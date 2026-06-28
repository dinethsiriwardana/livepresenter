# InteractDeck (Live Presenter)

InteractDeck is a real-time audience engagement and presentation projection platform. Instead of recreating slides, presenters upload standard PDF decks which are rasterized into static slide images (**Static Content Plane**). The system then overlays interactive engagement widgets (Polls, Quizzes, Word Clouds, sticky notes, Q&A, and reaction emojis) synced instantly via a real-time JSON state stream (**Dynamic Event Plane**).

---

## 🚀 Getting Started

### 1. Installation

Install the Node dependencies:
```bash
npm install
```

### 2. Run Locally (Using Firebase Local Emulators)
For testing and development without cloud costs, the project supports the **Firebase Local Emulator Suite**.

1. **Start the Firebase Emulators**:
   In your terminal, run:
   ```bash
   npx firebase emulators:start
   ```
   *(This boots up the local console at [http://localhost:4000](http://localhost:4000) representing local Firestore, RTDB, Auth, and Storage).*

2. **Toggle the Local Mode**:
   Open `.env.local` and ensure the emulator flag is active:
   ```env
   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
   ```

3. **Start the Next.js Dev Server**:
   In a separate terminal, run:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the homepage.

---

## 🌐 Connecting to the Real Firebase Project (`interact-deck-90184`)

To connect the application to the live Firebase production servers on Google Cloud:

### Step 1: Configure Environment
Open `.env.local` and set the emulator flag to `false`:
```env
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
```

### Step 2: Enable Services on the Firebase Console
Since the Firebase project was created programmatically, you must manually turn on the required database and login services:

1. **Authentication**: Go to [Firebase Auth Providers](https://console.firebase.google.com/project/interact-deck-90184/authentication/providers):
   - Enable **Anonymous** sign-in (required for audience participation).
   - Enable **Email/Password** sign-in (for presenters).
   - Enable **Google** sign-in (for Google presenter logins).
2. **Firestore Database**: Go to [Cloud Firestore](https://console.firebase.google.com/project/interact-deck-90184/firestore) and click **Create database**. Select your preferred region and choose **Production Mode** (which is secure).
3. **Realtime Database**: Go to [Realtime Database](https://console.firebase.google.com/project/interact-deck-90184/database) and click **Create database**.
4. **Storage**: Go to [Cloud Storage](https://console.firebase.google.com/project/interact-deck-90184/storage) and click **Get Started**.

### Step 3: Deploy Security Rules
Once the databases and storage are initialized in the Firebase console, upload our secure configuration rules directly from the project directory by running:
```bash
npx firebase deploy --only firestore:rules,database,storage
```
This automatically configures correct read/write permissions for presenters and participants, overwriting the default locked-down settings.

---

## 📁 Project Structure

- `src/lib/`: Firebase client (`firebaseClient.ts`) and server admin (`firebaseAdmin.ts`) SDK configurations.
- `src/context/`: `AuthContext.tsx` providing Google, Email, and Anonymous state management.
- `src/middleware.ts`: Next.js middleware protecting host `/dashboard` and `/editor` routes.
- `src/app/`: Next.js App Router routing matrix:
  - `/`: Main Landing Page.
  - `/login`: Form for host sign-in and account registration.
  - `/join`: Gateway page for audience members to enter room code.
  - `/dashboard`: Workspace selection and presentation templates manager.
  - `/dashboard/new`: Slide PDF uploader converting slides client-side to PNGs.
  - `/editor/[deckId]`: Canvas editor displaying coordinate overlay builder.
  - `/present/[sessionId]`: Presenter remote dashboard control panel.
  - `/cast/[joinCode]`: Fullscreen cast projection overlaying aggregate charts, pointer locations, and reaction emojis.
  - `/live/[joinCode]`: Participant dashboard with dynamic interaction modals and flying reaction buttons.
  - `/analytics/[sessionId]`: Post-session recap dashboard exporting response logs to CSV.
  - `/api/ai/`: Next.js route connecting to Gemini API (flash model) to auto-generate quizzes and cluster sticky notes.
