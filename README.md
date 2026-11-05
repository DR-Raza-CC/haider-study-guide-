# Haider Study Guide

Year 11 mock revision for Whitmore High School, with a parent dashboard.
Four weeks of study guides per subject, matched to the school's Year 11 December Mock Exam Revision Lists (Nov 2026).
Hosted free on Cloudflare Pages. Progress is stored in Cloudflare KV.

## Files
- index.html, app.js: the app (student and parent screens)
- data.js: all study guides and questions (22 subject choices × 4 weeks, including six RE religions and RE Themes), plus MOCK_DATE for the countdown
- functions/api/[[path]].js: the server (sign-in and saving progress)
- manifest.webmanifest, icon-192.png, icon-512.png, apple-touch-icon.png: let it install as a phone app
- _headers: makes sure updates show up straight away

## Setup
1. Create a GitHub repository called haider-study-guide and upload all these files, keeping the functions/api folder.
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → pick the repository.
   Framework preset: None. Build command: leave empty. Build output directory: /
3. Cloudflare → Storage & Databases → KV → Create namespace called haider-study.
4. Pages project → Settings → Bindings → Add → KV namespace. Variable name: STUDY. Namespace: haider-study. Save.
5. Deployments → latest deployment → ⋯ → Retry deployment.
6. Open the site straight away and complete "Set up your family".

## Updating content
Edit data.js (or ask Claude for new weeks), commit, and Cloudflare redeploys automatically.
