// Three jobs.
// 1) Serve the public site: requests for existing files are answered by Cloudflare's asset handling
//    before this code runs, so fetch() only sees misses, plus /assets/video/ (byte ranges for Safari, below).
// 2) Gate the course area: /learn/<course>/... is served from the COURSE_FILES KV namespace, only to a
//    signed-in learner whose account holds that course. The check is Supabase's own has_course() run
//    with the learner's token, so row-level security decides, not this file. Lesson videos and their posters
//    (<course>/video/...) come from the COURSE_MEDIA R2 bucket, behind the same check, in byte ranges.
// 3) Keep the Supabase free-tier project awake with a daily read (free projects pause after seven idle days).
// On the dev site (SITE_ENV = "dev", dev.aiskillszone.com) it also asks for a password on every request, tells
// search engines to stay away, and points every page at the dev Supabase project instead of the live one.

const GATE = /^\/learn\/([a-z0-9-]+)\/(.*)$/;
const TYPES = { mp4: "video/mp4", html: "text/html; charset=utf-8", txt: "text/plain; charset=utf-8", css: "text/css", js: "text/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf", zip: "application/zip", ico: "image/x-icon" };
const COOKIE = "sb_access";
const VIDEO = "/assets/video/";
const MEDIA = /^video\//;   // lesson videos and posters inside a course: <course>/video/<id>.mp4 and .jpg

export default {
  async fetch(request, env) {
    if (env.SITE_ENV === "dev") return devSite(request, env);
    return serve(request, env);
  },

  async scheduled(_event, env) {
    const res = await fetch(env.SUPABASE_URL + "/rest/v1/courses?select=slug&limit=1", { headers: anon(env) });
    console.log("supabase keep-alive", res.status, await res.text());
  },
};

async function serve(request, env) {
    const url = new URL(request.url);
    const bare = /^\/learn\/([a-z0-9-]+)$/.exec(url.pathname);   // /learn/<course> without the slash
    if (bare) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
    if (url.pathname.startsWith(VIDEO) && request.headers.has("range")) return serveRange(request, env);
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
    if (MEDIA.test(path)) {
      return (await courseMedia(request, env, `${course}/${path}`))
        || new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
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
}

// ---------------------------------------------------------------- video byte ranges
// Safari only plays a video from a server that answers a byte-range request with 206 Partial Content, and the
// asset service always sends the whole file. So range requests for /assets/video/ (routed here by
// run_worker_first) get just the asked-for bytes.
async function serveRange(request, env) {
  const res = await env.ASSETS.fetch(new Request(request.url, { headers: { "Accept-Encoding": "identity" } }));
  if (res.status !== 200) return res;
  // the asset service gives a Worker no Content-Length, so read the whole file
  return ranged(request, await res.arrayBuffer(), new Headers(res.headers));
}

// Lesson videos and posters live only in the COURSE_MEDIA R2 bucket, one folder per course
// (zero-to-ai-tester/video/l0-0a.mp4). R2 reads just the asked-for bytes and streams them, so the Worker never
// holds a whole video, however many learners press play at once. Returns null when the file is not in the bucket.
async function courseMedia(request, env, key) {
  const want = parseRange(request.headers.get("range"));
  const unsatisfiable = (size) => new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  if (want === false || (want && want.suffix === 0)) {
    const head = await env.COURSE_MEDIA.head(key);
    return head ? unsatisfiable(head.size) : null;
  }
  let obj;
  try {
    obj = request.method === "HEAD" ? await env.COURSE_MEDIA.head(key) : await env.COURSE_MEDIA.get(key, want ? { range: want } : {});
  } catch (err) {                                               // R2 turns down a range that runs past the end
    const head = await env.COURSE_MEDIA.head(key);
    if (!head || !want) throw err;
    if (want.offset >= head.size) return unsatisfiable(head.size);
    obj = await env.COURSE_MEDIA.get(key, { range: { offset: want.offset || 0 } });   // HTTP reads it as "to the end"
  }
  if (!obj) return null;
  const size = obj.size;
  const headers = new Headers({
    "Content-Type": TYPES[(key.split(".").pop() || "").toLowerCase()] || "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "X-Robots-Tag": "noindex, nofollow",
    "Accept-Ranges": "bytes",
  });
  const body = request.method === "HEAD" ? null : obj.body;
  if (!want) {
    headers.set("Content-Length", String(size));
    return new Response(body, { status: 200, headers });
  }
  const start = want.suffix ? Math.max(0, size - want.suffix) : want.offset;
  const end = want.length ? Math.min(start + want.length, size) - 1 : size - 1;
  if (start >= size) {
    if (body) await body.cancel();
    return unsatisfiable(size);
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(body, { status: 206, headers });
}

// One "bytes=a-b", "bytes=a-" or "bytes=-n" as an R2 range; null for no (or an unsupported) Range header, which
// gets the whole file; false for a range that ends before it starts.
function parseRange(header) {
  const r = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!r || (r[1] === "" && r[2] === "")) return null;
  if (r[1] === "") return { suffix: Number(r[2]) };
  const offset = Number(r[1]);
  if (r[2] === "") return { offset };
  const end = Number(r[2]);
  return end < offset ? false : { offset, length: end - offset + 1 };
}

// A 200 with the whole body, or a 206 with the asked-for bytes, or a 416 for a range past the end.
function ranged(request, buf, headers) {
  const size = buf.byteLength;
  const r = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get("range") || "").trim());
  let start = -1, end = -1;
  if (r && r[1] !== "") { start = Number(r[1]); end = r[2] === "" ? size - 1 : Math.min(Number(r[2]), size - 1); }
  else if (r && r[2] !== "") { start = Math.max(0, size - Number(r[2])); end = size - 1; }
  headers.set("Accept-Ranges", "bytes");
  if (!r) { headers.set("Content-Length", String(size)); return new Response(request.method === "HEAD" ? null : buf, { status: 200, headers }); }
  if (start < 0 || start > end || start >= size || (r[1] === "" && Number(r[2]) === 0)) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(request.method === "HEAD" ? null : buf.slice(start, end + 1), { status: 206, headers });
}

