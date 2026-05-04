# DayPlan Backend

NestJS + CQRS + Prisma + PostgreSQL.

## Architecture

- **CQRS** — every write goes through a Command, every read through a Query. Handlers live next to commands/queries.
- **Prisma** — type-safe DB access. Schema is the source of truth (`prisma/schema.prisma`).
- **JWT auth** — bearer token in `Authorization: Bearer ...` header.
- **Discord bot** — single bot serves all users; each user authorizes it into their server.
- **Cron** — runs every minute, posts daily wraps for users hitting their end-of-day time in their local timezone.

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
| `scheduler`  | `@Cron` job for end-of-day posting                                     |
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

1. Cron tick every minute (`@Cron(CronExpression.EVERY_MINUTE)`)
2. Find users where local time = `endOfDayTime`
3. For each user: load tasks → load enabled channels → format per-channel → post sequentially
4. Log success/failure per channel in `post_logs` table

## Testing the cron locally

Set your `endOfDayTime` to a minute from now and add some tasks for today. Wait, watch the logs.

```sql
UPDATE users SET end_of_day_time = '14:30' WHERE email = 'you@example.com';
```

## Production notes

- **Bot token security**: never commit `.env`. Use a secrets manager in production.
- **Database migrations**: `npx prisma migrate deploy` in CI/prod.
- **Rate limits**: Discord allows ~5 req/sec per channel. For 1000s of users hitting 11 PM together, switch to BullMQ + Redis for a queue.
- **Encryption**: `CryptoService` uses AES-256-GCM for at-rest token encryption.
