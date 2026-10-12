<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$root = dirname(__DIR__);
$settings = require $root . '/config/app.php';
if (!is_file($root . '/config/local.php')) { fwrite(STDERR, "Create config/local.php first.\n"); exit(1); }
$settings = array_replace($settings, require $root . '/config/local.php');
$pdo = new PDO('mysql:host=' . $settings['DB_HOST'] . ';port=' . $settings['DB_PORT'] . ';dbname=' . $settings['DB_NAME'] . ';charset=utf8mb4',
    $settings['DB_USER'], $settings['DB_PASS'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$key = hash('sha256', 'agrimarket:migrations:' . $settings['DB_NAME']);
$lock = $pdo->prepare('SELECT GET_LOCK(?, 10)');
$lock->execute([$key]);
if ((int)$lock->fetchColumn() !== 1) { fwrite(STDERR, "Another database upgrade is running.\n"); exit(1); }
try {
    $pdo->exec('CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(190) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    $files = glob($root . '/database/migrations/20*.sql');
    sort($files);
    foreach ($files as $file) {
        $name = basename($file);
        $hash = hash_file('sha256', $file);
        $check = $pdo->prepare('SELECT checksum FROM app_migrations WHERE name = ?');
        $check->execute([$name]);
        $existing = $check->fetchColumn();
        if ($existing !== false) {
            if (!hash_equals($existing, $hash)) throw new RuntimeException('An already-applied migration was changed: ' . $name);
            echo "Already applied: $name\n";
            continue;
        }
        $pdo->exec(file_get_contents($file));
        $pdo->prepare('INSERT INTO app_migrations (name, checksum) VALUES (?, ?)')->execute([$name, $hash]);
        echo "Applied: $name\n";
    }
    echo "Database upgrade complete. Existing accounts and orders kept. Request new email links if needed.\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Database upgrade stopped: ' . $error->getMessage() . PHP_EOL);
    exit(1);
} finally {
    $pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$key]);
}
