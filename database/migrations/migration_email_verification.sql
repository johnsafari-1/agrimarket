-- =====================================================================
-- Adds email verification tracking to an EXISTING users table.
-- Safe to run on a database that already has data.
-- Existing users are marked as already verified (is_verified = 1) so
-- current test/demo accounts keep working without needing to re-verify.
-- Run this on InfinityFree / any already-deployed database.
-- =====================================================================

ALTER TABLE users
    ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER locked_until,
    ADD COLUMN verification_token VARCHAR(64) NULL AFTER is_verified,
    ADD COLUMN verification_sent_at DATETIME NULL AFTER verification_token;

-- Existing accounts are grandfathered in as verified.
UPDATE users SET is_verified = 1 WHERE is_verified = 0;
