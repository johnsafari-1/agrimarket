-- =====================================================================
-- MIGRATION: Product Requests (buyer "I need...") + M-Pesa payment fields
-- Run this once against an EXISTING farmer_marketplace database.
-- (A fresh install can just import database.sql, which already includes this.)
-- Usage: phpMyAdmin -> select farmer_marketplace -> Import -> this file
--        or: mysql -u root farmer_marketplace < migration_requests_mpesa.sql
-- =====================================================================
USE farmer_marketplace;

-- ---------------------------------------------------------------------
-- PRODUCT_REQUESTS: a buyer describes a product they want but can't find
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_requests (
    request_id  INT AUTO_INCREMENT PRIMARY KEY,
    buyer_id    INT NOT NULL,
    title       VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category    ENUM('Cereals','Vegetables','Fruits','Dairy','Poultry','Livestock','Tubers','Other') NOT NULL DEFAULT 'Other',
    quantity    INT NOT NULL DEFAULT 1,
    unit        VARCHAR(30) NOT NULL DEFAULT 'kg',
    budget_max  DECIMAL(10,2) NULL,
    status      ENUM('Open','Fulfilled','Closed') NOT NULL DEFAULT 'Open',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_req_buyer FOREIGN KEY (buyer_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- REQUEST_OFFERS: a farmer's response to an open request
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_offers (
    offer_id   INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    farmer_id  INT NOT NULL,
    product_id INT NULL,
    message    TEXT NOT NULL,
    price      DECIMAL(10,2) NOT NULL,
    status     ENUM('Pending','Accepted','Declined') NOT NULL DEFAULT 'Pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_offer_request FOREIGN KEY (request_id) REFERENCES product_requests(request_id) ON DELETE CASCADE,
    CONSTRAINT fk_offer_farmer  FOREIGN KEY (farmer_id)  REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_offer_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- TRANSACTIONS: add M-Pesa STK Push tracking fields
-- ---------------------------------------------------------------------
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS phone_number         VARCHAR(20)  NULL AFTER payment_method,
    ADD COLUMN IF NOT EXISTS checkout_request_id  VARCHAR(60)  NULL AFTER phone_number,
    ADD COLUMN IF NOT EXISTS merchant_request_id  VARCHAR(60)  NULL AFTER checkout_request_id,
    ADD COLUMN IF NOT EXISTS mpesa_receipt_number VARCHAR(30)  NULL AFTER merchant_request_id,
    ADD COLUMN IF NOT EXISTS result_desc          VARCHAR(255) NULL AFTER mpesa_receipt_number;