// ---------------------------------------------------------------- dev site
async function devSite(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
  if (!devAuthorised(request, env)) {
    return new Response("Dev site. Ask the owner for the password.", {
      status: 401, headers: { "WWW-Authenticate": 'Basic realm="AI Skills Zone dev", charset="UTF-8"', "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
    });
  }
  const res = await serve(request, env);
  const headers = new Headers(res.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Cache-Control", "private, no-store");   // nothing on dev is cached anywhere, course pages included
  if (!(headers.get("Content-Type") || "").includes("text/html")) return new Response(res.body, { status: res.status, headers });
  // Same HTML as the live site, pointed at the dev project, with a ribbon so nobody mistakes it for live.
  let html = await res.text();
  html = html.split(env.LIVE_SUPABASE_URL).join(env.SUPABASE_URL).split(env.LIVE_SUPABASE_PUBLISHABLE_KEY).join(env.SUPABASE_PUBLISHABLE_KEY);
  const ribbon = '<div style="position:fixed;left:0;right:0;top:0;z-index:2147483647;height:4px;background:repeating-linear-gradient(45deg,#F97316 0 12px,#111 12px 24px)"></div>'
    + '<div style="position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:3px 8px;border-radius:6px;font:700 11px/1.4 system-ui,sans-serif;color:#111;background:#FBBF24;pointer-events:none">DEV · test payments only</div>';
  html = html.replace(/<body([^>]*)>/i, (m) => m + ribbon);
  headers.delete("Content-Length"); headers.delete("ETag");
  return new Response(html, { status: res.status, headers });
}

function devAuthorised(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ") || !env.DEV_PASSWORD) return false;
  let decoded = "";
  try { decoded = atob(h.slice(6)); } catch { return false; }
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  if (pass.length !== env.DEV_PASSWORD.length) return false;
  let diff = 0;
  for (let i = 0; i < pass.length; i++) diff |= pass.charCodeAt(i) ^ env.DEV_PASSWORD.charCodeAt(i);
  return diff === 0;
}

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

/** true / false from has_course(); null when the token is not accepted.
 *  A "yes" is remembered for 60 seconds per token in this isolate, so a learner clicking through
 *  lessons costs one database round-trip a minute instead of one per page. Revoking access or a
 *  token therefore takes effect within a minute. A "no" is never remembered: someone who was turned
 *  away and then buys gets in on their very next click. */
const ACCESS_CACHE = new Map();
async function hasCourse(env, token, course) {
  const key = course + ":" + token.slice(-48);
  const hit = ACCESS_CACHE.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await hasCourseUncached(env, token, course);
  if (value === true) {
    if (ACCESS_CACHE.size > 5000) ACCESS_CACHE.clear();
    ACCESS_CACHE.set(key, { value, until: Date.now() + 60000 });
  }
  return value;
}
async function hasCourseUncached(env, token, course) {
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/has_course", {
    method: "POST",
    headers: { ...anon(env, token), "Content-Type": "application/json" },
    body: JSON.stringify({ course }),
  });
  if (!res.ok) return null;
  return (await res.json()) === true;
}
