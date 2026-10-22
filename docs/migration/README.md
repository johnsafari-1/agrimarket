# Agrimarket TypeScript migration

The replacement application is in `apps/api` (NestJS/TypeScript) and `apps/web`
(React/TypeScript/Vite). Its browser workflows and API run without PHP or Apache.
MySQL/MariaDB remains the database. The PHP source remains available for reference
and controlled rollback before cutover; it is not used by the Node application.

**Do not point both applications at the same writable database.** The PHP handlers
do not understand farmer-specific fulfilments, Node cart data or checkout keys.
Develop and rehearse using a database copy. There is no automatic deployment,
database import or cutover in this branch.

## Prerequisites

- Node.js 24 with npm; use a currently patched release.
- MySQL 8 or MariaDB 10.4+, accessible over TCP. MariaDB 10.11 is used by local tests.
- A database copy containing the legacy schema, including KYC, recovery, lockout
  and estimated delivery columns. The Node migration checks these prerequisites.
- SMTP for email verification/recovery. A local mail catcher can be used for testing.

## Windows: preserve the existing installation

Stop Apache in XAMPP. MySQL can remain running for the database copy; the new app
does not use XAMPP's PHP. Do not uninstall XAMPP while its database is still needed.
Back up `config/local.php`, `public/uploads`, and any untracked local changes too.
Keep backups outside `htdocs` and outside Git.

Example PowerShell database copy, assuming the existing database really is named
`farmer_marketplace`. Verify its name in your local configuration first. `-p`
prompts for the database administrator password; do not paste it into chat or Git.

```powershell
$backupDir = "D:\agrimarket-backups\$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupDir | Out-Null
$dumpPath = "$backupDir\marketplace.sql"

& "D:\xampp\mysql\bin\mysqldump.exe" -u root -p `
  --single-transaction --routines --triggers --events --hex-blob `
  --default-character-set=utf8mb4 "--result-file=$dumpPath" farmer_marketplace
if ($LASTEXITCODE -ne 0) { throw "Database export failed." }

& "D:\xampp\mysql\bin\mysql.exe" -u root -p `
  --execute="CREATE DATABASE agrimarket_ts CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if ($LASTEXITCODE -ne 0) { throw "Copy database creation failed; do not overwrite an existing copy." }

