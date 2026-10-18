# Security review — 18 October 2026

## Implemented

- Asynchronous scrypt with random salts, N=131072, r=8, p=1 and constant-time verification. Login never accepts plaintext storage.
- JWT protection applies globally. Only login, refresh and health checks are public; service routes require x-request-secret.
- Access/refresh purpose claims, random token IDs, signature and expiry checks, atomic single-use refresh rotation. Only SHA-256 refresh digests are stored.
- Public user queries use an explicit field allowlist. A global response boundary also removes credentials, bot tokens and audience data from nested legacy responses.
- Ownership checks precede interceptors, including uploads, in every environment. Creation derives the owner from the authenticated account.
- Telegram moderation callbacks are accepted only in the configured private admin chat.
- Registration/provisioning and moderation require service credentials. A Telegram ID is not proof of identity: the trusted gateway must verify ownership before provisioning.
- Worker callbacks and audience downloads require service credentials. Audience files are blocked on public upload routes. Downloads use only the configured API origin and reject redirects.
- New audience filenames use random IDs, never tokens. Media upload size/type limits run inside Multer; old active content downloads as attachments with nosniff.
- Removed the HTTP test-send operation, fallback JWT secret, unrestricted CORS callback, obsolete auth code, unused packages and forced dependency installation.
- Corrected notification injection, circular barrel imports and compiled import paths. Container builds use Node 22, npm ci and an unprivileged user; local secrets are excluded. Compose does not publish worker/userbot ports.

## Rollout

1. Stop API and worker; back up the database and audience files.
2. Configure different random JWT_SECRET and SECRET_KEY values, at least 32 characters each, plus explicit CORS_ORIGINS. Never send the service key to the browser.
3. Install dependencies, regenerate Prisma Client and run `npm run security:migrate-credentials` against the stopped database. It hashes legacy plaintext passwords and revokes all refresh sessions. Rerunning while stopped is safe; existing scrypt hashes are preserved.
4. Deploy API and worker together. The worker downloads audiences through /api/v1/internal/audiences/:filename.
5. Sign in again. Old tokens without a purpose claim are rejected. Refresh requests use the internal account ID returned at registration.
6. If a deployed version exposed credentials, rotate those too: hashing storage does not revoke leaked secrets.

Prisma's refreshTokenHash property maps to the existing refreshToken column, so no destructive schema migration is needed. The supplied credential migration was NOT run against the user's database.

## Remaining findings

### P1: payments lack a durable idempotency boundary

Locations: payment.service.ts::approveMailingPayment and reservation.service.ts::removeMailingReservation.

A read/check precedes several external balance operations and a database update/delete. Concurrent requests can pass the same check; an intermediate failure leaves partial settlement. A Prisma transaction cannot make remote balance requests atomic.

Next change: persist a unique settlement/cancellation operation, use a transactional outbox and gateway-supported idempotency, explicit states, retries and reconciliation. Test concurrent approval and crashes after each monetary side effect. This requires agreement with the balance gateway contract.

### P1: floating point money and inconsistent rounding

Locations: monetary Float fields in prisma/schema.prisma and payment/reservation services.

Prices include 0.00005 while cancellation rounds to two decimals. Binary floating point and cent rounding can lose value or disagree with the gateway.

Next change: agree on currency/precision, migrate to decimal or integer micro-units, and define one settlement rounding rule. Include reconciliation of existing amounts.

### P2: internal service APIs trust the container network

Compose no longer publishes worker/userbot ports, but those APIs lack independent authentication. An actor on the container network still has substantial capabilities. Add separate credentials per service and validate media URLs before exposing these APIs.

### P2: rate limits are local to one API process

Authentication uses Nest Throttler with in-memory storage. Multiple replicas need shared rate-limit storage or gateway enforcement and a deliberate trusted-proxy configuration.

### P2: development dependencies and repository-wide lint

Compatible updates removed high/critical production dependency findings at review time. Swagger's YAML dependency chain retains moderate advisories; development tools require separate upgrades. Recheck with `npm audit --omit=dev`; audit results are not proof of exploitability or security.

The full ESLint check still reports legacy unsafe types, unused imports and formatting issues. The auth/users/config/migration lint check is separate and passing. Do not disable existing rules to make CI appear green.

## Verification and limits

Automated checks cover hashing, invalid credentials, token purposes/TTLs, refresh replay/concurrency, ownership, forged owner IDs, service credentials, malformed requests, throttling, forbidden media, private static files, full provider resolution, worker callbacks and audience downloads.

Database, gateway and Telegram boundaries are mocked in API tests. This does not replace testing with PostgreSQL, Redis and Telegram, reviewing the external balance gateway or testing a deployed container.

## Design references

- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [NestJS global authentication with Passport](https://docs.nestjs.com/v9/recipes/passport#enable-authentication-globally)
