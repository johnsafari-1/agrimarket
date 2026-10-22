CREATE TABLE IF NOT EXISTS node_sessions (
  session_id CHAR(64) PRIMARY KEY, csrf_token CHAR(64) NOT NULL, user_id INT NULL,
  fingerprint CHAR(64) NULL, created_at DATETIME NOT NULL, last_seen DATETIME NOT NULL,
  INDEX idx_node_sessions_user (user_id), INDEX idx_node_sessions_seen (last_seen),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_mail_outbox (
  mail_id BIGINT AUTO_INCREMENT PRIMARY KEY, payload TEXT NOT NULL, attempts INT NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at DATETIME NULL,
  INDEX idx_mail_pending (sent_at, available_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_fulfilments (
  order_id INT NOT NULL, farmer_id INT NOT NULL,
  status ENUM('Pending','Confirmed','Shipped','Delivered','Cancelled') NOT NULL DEFAULT 'Pending',
  version INT NOT NULL DEFAULT 0, estimated_delivery_date DATE NULL,
  estimated_delivery_window ENUM('Morning','Afternoon','Evening') NULL,
  PRIMARY KEY (order_id, farmer_id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (farmer_id) REFERENCES users(user_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_fulfilment_events (
  event_id BIGINT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, farmer_id INT NOT NULL,
  status VARCHAR(20) NOT NULL, note VARCHAR(500) NOT NULL, actor_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_node_events (order_id, farmer_id, event_id),
  FOREIGN KEY (order_id, farmer_id) REFERENCES node_fulfilments(order_id, farmer_id),
  FOREIGN KEY (actor_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_order_item_snapshots (
  item_id INT PRIMARY KEY, farmer_id INT NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(30) NOT NULL,
  FOREIGN KEY (item_id) REFERENCES order_items(item_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_checkouts (
  buyer_id INT NOT NULL, request_key VARCHAR(80) NOT NULL, request_hash CHAR(64) NOT NULL,
  order_id INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (buyer_id, request_key), FOREIGN KEY (buyer_id) REFERENCES users(user_id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_cart (
  buyer_id INT NOT NULL, product_id INT NOT NULL, quantity INT NOT NULL,
  PRIMARY KEY (buyer_id, product_id), FOREIGN KEY (buyer_id) REFERENCES users(user_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_audit (
  audit_id BIGINT AUTO_INCREMENT PRIMARY KEY, actor_id INT NOT NULL, action VARCHAR(80) NOT NULL,
  target_id INT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS node_payment_jobs (
  txn_id INT PRIMARY KEY, attempts INT NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (txn_id) REFERENCES transactions(txn_id) ON DELETE CASCADE
) ENGINE=InnoDB;
INSERT INTO node_fulfilments (order_id, farmer_id, status, estimated_delivery_date, estimated_delivery_window)
SELECT DISTINCT o.order_id, p.farmer_id, o.status, o.estimated_delivery_date, o.estimated_delivery_window
FROM orders o JOIN order_items i ON i.order_id=o.order_id JOIN products p ON p.product_id=i.product_id
ON DUPLICATE KEY UPDATE order_id=VALUES(order_id);
INSERT INTO node_order_item_snapshots (item_id, farmer_id, product_name, unit)
SELECT i.item_id,p.farmer_id,p.product_name,p.unit FROM order_items i JOIN products p ON p.product_id=i.product_id
ON DUPLICATE KEY UPDATE item_id=VALUES(item_id);
INSERT INTO node_fulfilment_events (order_id,farmer_id,status,note,actor_id)
SELECT f.order_id,f.farmer_id,f.status,'Migrated current status; earlier farmer-specific event times were not recorded.',NULL
FROM node_fulfilments f WHERE NOT EXISTS (SELECT 1 FROM node_fulfilment_events e WHERE e.order_id=f.order_id AND e.farmer_id=f.farmer_id);
