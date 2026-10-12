<?php
define('ROOT_PATH', dirname(__DIR__));
define('APP_PATH', __DIR__);
define('PUBLIC_PATH', ROOT_PATH . '/public');
define('STORAGE_PATH', ROOT_PATH . '/storage');

ini_set('log_errors', '1');
ini_set('display_errors', '0');
ini_set('error_log', STORAGE_PATH . '/logs/php.log');

$settings = require ROOT_PATH . '/config/app.php';
$localConfig = ROOT_PATH . '/config/local.php';
if (is_file($localConfig)) {
    $overrides = require $localConfig;
    if (!is_array($overrides)) {
        http_response_code(503);
        exit('Configuration is invalid. Check config/local.php.');
    }
    $settings = array_replace($settings, $overrides);
} elseif (is_file(ROOT_PATH . '/config.php')) {
    // Do not silently replace an existing installation's database/SMTP settings.
    http_response_code(503);
    exit('Local setup needs updating. Run scripts/migrate-local.php with PHP, then reload.');
}

foreach ($settings as $name => $value) {
    if (!defined($name)) define($name, $value);
}
date_default_timezone_set(APP_TIMEZONE);
if (session_status() === PHP_SESSION_NONE) session_start();

require_once APP_PATH . '/support/helpers.php';
require_once APP_PATH . '/services/Mpesa.php';
require_once APP_PATH . '/services/payments.php';
require_once APP_PATH . '/services/mailer.php';

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (PDOException $error) {
    error_log('Database connection failed: ' . $error->getMessage());
    http_response_code(503);
    exit('Database unavailable. Check MySQL and the database settings in config/local.php.');
}
