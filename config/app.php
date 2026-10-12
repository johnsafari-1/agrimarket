<?php
/** Safe defaults. Override machine-specific values in ignored config/local.php. */
return [
    'APP_NAME' => 'AgriMarket',
    'APP_TIMEZONE' => 'Africa/Nairobi',
    'SITE_URL' => 'http://localhost/marketplace',
    'DB_HOST' => '127.0.0.1',
    'DB_PORT' => 3306,
    'DB_NAME' => 'farmer_marketplace',
    'DB_USER' => 'root',
    'DB_PASS' => '',
    'SMTP_HOST' => '',
    'SMTP_PORT' => 587,
    'SMTP_USER' => '',
    'SMTP_PASS' => '',
    'SMTP_SECURE' => 'tls',
    'MPESA_ENV' => 'sandbox',
    'MPESA_CONSUMER_KEY' => '',
    'MPESA_CONSUMER_SECRET' => '',
    'MPESA_SHORTCODE' => '174379',
    'MPESA_PASSKEY' => '',
    'MPESA_CALLBACK_URL' => '',
];
