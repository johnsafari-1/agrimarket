-- Apply through scripts/migrate.php once. Existing accounts/orders are preserved.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_key CHAR(64) PRIMARY KEY,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    started_at DATETIME NOT NULL,
    INDEX idx_auth_rate_started (started_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_events (
    event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    status ENUM('Pending','Confirmed','Shipped','Delivered','Cancelled') NOT NULL,
    actor_id INT NULL,
    note VARCHAR(500) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_events_order (order_id, event_id),
    CONSTRAINT fk_event_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    CONSTRAINT fk_event_actor FOREIGN KEY (actor_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Old email links contain raw tokens. New links store only SHA-256 digests.
UPDATE users SET reset_token = NULL, reset_sent_at = NULL,
    verification_token = NULL, verification_sent_at = NULL;

-- Use known placement dates; do not invent historical shipping/delivery dates.
INSERT INTO order_events (order_id, status, actor_id, note, created_at)
SELECT o.order_id, 'Pending', o.buyer_id, 'Order placed.', o.order_date FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.order_id);
INSERT INTO order_events (order_id, status, actor_id, note)
SELECT o.order_id, o.status, NULL, 'Tracking enabled. The time of earlier status changes was not recorded.' FROM orders o
WHERE o.status <> 'Pending' AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.order_id AND e.status = o.status);
