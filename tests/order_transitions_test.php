<?php
/** Integration tests against a disposable database; never reads config.php. */
require_once __DIR__ . '/../app/services/order_transitions.php';
require_once __DIR__ . '/../app/services/payments.php';

$dsn = getenv('AGRIMARKET_TEST_DSN') ?: 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4';
$user = getenv('AGRIMARKET_TEST_USER') ?: 'root';
$pass = getenv('AGRIMARKET_TEST_PASS') ?: '';
$options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

// Worker processes use separate connections to exercise real InnoDB row locks.
if (($argv[1] ?? '') === '--worker') {
    check((bool)preg_match('/^agrimarket_test_[a-f0-9]+$/', $argv[2] ?? ''), 'Invalid test database.');
    $worker = new PDO($dsn, $user, $pass, $options);
    $worker->exec('USE `' . $argv[2] . '`');
    $worker->exec('SET SESSION innodb_lock_wait_timeout = 10');
    echo "ready\n";
    flush();
    $changed = transition_order(
        $worker, 1, (int)$argv[3], $argv[4], $argv[5], $argv[6], date('Y-m-d'), 'Morning'
    );
    echo $changed ? "changed\n" : "unchanged\n";
    exit;
}

$pdo = new PDO($dsn, $user, $pass, $options);
$database = 'agrimarket_test_' . bin2hex(random_bytes(6));
$created = false;
$tests = 0;

