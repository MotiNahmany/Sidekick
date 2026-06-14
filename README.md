# Sidekick

A small multi-tab web app powered by the Claude API. A left nav switches between
tools:

- **Book Match** — describe your interests, get 5 tailored book recommendations
  with cover images and Amazon search links.
- **Plan My Day** — dump everything you need to do today (meetings, tasks,
  computer work, lunch); Claude organizes and optimizes it into a time-ordered
  schedule table (Time · Task · People · Depends on).

## How it works

```
Browser (public/)                Express (server.js)            Claude API
─────────────────                ───────────────────            ──────────
Book Match  →  POST /api/recommend  →  holds the API key  →  claude-opus-4-8
Plan My Day →  POST /api/plan        →  structured output →  claude-opus-4-8
```

The Express server exists so your Anthropic API key stays on the server and is
never exposed to the browser. Both endpoints use structured JSON output so the
results are always well-formed.

Book covers come from the free Open Library API (searched by title + author).
The tabs are client-side views; the URL hash (`#book` / `#plan`) remembers the
current tab across refreshes.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Add your API key:
   - Copy `.env.example` to `.env`
   - Paste your key from https://console.anthropic.com/settings/keys
3. Start the server:
   ```
   npm start
   ```
4. Open http://localhost:3000

## Files

- `server.js` — Express server + `/api/recommend` and `/api/plan`
- `public/index.html` — app shell (sidebar + both views)
- `public/style.css` — styling
- `public/app.js` — tab navigation + both tools' frontend logic

No build step.
