# Setup and upgrade

## Existing Windows/XAMPP installation

```powershell
Set-Location 'D:\xampp\htdocs\marketplace'
git fetch origin
git switch --track origin/feature-auth-ui-tracking
& 'D:\xampp\php\php.exe' scripts/migrate-local.php
& 'D:\xampp\php\php.exe' scripts/migrate.php
```

The CLI setup script extracts literal `define()` settings from the old ignored
`config.php` without running it. It creates ignored `config/local.php` and copies
local product images to `public/uploads/`. Existing destination settings/images
are never overwritten. Original configuration, backups, uploads and your local
`migration_kyc_fields.sql` are kept. The KYC script is copied into `database/migrations/`
for review without applying SQL. No credentials are printed. Settings expressed
as code rather than literals require manual migration using
`config/local.example.php` as the new format.

Keep your existing database. **Do not re-import `database/schema.sql`.** The new
authentication/tracking tables are added by `scripts/migrate.php`, which records
applied migrations and is safe to run again. Run it with Apache stopped during
the first upgrade, then restart Apache. Existing accounts and orders are preserved.
Existing email links are invalidated once; request new verification/reset links.
Existing browser sessions must sign in again after this upgrade.
Historical scripts in `database/migrations/` are one-time upgrades; check missing
columns before applying one. Your untracked KYC migration is not applied or replaced.

Start Apache and MySQL. Open **http://localhost/marketplace/** as before. The root
`.htaccess` maps original page/asset/upload URLs into `public/` and blocks private
files. XAMPP must enable `mod_rewrite` and `AllowOverride All` for this directory.
If rewrites are disabled, use **http://localhost/marketplace/public/** and update
`SITE_URL`. Do not expose the project root publicly without the access rules.

## Fresh installation

1. Install XAMPP with PHP 8+, MySQL/MariaDB, and extensions `pdo_mysql`, `mbstring`,
   `curl`, `fileinfo`, and `tokenizer`.
2. Clone into `D:\xampp\htdocs\marketplace`.
3. Copy `config/local.example.php` to `config/local.php`; fill in database, SMTP,
   `SITE_URL`, and optional M-Pesa settings.
4. Start MySQL and import **database/schema.sql** in phpMyAdmin. Run
   `scripts/migrate.php` once before using the app, then start Apache.
5. Open **http://localhost/marketplace/** with rewrite rules enabled.

The fresh schema includes password-reset and registration profile fields. Demo
accounts use `password123`: `admin@agrimarket.co.ke`, `john@farmer.co.ke`,
`mary@farmer.co.ke`, `peter@buyer.co.ke`, `grace@buyer.co.ke`. Use demo accounts only
for development. Configure SMTP before registering accounts requiring verification.
With blank SMTP settings, email returns the existing delivery-failed message.

## Apache document root

For deployment, expose only `public/`. Example local Windows virtual host:

```apache
<VirtualHost *:80>
    ServerName agrimarket.local
    DocumentRoot "D:/xampp/htdocs/marketplace/public"
    <Directory "D:/xampp/htdocs/marketplace/public">
        Options -Indexes
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

Add `127.0.0.1 agrimarket.local` to the Windows hosts file and set `SITE_URL` to
`http://agrimarket.local` for this local host. For hosting, use your HTTPS domain.
The web server needs read access to `config/local.php` and write access to
`storage/logs/` and `public/uploads/`. On Linux assign an appropriate shared group
and permissions; the upgrade script initially creates settings with owner-only access.

## PHP development server

With MySQL running:

```powershell
& 'D:\xampp\php\php.exe' -S 127.0.0.1:8000 -t public
```

Open **http://127.0.0.1:8000/** and use that `SITE_URL` for email links. This serves
only `public/`. Use Apache for deployment; the development server ignores `.htaccess`.

## M-Pesa

Set `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`,
`MPESA_SHORTCODE`, `MPESA_ENV`, and `MPESA_CALLBACK_URL` in `config/local.php`.
The callback must be public HTTPS, ending in `/mpesa_callback.php` under your
application URL. Original `/marketplace/mpesa_callback.php` links continue to work
with the root rewrite rules. Callback logs are now private in `storage/logs/`.

## Verification

See [../tests/README.md](../tests/README.md). Integration tests use disposable
databases. No test sends email or calls M-Pesa. Test settings are not production settings.


## Open and work in VS Code

```powershell
Set-Location 'D:\xampp\htdocs\marketplace'
code .
```

Authentication logic lives in `app/services/auth.php`; shared layout is under
`resources/views/layout/`; sign-in UI is under `resources/views/auth/`; customer
tracking is under `resources/views/orders/` and `app/services/tracking.php`. No
Node build or Composer install is needed for this increment.