function fixture(PDO $pdo, string $status = 'Pending'): void {
    $pdo->exec('DELETE FROM transactions; DELETE FROM order_items; DELETE FROM orders; DELETE FROM products; DELETE FROM users;');
    $pdo->exec("INSERT INTO users (user_id, full_name, email, password_hash, role) VALUES
        (1, 'Buyer', 'buyer@example.test', 'test', 'Buyer'),
        (2, 'Farmer', 'farmer@example.test', 'test', 'Farmer'),
        (3, 'Other buyer', 'other-buyer@example.test', 'test', 'Buyer'),
        (4, 'Other farmer', 'other-farmer@example.test', 'test', 'Farmer')");
    $pdo->exec("INSERT INTO products (product_id, farmer_id, product_name, price, quantity) VALUES
        (1, 2, 'Maize', 10, 7), (2, 2, 'Potatoes', 10, 6)");
    $pdo->prepare('INSERT INTO orders (order_id, buyer_id, total_amount, delivery_address, status) VALUES (1, 1, 70, ?, ?)')
        ->execute(['Test address', $status]);
    $pdo->exec('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (1, 1, 3, 10), (1, 2, 4, 10)');
}

function status(PDO $pdo): string {
    return $pdo->query('SELECT status FROM orders WHERE order_id = 1')->fetchColumn();
}

function stock(PDO $pdo): array {
    return array_map('intval', $pdo->query('SELECT quantity FROM products ORDER BY product_id')->fetchAll(PDO::FETCH_COLUMN));
}

function worker(string $database, int $actor, string $role, string $expected, string $next): array {
    $command = [PHP_BINARY];
    if (php_ini_loaded_file()) array_push($command, '-c', php_ini_loaded_file());
    array_push($command, __FILE__, '--worker', $database, (string)$actor, $role, $expected, $next);
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    check(is_resource($process), 'Could not launch concurrency test.');
    fclose($pipes[0]);
    stream_set_timeout($pipes[1], 15);
    check(trim((string)fgets($pipes[1])) === 'ready', 'Worker did not connect.');
    return [$process, $pipes];
}

function finish_worker(array $worker): string {
    [$process, $pipes] = $worker;
    $result = trim(stream_get_contents($pipes[1]));
    $error = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    check(proc_close($process) === 0, 'Worker failed: ' . $error);
    return $result;
}

function test_case(string $name, callable $run): void {
    global $tests;
    $run();
    ++$tests;
    echo "PASS $name\n";
}

try {
    $pdo->exec('CREATE DATABASE `' . $database . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    $created = true;
    $pdo->exec('USE `' . $database . '`');
    $schema = file_get_contents(__DIR__ . '/../database/schema.sql');
    $schema = preg_replace('/^CREATE DATABASE.*;\s*$/m', '', $schema);
    $schema = preg_replace('/^USE farmer_marketplace;\s*$/m', '', $schema);
    $schema = substr($schema, 0, strpos($schema, '-- SEED DATA'));
    $pdo->exec($schema);

    test_case('buyer cancellation restores every item exactly once', function () use ($pdo) {
        fixture($pdo);
        check(transition_order($pdo, 1, 1, 'Buyer', 'Pending', 'Cancelled'), 'Cancellation failed.');
        check(!transition_order($pdo, 1, 1, 'Buyer', 'Pending', 'Cancelled'), 'Duplicate cancellation succeeded.');
        check(!transition_order($pdo, 1, 2, 'Farmer', 'Pending', 'Cancelled'), 'Farmer cancelled again.');
        check(status($pdo) === 'Cancelled' && stock($pdo) === [10, 10], 'Stock returned incorrectly.');
    });

    test_case('farmer can cancel confirmed order once', function () use ($pdo) {
        fixture($pdo, 'Confirmed');
        check(transition_order($pdo, 1, 2, 'Farmer', 'Confirmed', 'Cancelled'), 'Cancellation failed.');
        check(!transition_order($pdo, 1, 2, 'Farmer', 'Confirmed', 'Cancelled'), 'Duplicate succeeded.');
        check(stock($pdo) === [10, 10], 'Incorrect stock.');
    });

    test_case('ownership and role checks prevent unauthorized changes', function () use ($pdo) {
        fixture($pdo);
        foreach ([[3, 'Buyer'], [4, 'Farmer'], [1, 'Admin'], [1, 'Farmer'], [2, 'Buyer']] as [$id, $role]) {
            check(!transition_order($pdo, 1, $id, $role, 'Pending', 'Cancelled'), 'Unauthorized change.');
        }
        check(!transition_order($pdo, 99, 1, 'Buyer', 'Pending', 'Cancelled'), 'Missing order changed.');
        check(status($pdo) === 'Pending' && stock($pdo) === [7, 6], 'Rejected change had side effects.');
    });

    test_case('buyer cannot cancel a confirmed order or confirm one', function () use ($pdo) {
        fixture($pdo, 'Confirmed');
        check(!transition_order($pdo, 1, 1, 'Buyer', 'Confirmed', 'Cancelled'), 'Confirmed cancellation allowed.');
        fixture($pdo);
        check(!transition_order($pdo, 1, 1, 'Buyer', 'Pending', 'Confirmed'), 'Buyer confirmation allowed.');
    });

    test_case('stale status and skipped lifecycle steps are rejected', function () use ($pdo) {
        fixture($pdo, 'Confirmed');
        check(!transition_order($pdo, 1, 2, 'Farmer', 'Pending', 'Cancelled'), 'Stale request accepted.');
        check(!transition_order($pdo, 1, 2, 'Farmer', 'Confirmed', 'Delivered'), 'Skipped shipping.');
        check(status($pdo) === 'Confirmed' && stock($pdo) === [7, 6], 'Rejected transition mutated data.');
    });

    test_case('confirmation validates delivery date and window', function () use ($pdo) {
        fixture($pdo);
        foreach ([['2099-02-30', 'Morning'], ['2000-01-01', 'Morning'], [date('Y-m-d'), 'Night']] as [$date, $window]) {
            try {
                transition_order($pdo, 1, 2, 'Farmer', 'Pending', 'Confirmed', $date, $window);
                throw new RuntimeException('Invalid delivery details accepted.');
            } catch (InvalidArgumentException $expected) {
                check(!$pdo->inTransaction() && status($pdo) === 'Pending', 'Validation failed to roll back.');
            }
        }
        check(transition_order($pdo, 1, 2, 'Farmer', 'Pending', 'Confirmed', date('Y-m-d'), 'Morning'), 'Valid confirmation rejected.');
        $row = $pdo->query('SELECT estimated_delivery_date, estimated_delivery_window FROM orders')->fetch();
        check($row['estimated_delivery_date'] === date('Y-m-d') && $row['estimated_delivery_window'] === 'Morning', 'Delivery details missing.');
    });

    test_case('failed second restock rolls back order and first restock', function () use ($pdo) {
        fixture($pdo);
        $pdo->exec("CREATE TRIGGER fail_restock BEFORE UPDATE ON products FOR EACH ROW
            BEGIN IF NEW.product_id = 2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test failure'; END IF; END");
        try {
            try {
                transition_order($pdo, 1, 1, 'Buyer', 'Pending', 'Cancelled');
                throw new RuntimeException('Restock failure was swallowed.');
            } catch (PDOException $expected) {
                check(status($pdo) === 'Pending' && stock($pdo) === [7, 6], 'Partial cancellation committed.');
                check(!$pdo->inTransaction(), 'Transaction left open.');
            }
        } finally {
            $pdo->exec('DROP TRIGGER fail_restock');
        }
    });

    test_case('delivery completes only pending Cash on Delivery payment', function () use ($pdo) {
        fixture($pdo, 'Shipped');
        $pdo->exec("INSERT INTO transactions (order_id, amount, payment_method, payment_status) VALUES
            (1, 70, 'Cash on Delivery', 'Pending'), (1, 70, 'M-Pesa', 'Pending'),
            (1, 70, 'Card', 'Pending'), (1, 70, 'Cash on Delivery', 'Failed')");
        check(transition_order($pdo, 1, 2, 'Farmer', 'Shipped', 'Delivered'), 'Delivery failed.');
        $rows = $pdo->query('SELECT payment_status, paid_at FROM transactions ORDER BY txn_id')->fetchAll();
        check(array_column($rows, 'payment_status') === ['Completed', 'Pending', 'Pending', 'Failed'], 'Unverified payment marked paid.');
        check($rows[0]['paid_at'] !== null && $rows[1]['paid_at'] === null && $rows[2]['paid_at'] === null, 'Incorrect paid timestamps.');
    });

    test_case('payment failure rolls back delivery status', function () use ($pdo) {
        fixture($pdo, 'Shipped');
        $pdo->exec("INSERT INTO transactions (order_id, amount, payment_method) VALUES (1, 70, 'Cash on Delivery')");
        $pdo->exec("CREATE TRIGGER fail_payment BEFORE UPDATE ON transactions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test failure'");
        try {
            try {
                transition_order($pdo, 1, 2, 'Farmer', 'Shipped', 'Delivered');
                throw new RuntimeException('Payment failure was swallowed.');
            } catch (PDOException $expected) {
                check(status($pdo) === 'Shipped', 'Delivery partially committed.');
                check($pdo->query('SELECT payment_status FROM transactions')->fetchColumn() === 'Pending', 'Payment partially committed.');
            }
        } finally {
            $pdo->exec('DROP TRIGGER fail_payment');
        }
    });

    test_case('competing buyer and farmer cancellation restores stock once', function () use ($pdo, $database) {
        fixture($pdo);
        $pdo->beginTransaction();
        $pdo->query('SELECT order_id FROM orders WHERE order_id = 1 FOR UPDATE')->fetch();
        try {
            $buyer = worker($database, 1, 'Buyer', 'Pending', 'Cancelled');
            $farmer = worker($database, 2, 'Farmer', 'Pending', 'Cancelled');
            $read = [$buyer[1][1], $farmer[1][1]];
            $write = $except = [];
            check(stream_select($read, $write, $except, 0, 200000) === 0, 'Cancellation bypassed row lock.');
        } finally {
            $pdo->commit();
        }
        $results = [finish_worker($buyer), finish_worker($farmer)];
        sort($results);
        check($results === ['changed', 'unchanged'], 'Both concurrent requests changed order.');
        check(status($pdo) === 'Cancelled' && stock($pdo) === [10, 10], 'Concurrent restock incorrect.');
    });

    test_case('queued cancellation rechecks status after another request confirms', function () use ($pdo, $database) {
        fixture($pdo);
        $pdo->beginTransaction();
        $pdo->query('SELECT order_id FROM orders WHERE order_id = 1 FOR UPDATE')->fetch();
        try {
            $buyer = worker($database, 1, 'Buyer', 'Pending', 'Cancelled');
            $pdo->exec("UPDATE orders SET status = 'Confirmed' WHERE order_id = 1");
        } finally {
            $pdo->commit();
        }
        check(finish_worker($buyer) === 'unchanged', 'Queued cancellation ignored latest status.');
        check(status($pdo) === 'Confirmed' && stock($pdo) === [7, 6], 'Confirmed stock restored.');
    });

    test_case('queued confirmation cannot revive cancelled order', function () use ($pdo, $database) {
        fixture($pdo);
        $pdo->beginTransaction();
        $pdo->query('SELECT order_id FROM orders WHERE order_id = 1 FOR UPDATE')->fetch();
        try {
            $farmer = worker($database, 2, 'Farmer', 'Pending', 'Confirmed');
            $pdo->exec("UPDATE orders SET status = 'Cancelled' WHERE order_id = 1");
        } finally {
            $pdo->commit();
        }
        check(finish_worker($farmer) === 'unchanged', 'Queued confirmation revived cancelled order.');
        check(status($pdo) === 'Cancelled', 'Cancelled status overwritten.');
    });

    test_case('tracking failure rolls back delivery and payment', function () use ($pdo) {
        fixture($pdo, 'Shipped');
        $pdo->exec("INSERT INTO transactions (order_id, amount, payment_method) VALUES (1, 70, 'Cash on Delivery')");
        $pdo->exec("CREATE TRIGGER fail_event BEFORE INSERT ON order_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test failure'");
        try {
            try {
                transition_order($pdo, 1, 2, 'Farmer', 'Shipped', 'Delivered');
                throw new RuntimeException('Tracking failure swallowed.');
            } catch (PDOException $expected) {
                check(status($pdo) === 'Shipped', 'Delivery committed without history.');
                check($pdo->query('SELECT payment_status FROM transactions')->fetchColumn() === 'Pending', 'Payment committed without history.');
            }
        } finally { $pdo->exec('DROP TRIGGER fail_event'); }
    });
    test_case('provider result records confirmation once and preserves cancellation', function () use ($pdo) {
        fixture($pdo);
        $pdo->exec("INSERT INTO transactions (order_id, amount, payment_method, checkout_request_id) VALUES (1, 70, 'M-Pesa', 'test-checkout')");
        apply_mpesa_result($pdo, 'test-checkout', true, 'Confirmed', 'test-receipt');
        apply_mpesa_result($pdo, 'test-checkout', false, 'Late failure', null);
        check(status($pdo) === 'Confirmed', 'Payment did not confirm order.');
        check((int)$pdo->query('SELECT COUNT(*) FROM order_events')->fetchColumn() === 1, 'Payment history duplicated.');
        check($pdo->query('SELECT payment_status FROM transactions')->fetchColumn() === 'Completed', 'Late result reverted payment.');
        fixture($pdo, 'Cancelled');
        $pdo->exec("INSERT INTO transactions (order_id, amount, payment_method, checkout_request_id) VALUES (1, 70, 'M-Pesa', 'cancelled-checkout')");
        apply_mpesa_result($pdo, 'cancelled-checkout', true, 'Confirmed', null);
        check(status($pdo) === 'Cancelled' && (int)$pdo->query('SELECT COUNT(*) FROM order_events')->fetchColumn() === 0, 'Late payment revived cancellation.');
    });
    echo "$tests tests passed.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($created) $pdo->exec('DROP DATABASE `' . $database . '`');
}
