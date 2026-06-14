import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Book recommender running at http://localhost:${PORT}`));
