// Shared by the API functions. Files starting with "_" are not served as routes by Vercel.

// Public values (same as config.js).
export const SUPABASE_URL = "https://krsixzjzdwmxtxsybcsm.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtyc2l4emp6ZHdteHR4c3liY3NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MzQ0NzQsImV4cCI6MjEwODUxMDQ3NH0.GoCZQY_dnUD6krMoqjf-cb_qvo9bKUKiiY0mCdx8PD0";
// Public half of the Web Push key pair; the private half is the VAPID_PRIVATE_KEY env var.
export const VAPID_PUBLIC =
  "BErwRNr7p821FnB-t8b44r2Q8An1gz31nI6EVlmYYR9SgEgBPtE4RIYylGbIlmL36hj31xS5DA0ngGRwZs764Ak";

// Returns the signed-in Supabase user for a "Bearer <token>" header, or null.
// ALLOWED_EMAILS (comma-separated), when set, limits which accounts may use the API.
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

// Supabase REST with the service role key (server only; bypasses row level security).
export function admin(fetchFn = fetch) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const call = async (path, opt = {}) => {
    const r = await fetchFn(`${SUPABASE_URL}/rest/v1/${path}`, { ...opt, headers: { ...h, ...(opt.headers || {}) } });
    if (!r.ok) throw new Error(`supabase ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  return {
    get: (path) => call(path),
    post: (path, body, prefer) => call(path, { method: "POST", body: JSON.stringify(body), headers: prefer ? { Prefer: prefer } : {} }),
    del: (path) => call(path, { method: "DELETE" }),
  };
}