$sourcePath = $dumpPath.Replace('\', '/')
& "D:\xampp\mysql\bin\mysql.exe" -u root -p agrimarket_ts `
  "--execute=SOURCE $sourcePath"
if ($LASTEXITCODE -ne 0) { throw "Database import failed." }
```

Using `--result-file` avoids PowerShell's SQL output encoding changes. Exporting
without `--databases` avoids putting the original database's `USE` statement in
the dump. Check views/triggers/routines for explicitly qualified original-schema
references if you have added any yourself.

Create a separate development database account in the MySQL administrator console:

```sql
CREATE USER 'agrimarket_node'@'127.0.0.1' IDENTIFIED BY 'CHOOSE-A-UNIQUE-LONG-LOCAL-PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, REFERENCES
  ON agrimarket_ts.* TO 'agrimarket_node'@'127.0.0.1';
```

Use that account in the ignored environment file. Production runtime credentials
should have only the necessary DML permissions; run migrations separately.

## Configure and start

From the repository root:

```powershell
npm ci
Copy-Item apps\api\.env.example apps\api\.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Edit `apps/api/.env`: set the copy's `DB_*` values and paste the generated key into
`MAIL_ENCRYPTION_KEY`. Set SMTP values; retain `MPESA_ENABLED=false` initially.
Do not commit the file. `APP_ORIGIN=http://localhost:5173` must match the browser
origin exactly. The API only listens on `127.0.0.1:4000`.

```powershell
npm run migrate --workspace @agrimarket/api
npm run dev
```

Open `http://localhost:5173`. The Vite server proxies `/api` to NestJS. TypeScript
and Node reload on source changes. Run the mail/payment worker in another terminal:

```powershell
npm run worker --workspace @agrimarket/api
```

The API must be built before starting the worker (`npm run build`). The worker
retries encrypted email jobs and, when configured, queries pending M-Pesa payments.
No SMTP credentials means account verification/recovery cannot complete by email.
Never enable a public verification bypass to work around SMTP setup.

### Optional empty demo

For an empty `agrimarket_ts` database only, use `npm run db:init --workspace
@agrimarket/api` instead of importing legacy data. It refuses a nonempty database.
Then run `npm run seed:demo --workspace @agrimarket/api`. This refuses production
and existing users, creates `.test` demo accounts and prints a randomly generated
temporary password. Do not run it against your copied real data.

## What is migrated

| Existing feature                | Replacement                                                                    | Important behavior                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Login, registration, KYC fields | `/login`, `/register`                                                          | Buyer/Farmer signup only; existing bcrypt hashes work; National ID is not exposed in account responses               |
| Email verification/recovery     | `/verify-email`, `/forgot-password`, `/reset-password`, `/resend-verification` | Hashed single-use tokens; encrypted mail queue; one hour reset / 24 hour verification expiry                         |
| PHP sessions                    | Database-backed opaque sessions                                                | All users sign in again; 30 minute idle / 12 hour absolute expiry; password/account changes revoke access            |
| Catalogue and product detail    | `/`, `/products/:id`                                                           | Search, category filter, pagination, farmer contact                                                                  |
| Cart and checkout               | `/cart`                                                                        | Persistent buyer cart, stock locking, server prices, decimal-safe totals, idempotent checkout                        |
| Farmer listings                 | `/farm`                                                                        | Create/edit/archive, image decoding and WebP re-encoding; stock edits detect intervening quantity changes            |
| Buyer/farmer orders             | `/orders`, `/orders/:id`                                                       | Farmer-specific fulfilment and events; sellers see only their own items; buyer cancellation only before confirmation |
| Expected delivery and tracking  | Order detail                                                                   | Separate ETA/window and status per farmer; visible tabs refresh every 30 seconds and retain snapshots on failure     |
| Buyer requests and offers       | `/requests`                                                                    | Owner checks, one farmer offer per request, serialized acceptance, catalogue matches                                 |
| Messaging                       | `/messages`                                                                    | Participant-only messages, unread counts, history pagination and farmer contact links                                |
| Administration                  | `/admin`, `/orders`                                                            | Account activation, listing archive, metrics, order inspection/fulfilment and CSV export with formula neutralization |
| M-Pesa initiation/status        | Order detail + `/api/payments/mpesa/*`                                         | Explicit configuration required; independent provider query, callbacks cannot settle payments                        |

Deliberate changes: deleting users/listings is replaced by deactivation/archive to
preserve purchases. Card checkout is unavailable because the old app had no card
provider. Accepted offers open a conversation to arrange fulfilment; they do not
silently substitute a negotiated offer price into normal listing checkout. A
listing link remains available, and its current catalogue price is explicit.

## Data and schema behavior

The migration adds only `node_*` tables, with a checksum ledger and a database
advisory lock. Existing users, password hashes, product/order IDs, payments,
messages and requests are not rewritten. Completed/cancelled legacy orders retain
their original totals. Historical item names are snapshotted from the current
catalogue because older names were not recorded.

Existing orders are split into farmer fulfilment records using the known current
overall status. Their initial timeline says earlier farmer-specific times were
not recorded. New events have actual timestamps. Legacy `order_events` remain in
the database but are not falsely assigned to individual farmers in the new UI.

MySQL DDL is not transactional. If a migration fails partway, inspect the error
and rerun the unchanged file against the copy; creation/backfill statements are
idempotent. Do not edit a migration after it has been applied; create a new named
migration for future schema changes. Normal API startup never runs migrations.

New timestamps are stored in UTC and displayed in the browser's timezone. Verify
the timezone meaning of your existing SQL timestamps before cutover; the copy
process preserves values and does not guess historical timezone conversions.

Legacy images are read from `public/uploads` using a restricted image endpoint.
New images go to private `storage/node-uploads`. Copy both when moving hosts.
Old PHP session carts and browser sessions are not imported. Existing email links
pointing at old PHP URLs need a resend or an explicit cutover redirect.

## Security and operational boundaries

- Cookies are HttpOnly/SameSite=Lax. Production requires `COOKIE_SECURE=true` and
  an HTTPS `APP_ORIGIN`. All browser mutations require the configured Origin and
  a session-bound CSRF header. Sensitive API responses have no-store/referrer headers.
- Forwarded IP headers are ignored by default. Behind a local reverse proxy, use
  `TRUST_PROXY=loopback` only when it overwrites client-supplied forwarded headers.
  Otherwise all proxied clients share the socket peer's login quota.
- Five bad account passwords lock for 15 minutes; login IP quota is 20/15 minutes;
  registration and each mail-request quota is five/15 minutes. Recovery responses
  do not disclose account existence. Changing role/status is checked on every request.
- Uploads are limited to 3 MB/16 megapixels and re-encoded to WebP. Old files can
  only be served with approved image filenames. Product responses exclude KYC data.
- Cancellation and restocking are atomic. COD cancellations reduce the remaining
  payable amount. Online-payment cancellations are blocked until a reviewed refund
  process exists. COD is completed only when every remaining delivery is delivered.
- M-Pesa callback result codes/receipt/amount fields are untrusted and ignored for
  settlement. The worker authenticates to the configured Daraja environment and
  queries the exact locally issued checkout reference. Payment confirmation does
  not confirm fulfilment. Whole-shilling amounts are required; no rounding up.
- An uncertain STK initiation is not automatically retried, preventing duplicate
  prompts. Failed/exhausted jobs and uncertain initiations need operator review.
  Receipt retrieval, provider reconciliation reports and automated refunds remain
  follow-up work; payment tests use a simulated provider, not live money.
- Email delivery is at least once; a crash after SMTP accepts mail may resend the
  same link. A new token does not extend an older token's expiry. Keep the encryption
  key backed up; changing it makes unsent encrypted messages unreadable.

## Validation and cutover checklist

`npm run typecheck`, `npm run build`, `npm run format:check`, `npm audit --omit=dev`.
For integration tests, provide credentials able to create/drop a **test-only**
database through environment variables, with `DB_NAME=agrimarket_node_test`, then
run `npm test`. The suite refuses names not ending `_test` and recreates that
specific database. Never use real data as test fixtures.

Browser tests use `npm run test:ui` with the isolated test database and demo fixture
state. Install Chromium with `npx playwright install chromium`; see the CI workflow
for the complete reproducible setup. Browser screenshots are private local test
artifacts and are not committed.

Before switching real traffic:

1. Rehearse export/restore and the additive migration on a copy. Compare legacy
   table counts, order totals and payment totals before and after migration.
2. Verify legacy login hashes; inspect unsupported password algorithms, duplicate
   normalized emails, missing KYC columns, orphaned historical orders and timestamps.
3. Test buyer/farmer/admin workflows, mixed-farmer orders, cancellations, concurrent
   checkout, and image links with representative copied data.
4. Test SMTP delivery and worker retry/restart recovery. Rotate any secrets exposed
   previously in source or logs. Keep uploads/outbox key in the backup plan.
5. Validate Daraja credentials, amount/phone/reference handling and callback/query
   behavior in the sandbox before enabling M-Pesa. Review legacy Card/pending online
   transactions and any refund obligations. No live payment validation is implied.
6. Configure HTTPS, same-origin static hosting for `apps/web/dist`, `/api` proxy,
   SPA route fallback, request limits and Node/worker supervision. Protect the SQL
   service; moving off PHP does not update the XAMPP database server automatically.
7. Stop writes in PHP, take a final consistent copy, validate it, migrate, switch
   traffic and require sign-in. Do not reopen the old PHP app for writes afterward.

Rollback before accepting Node writes can use the untouched legacy installation.
After Node writes, a rollback needs reconciled data export/replay; simply pointing
PHP at the Node database would lose fulfilment meaning. Keep the PHP source until
the cutover is accepted, then remove it from the deployed application.
