-- =====================================================================
-- Adds an estimated delivery date + time window to orders, set by the
-- farmer when they confirm the order.
-- Safe to run on a database that already has data.
-- =====================================================================

ALTER TABLE orders
    ADD COLUMN estimated_delivery_date DATE NULL AFTER delivery_address,
    ADD COLUMN estimated_delivery_window ENUM('Morning','Afternoon','Evening') NULL AFTER estimated_delivery_date;
