# Migration validation — 22 October 2026

The replacement runtime has been exercised with generated, isolated fixtures.
No Windows installation, real customer database, SMTP account or live M-Pesa
account was modified or used.

| Check                                                          | Result                           |
| -------------------------------------------------------------- | -------------------------------- |
| API and React TypeScript checks, including unused local checks | Pass                             |
| API and React builds                                           | Pass                             |
| Prettier checks and Git whitespace checks                      | Pass                             |
| Database/API integration tests                                 | 33 passed                        |
| Desktop and mobile browser workflows                           | 6 passed                         |
| npm audit (production dependencies)                            | 0 known vulnerabilities reported |

Local runtime: Node 24.19.0, MariaDB 10.11.14. Browser validation used Chromium
141 headless at desktop 1440×1000 and iPhone 13 viewport/touch emulation. This is
mobile emulation, not testing on physical iOS Safari. The current full Chrome
binary failed to launch in this environment; CI installs Playwright's current
Chromium independently. Screenshots of marketplace, farmer tracking, messaging
and administration were captured, with marketplace/tracking/admin inspected.

Integration coverage includes:

- Additive migration, rerun/checksum behavior, existing order IDs/status/ETA and
  truthful baseline history; PHP `$2y$` password compatibility and rehashing.
- Signup role restrictions, required KYC fields, verification, reset expiry,
  single use, common recovery responses, cooldowns, concurrent account/IP quotas,
  CSRF/origin validation, session rotation/expiry/revocation and logout.
- Cart validation, locked inventory reservation, checkout retry idempotency,
  competing buyers for the last item, farmer-specific item/event visibility,
  ownership checks, stale delivery updates, ETA validation, partial COD
  cancellation/restocking, aggregate delivery/payment completion and retained
  historical item snapshots after archive/edit.
- Image decoding/re-encoding and invalid image rejection; serialized request
  acceptance and linked-product ownership; participant-only messaging; admin
  self-deactivation protection and session revocation; CSV formula neutralization.
- Disabled-payment behavior, untrusted callback notifications, provider-reference
  mismatch and duplicate reconciliation using a simulated provider, and blocked
  online-payment cancellation pending refund review.
- Malformed/oversized JSON handling; encrypted mail payloads, failed SMTP retry
  scheduling and successful delivery/payload purging against a local SMTP fixture.

Browser coverage includes search/category filtering, responsive navigation,
buyer sign-in/cart/checkout, two separate farmer deliveries, farmer confirmation
with ETA/note, tracking refresh and retained state after a network failure,
farmer listing creation, requests board access, message sending/XSS-safe display,
admin metrics/accounts/listings, and horizontal overflow checks on tested pages.

Remaining acceptance work is explicit: restore a copy of the user's actual
database; compare counts/totals/images/timezones; validate existing pending
online payments; test real SMTP and Daraja sandbox credentials; rehearse HTTPS
hosting, worker supervision, backups and cutover/rollback. See [the setup guide](README.md).
Passing tests and a clean dependency advisory report are not a full security audit.
