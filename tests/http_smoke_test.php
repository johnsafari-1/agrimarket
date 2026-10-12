<?php
/** Apache HTTP tests with a fresh disposable database and dummy local settings. */
$root = dirname(__DIR__);
$localPath = $root . '/config/local.php';
if (is_file($localPath)) throw new RuntimeException('Refusing to replace existing config/local.php.');
$dsn = getenv('AGRIMARKET_TEST_DSN') ?: 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4';
$user = getenv('AGRIMARKET_TEST_USER') ?: 'root';
$pass = getenv('AGRIMARKET_TEST_PASS') ?: '';
$base = getenv('AGRIMARKET_TEST_URL') ?: 'http://127.0.0.1:18080/marketplace';
$pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$database = 'agrimarket_test_' . bin2hex(random_bytes(6));
$created = false;
$localCreated = false;
$cookies = [];
$checks = 0;
function verify(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function request_page(string $path, string $method = 'GET', array $data = []): array {
    global $base, $cookies, $checks;
    $headers = ['Content-Type: application/x-www-form-urlencoded'];
    if ($cookies) $headers[] = 'Cookie: ' . implode('; ', $cookies);
    $context = stream_context_create(['http' => [
        'method' => $method, 'header' => implode("\r\n", $headers),
        'content' => $method === 'POST' ? http_build_query($data) : '',
        'ignore_errors' => true, 'follow_location' => 0, 'timeout' => 10,
    ]]);
    $body = file_get_contents($base . $path, false, $context);
    verify($body !== false, 'HTTP request failed: ' . $path);
    $status = (int)explode(' ', $http_response_header[0])[1];
    $location = '';
    foreach ($http_response_header as $header) {
        if (preg_match('/^Set-Cookie:\s*([^=]+)=([^;]*)/i', $header, $match)) $cookies[$match[1]] = $match[1] . '=' . $match[2];
        if (stripos($header, 'Location: ') === 0) $location = substr($header, 10);
    }
    ++$checks;
    return ['status' => $status, 'body' => $body, 'location' => $location];
}
function csrf(array $page): string {
    verify((bool)preg_match('/name="csrf_token" value="([^"]+)"/', $page['body'], $match), 'Missing CSRF field.');
    return $match[1];
}
function sign_in(string $email, string $destination): void {
    global $cookies;
    $cookies = [];
    $page = request_page('/login.php');
    verify($page['status'] === 200, 'Login form unavailable.');
    $response = request_page('/login.php', 'POST', ['csrf_token' => csrf($page), 'email' => $email, 'password' => 'password123']);
    verify($response['status'] === 302 && $response['location'] === $destination, 'Login failed: ' . $email);
}
try {
    $pdo->exec('CREATE DATABASE `' . $database . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    $created = true;
    $pdo->exec('USE `' . $database . '`');
    $schema = file_get_contents($root . '/database/schema.sql');
    $schema = preg_replace('/^CREATE DATABASE.*;\s*$/m', '', $schema);
    $schema = preg_replace('/^USE farmer_marketplace;\s*$/m', '', $schema);
    $pdo->exec($schema);
    // Parse the DSN without printing or using the application's real credentials.
    $parts = [];
    foreach (explode(';', substr($dsn, 6)) as $part) {
        if (str_contains($part, '=')) { [$key, $value] = explode('=', $part, 2); $parts[$key] = $value; }
    }
    $settings = ['DB_HOST' => $parts['host'] ?? '127.0.0.1', 'DB_PORT' => (int)($parts['port'] ?? 3306),
        'DB_NAME' => $database, 'DB_USER' => $user, 'DB_PASS' => $pass, 'SITE_URL' => $base];
    file_put_contents($localPath, '<?php return ' . var_export($settings, true) . ';');
    $localCreated = true;
    chmod($localPath, 0644); // Dummy CI settings readable by Apache.
    file_put_contents($root . '/public/uploads/blocked.php', '<?php echo "must-not-run";');
    file_put_contents($root . '/storage/logs/private-fixture.log', 'must-not-read');

    $page = request_page('/');
    verify($page['status'] === 200 && str_contains($page['body'], 'Fresh Maize'), 'Root rewrite or fresh schema failed.');
    foreach (['/assets/app.css', '/assets/app.js', '/assets/images/hero-market.jpg', '/public/index.php', '/product.php?id=1'] as $path) {
        verify(request_page($path)['status'] === 200, 'Public resource failed: ' . $path);
    }
    foreach (['/config/local.php', '/config/app.php', '/app/bootstrap.php', '/database/schema.sql', '/storage/logs/private-fixture.log',
        '/scripts/migrate-local.php', '/tests/http_smoke_test.php', '/lib/PHPMailer/src/SMTP.php', '/.git/config', '/config.php.OLD_BACKUP',
        '/uploads/blocked.php', '/public/uploads/blocked.php'] as $path) {
        verify(request_page($path)['status'] === 403, 'Private resource exposed: ' . $path);
    }
    verify(request_page('/farmer_dashboard.php')['status'] === 302, 'Guest accessed farmer dashboard.');

    $register = request_page('/login.php?tab=register');
    $response = request_page('/register.php', 'POST', ['csrf_token' => csrf($register), 'full_name' => 'Fresh Buyer',
        'email' => 'fresh@example.test', 'phone' => '0700000010', 'role' => 'Buyer',
        'password' => 'test-password', 'confirm' => 'test-password', 'national_id' => '99999999', 'location' => 'Nakuru']);
    verify($response['status'] === 302 && $response['location'] === 'login.php', 'Registration failed.');
    verify((int)$pdo->query("SELECT COUNT(*) FROM users WHERE email='fresh@example.test' AND national_id='99999999'")->fetchColumn() === 1, 'Profile fields unavailable on fresh install.');

    sign_in('peter@buyer.co.ke', 'index.php');
    foreach (['/cart.php', '/my_orders.php', '/requests.php', '/messages.php', '/forgot_password.php', '/reset_password.php?token=invalid', '/verify.php?token=invalid', '/resend_verification.php'] as $path) {
        verify(request_page($path)['status'] === 200, 'Buyer page failed: ' . $path);
    }
    verify(request_page('/admin_dashboard.php')['status'] === 302, 'Buyer accessed admin dashboard.');
    $cart = request_page('/cart.php');
    verify(request_page('/cart.php', 'POST', ['csrf_token' => csrf($cart), 'action' => 'add', 'product_id' => 1, 'quantity' => 2])['status'] === 302, 'Cart add failed.');
    $checkout = request_page('/checkout.php');
    $placed = request_page('/checkout.php', 'POST', ['csrf_token' => csrf($checkout), 'delivery_address' => 'Test Nakuru', 'payment_method' => 'Cash on Delivery']);
    verify($placed['status'] === 302 && str_starts_with($placed['location'], 'order.php?id='), 'Checkout failed.');
    $order = request_page('/' . $placed['location']);
    verify($order['status'] === 200, 'Order details failed.');
    verify(request_page('/' . $placed['location'], 'POST', ['csrf_token' => csrf($order), 'action' => 'cancel'])['status'] === 302, 'Cancellation failed.');
    verify((int)$pdo->query('SELECT quantity FROM products WHERE product_id=1')->fetchColumn() === 500, 'Cancellation did not restore stock.');

    sign_in('john@farmer.co.ke', 'farmer_dashboard.php');
    foreach (['/farmer_dashboard.php', '/farmer_products.php', '/farmer_product_form.php', '/farmer_orders.php', '/farmer_requests.php'] as $path) {
        verify(request_page($path)['status'] === 200, 'Farmer page failed: ' . $path);
    }
    sign_in('admin@agrimarket.co.ke', 'admin_dashboard.php');
    foreach (['/admin_dashboard.php', '/admin_users.php', '/admin_products.php', '/admin_orders.php', '/admin_report.php'] as $path) {
        verify(request_page($path)['status'] === 200, 'Admin page failed: ' . $path);
    }
    echo "PASS $checks HTTP checks: legacy URLs, assets, private files, roles, fresh registration, checkout and cancellation.\n";
} finally {
    if ($localCreated) unlink($localPath);
    foreach (['/public/uploads/blocked.php', '/storage/logs/private-fixture.log'] as $path) {
        if (is_file($root . $path)) unlink($root . $path);
    }
    if ($created) $pdo->exec('DROP DATABASE `' . $database . '`');
}
