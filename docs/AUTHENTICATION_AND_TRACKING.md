# Authentication and customer tracking

## Authentication

Shared authentication is in `app/services/auth.php`. New passwords/reset passwords
require at least 15 characters and at most 72 bytes, without null bytes. Existing
password hashes keep working and are rehashed on successful login when needed.
Demo passwords remain development fixtures; the new policy applies when creating
or resetting passwords.

Login failures use a common response across unknown, inactive, unverified and
locked accounts. Five failed account attempts cause a 15-minute lockout. The
IP-scoped login limit is 20 attempts in 15 minutes; registration and each recovery
flow allow five. Counters/cooldowns use database row locks so parallel requests
cannot bypass them. The socket peer address is used; forwarded headers are not
trusted automatically. Shared NAT/proxy addresses share the IP quota.

Verification/reset tokens are random 32-byte values. Only SHA-256 digests are
stored in the existing token fields. Verification links last 24 hours and reset
links one hour; consumption is atomic and single-use. Recovery responses do not
identify whether an account exists. SMTP remains synchronous; a queued mail
workflow and MFA are future improvements.

Session IDs and CSRF tokens rotate at sign-in. Cookies are HttpOnly, SameSite=Lax,
and Secure for direct HTTPS. Set `SESSION_SECURE => true` in local configuration
when deployed behind a trusted HTTPS terminator; it must remain false/automatic
for HTTP-only local development. Sessions expire after 30 minutes idle or 12
hours absolute. Account status, current role and password fingerprint are checked
on every authenticated request, so disabling/resetting an account revokes its
existing sessions. Logout requires POST plus CSRF. Sensitive pages use no-store
and no-referrer headers.

Upgrade with `scripts/migrate.php`; originals are preserved, old email links are
invalidated once, and old browser sessions must sign in again. Migration state
and checksums prevent accidental reruns. Historical `migration_*.sql` scripts are
not automatically executed. The new runner only uses timestamped `20*.sql` files.
Expired rate-limit rows can be pruned during maintenance:

```sql
DELETE FROM auth_rate_limits WHERE started_at < NOW() - INTERVAL 1 DAY;
```

Reference guidance: [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
[session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
and [password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
This change does not represent a full security audit or add MFA.

## Tracking

`order_events` records placement, confirmation, dispatch, delivery and cancellation
with timestamps and optional farmer notes. Changes and event insertion share the
same database transaction. Provider confirmation is serialized with manual
status changes; duplicate results cannot add duplicate confirmation events or
revive a cancelled order. This does not authenticate M-Pesa callbacks; provider
callback verification/reconciliation remains separate work.

Existing orders get their known placement timestamp plus a labelled baseline
record for their current state; unknown historical shipping times are not invented.
The owner-only JSON endpoint is `order_tracking.php?id=...`. Another buyer gets
404, guests 401 and other roles 403. Responses exclude buyer/phone/provider IDs.

Customer order pages show expected delivery, payment status, farmer contact links
and a timestamped timeline. Visible pages refresh every 30 seconds, with manual
refresh available. Hidden pages pause, stale responses are ignored, notes are
rendered as text, and failed requests retain the last successful snapshot.
Tracking describes farmer-provided delivery progress, rather than GPS location.
An order still has one overall fulfilment status; separate fulfilment per farmer
in mixed-farmer orders is future work. New orders and status changes provide real
history from this upgrade onwards.
