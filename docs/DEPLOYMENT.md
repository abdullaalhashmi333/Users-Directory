# Users Directory — Deployment Guide

## How deployment works

```
push to main ──► GitHub Actions runs all tests ──► Railway builds and deploys
                       (fail = no deploy)
```

- Code lives in GitHub on the `main` branch.
- `.github/workflows/ci.yml` runs every automated test (API tests plus browser tests on
  desktop and phone sizes) on each push.
- Railway is connected to the repository and redeploys on every push to `main`. With
  **Wait for CI** turned on, Railway only deploys a commit after its tests pass.
- Railway checks `GET /health` before switching traffic to a new version, so a version that
  does not start is never put live.

## One-time Railway setup

1. Sign in at [railway.com](https://railway.com) with GitHub.
2. **New Project → Deploy from GitHub repo →** choose `abdullaalhashmi333/Users-Directory`.
   If the repo is not listed, use **Configure GitHub App** and give Railway access to it.
3. Railway reads `railway.json` and starts the first deploy. No variables are required.
4. Open the service → **Settings → Networking → Generate Domain** to get the public link
   (something like `users-directory-production.up.railway.app`).
5. Open the service → **Settings** and turn on **Wait for CI**, so failed tests stop a deploy.
6. Optional but recommended: keep data between deploys by adding a **Volume** to the service
   (right-click the service → **Attach volume**, mount path `/data`). Railway then sets
   `RAILWAY_VOLUME_MOUNT_PATH` and the app stores its database there automatically.
   Volumes are billed by usage on Railway.

Without a volume the database lives in the container, so every deploy starts again from the
sample data. That is acceptable in test mode; it is not acceptable for real data.

## Settings (environment variables)

All are optional. None are set by default.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | set by Railway | Port the app listens on. |
| `DB_PATH` | volume path, else `./data/directory.db` | Where the SQLite database file is stored. |
| `TEST_MODE` | `true` | `false` hides the test banner and disables "Reset to sample data". |
| `SEED_SAMPLE_DATA` | `true` | Loads sample data when the database is empty. Set `false` for production. |
| `APP_PASSWORD` | not set | When set, the whole app asks for a username and password (browser login prompt). |
| `APP_USER` | `admin` | Username used with `APP_PASSWORD`. |

Changing any of these on Railway is done only after telling the owner first.

## Running locally (for developers)

Requires Node.js 22.

```bash
npm install
npm start            # http://localhost:3000
npm test             # all tests (needs: npx playwright install chromium)
```

## Technical summary

- Node.js 22 + Express, SQLite via Node's built-in `node:sqlite` (no database server needed).
- Plain HTML/CSS/JavaScript interface in `public/`, no build step.
- Excel export via `exceljs`.
- API: `GET /api/tree?q=`, CRUD under `/api/entities`, `/api/departments`, `/api/focal-points`,
  `GET /api/email-check`, `GET /api/export.xlsx[?entityId=]`, `GET /health`.

## Before real data is entered

Switch to production rules first (owner must confirm): attach a volume, set
`TEST_MODE=false` and `SEED_SAMPLE_DATA=false`, set `APP_PASSWORD`, delete the sample data,
and add backups.
