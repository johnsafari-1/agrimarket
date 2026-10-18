-- =====================================================================
-- Adds registration KYC fields: National ID, location, and a
-- farmer-only business/farm name.
-- Columns are nullable at the DB level (existing seed accounts have
-- none of this data) — the PHP registration form is what actually
-- enforces "required" for new signups.
-- National ID is UNIQUE to prevent the same ID being used for
-- multiple accounts.
-- =====================================================================

ALTER TABLE users
    ADD COLUMN national_id VARCHAR(20) NULL,
    ADD COLUMN location VARCHAR(150) NULL,
    ADD COLUMN business_name VARCHAR(150) NULL,
    ADD UNIQUE KEY uq_users_national_id (national_id);
