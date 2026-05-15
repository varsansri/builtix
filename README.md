# Builtix

Mobile-first AI terminal. Build anything from your phone.

## Run locally

### Backend
```bash
cd backend
cp .env.example .env
# Add your Anthropic API key to .env
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in Chrome on your phone (same wifi).

## Deploy
- Backend: Railway / Render (add ANTHROPIC_API_KEY env var)
- Frontend: Vercel (set VITE_API_URL to your backend URL)
