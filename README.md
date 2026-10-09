# AI Skills Zone: public site

The public site at https://aiskillszone.com. Each course lives in its own folder; the root page lists them.

- `index.html`: the hub page listing the courses.
- `zero-to-ai-tester/`: landing page, syllabus, terms, and the free sample (primer) for Zero to AI Tester. The course content itself lives in a private repository.
- `_redirects`, `404.html`: Cloudflare routing for the old root URLs and missing pages.
- `wrangler.toml`: Cloudflare deployment (`npx wrangler deploy` from this folder).

GitHub Pages still serves the same files at https://chandirakumar.github.io/ai-testing-course-site/ as a mirror; every page carries a canonical tag pointing at aiskillszone.com.

Adding a course: create a new folder next to `zero-to-ai-tester/`, add a card for it on `index.html`, deploy.

## Updating a page yourself (no Claude needed)

Everything on aiskillszone.com is a plain HTML file in this folder. To change the privacy policy, the terms, or any text:

1. Open the file in any editor (VS Code, Notepad): `privacy.html`, `zero-to-ai-tester/terms.html`, `zero-to-ai-tester/index.html`, `index.html`, `learn/index.html`.
2. Make the change. For the privacy policy or terms, also change the "Last updated" date near the top.
3. Deploy to Cloudflare from this folder (wrangler is logged in to the AI Skills Zone account for this folder only):
   ```
   npx wrangler deploy
   ```
   The site is live within a few seconds. Check it in a private browser window.
4. Save the change to GitHub so the history and the mirror stay in step:
   ```
   git add -A
   git commit -m "Privacy policy: <what changed>"
   git push
   ```

Course lessons are different: they live in the private repo (`F:\Projects\ai-testing-course`, folder `modules/`) and are published with `python platform/publish_course.py` after regenerating the pack. Leave those to the course-publishing workflow.

If `npx wrangler deploy` ever says it is logged in to the wrong account, run `npx wrangler auth activate aiskillszone .` once in this folder.
