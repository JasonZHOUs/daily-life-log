// POST /api/food-photo  { image: <base64 JPEG>, lang: "en" | "zh" }
// Header: Authorization: Bearer <Supabase access token>
// Returns { items: [{ name_en, name_zh, grams, kcal, protein_g, fat_g, carbs_g }], note }
//
// Environment (Vercel → Project → Settings → Environment Variables), one of:
//   GEMINI_API_KEY     Google Gemini (has a free tier). Used first when present.
//   ANTHROPIC_API_KEY  Claude. A Gemini key (starts with "AIza") placed here is treated as Gemini.
// Optional:
//   GEMINI_MODEL       defaults to gemini-3.8-flash
//   ALLOWED_EMAILS     comma-separated; when set, only these accounts may use it
import Anthropic from "@anthropic-ai/sdk";
import { checkUser } from "./_lib.js";
export { checkUser };

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
  return clean(text ? text.text : "");
}

// Gemini Interactions API (REST). The response shape is read defensively: the SDKs expose
// output_text, and the raw resource carries the model output inside its steps/outputs.
export function geminiText(j) {
  if (j && typeof j.output_text === "string") return j.output_text;
  const found = [];
  const walk = (v) => {
    if (typeof v === "string") { if (/^\s*\{[\s\S]*"items"/.test(v)) found.push(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(j);
  return found.length ? found[found.length - 1] : "";
}

// Free-tier models get overloaded or hit per-model quotas; try the next model when that happens.
export const GEMINI_MODELS = () =>
  [...new Set([process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"].filter(Boolean))];

export async function analyzeGemini(key, image, lang, fetchFn = fetch, models = GEMINI_MODELS()) {
  let out;
  for (const model of [].concat(models)) {
    out = await geminiOnce(key, image, lang, fetchFn, model);
    if (!out.retry) break;
  }
  delete out.retry;
  return out;
}

async function geminiOnce(key, image, lang, fetchFn, model) {
  const r = await fetchFn("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { type: "text", text: PROMPT.replace("{LANG}", lang === "zh" ? "Chinese" : "English") },
        { type: "image", data: image, mime_type: "image/jpeg" },
      ],
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
    }),
  });
  if (!r.ok) {
    const raw = await r.text().catch(() => "");
    console.error("gemini", r.status, raw.slice(0, 300));
    // Google's own explanation (e.g. API disabled, key restricted, quota, model name), shown in the app.
    let detail = "";
    try { const o = JSON.parse(raw), e = (Array.isArray(o) ? o[0] : o).error || {}; detail = [e.status, e.message].filter(Boolean).join(": "); } catch { detail = raw; }
    detail = `Gemini ${r.status}${detail ? " " + detail.replace(/AIza[\w-]+/g, "[key]").slice(0, 240) : ""}`;
    const keyProblem = r.status === 401 || r.status === 403 || /API_KEY|api key/i.test(detail);
    if (keyProblem) return { status: 503, body: { error: "not_configured", detail } };
    // overloaded (503/500), quota (429) or model unavailable to this key (404): try the next model
    if ([429, 500, 503, 504, 404].includes(r.status)) return { status: 429, body: { error: "busy", detail }, retry: true };
    if (r.status === 400) return { status: 400, body: { error: "image", detail } };
    return { status: 502, body: { error: "upstream", detail } };
  }
  return clean(geminiText(await r.json()));
}

export function pickProvider(env = process.env) {
  const a = (env.ANTHROPIC_API_KEY || "").trim(), g = (env.GEMINI_API_KEY || "").trim();
  if (g) return { kind: "gemini", key: g };
  // Claude keys always start with "sk-ant-"; anything else saved here is taken to be a Gemini key.
  if (a && !a.startsWith("sk-ant-")) return { kind: "gemini", key: a };
  if (a) return { kind: "claude" };
  return null;
}

function clean(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || "").replace(/^\s*```(?:json)?|```\s*$/g, ""));
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

// Up to three model attempts can take a while; allow time for them.
export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const provider = pickProvider();
  if (!provider) return res.status(503).json({ error: "not_configured" });
  const user = await checkUser(req.headers.authorization).catch(() => null);
  if (!user) return res.status(401).json({ error: "sign_in" });
  const { image, lang } = req.body || {};
  if (typeof image !== "string" || !image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return res.status(400).json({ error: "image" });
  }
  try {
    const out = provider.kind === "gemini"
      ? await analyzeGemini(provider.key, image, lang)
      : await analyze(new Anthropic(), image, lang);
    return res.status(out.status).json(out.body);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "busy" });
    if (error instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: "not_configured", detail: "Claude 401: the key in ANTHROPIC_API_KEY was rejected" });
    if (error instanceof Anthropic.BadRequestError) return res.status(400).json({ error: "image" });
    if (error instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream" });
    return res.status(500).json({ error: "server" });
  }
}
