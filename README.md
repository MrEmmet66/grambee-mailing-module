<h1 align="center">Mailing Platform Backend</h1>

<p align="center">
  Backend for a two-sided ad-mailing marketplace: bot and channel owners offer their audience,
  advertisers book promotions on it, and the platform handles moderation, scheduling,
  delivery, tracking and payouts.
</p>

<p align="center">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Go" src="https://img.shields.io/badge/Go-1.21-00ADD8?logo=go&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white">
  <img alt="Redis" src="https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white">
</p>

<!--
  DEMO
  If the project is deployed, put a short demo link or a Loom/YouTube walkthrough here, e.g.
  Demo: https://demo.example.com  (read-only account: demo / demo)
-->

## Overview

The platform connects two sides of an advertising market:

- **Owners** register a bot or a channel, upload audience statistics and set a price (fixed, or per acquired subscriber).
- **Advertisers** create a mailing: post content, media, buttons and a target link, then reserve slots on selected audiences.
- **Admins** review applications and mailings before they go out.

The backend exposes a REST API for the web client, sends and tracks the mailings, and keeps
the money side consistent: reservations, holds, commissions, balances and referral payouts.

## Stack

| Layer | Technology |
| --- | --- |
| API | NestJS 11, TypeScript, class-validator, Passport + JWT |
| Data | PostgreSQL, Prisma ORM |
| Queues / cache | Redis, Bull (Node), asynq (Go) |
| Delivery worker | Go 1.21, Gin, asynq, logrus |
| Userbot service | Python 3.11, FastAPI, Telethon |
| Docs | Swagger (OpenAPI) |
| Infra | Docker, Docker Compose |

## Architecture

<img src="docs/images/architecture.png" alt="Architecture" width="100%">

<!-- capture: a diagram of the 4 services and how they talk. boxes: Web client -> api (NestJS) -> postgres / redis; api -> go-mailing-worker (REST) -> redis (asynq) -> Telegram Bot API; api -> telethon-api -> Telegram userbot. Draw in draw.io or excalidraw and export PNG. -->

The system is split into three services behind a single HTTP API:

- **`api` (NestJS)** holds the domain and business logic. It is the only service the client talks to, and the only one that touches the database.
- **`go-mailing-worker`** performs the actual message delivery. It is separate because sending is long-running and rate-limited, and because it needs to run many independent send jobs at once.
- **`telethon-api` (FastAPI)** wraps a Telegram userbot account for operations a bot account cannot do: resolving private channels, forwarding messages, inviting bots, reading view counts.

The API and the worker share Redis. The API enqueues and manages jobs through the worker's REST endpoints; the worker pulls tasks from asynq queues and talks to Telegram.

## Mailing flow

1. An advertiser creates a mailing with content, media and an invite link.
2. The advertiser picks target audiences and reserves dates for them. Selecting a slot holds the amount from the balance.
3. Each reservation goes through admin review.
4. When a reservation is due, the API asks the worker to start a send job for that audience.
5. The worker runs the job in its own process, sends the messages with rate limiting, and reports progress back.
6. On completion the API settles the money: the hold is released, the audience owner is credited, the platform keeps its commission, and referrers are paid out.
7. Link clicks and post views are tracked and attached to the reservation.

## Delivery worker (Go)

The worker is a separate service because sending is long-running and rate-limited, and it needs to keep many send jobs isolated from each other:

- **Adaptive rate limiting.** Each job uses a token-bucket limiter that starts at a conservative rate and adjusts it: it speeds up after a run of successful sends and backs off on `FLOOD_WAIT` responses. A few limiters implement the same interface and can be swapped.
- **One process per mailing.** The worker manager spawns a dedicated OS process per mailing, tracks it, and cleans up stale or zombie processes. Jobs can be stopped gracefully via `SIGTERM` with a forced kill as a fallback.
- **Queue management.** Jobs live in asynq queues; task IDs are derived from mailing and chat IDs to avoid duplicate sends.
- **Metrics.** Throughput, sent and failed counts are tracked per job and exposed through an HTTP endpoint, with asynqmon available for the queues.

## REST API

The API is documented with Swagger and served at `/api/docs`. Modules:

| Module | Responsibility |
| --- | --- |
| `auth` | Registration, login, JWT access and refresh tokens |
| `users` | User accounts |
| `bot_sellers` | Audience registration (bots and channels), statistics, moderation |
| `mailing` | Mailing creation, reservations, scheduling, processing, payment |
| `mailing/stats` | Per-mailing and per-audience statistics |
| `balance` | Balance and transactions |
| `commissions` | Commission calculation and payouts |
| `telegram` | Bot integration, notifications, application handling |
| `notifications` | In-app notifications |

## Getting started

### With Docker Compose

```bash
cp .env.example .env      # fill in your own values
docker compose up --build
```

This starts the API (`:4000`), the Go worker (`:8080`), the telethon service (`:8000`), PostgreSQL (`:5435`) and Redis. Database migrations are applied automatically on API start.

### Local development

```bash
npm install
npx prisma migrate dev
npm run start:dev
```

### Environment

All configuration lives in `.env` (see `.env.example` for the full list). The important groups are the database URL, Telegram bot tokens, userbot `api_id`/`api_hash`, JWT secrets, Redis connection and commission settings.

## Screenshots

<img src="docs/images/swagger.png" alt="Swagger UI" width="100%">

<!-- capture: open http://localhost:4000/api/docs, expand a couple of endpoints (mailings, bot-sellers), screenshot the request/response panel. -->

<img src="docs/images/worker-dashboard.png" alt="Worker queue dashboard" width="100%">

<!-- capture: the asynqmon dashboard showing active/completed queues and job throughput. -->

## Repository layout

```
src/                  NestJS API (modules, DTOs, guards, filters)
prisma/               Prisma schema and migrations
go-mailing-worker/    Go delivery worker (handlers, rate limiters, worker manager)
telethon/             FastAPI + Telethon userbot service
docker-compose.yml    Full local stack
```

## Notes

The Go worker and the telethon service run outside the database on purpose: the worker talks to Telegram only, and the userbot service never touches the database. All persistence goes through the API.

## License

UNLICENSED (private project).
