<?php
require_once dirname(__DIR__) . '/app/support/legacy_config.php';
function expect(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$source = <<<'PHP'
<?php
define('DB_HOST', 'localhost');
define('DB_NAME', 'farmer_marketplace');
define('DB_USER', 'root');
define('DB_PASS', 'a\'b\\c');
define('SMTP_PASS', "line\nquote\"test");
define('SMTP_PORT', 587);
file_put_contents('/must-not-execute', 'unsafe');
PHP;
$values = read_legacy_settings($source, ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS', 'SMTP_PASS', 'SMTP_PORT']);
expect($values['DB_PASS'] === "a'b\\c", 'Single-quoted credential changed.');
expect($values['SMTP_PASS'] === "line\nquote\"test", 'Double-quoted credential changed.');
expect($values['SMTP_PORT'] === 587, 'Port not parsed.');
expect(!file_exists('/must-not-execute'), 'Legacy source was executed.');
try {
    read_legacy_settings("<?php define('DB_PASS', getenv('DB_PASS'));", ['DB_PASS']);
    throw new RuntimeException('Dynamic credential accepted.');
} catch (RuntimeException $error) {
    expect(str_contains($error->getMessage(), 'manual migration'), 'Wrong dynamic value error.');
}
$root = sys_get_temp_dir() . '/agrimarket_setup_' . bin2hex(random_bytes(5));
try {
    foreach (['config', 'uploads', 'public/uploads', 'database/migrations'] as $directory) mkdir($root . '/' . $directory, 0700, true);
    copy(dirname(__DIR__) . '/config/app.php', $root . '/config/app.php');
    file_put_contents($root . '/config.php', $source);
    file_put_contents($root . '/uploads/product.jpg', 'fixture image');
    file_put_contents($root . '/uploads/unsafe.php', '<?php echo "unsafe";');
    file_put_contents($root . '/migration_kyc_fields.sql', '-- local KYC fixture');
    migrate_local_files($root);
    $local = require $root . '/config/local.php';
    expect($local['DB_PASS'] === "a'b\\c" && $local['SMTP_PASS'] === "line\nquote\"test", 'Migrated credentials changed.');
    expect(file_get_contents($root . '/public/uploads/product.jpg') === 'fixture image', 'Image not copied.');
    expect(!file_exists($root . '/public/uploads/unsafe.php'), 'Script copied into public uploads.');
    expect(file_exists($root . '/uploads/product.jpg'), 'Original image removed.');
    expect(file_get_contents($root . '/database/migrations/migration_kyc_fields.sql') === '-- local KYC fixture', 'KYC migration not preserved.');
    $before = file_get_contents($root . '/config/local.php');
    migrate_local_files($root);
    expect(file_get_contents($root . '/config/local.php') === $before, 'Second run changed settings.');
    file_put_contents($root . '/uploads/product.jpg', 'different image');
    try {
        migrate_local_files($root);
        throw new RuntimeException('Conflicting image replaced.');
    } catch (RuntimeException $error) {
        expect(str_contains($error->getMessage(), 'conflicting destination'), 'Wrong conflict error.');
    }
    expect(file_get_contents($root . '/public/uploads/product.jpg') === 'fixture image', 'Destination overwritten.');
    echo "PASS local configuration migration, repeat setup, upload preservation and collision checks.\n";
} finally {
    if (is_dir($root)) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($files as $file) $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
        rmdir($root);
    }
}
