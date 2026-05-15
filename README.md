# ⬛ Builtix

**Build anything from your phone. Mobile-first AI terminal.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/varsansri/builtix&env=GROQ_KEY_1,GROQ_KEY_2,GROQ_KEY_3,GROQ_KEY_4&envDescription=Groq%20API%20keys%20for%20auto-rotation%20when%20one%20hits%20rate%20limits&envLink=https://console.groq.com/keys&project-name=builtix&repository-name=builtix-deploy)

---

## ▶ Deploy in 60 seconds

1. Click the **Deploy with Vercel** button above
2. Log in with GitHub
3. Enter your 4 Groq API keys when asked
4. Click Deploy — done

Your live URL will be `builtix-xxxx.vercel.app`

---

## What Builtix can do

- Read, write, edit files
- Run bash commands
- Search the web
- Fetch URLs
- Voice input (tap mic, speak, send)
- Attach files from your phone
- 4 Groq API keys — auto-switches when one hits rate limit
- Full transparent step-by-step output like Claude Code

## Run locally

```bash
# Install deps
npm install

# Add your keys
cp backend/.env.example .env
# Edit .env with your Groq keys

# Start (two terminals)
npm run dev:backend
npm run dev:frontend
```

Open `http://localhost:5173` in Chrome.
