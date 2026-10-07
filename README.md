# AI Skills Zone: public site

The public site at https://aiskillszone.com. Each course lives in its own folder; the root page lists them.

- `index.html`: the hub page listing the courses.
- `zero-to-ai-tester/`: landing page, syllabus, terms, and the free sample (primer) for Zero to AI Tester. The course content itself lives in a private repository.
- `_redirects`, `404.html`: Cloudflare routing for the old root URLs and missing pages.
- `wrangler.toml`: Cloudflare deployment (`npx wrangler deploy` from this folder).

GitHub Pages still serves the same files at https://chandirakumar.github.io/ai-testing-course-site/ as a mirror; every page carries a canonical tag pointing at aiskillszone.com.

Adding a course: create a new folder next to `zero-to-ai-tester/`, add a card for it on `index.html`, deploy.
