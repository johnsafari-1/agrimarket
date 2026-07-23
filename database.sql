-- =====================================================================
-- FARMER-BUYER AGRICULTURAL MARKETPLACE MANAGEMENT SYSTEM
-- Database schema per project report Tables 3.3, 3.4, 3.5
-- Import via phpMyAdmin or: mysql -u root < database.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- USERS: farmers, buyers, administrators (Table 3.3)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('Farmer','Buyer','Admin') NOT NULL DEFAULT 'Buyer',
    phone         VARCHAR(20),
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PRODUCTS: listings by farmers
-- ---------------------------------------------------------------------
CREATE TABLE products (
    product_id   INT AUTO_INCREMENT PRIMARY KEY,
    farmer_id    INT NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    description  TEXT,
    price        DECIMAL(10,2) NOT NULL,
    quantity     INT NOT NULL DEFAULT 0,
    unit         VARCHAR(30) NOT NULL DEFAULT 'kg',
    category     ENUM('Cereals','Vegetables','Fruits','Dairy','Poultry','Livestock','Tubers','Other') NOT NULL DEFAULT 'Other',
    image_url    VARCHAR(255),
    status       ENUM('Available','Unavailable') NOT NULL DEFAULT 'Available',
    listed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_farmer FOREIGN KEY (farmer_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT chk_price CHECK (price > 0),
    CONSTRAINT chk_quantity CHECK (quantity >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ORDERS: buyer orders, 5 status states (Table 3.3)
-- ---------------------------------------------------------------------
CREATE TABLE orders (
    order_id         INT AUTO_INCREMENT PRIMARY KEY,
    buyer_id         INT NOT NULL,
    total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    status           ENUM('Pending','Confirmed','Shipped','Delivered','Cancelled') NOT NULL DEFAULT 'Pending',
    delivery_address VARCHAR(255) NOT NULL,
    order_date       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ORDER_ITEMS: junction between ORDERS and PRODUCTS
-- ---------------------------------------------------------------------
CREATE TABLE order_items (
    item_id    INT AUTO_INCREMENT PRIMARY KEY,
    order_id   INT NOT NULL,
    product_id INT NOT NULL,
    quantity   INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_items_order   FOREIGN KEY (order_id)   REFERENCES orders(order_id)     ON DELETE CASCADE,
    CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- TRANSACTIONS: payment records per order
-- ---------------------------------------------------------------------
CREATE TABLE transactions (
    txn_id               INT AUTO_INCREMENT PRIMARY KEY,
    order_id             INT NOT NULL,
    amount               DECIMAL(12,2) NOT NULL,
    payment_method       ENUM('M-Pesa','Card','Cash on Delivery') NOT NULL DEFAULT 'Cash on Delivery',
    phone_number         VARCHAR(20)  NULL,
    checkout_request_id  VARCHAR(60)  NULL,
    merchant_request_id  VARCHAR(60)  NULL,
    mpesa_receipt_number VARCHAR(30)  NULL,
    result_desc          VARCHAR(255) NULL,
    payment_status       ENUM('Pending','Completed','Failed') NOT NULL DEFAULT 'Pending',
    paid_at              DATETIME NULL,
    CONSTRAINT fk_txn_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PRODUCT_REQUESTS: a buyer describes a product they want but can't find
-- ---------------------------------------------------------------------
CREATE TABLE product_requests (
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
CREATE TABLE request_offers (
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
-- MESSAGES: in-platform farmer-buyer messaging (self-referencing USERS)
-- ---------------------------------------------------------------------
CREATE TABLE messages (
    msg_id      INT AUTO_INCREMENT PRIMARY KEY,
    sender_id   INT NOT NULL,
    receiver_id INT NOT NULL,
    content     TEXT NOT NULL,
    is_read     TINYINT(1) NOT NULL DEFAULT 0,
    sent_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_msg_sender   FOREIGN KEY (sender_id)   REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_msg_receiver FOREIGN KEY (receiver_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- SEED DATA  (all passwords are: password123)
-- Hash generated with PHP password_hash('password123', PASSWORD_DEFAULT)
-- =====================================================================
INSERT INTO users (full_name, email, password_hash, role, phone) VALUES
('System Administrator', 'admin@agrimarket.co.ke',  '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q', 'Admin',  '0700000001'),
('John Kiprop',          'john@farmer.co.ke',        '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q', 'Farmer', '0700000002'),
('Mary Wanjiku',         'mary@farmer.co.ke',        '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q', 'Farmer', '0700000003'),
('Peter Otieno',         'peter@buyer.co.ke',        '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q', 'Buyer',  '0700000004'),
('Grace Muthoni',        'grace@buyer.co.ke',        '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q', 'Buyer',  '0700000005');

INSERT INTO products (farmer_id, product_name, description, price, quantity, unit, category) VALUES
(2, 'Fresh Maize',        'Newly harvested dry maize, well dried and sorted.',        55.00,  500, 'kg',    'Cereals'),
(2, 'Irish Potatoes',     'Grade one potatoes from Molo, ideal for chips and mash.',  80.00,  300, 'kg',    'Tubers'),
(2, 'Fresh Cow Milk',     'Morning-fresh milk, delivered chilled.',                   65.00,  100, 'litre', 'Dairy'),
(3, 'Sukuma Wiki',        'Fresh collard greens harvested daily.',                    30.00,  200, 'bunch', 'Vegetables'),
(3, 'Ripe Bananas',       'Sweet Kampala bananas, ready to eat.',                    250.00,   80, 'bunch', 'Fruits'),
(3, 'Free-Range Eggs',    'Kienyeji eggs from free-range hens.',                     450.00,   50, 'tray',  'Poultry');

INSERT INTO product_requests (buyer_id, title, description, category, quantity, unit, budget_max) VALUES
(4, 'Need 2 bags of dry maize', 'Looking for clean, well-dried maize, no weevils, delivered to Nakuru town within a week.', 'Cereals', 2, 'bag', 6000.00);