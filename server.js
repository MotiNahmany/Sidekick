import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// ---- Maintenance switch -------------------------------------------------
// Set the env var MAINTENANCE=on (in Render → Environment) to take the whole
// site offline behind a "back soon" page; set it to off (or remove it) to
// resume. Evaluated at startup, so a change triggers a redeploy/restart.
const MAINTENANCE = /^(1|on|true|yes)$/i.test((process.env.MAINTENANCE || "").trim());

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Andrea Blake — back soon</title>
<style>
  html, body { height: 100%; }
  body { margin: 0; display: flex; align-items: center; justify-content: center;
    background: #1e1e1e; color: #d4d4d4; text-align: center; padding: 2rem;
    font-family: "Book Antiqua", "Palatino Linotype", Palatino, Georgia, serif; }
  h1 { color: #ff5b00; font-size: 2.4rem; margin: 0 0 0.75rem; }
  p { font-size: 1.15rem; line-height: 1.5; color: #9d9d9d; margin: 0.35rem 0; }
  .tag { margin-top: 1.75rem; font-size: 0.78rem; letter-spacing: 0.1em;
    text-transform: uppercase; color: #6b6b6b; }
</style></head>
<body><div>
  <h1>Andrea Blake</h1>
  <p>We've stepped out for the night.</p>
  <p>The site is paused for maintenance and will be back tomorrow.</p>
  <div class="tag">Temporarily offline</div>
</div></body></html>`;

if (MAINTENANCE) {
  app.use((req, res) => {
    res.set("Retry-After", "3600");
    res.status(503).type("html").send(MAINTENANCE_HTML);
  });
}
// -------------------------------------------------------------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// JSON schema constraining Claude to exactly the shape the frontend renders.
const BOOKS_SCHEMA = {
  type: "object",
  properties: {
    books: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          author: { type: "string" },
          why: {
            type: "string",
            description: "One or two sentences on why this reader will love it.",
          },
        },
        required: ["title", "author", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["books"],
  additionalProperties: false,
};

app.post("/api/recommend", async (req, res) => {
  const interests = (req.body?.interests ?? "").trim();
  if (!interests) {
    return res.status(400).json({ error: "Please describe your interests." });
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: BOOKS_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `A reader describes their interests as:\n\n"${interests}"\n\n` +
            "Recommend exactly 5 real, published books this person is likely to consider a great read. " +
            "Favor well-regarded titles, vary them across their interests, and avoid obscure or fabricated books. " +
            "For each, give the exact title, the author, and a short, specific reason it fits this reader.",
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const { books } = JSON.parse(text);
    res.json({ books });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Could not get recommendations. Please try again." });
  }
});

// Schedule shape for the Plan My Day tool.
const SCHEDULE_SCHEMA = {
  type: "object",
  properties: {
    schedule: {
      type: "array",
      items: {
        type: "object",
        properties: {
          time: { type: "string", description: "Time block, e.g. '9:00–9:30 AM'." },
          description: { type: "string", description: "Quick description of the task." },
          people: {
            type: "array",
            items: { type: "string" },
            description: "People involved; empty array if none.",
          },
          dependencies: {
            type: "array",
            items: { type: "string" },
            description:
              "Quick descriptions of other tasks in this list that must happen first; empty array if none.",
          },
        },
        required: ["time", "description", "people", "dependencies"],
        additionalProperties: false,
      },
    },
  },
  required: ["schedule"],
  additionalProperties: false,
};

app.post("/api/plan", async (req, res) => {
  const todos = (req.body?.todos ?? "").trim();
  if (!todos) {
    return res.status(400).json({ error: "Please describe what you need to do today." });
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      output_config: { format: { type: "json_schema", schema: SCHEDULE_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Here is everything I need to do today:\n\n"${todos}"\n\n` +
            "Organize and optimize this into a realistic, time-ordered schedule for today. " +
            "Respect any fixed meeting times I gave, batch similar work together, include lunch, " +
            "leave brief buffers between blocks, and order tasks so their dependencies are satisfied. " +
            "Return an itemized schedule. For each item give: a time block, a quick description, the " +
            "people involved, and which other tasks (by their quick description) it depends on.",
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const { schedule } = JSON.parse(text);
    res.json({ schedule });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Could not build your schedule. Please try again." });
  }
});

