// Two jobs. 1) Serve the site: every request for an existing file is answered by Cloudflare's asset
// handling before this code runs, so fetch() only sees misses and hands them to the assets binding,
// which applies the 404 page. 2) Keep the Supabase free-tier project awake: free projects are paused
// after seven idle days, and a paused database means no logins and no recorded purchases.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env) {
    const url = env.SUPABASE_URL + "/rest/v1/courses?select=slug&limit=1";
    const res = await fetch(url, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + env.SUPABASE_PUBLISHABLE_KEY } });
    console.log("supabase keep-alive", res.status, await res.text());
  },
};
