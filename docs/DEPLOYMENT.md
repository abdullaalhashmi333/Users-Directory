# Users Directory — Deployment Guide

## How deployment works

```
push to main ──► GitHub Actions runs all tests ──► Railway builds and deploys
                  (against a real PostgreSQL)        (only after tests pass)
```

- Code lives in GitHub on the `main` branch.
- `.github/workflows/ci.yml` runs every automated test (API, sign-in and roles, and browser
  tests on desktop and phone sizes) against a PostgreSQL 16 database on each push.
- Railway redeploys on every push to `main`. With **Wait for CI** on, it only deploys a
  commit whose tests passed.
- Railway checks `GET /health` (which also checks the database connection) before switching
  traffic to a new version. A version that cannot start or reach the database is never put
  live, and the previous version keeps running.

## Data storage

All data is stored in **PostgreSQL**, read from the `DATABASE_URL` variable.

- Records are kept across deploys and restarts. Deploying never deletes, resets or
  overwrites data.
- On start-up the app applies any new database migrations (tracked in the
  `schema_migrations` table). Migrations only add structure; they never remove records.
- Sample data is **off**. It is only loaded if `SEED_SAMPLE_DATA=true` *and* the directory
  is completely empty, so it can never mix with or replace real records.
- There is no "reset" function in the app.

## One-time Railway setup

Do these steps **before** deploying this version. If the app is deployed without a
database, its health check fails and Railway keeps the previous version running.

1. **Add PostgreSQL.** In the Railway project, click **+ Create → Database → PostgreSQL**.
   This adds a database service, billed by usage.
2. **Connect the app to it.** Open the **Users-Directory** service, then **Variables → New
   Variable**:
   - Name `DATABASE_URL`, value `${{Postgres.DATABASE_URL}}` (Railway offers this as a
     reference when you start typing).
3. **Create the first admin.** In the same Variables screen, add:
   - `ADMIN_USERNAME`: the admin's username, for example `admin`
   - `ADMIN_PASSWORD`: a strong password of at least 10 characters

   The admin is created only when there are no users at all. Changing these variables later
   does **not** change any password; use **Change password** in the app instead. You may
   delete `ADMIN_PASSWORD` from Railway after the first sign-in.
4. Railway redeploys automatically after variables change. Open the link and sign in.

Already done earlier: the service is connected to the GitHub repo, has a public domain under
**Settings → Networking**, and has **Wait for CI** turned on.

## Settings (environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Use Railway's `${{Postgres.DATABASE_URL}}`. |
| `ADMIN_USERNAME` | First start only | Username of the first admin, created when no users exist. |
| `ADMIN_PASSWORD` | First start only | Password of the first admin (min. 10 characters). |
| `TEST_MODE` | No (default `true`) | Shows the "test mode" banner. Set `false` when switching to production. |
| `SEED_SAMPLE_DATA` | No (default off) | `true` loads made-up sample data, only into an empty directory. |
| `SESSION_HOURS` | No (default `12`) | How long a sign-in lasts. |
| `PORT` | Set by Railway | Port the app listens on. |

Changing any of these on Railway is done only after telling the owner first.

## Security

- Every page of data and every action requires signing in. Without a valid session the API
  returns nothing but "Please sign in". `/health` reveals no data.
- Roles: **Viewer** (see and export), **Editor** (also add, edit, delete), **Admin** (also
  manage users). Checked on the server for every request.
- Passwords are stored as salted scrypt hashes, never in plain text. Sign-in attempts are
  limited (5 failures per username or 20 per address in 15 minutes).
- Sessions are random tokens stored hashed in the database, sent in an `HttpOnly`,
  `SameSite=Lax`, `Secure` cookie. Signing out, a password reset, a role change or
  deactivation ends the user's sessions.
- Requests from other websites are refused, and the app sends strict security headers
  (Content-Security-Policy, X-Frame-Options, HSTS).
- There must always be at least one active admin.

## Running locally (for developers)

Requires Node.js 22 and PostgreSQL.

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/users_directory \
ADMIN_USERNAME=admin ADMIN_PASSWORD=change-me-please SEED_SAMPLE_DATA=true npm start
# http://localhost:3000

# Tests use TEST_DATABASE_URL (default postgres://app:app@localhost:5432/users_directory_test),
# each test suite in its own temporary schema. Browser tests need: npx playwright install chromium
npm test
```

## Technical summary

- Node.js 22 + Express, PostgreSQL via `pg`, migrations in `src/db.js`.
- Plain HTML/CSS/JavaScript interface in `public/`, no build step.
- Excel export via `exceljs`.
- API: `POST /api/login`, `POST /api/logout`, `GET /api/me`, `GET /api/tree?q=`, CRUD under
  `/api/entities`, `/api/departments`, `/api/focal-points`, `/api/users` (admin),
  `GET /api/email-check`, `GET /api/export.xlsx[?entityId=]`, `GET /health`.

## Before real data is entered

The owner confirms the switch to production rules first. Then: set `TEST_MODE=false`,
make sure `SEED_SAMPLE_DATA` is not set, delete any sample records, and turn on database
backups in Railway.
