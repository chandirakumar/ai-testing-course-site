# AI Skills Zone: public site

The public site at https://aiskillszone.com. Each course lives in its own folder; the root page lists them.

- `index.html`: the hub page listing the courses.
- `zero-to-ai-tester/`: landing page and syllabus for Zero to AI Tester. The course content itself lives in a private repository.
- `_redirects`, `404.html`: Cloudflare routing for the old root URLs and missing pages.
- `wrangler.toml`: Cloudflare deployment (`npx wrangler deploy` from this folder).

GitHub Pages still serves the same files at https://chandirakumar.github.io/ai-testing-course-site/ as a mirror; every page carries a canonical tag pointing at aiskillszone.com.

Adding a course: create a new folder next to `zero-to-ai-tester/`, add a card for it on `index.html`, deploy.

## Updating a page yourself (no Claude needed)

Everything on aiskillszone.com is a plain HTML file in this folder. To change the privacy policy, the terms, or any text:

1. Open the file in any editor (VS Code, Notepad): `privacy.html`, `terms.html`, `zero-to-ai-tester/index.html`, `index.html`, `learn/index.html`.
2. Make the change. For the privacy policy or terms, also change the "Last updated" date near the top.
3. Try it on the dev site first (see below), then deploy to the live site from this folder (wrangler is logged in to the AI Skills Zone account for this folder only):
   ```
   npx wrangler deploy --env dev
   npx wrangler deploy
   ```
   Each is live within a few seconds. Check it in a private browser window.
4. Save the change to GitHub so the history and the mirror stay in step:
   ```
   git add -A
   git commit -m "Privacy policy: <what changed>"
   git push
   ```

Course lessons are different: they live in the private repo (`F:\Projects\ai-testing-course`, folder `modules/`) and are published with `python platform/publish_course.py` after regenerating the pack. Leave those to the course-publishing workflow.

If `npx wrangler deploy` ever says it is logged in to the wrong account, run `npx wrangler auth activate aiskillszone .` once in this folder.

## The dev site: dev.aiskillszone.com

A full copy of the platform for trying changes and building new courses before customers see them.

| | Live | Dev |
|---|---|---|
| Address | aiskillszone.com | dev.aiskillszone.com (password: the file `.dev-site-password` in the private course folder, any username) |
| Pages | this folder | the same folder, same files |
| Database, sign-in, functions | Supabase project `cxiezjegnnbkghbevqra` | Supabase project `ofuydnjqsltvlalgvnod` |
| Payments | Razorpay LIVE keys since 10 October 2026: real money | always Razorpay TEST keys: no real money |
| Course pages | KV store `COURSE_FILES` | KV store `COURSE_FILES_DEV` |
| Admin | aiskillszone.com/admin/ | dev.aiskillszone.com/admin/ (same owner email or WhatsApp number) |

Dev shows an orange-and-black strip at the top and a "DEV · test payments only" tag, is hidden from search engines, and
points every page at the dev database automatically, so the HTML is never edited twice.

- Deploy pages to dev: `npx wrangler deploy --env dev`. To live: `npx wrangler deploy`.
- Publish course pages to dev: `python platform/publish_course.py --env dev` in the course repo. To live: without `--env dev`.
- Database changes: add a migration file in the course repo's `supabase/migrations/`, apply it to dev, test, then apply it to live.
- Backend functions: `npx supabase functions deploy --project-ref ofuydnjqsltvlalgvnod` for dev, then the live ref.
- Tests: run pytest in `tests/payment`; they target dev by default. Never point them at live, which takes real payments.

A new course: build its folder and pack, publish it to dev, add its row to the dev `courses` table, buy it on dev with a
Razorpay test card, then repeat the publish and the row on live.

Never put a secret in this folder without adding it to `.assetsignore`: every file here is uploaded and served.
