<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__) . '/app/support/legacy_config.php';
try {
    foreach (migrate_local_files(dirname(__DIR__)) as $message) echo $message . PHP_EOL;
    echo "Setup complete. Keep your existing database; do not re-import database/schema.sql.\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Setup stopped: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