// =====================================================================
//  Trading News — web-searched, market-moving headlines
// =====================================================================
// Claude searches the web (server-side web_search tool), returns the items as
// a JSON block, and the result is cached in memory and refreshed on a
// 10-minute interval. The frontend polls /api/news.
//
// Uses the basic web_search_20250305 variant (not _20260209): the dynamic-
// filtering variant runs code execution under the hood, which burns the search
// quota before results return and yields an empty list.
const NEWS_PROMPT =
  "Search the web for the most recent news events that move financial markets — " +
  "economic data and central-bank actions (BLS jobs/CPI/PPI, Fed/ECB/BOJ decisions), " +
  "geopolitical developments, and major corporate or commodity headlines — that affect " +
  "stocks, bonds, futures, currencies, commodities, Bitcoin, and alternative assets.\n\n" +
  "Find 12–15 of the highest-impact items from roughly the last 3–4 days. Prefer concrete, " +
  "numeric, recent items over vague commentary, and use only real, verifiable reporting.\n\n" +
  "When done, respond with ONLY a JSON object inside a ```json code block, no prose outside it, " +
  'of the form {"items":[{"date":"<ISO 8601 UTC date-time>","source":"<publisher or issuing body>",' +
  '"summary":"<at most 3 short lines; lead with the key numbers (actual vs expected/prior) and the ' +
  'expected market impact>"}]}. Order items newest first.';

const NEWS_REQUEST = {
  model: "claude-opus-4-8",
  max_tokens: 8000,
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
};

// Pull the items array out of the model's final text (a ```json fence, or the
// first balanced {...} as a fallback).
function parseNewsItems(text) {
  let jsonStr = null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  if (fence) {
    jsonStr = fence[1];
  } else {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) jsonStr = text.slice(start, end + 1);
  }
  if (!jsonStr) return [];
  const parsed = JSON.parse(jsonStr);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

let newsCache = { items: [], updatedAt: null, error: null };
let newsRefreshing = false;

async function refreshNews() {
  if (newsRefreshing) return;
  newsRefreshing = true;
  try {
    const messages = [{ role: "user", content: NEWS_PROMPT }];
    let response = await client.messages.create({ ...NEWS_REQUEST, messages });

    // Server-side tool loops can hit their iteration cap and pause; resume.
    let guard = 0;
    while (response.stop_reason === "pause_turn" && guard++ < 5) {
      messages.push({ role: "assistant", content: response.content });
      response = await client.messages.create({ ...NEWS_REQUEST, messages });
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const items = parseNewsItems(text);
    // Newest first.
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (items.length) {
      newsCache = { items, updatedAt: new Date().toISOString(), error: null };
    } else {
      // Keep the last good batch; note that this refresh found nothing.
      newsCache = { ...newsCache, updatedAt: new Date().toISOString() };
    }
    console.log(`Trading News refreshed: ${items.length} items at ${newsCache.updatedAt}`);
  } catch (err) {
    console.error("Trading News refresh failed:", err.message);
    newsCache = { ...newsCache, error: "Could not refresh trading news." };
  } finally {
    newsRefreshing = false;
  }
}

app.get("/api/news", (req, res) => res.json(newsCache));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Book recommender running at http://localhost:${PORT}`);
  // Refresh now, then every 10 minutes. Skipped while in maintenance mode.
  if (!MAINTENANCE) {
    refreshNews();
    setInterval(refreshNews, 10 * 60 * 1000);
  }
});
