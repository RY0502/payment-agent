# Freestyle VM Deployment

This project runs on a Freestyle persistent Linux VM as a normal Node.js service. It uses standard Playwright Chromium on non-Vercel hosts; `@sparticuz/chromium` remains available for the Vercel deployment path.

## Requirements

- Node.js 22 (Node.js 20+ is supported by the project)
- pnpm 10
- At least 2 GB RAM recommended for Chromium and the agent
- A Freestyle VM with a public HTTP service/domain

## Install and build

Run these commands from the repository directory:

```bash
corepack enable
corepack prepare pnpm@10.26.2 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm run build
mkdir -p logs screenshots
```

The `--with-deps` option installs the Linux libraries required by Chromium. If the VM does not allow package installation, install the equivalent Chromium system dependencies through the VM image package manager first.

## Environment

Set these values in the Freestyle VM environment or in a protected `.env` file:

```bash
NODE_ENV=production
HEADLESS=true
HOST=0.0.0.0
PORT=8123
GROQ_API_KEY=replace-me
```

Add the optional Mailgun, push notification, and provider failover variables from `.env.example` as needed. Do not commit `.env` or log complete payment data.

## Start the API

For a direct process:

```bash
pnpm run start:prod
```

For PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
```

The PM2 configuration starts `dist/server.js`, uses port `8123`, binds the server to `0.0.0.0`, and enables headless Chromium. Ensure the Freestyle service exposes TCP port `8123` or route its public domain to that port.

Verify the service from the VM:

```bash
curl http://127.0.0.1:8123/health
```

The public API endpoints are:

- `GET /health`
- `POST /payment`

## Operational notes

- Run one payment per VM initially. The agent owns a browser session and uses process-level state.
- Keep the VM user able to write to `screenshots/` and `logs/`.
- The final payment confirmation wait is three minutes. The agent's overall internal timeout remains ten minutes.
- Add authentication before exposing `/payment` publicly.
- Configure VM restart monitoring and disk cleanup for screenshots/logs.
- The existing Vercel deployment remains unchanged; Freestyle selects the standard Playwright browser branch because `VERCEL` is not set.
