# Deepthanush Chowdary — Portfolio

Personal portfolio website for Deepthanush Chowdary, Computer Science & Engineering student at KL University.

## Live

https://deepthanush.io

## Features

- Responsive design (mobile-first)
- Dark / light theme toggle
- Live age counter with millisecond precision
- GitHub contributions graph (fetched via local proxy)
- Open source repos (auto-fetched from GitHub API)
- Skill category filtering with staggered animations
- Cloudflare Turnstile verification on load

## Tech Stack

- HTML5, CSS3, JavaScript (vanilla)
- Tailwind CSS (CDN)
- Simple Icons (CDN)
- Vercel (deployment)
- Python (local development server)

## Local Development

```bash
python server.py
```

Then open `http://127.0.0.1:8081` in your browser.

The `server.py` serves static files and provides a cached `/api/github-activity` endpoint that scrapes GitHub's official contribution graph.

## Deployment

```bash
vercel --prod
```

## Project Structure

```
dev-portfolio/
├── assets/
│   ├── css/
│   │   └── style.css
│   ├── images/
│   │   ├── avatar.jpg
│   │   ├── coursera-logo.png
│   │   ├── deeplearning-ai-logo.webp
│   │   ├── iit-bombay-logo.svg
│   │   └── klu-logo.webp
│   └── js/
│       └── main.js
├── index.html
├── server.py
├── vercel.json
└── README.md
```

## Notes

- The GitHub Activity chart uses a local Python proxy to avoid GitHub API rate limits and CORS issues.
- Cloudflare Turnstile site key must be whitelisted for your domain in the Cloudflare dashboard.
- For production, the Turnstile widget is optional and can be bypassed with the "Continue anyway" button.
