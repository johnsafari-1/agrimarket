# Order transition integration tests

Run against a local MySQL/MariaDB development server with PHP 8+ and `pdo_mysql`:

```powershell
$env:AGRIMARKET_TEST_DSN = 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4'
$env:AGRIMARKET_TEST_USER = 'root'
$env:AGRIMARKET_TEST_PASS = ''
& 'D:\xampp\php\php.exe' tests/order_transitions_test.php
```

The test account needs permission to create/drop databases and triggers. Each run
creates a randomly named `agrimarket_test_*` database, loads the schema from
`database.sql`, and drops that database when finished. It does not load `config.php`
or modify `farmer_marketplace`. Use a development server.

Tests cover authorization, duplicate cancellation, stale updates, delivery date
validation, rollback after stock/payment failure, separation of delivery from
online payment, and simultaneous requests using separate PHP processes and real
InnoDB row locks. Concurrency tests need PHP's `proc_open` enabled.
