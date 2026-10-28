// POST /api/food-photo  { image: <base64 JPEG>, lang: "en" | "zh" }
// Header: Authorization: Bearer <Supabase access token>
// Returns { items: [{ name_en, name_zh, grams, kcal, protein_g, fat_g, carbs_g }], note }
//
// Environment (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  required
//   ALLOWED_EMAILS     optional, comma-separated; when set, only these accounts may use it
import Anthropic from "@anthropic-ai/sdk";

// Public values (same as config.js); used only to check the caller's login.
const SUPABASE_URL = "https://krsixzjzdwmxtxsybcsm.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtyc2l4emp6ZHdteHR4c3liY3NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MzQ0NzQsImV4cCI6MjEwODUxMDQ3NH0.GoCZQY_dnUD6krMoqjf-cb_qvo9bKUKiiY0mCdx8PD0";
const MAX_IMAGE_CHARS = 4_000_000; // base64 length; the app sends ~200-400 KB

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name_en: { type: "string" },
          name_zh: { type: "string" },
          grams: { type: "number" },
          kcal: { type: "number" },
          protein_g: { type: "number" },
          fat_g: { type: "number" },
          carbs_g: { type: "number" },
        },
        required: ["name_en", "name_zh", "grams", "kcal", "protein_g", "fat_g", "carbs_g"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["items", "note"],
  additionalProperties: false,
};

const PROMPT = `This photo was taken by someone logging what they are about to eat. They live in Singapore and often eat hawker food, Chinese dishes, and simple home or gym-friendly meals.

List each distinct food or drink you can see as a separate item (for example rice, chicken and the side vegetables of a plate are separate items unless it is clearly one named dish like chicken rice). For each item give an English name, a short Chinese name, your best estimate of the portion actually on the plate in grams (or ml for drinks), and the calories, protein, fat and carbohydrate for that portion. Use typical Singapore portion sizes and cooking styles (oil, sauces) when you cannot tell.

Use the plate, bowl, cutlery or hands in the photo to judge size. Round grams to the nearest 5 and nutrients to whole numbers or one decimal.

In "note", write one short sentence (in the user's language: {LANG}) saying what was hardest to judge, e.g. hidden oil or sauce. If the photo shows no food, return an empty items list and say so in the note.`;

export async function analyze(client, image, lang) {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: PROMPT.replace("{LANG}", lang === "zh" ? "Chinese" : "English") },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") return { status: 422, body: { error: "refused" } };
  if (response.stop_reason === "max_tokens") return { status: 502, body: { error: "too_long" } };
  const text = response.content.find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(text ? text.text : "");
  } catch {
    return { status: 502, body: { error: "bad_output" } };
  }
  const num = (v) => (Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 10) / 10 : 0);
  const items = (parsed.items || [])
    .filter((x) => x && x.name_en && num(x.grams) > 0)
    .slice(0, 12)
    .map((x) => ({
      name_en: String(x.name_en).slice(0, 80),
      name_zh: String(x.name_zh || "").slice(0, 40),
      grams: Math.round(num(x.grams)),
      kcal: Math.round(num(x.kcal)),
      protein_g: num(x.protein_g),
      fat_g: num(x.fat_g),
      carbs_g: num(x.carbs_g),
    }));
  return { status: 200, body: { items, note: String(parsed.note || "").slice(0, 300) } };
}

export async function checkUser(authHeader, fetchFn = fetch) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetchFn(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
  });
  if (!r.ok) return null;
  const u = await r.json();
  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(String(u.email || "").toLowerCase())) return null;
  return u;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "not_configured" });
  const user = await checkUser(req.headers.authorization).catch(() => null);
  if (!user) return res.status(401).json({ error: "sign_in" });
  const { image, lang } = req.body || {};
  if (typeof image !== "string" || !image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return res.status(400).json({ error: "image" });
  }
  try {
    const out = await analyze(new Anthropic(), image, lang);
    return res.status(out.status).json(out.body);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "busy" });
    if (error instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: "not_configured" });
    if (error instanceof Anthropic.BadRequestError) return res.status(400).json({ error: "image" });
    if (error instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream" });
    return res.status(500).json({ error: "server" });
  }
}
