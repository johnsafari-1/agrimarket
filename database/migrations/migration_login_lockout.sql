-- =====================================================================
-- Adds login-attempt lockout tracking to an EXISTING users table.
-- Safe to run on a database that already has data (does not touch
-- existing rows other than giving them the new columns' defaults).
-- Run this on InfinityFree / any already-deployed database instead of
-- re-importing database.sql.
-- =====================================================================

ALTER TABLE users
    ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER is_active,
    ADD COLUMN locked_until DATETIME NULL AFTER failed_login_attempts;
