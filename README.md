# SubZero — Email Subscription Killer

Scan your Gmail for the past year, find every subscription and newsletter, and unsubscribe in one click. Powered by Gemini AI (free).

---

## Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Queue**: BullMQ + Redis
- **AI**: Gemini 2.0 Flash (free)
- **Email**: Gmail API via OAuth2

---

## Setup (takes ~15 minutes)

### 1. Get a Gemini API key (free)
1. Go to https://aistudio.google.com
2. Click "Get API key" → Create API key
3. Copy it

### 2. Set up Google OAuth2
1. Go to https://console.cloud.google.com
2. Create a new project (or use existing)
3. Go to "APIs & Services" → "Enable APIs" → enable **Gmail API**
4. Go to "OAuth consent screen":
   - User type: External
   - Fill in app name (e.g. SubZero), your email
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Add your email as a test user
5. Go to "Credentials" → "Create Credentials" → OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URI: `http://localhost:3001/auth/google/callback`
6. Copy Client ID and Client Secret

### 3. Install Redis (local)
```bash
# macOS
brew install redis && brew services start redis

# Ubuntu/WSL
sudo apt install redis-server && sudo service redis start

# Or use Railway free tier: railway.app
```

### 4. Set up backend
```bash
cd backend
cp .env.example .env
# Fill in your .env with the keys above
npm install
```

### 5. Set up frontend
```bash
cd frontend
npm install
```

### 6. Run everything

Open 3 terminal tabs:

**Tab 1 — Backend:**
```bash
cd backend && npm run dev
```

**Tab 2 — Worker (email scanner):**
```bash
cd backend && npm run worker
```

**Tab 3 — Frontend:**
```bash
cd frontend && npm run dev
```

Visit http://localhost:3000

---

## How it works

1. User clicks "Connect Gmail" → Google OAuth2 consent
2. Backend gets read-only access token (encrypted, stored in session)
3. User clicks "Start scanning" → BullMQ queues a background job
4. Worker fetches emails via Gmail API (past 12 months, promotions + subscription keywords)
5. Deduplicates by sender domain (5,000 emails → ~80 unique senders)
6. Sends sender list to Gemini for classification
7. Results saved to Redis, shown on dashboard
8. User clicks "Unsubscribe" → backend reads List-Unsubscribe header and opens the URL

---

## Deploying to production

**Frontend → Vercel:**
```bash
cd frontend && npx vercel
```

**Backend + Worker → Railway:**
- Connect your GitHub repo
- Add environment variables
- Deploy backend as one service, worker as another

Update `.env` with production URLs before deploying.

---

## Adding Outlook/Yahoo later

The architecture is ready — just add new OAuth routes in `backend/src/routes/auth.js` and new extractor services in `backend/src/services/`. The worker calls whichever extractor matches the user's connected provider.
