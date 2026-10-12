<?php
require_once dirname(__DIR__) . '/app/services/auth.php';
define('AUTH_IDLE_SECONDS', 1800);
define('AUTH_MAX_SECONDS', 43200);
$dsn = getenv('AGRIMARKET_TEST_DSN') ?: 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4';
$user = getenv('AGRIMARKET_TEST_USER') ?: 'root';
$pass = getenv('AGRIMARKET_TEST_PASS') ?: '';
$options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
function assert_auth(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
if (($argv[1] ?? '') === '--worker') {
    assert_auth((bool)preg_match('/^agrimarket_test_[a-f0-9]+$/', $argv[2] ?? ''), 'Invalid fixture database.');
    $worker = new PDO($dsn, $user, $pass, $options);
    $worker->exec('USE `' . $argv[2] . '`');
    $mode = $argv[3];
    $result = match ($mode) {
        'login' => auth_authenticate($worker, 'buyer@example.test', 'wrong-password') !== null,
        'reset' => auth_reset_password($worker, $argv[4], 'new long passphrase for testing'),
        'throttle' => auth_allow_attempt($worker, 'race', '127.0.0.1', 1),
    };
    echo $result ? 'yes' : 'no';
    exit;
}
ob_start();
session_start();
$pdo = new PDO($dsn, $user, $pass, $options);
$database = 'agrimarket_test_' . bin2hex(random_bytes(6));
$created = false;
$tests = 0;
$password = 'correct long passphrase for testing';
$passwordHash = password_hash($password, PASSWORD_DEFAULT);
function auth_fixture(PDO $pdo): void {
    global $passwordHash;
    $pdo->exec('DELETE FROM auth_rate_limits; DELETE FROM users;');
    $stmt = $pdo->prepare("INSERT INTO users (user_id, full_name, email, password_hash, role, is_verified, is_active) VALUES (?, ?, ?, ?, 'Buyer', ?, ?)");
    foreach ([[1, 'Verified Buyer', 'buyer@example.test', 1, 1], [2, 'Unverified', 'unverified@example.test', 0, 1], [3, 'Inactive', 'inactive@example.test', 1, 0]] as [$id, $name, $email, $verified, $active]) {
        $stmt->execute([$id, $name, $email, $passwordHash, $verified, $active]);
    }
    $_SESSION = [];
}
function auth_test(string $name, callable $run): void { global $tests; $run(); ++$tests; echo "PASS $name\n"; }
function auth_workers(string $database, string $mode, int $count, string $token = ''): array {
    $workers = [];
    for ($i = 0; $i < $count; ++$i) {
        $cmd = [PHP_BINARY];
        if (php_ini_loaded_file()) array_push($cmd, '-c', php_ini_loaded_file());
        array_push($cmd, __FILE__, '--worker', $database, $mode, $token);
        $process = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        assert_auth(is_resource($process), 'Worker could not start.');
        fclose($pipes[0]);
        $workers[] = [$process, $pipes];
    }
    $results = [];
    foreach ($workers as [$process, $pipes]) {
        $results[] = trim(stream_get_contents($pipes[1]));
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        assert_auth(proc_close($process) === 0, 'Worker error: ' . $error);
    }
    return $results;
}
try {
    $pdo->exec('CREATE DATABASE `' . $database . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); $created = true;
    $pdo->exec('USE `' . $database . '`');
    $schema = file_get_contents(dirname(__DIR__) . '/database/schema.sql');
    $schema = preg_replace('/^CREATE DATABASE.*;\s*$/m', '', $schema);
    $schema = preg_replace('/^USE farmer_marketplace;\s*$/m', '', $schema);
    $schema = substr($schema, 0, strpos($schema, '-- SEED DATA'));
    $pdo->exec($schema);
    auth_test('passphrase bounds, null bytes and email normalization', function () {
        assert_auth(auth_email(' BUYER@Example.Test ') === 'buyer@example.test' && auth_email([]) === '', 'Email normalization failed.');
        assert_auth(auth_password_error('password123') !== null, 'Weak password accepted.');
        assert_auth(auth_password_error(str_repeat('a', 73)) !== null && auth_password_error("valid passphrase\0") !== null, 'Unsafe bcrypt input accepted.');
        assert_auth(auth_password_error('three memorable words together') === null, 'Passphrase rejected.');
    });
    auth_test('registration validates roles, duplicate identity and digest storage', function () use ($pdo) {
        auth_fixture($pdo);
        $input = ['full_name' => 'Test Farmer', 'email' => ' NEW@Example.Test ', 'role' => 'Admin', 'national_id' => '12345678', 'location' => 'Nakuru', 'business_name' => 'Test farm', 'password' => 'three memorable words together', 'confirm' => 'three memorable words together'];
        assert_auth((bool)auth_register($pdo, $input)['errors'], 'Admin self-registration allowed.');
        $input['role'] = 'Farmer';
        $result = auth_register($pdo, $input);
        assert_auth(!$result['errors'], 'Valid registration rejected.');
        $row = $pdo->query("SELECT * FROM users WHERE email='new@example.test'")->fetch();
        assert_auth($row['verification_token'] === hash('sha256', $result['token']) && $row['verification_token'] !== $result['token'], 'Raw token stored.');
        assert_auth(password_verify($input['password'], $row['password_hash']) && !$row['is_verified'], 'Registration auth state incorrect.');
        assert_auth((bool)auth_register($pdo, $input)['errors'], 'Duplicate registration accepted.');
    });
    auth_test('authentication excludes unknown, inactive and unverified accounts', function () use ($pdo, $password) {
        auth_fixture($pdo);
        foreach (['unknown@example.test', 'inactive@example.test', 'unverified@example.test'] as $email) assert_auth(auth_authenticate($pdo, $email, $password) === null, 'Ineligible account signed in.');
        assert_auth((int)auth_authenticate($pdo, ' BUYER@EXAMPLE.TEST ', $password)['user_id'] === 1, 'Verified login failed.');
    });
    auth_test('concurrent failures lock the account after five attempts', function () use ($pdo, $database, $password) {
        auth_fixture($pdo);
        assert_auth(auth_workers($database, 'login', 5) === array_fill(0, 5, 'no'), 'Bad password authenticated.');
        $row = $pdo->query('SELECT failed_login_attempts, locked_until > NOW() AS locked FROM users WHERE user_id=1')->fetch();
        assert_auth((int)$row['failed_login_attempts'] === 5 && $row['locked'], 'Concurrent lockout bypassed.');
        assert_auth(auth_authenticate($pdo, 'buyer@example.test', $password) === null, 'Locked account authenticated.');
        $pdo->exec('UPDATE users SET locked_until=NOW()-INTERVAL 1 MINUTE WHERE user_id=1');
        auth_authenticate($pdo, 'buyer@example.test', 'wrong');
        assert_auth((int)$pdo->query('SELECT failed_login_attempts FROM users WHERE user_id=1')->fetchColumn() === 1, 'Expired lockout did not restart counter.');
        assert_auth(auth_authenticate($pdo, 'buyer@example.test', $password) !== null, 'Expired lockout did not allow correct password.');
    });
    auth_test('IP limiter remains atomic across concurrent processes and resets on expiry', function () use ($pdo, $database) {
        auth_fixture($pdo);
        $results = auth_workers($database, 'throttle', 4);
        assert_auth(count(array_filter($results, static fn($value) => $value === 'yes')) === 1, 'Parallel limiter exceeded quota.');
        $pdo->exec('UPDATE auth_rate_limits SET started_at=NOW()-INTERVAL 16 MINUTE');
        assert_auth(auth_allow_attempt($pdo, 'race', '127.0.0.1', 1), 'Expired bucket did not reset.');
    });
    auth_test('token issuance is hashed, cooled down and limited to eligible accounts', function () use ($pdo) {
        auth_fixture($pdo);
        $message = auth_issue_token($pdo, 'buyer@example.test', 'reset');
        assert_auth($message && auth_valid_reset($pdo, $message['token']), 'Reset token missing.');
        assert_auth($pdo->query('SELECT reset_token FROM users WHERE user_id=1')->fetchColumn() === hash('sha256', $message['token']), 'Reset token not hashed.');
        assert_auth(auth_issue_token($pdo, 'buyer@example.test', 'reset') === null, 'Cooldown bypassed.');
        assert_auth(auth_issue_token($pdo, 'inactive@example.test', 'reset') === null && auth_issue_token($pdo, 'unknown@example.test', 'reset') === null, 'Ineligible token issued.');
        $pdo->exec('UPDATE users SET reset_sent_at=NULL WHERE user_id=1');
        $next = auth_issue_token($pdo, 'buyer@example.test', 'reset');
        assert_auth(!auth_valid_reset($pdo, $message['token']) && auth_valid_reset($pdo, $next['token']), 'Old reset token still valid.');
    });
    auth_test('expired and future reset tokens fail', function () use ($pdo) {
        auth_fixture($pdo); $message = auth_issue_token($pdo, 'buyer@example.test', 'reset');
        $pdo->exec('UPDATE users SET reset_sent_at=NOW()-INTERVAL 2 HOUR WHERE user_id=1');
        assert_auth(!auth_valid_reset($pdo, $message['token']) && !auth_reset_password($pdo, $message['token'], 'new long passphrase for testing'), 'Expired token accepted.');
        $pdo->exec('UPDATE users SET reset_sent_at=NOW()+INTERVAL 10 MINUTE WHERE user_id=1');
        assert_auth(!auth_valid_reset($pdo, $message['token']), 'Future reset token accepted.');
    });
    auth_test('reset token is single-use even under concurrent requests', function () use ($pdo, $database) {
        auth_fixture($pdo); $message = auth_issue_token($pdo, 'buyer@example.test', 'reset');
        $results = auth_workers($database, 'reset', 3, $message['token']);
        assert_auth(count(array_filter($results, static fn($result) => $result === 'yes')) === 1, 'Concurrent reset replay succeeded.');
        assert_auth(!auth_valid_reset($pdo, $message['token']), 'Consumed reset token remained valid.');
    });
    auth_test('verification tokens expire and cannot be reused', function () use ($pdo) {
        auth_fixture($pdo); $message = auth_issue_token($pdo, 'unverified@example.test', 'verification');
        $pdo->exec('UPDATE users SET verification_sent_at=NOW()-INTERVAL 2 DAY WHERE user_id=2');
        assert_auth(!auth_verify_email($pdo, $message['token']), 'Expired verification accepted.');
        $pdo->exec('UPDATE users SET verification_sent_at=NOW() WHERE user_id=2');
        assert_auth(auth_verify_email($pdo, $message['token']) && !auth_verify_email($pdo, $message['token']), 'Verification replay accepted.');
    });
    auth_test('session rotates CSRF and reloads permissions', function () use ($pdo, $password) {
        auth_fixture($pdo); $_SESSION['csrf_token'] = 'old-token';
        auth_start_session(auth_authenticate($pdo, 'buyer@example.test', $password));
        assert_auth($_SESSION['csrf_token'] !== 'old-token', 'CSRF not rotated.');
        $pdo->exec("UPDATE users SET role='Farmer' WHERE user_id=1");
        auth_refresh_session($pdo);
        assert_auth($_SESSION['role'] === 'Farmer', 'Stale role retained.');
        $pdo->exec('UPDATE users SET is_active=0 WHERE user_id=1');
        auth_refresh_session($pdo); assert_auth(!isset($_SESSION['user_id']), 'Disabled session retained.');
    });
    auth_test('password reset invalidates existing sessions', function () use ($pdo, $password) {
        auth_fixture($pdo); auth_start_session(auth_authenticate($pdo, 'buyer@example.test', $password));
        $message = auth_issue_token($pdo, 'buyer@example.test', 'reset');
        assert_auth(auth_reset_password($pdo, $message['token'], 'new long passphrase for testing'), 'Reset failed.');
        auth_refresh_session($pdo); assert_auth(!isset($_SESSION['user_id']), 'Session survived password reset.');
    });
    auth_test('idle and absolute session expiry are enforced', function () use ($pdo, $password) {
        auth_fixture($pdo); auth_start_session(auth_authenticate($pdo, 'buyer@example.test', $password));
        $_SESSION['auth_last_seen'] = time() - 1801; auth_refresh_session($pdo);
        assert_auth(!isset($_SESSION['user_id']), 'Idle session retained.');
        auth_start_session(auth_authenticate($pdo, 'buyer@example.test', $password));
        $_SESSION['auth_started_at'] = time() - 43201; auth_refresh_session($pdo);
        assert_auth(!isset($_SESSION['user_id']), 'Absolute expiry ignored.');
    });
    echo "$tests authentication tests passed.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($created) $pdo->exec('DROP DATABASE `' . $database . '`');
    $_SESSION = []; session_destroy(); ob_end_flush();
}
