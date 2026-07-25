# Farmer-Buyer Agricultural Marketplace Management System (AgriMarket)

Group 5 Team Project — Kabarak University. Plain PHP + MySQL, built for XAMPP.

## Requirements

- XAMPP with **PHP 8.0 or newer** (the code uses `match()` expressions) and MySQL/MariaDB.

## Setup (5 minutes)

1. Copy this whole `marketplace` folder into `C:\xampp\htdocs\`.
2. Start **Apache** and **MySQL** in the XAMPP Control Panel.
3. Open phpMyAdmin (`http://localhost/phpmyadmin`) → **Import** → choose `database.sql` → Go.
   This creates the `farmer_marketplace` database, all six tables, and sample data.
4. Open `http://localhost/marketplace/` in your browser.

If your MySQL root account has a password, edit `DB_PASS` in `config.php`.

## Test accounts (all passwords: `password123`)

| Role   | Email                    |
|--------|--------------------------|
| Admin  | admin@agrimarket.co.ke   |
| Farmer | john@farmer.co.ke        |
| Farmer | mary@farmer.co.ke        |
| Buyer  | peter@buyer.co.ke        |
| Buyer  | grace@buyer.co.ke        |

## Modules → files map (matches report Table 1.1)

| Module | Files |
|--------|-------|
| Authentication | `register.php`, `login.php`, `logout.php`, `config.php` |
| Product Management (Farmer) | `farmer_dashboard.php`, `farmer_products.php`, `farmer_product_form.php` |
| Product Search & Ordering (Buyer) | `index.php`, `product.php`, `cart.php`, `checkout.php` |
| Order Management & Tracking | `my_orders.php`, `order.php`, `farmer_orders.php` |
| Farmer-Buyer Communication | `messages.php` |
| Product Requests (Buyer "I need...") | `requests.php` (buyer), `farmer_requests.php` (farmer) |
| Payments | `checkout.php`, `mpesa.php`, `mpesa_wait.php`, `mpesa_status.php`, `mpesa_callback.php` |
| Administrative Dashboard | `admin_dashboard.php`, `admin_users.php`, `admin_products.php`, `admin_orders.php`, `admin_report.php` (CSV export) |

Shared layout: `header.php`, `footer.php`. Product images are saved to `uploads/`.

## Order lifecycle (report Table 3.3)

Pending → Confirmed → Shipped → Delivered (farmer updates status in `farmer_orders.php`).
A buyer can cancel while an order is still Pending; cancelling returns stock to the farmer.
Marking Delivered sets the linked transaction to Completed. Paying by M-Pesa moves an order to
Confirmed automatically as soon as the payment is verified (see below); Cash on Delivery and Card
stay Pending until the farmer confirms.

## Product requests ("I need...")

A buyer who can't find what they want goes to **Request a Product** (`requests.php`), describes it
(title, description, category, quantity, optional budget) and submits. Two things happen:

1. The description is matched against current listings straight away (simple keyword + category
   match) and any hits are shown immediately.
2. The request is posted to the open **Buyer Requests** board (`farmer_requests.php`), where any
   farmer can respond with a price and message, optionally linking one of their own listings.

The buyer sees offers on `requests.php` and accepts one. If the offer is linked to a listing it's
added straight to the buyer's cart at the requested quantity, ready for the normal checkout flow
(including M-Pesa). If it's a free-form offer, accepting opens a message thread with the farmer to
arrange the details.

## M-Pesa setup (Daraja sandbox)

Card and Cash on Delivery need no setup. M-Pesa uses Safaricom's Daraja **Lipa Na M-Pesa Online**
(STK Push) API and needs your own sandbox credentials:

1. Create a free account at <https://developer.safaricom.co.ke>, then create an app under
   **Lipa Na M-Pesa Online** on the sandbox. This gives you a Consumer Key, Consumer Secret, and
   Passkey (the sandbox shortcode `174379` is already set in `config.php`).
2. Paste those three values into `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, and
   `MPESA_PASSKEY` in `config.php`.
3. Safaricom must be able to reach `MPESA_CALLBACK_URL` over public HTTPS — on local XAMPP, run
   `ngrok http 80` and paste the `https://...` URL it gives you into `MPESA_CALLBACK_URL`
   (ending in `/marketplace/mpesa_callback.php`).
4. At checkout, choose **M-Pesa**, enter a Safaricom test number (e.g. `254708374149` from the
   Daraja docs), and confirm on the simulated prompt. The waiting screen (`mpesa_wait.php`) polls
   for the result even if the callback URL isn't reachable yet, so it still works without step 3
   during local development — step 3 is only needed for the callback to fire instantly.
5. Switch `MPESA_ENV` to `production` and use your production shortcode/credentials when you go live.

## Demo walkthrough for the defense

1. Register a new buyer (shows validation + role selection).
2. Log in as `john@farmer.co.ke` → add a product with an image.
3. Log in as `peter@buyer.co.ke` → search/filter → add to cart → checkout.
4. Back as the farmer → Orders → Confirm → Ship → Deliver (buyer sees the tracker update).
5. Buyer messages farmer from the product page; farmer replies (unread badge shows).
6. Log in as admin → dashboard stats → export the sales CSV.

## Troubleshooting

- **"Database connection failed"** — MySQL not running, or `database.sql` not imported, or wrong `DB_PASS`.
- **Blank page / 500 error** — your XAMPP PHP is older than 8.0; upgrade XAMPP.
- **Images not saving** — ensure the `uploads/` folder exists and is writable (it is created automatically on first upload).
