# AgriMarket

Farmer–buyer marketplace — Kabarak University Group 5 project. Plain PHP 8+
and MySQL/MariaDB, compatible with XAMPP.

## Setup

- **Existing installation:** follow [docs/SETUP.md](docs/SETUP.md) to migrate local
  settings/uploads. Keep your database; do not re-import the fresh schema.
- **Fresh installation:** copy `config/local.example.php` to `config/local.php`,
  import `database/schema.sql`, start Apache/MySQL, then open
  `http://localhost/marketplace/` with rewrite rules enabled.
- **Tests:** see [tests/README.md](tests/README.md).

## Structure

| Directory | Responsibility |
|---|---|
| `public/` | Browser-facing pages, assets and product uploads; server document root |
| `app/` | Bootstrap, shared helpers and services |
| `config/` | Safe defaults, local settings example and ignored credentials |
| `resources/views/layout/` | Shared header/footer templates |
| `database/` | Fresh-install schema and historical upgrade scripts |
| `storage/logs/` | Private application and callback logs |
| `lib/PHPMailer/` | Existing bundled mail dependency |
| `scripts/` | CLI-only local upgrade utilities |
| `tests/` | Setup, HTTP smoke and order integration tests |
| `docs/` | Installation, upgrade and hosting instructions |

Page handlers retain their original filenames and load `app/bootstrap.php`.
Root Apache rewrite rules preserve `/marketplace/` URLs and block private files.
For deployment, set the document root to `public/`.

## Features

| Module | Public handlers |
|---|---|
| Accounts and password recovery | `login.php`, `register.php`, `verify.php`, `resend_verification.php`, `forgot_password.php`, `reset_password.php` |
| Farmer listings | `farmer_dashboard.php`, `farmer_products.php`, `farmer_product_form.php` |
| Shopping | `index.php`, `product.php`, `cart.php`, `checkout.php` |
| Orders | `my_orders.php`, `order.php`, `farmer_orders.php` |
| Messages | `messages.php` |
| Requests/offers | `requests.php`, `farmer_requests.php` |
| M-Pesa | `mpesa_wait.php`, `mpesa_status.php`, `mpesa_callback.php` |
| Administration/reports | `admin_dashboard.php`, `admin_users.php`, `admin_products.php`, `admin_orders.php`, `admin_report.php` |

Orders progress **Pending → Confirmed → Shipped → Delivered**. Cancellation
updates status/restocking atomically; duplicate and stale changes are rejected.
Delivery completes pending Cash on Delivery transactions only. Online payments
are handled independently. Per-farmer fulfilment of mixed-farmer orders remains
future work. Card selection records a method; no card provider is integrated.

Buyer requests match listings and invite farmer offers. Accepted listing offers
enter the cart; free-form offers open a message thread.

## Conventions

Secrets belong in ignored `config/local.php`, images in `public/uploads/`, and logs
in `storage/logs/`. Schema changes need a named upgrade script and an updated fresh
schema. Put reusable operations in `app/services/`. Keep `*.OLD_BACKUP` out of Git.
