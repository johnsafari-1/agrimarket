-- =====================================================================
-- Adds password-reset token tracking to an EXISTING users table.
-- Safe to run on a database that already has data.
-- =====================================================================

ALTER TABLE users
    ADD COLUMN reset_token VARCHAR(64) NULL AFTER verification_sent_at,
    ADD COLUMN reset_sent_at DATETIME NULL AFTER reset_token;
