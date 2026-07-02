# DayPlan Backend

NestJS + CQRS + Prisma + PostgreSQL.

## Architecture

- **CQRS** — every write goes through a Command, every read through a Query. Handlers live next to commands/queries.
- **Prisma** — type-safe DB access (Prisma 7, `prisma-client` generator + `@prisma/adapter-pg`). Schema is the source of truth (`prisma/schema/schema.prisma`); client is generated to `prisma/generated/`.
- **JWT auth** — bearer token in `Authorization: Bearer ...` header.
- **Discord bot** — single bot serves all users; each user authorizes it into their server.
- **Scheduler** — posts each user's "TODAY GOAL" / "Work Updated" once they reach their configured time in their local timezone. Driven by an in-process `@Cron` (always-on hosts) or by an external cron hitting a secured HTTP endpoint (sleeping/free tiers, serverless). See "Daily post flow" below.

## Setup

```bash
# 1. Install
npm install

# 2. Start Postgres (from monorepo root)
docker compose up -d db

# 3. Set env
cp .env.example .env
# edit .env — set JWT_SECRET, DISCORD_* values

# 4. Generate Prisma client + run migrations
npx prisma migrate dev --name init

# 5. Start dev server
npm run start:dev
```

API runs at `http://localhost:3000/api`.
Swagger at `http://localhost:3000/docs`.

## Module map

| Module       | Responsibility                                                         |
|--------------|------------------------------------------------------------------------|
| `auth`       | Sign up / sign in, JWT issuing, JWT validation strategy & guard        |
| `users`      | Profile, reminder schedule                                             |
| `tasks`      | Today's tasks, history, mark done — full CQRS                          |
| `discord`    | OAuth callback, channel listing, channel selection, posting            |
| `scheduler`  | Due-post runner + secured HTTP cron trigger (`/internal/cron/...`)      |
| `prisma`     | Global Prisma client                                                   |

## How CQRS works here

Every controller endpoint dispatches to either `CommandBus` or `QueryBus`.

- **Commands** mutate state — `CreateTaskCommand`, `ToggleTaskCommand`, etc.
- **Queries** read state — `GetTasksByDateQuery`, `ListAvailableChannelsQuery`, etc.
- Handlers live in the same file as their command/query, marked with `@CommandHandler()` / `@QueryHandler()`.
- Modules register handlers via the `providers` array.

The benefit: every business operation is named, typed, and tested in isolation. You can introduce events later (e.g., `TaskCreatedEvent`) without restructuring.

## Discord OAuth flow

1. Mobile app: `GET /api/discord/auth-url` → returns Discord OAuth URL with signed state
2. App opens URL in browser
3. User authorizes on Discord
4. Discord redirects to `GET /auth/discord/callback?code=...&state=...` (no JWT, public)
5. Backend verifies state, exchanges code for tokens, saves connection, redirects to `dayplan://discord-connected?guild=...`
6. App fetches `GET /api/discord/channels?guildId=...`
7. User picks channels in app
8. App `POST /api/discord/channels` to save selection

## Daily post flow (automatic)

Each run (`SchedulerService.runDuePosts()`):

1. Load all users.
2. For each user, compute their local time. A post is **due** once `localTime >= goalPostTime` (goal) / `>= workUpdateTime` (work update) — a *window*, not an exact minute.
3. If a successful `post_logs` row already exists for that `(user, kind, local-day)`, **skip** (idempotent — posts at most once per day).
4. Otherwise load tasks → enabled+routed channels → format per-channel → post → record per-channel result in `post_logs`.

### What triggers a run

Two interchangeable triggers (both call the same `runDuePosts()`; idempotency makes running both safe):

- **In-process cron** — `@Cron(EVERY_MINUTE)`. Only fires while the Node process is alive and awake. Enable with `ENABLE_INPROCESS_CRON=true` on an always-on host (paid Render/Fly/VM/container). **On a sleeping free tier or serverless it will not run** — the process isn't alive to tick.
- **External cron → HTTP endpoint** — `POST /api/internal/cron/run-due-posts`, authorized by `CRON_SECRET` sent in a header — `Authorization: Bearer <secret>` or `X-Cron-Key: <secret>` (header, not `?key=`, so the secret never hits access logs; fails closed if unset). Point any scheduler at it:
  - **Minute-accurate:** a dedicated cron service like [cron-job.org](https://cron-job.org) or Upstash QStash, every minute.
  - **Committed / zero-signup:** `.github/workflows/scheduled-posts.yml` (every 5 min; set repo var `BACKEND_URL` and secret `CRON_SECRET`).

> Because matching is a catch-up window + idempotency (not exact-minute equality), a missed minute — cold start, restart, deploy, a coarse 5-min external cron — still posts once, later that same local day, instead of being lost until tomorrow.

## Testing locally

With `ENABLE_INPROCESS_CRON=true`, set your `goalPostTime` a minute from now, add tasks + a Discord channel, and watch the logs:

```sql
UPDATE users SET goal_post_time = '14:30' WHERE email = 'you@example.com';
```

Or trigger a run immediately (bypasses the wait; still idempotent per day):

```bash
curl -X POST http://localhost:3000/api/internal/cron/run-due-posts \
  -H "Authorization: Bearer $CRON_SECRET"
```

To force a post regardless of schedule/idempotency (e.g. verify Discord delivery), use the per-user test endpoint:

```bash
curl -X POST http://localhost:3000/api/discord/test-publish \
  -H "Authorization: Bearer <user-jwt>" -H "Content-Type: application/json" \
  -d '{"kind":"goal"}'
```

## Production notes

- **Scheduling on a sleeping/free host**: in-process `@Cron` won't fire while the service is spun down. Drive posting via the external-cron HTTP endpoint above (this is the intended setup for Render free).
- **Build generates the Prisma client**: `build` runs `prisma generate && nest build`. The generated client (`prisma/generated/`) is not committed, so the build step must run on deploy.
- **Bot token security**: never commit `.env`. Use a secrets manager in production.
- **Database migrations**: `npx prisma migrate deploy` in CI/prod. Avoid `db:push:reset` against a real DB — it drops data (`db:push` alone is non-destructive).
- **Rate limits**: Discord allows ~5 req/sec per channel. For 1000s of users hitting the same minute, switch to BullMQ + Redis for a queue.
- **Encryption**: `CryptoService` uses AES-256-GCM for at-rest token encryption.
