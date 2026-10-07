// Three jobs.
// 1) Serve the public site: requests for existing files are answered by Cloudflare's asset handling
//    before this code runs, so fetch() only sees misses.
// 2) Gate the course area: /learn/<course>/... is served from the COURSE_FILES KV namespace, only to a
//    signed-in learner whose account holds that course. The check is Supabase's own has_course() run
//    with the learner's token, so row-level security decides, not this file.
// 3) Keep the Supabase free-tier project awake with a daily read (free projects pause after seven idle days).

const GATE = /^\/learn\/([a-z0-9-]+)\/(.*)$/;
const TYPES = { html: "text/html; charset=utf-8", txt: "text/plain; charset=utf-8", css: "text/css", js: "text/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf", zip: "application/zip", ico: "image/x-icon" };
const COOKIE = "sb_access";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const bare = /^\/learn\/([a-z0-9-]+)$/.exec(url.pathname);   // /learn/<course> without the slash
    if (bare) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
    const m = GATE.exec(url.pathname);
    if (!m) return env.ASSETS.fetch(request);

    const [, course, rest] = m;
    const token = readCookie(request.headers.get("cookie"), COOKIE);
    const signIn = () => Response.redirect(`${url.origin}/learn/?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    if (!token) return signIn();

    const allowed = await hasCourse(env, token, course);
    if (allowed === null) return signIn();                      // token missing, expired or forged: sign in again
    if (allowed === false) return Response.redirect(`${url.origin}/learn/?missing=${encodeURIComponent(course)}`, 302);

    const path = rest === "" ? "START-HERE.html" : rest.replace(/\/$/, "/index.html");
    const body = await env.COURSE_FILES.get(`${course}/${path}`, { type: "stream" });
    if (!body) return env.ASSETS.fetch(new Request(`${url.origin}/__missing__`, request)); // the site's 404 page
    const ext = (path.split(".").pop() || "").toLowerCase();
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "same-origin",
      },
    });
  },

  async scheduled(_event, env) {
    const res = await fetch(env.SUPABASE_URL + "/rest/v1/courses?select=slug&limit=1", { headers: anon(env) });
    console.log("supabase keep-alive", res.status, await res.text());
  },
};

function anon(env, bearer) {
  return { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + (bearer || env.SUPABASE_PUBLISHABLE_KEY) };
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** true / false from has_course(); null when the token is not accepted. */
async function hasCourse(env, token, course) {
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/has_course", {
    method: "POST",
    headers: { ...anon(env, token), "Content-Type": "application/json" },
    body: JSON.stringify({ course }),
  });
  if (!res.ok) return null;
  return (await res.json()) === true;
}
