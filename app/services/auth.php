<?php
function auth_email($value): string {
    return is_string($value) ? strtolower(trim($value)) : '';
}

function auth_password_error($password): ?string {
    if (!is_string($password) || mb_strlen($password, 'UTF-8') < 15) return 'Use a passphrase of at least 15 characters.';
    if (strlen($password) > 72 || str_contains($password, "\0")) return 'Use a password of at most 72 bytes without null characters.';
    return null;
}

/** Atomic database-backed limit, including attempts against nonexistent accounts. */
function auth_allow_attempt(PDO $pdo, string $scope, string $address, int $limit = 20): bool {
    $key = hash('sha256', $scope . '|' . $address);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT IGNORE INTO auth_rate_limits (bucket_key, attempts, started_at) VALUES (?, 0, NOW())')->execute([$key]);
        $stmt = $pdo->prepare('SELECT attempts, started_at <= NOW() - INTERVAL 15 MINUTE AS expired FROM auth_rate_limits WHERE bucket_key = ? FOR UPDATE');
        $stmt->execute([$key]);
        $bucket = $stmt->fetch(PDO::FETCH_ASSOC);
        $attempts = $bucket['expired'] ? 1 : (int)$bucket['attempts'] + 1;
        $pdo->prepare('UPDATE auth_rate_limits SET attempts = ?, started_at = IF(?, NOW(), started_at) WHERE bucket_key = ?')
            ->execute([min($attempts, $limit + 1), (int)$bucket['expired'], $key]);
        $pdo->commit();
        return $attempts <= $limit;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

/** Lock the account so concurrent bad passwords cannot bypass the attempt limit. */
function auth_authenticate(PDO $pdo, string $email, string $password): ?array {
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT *, locked_until > NOW() AS currently_locked FROM users WHERE email = ? FOR UPDATE');
        $stmt->execute([auth_email($email)]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        // Fixed valid bcrypt hash gives nonexistent users a password verification too.
        $dummy = '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q';
        $valid = strlen($password) <= 72 && !str_contains($password, "\0")
            && password_verify($password, $user['password_hash'] ?? $dummy);
        if (!$user || !$valid || $user['currently_locked'] || !$user['is_active'] || !$user['is_verified']) {
            if ($user && !$valid && !$user['currently_locked']) {
                $attempts = $user['locked_until'] !== null ? 1 : (int)$user['failed_login_attempts'] + 1;
                $pdo->prepare('UPDATE users SET failed_login_attempts = ?, locked_until = IF(? >= 5, NOW() + INTERVAL 15 MINUTE, NULL) WHERE user_id = ?')
                    ->execute([min($attempts, 5), $attempts, $user['user_id']]);
            }
            $pdo->commit();
            return null;
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $user['password_hash'] = password_hash($password, PASSWORD_DEFAULT);
            $pdo->prepare('UPDATE users SET password_hash = ? WHERE user_id = ?')->execute([$user['password_hash'], $user['user_id']]);
        }
        $pdo->prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE user_id = ?')->execute([$user['user_id']]);
        $pdo->commit();
        return $user;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function auth_start_session(array $user): void {
    session_regenerate_id(true);
    $_SESSION = [
        'user_id' => (int)$user['user_id'], 'full_name' => $user['full_name'], 'role' => $user['role'],
        'auth_fingerprint' => hash('sha256', $user['password_hash']),
        'auth_started_at' => time(), 'auth_last_seen' => time(), 'csrf_token' => bin2hex(random_bytes(32)),
    ];
}

/** Reload permissions and revoke sessions after password/account changes or expiry. */
function auth_refresh_session(PDO $pdo): void {
    if (!isset($_SESSION['user_id'])) return;
    $stmt = $pdo->prepare('SELECT user_id, full_name, role, is_active, is_verified, password_hash FROM users WHERE user_id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    $idle = time() - ($_SESSION['auth_last_seen'] ?? 0);
    $age = time() - ($_SESSION['auth_started_at'] ?? 0);
    if (!$user || !$user['is_active'] || !$user['is_verified'] || $idle > AUTH_IDLE_SECONDS || $age > AUTH_MAX_SECONDS
        || !hash_equals(hash('sha256', $user['password_hash']), $_SESSION['auth_fingerprint'] ?? '')) {
        $_SESSION = [];
        session_regenerate_id(true);
        return;
    }
    $_SESSION['full_name'] = $user['full_name'];
    $_SESSION['role'] = $user['role'];
    $_SESSION['auth_last_seen'] = time();
}

/** Token digests use the existing 64-character fields. Cooldowns are checked under a row lock. */
function auth_issue_token(PDO $pdo, string $email, string $purpose): ?array {
    if (!in_array($purpose, ['reset', 'verification'], true)) throw new InvalidArgumentException('Invalid token purpose.');
    $field = $purpose === 'reset' ? 'reset_token' : 'verification_token';
    $sent = $purpose === 'reset' ? 'reset_sent_at' : 'verification_sent_at';
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("SELECT *, ($sent IS NULL OR $sent <= NOW() - INTERVAL 60 SECOND) AS can_send FROM users WHERE email = ? FOR UPDATE");
        $stmt->execute([auth_email($email)]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user || !$user['is_active'] || !$user['can_send'] || ($purpose === 'verification' && $user['is_verified'])) {
            $pdo->commit();
            return null;
        }
        $token = bin2hex(random_bytes(32));
        $pdo->prepare("UPDATE users SET $field = ?, $sent = NOW() WHERE user_id = ?")->execute([hash('sha256', $token), $user['user_id']]);
        $pdo->commit();
        return ['email' => $user['email'], 'name' => $user['full_name'], 'token' => $token];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function auth_valid_reset(PDO $pdo, string $token): bool {
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) return false;
    $stmt = $pdo->prepare('SELECT user_id FROM users WHERE reset_token = ? AND is_active = 1
        AND reset_sent_at BETWEEN NOW() - INTERVAL 1 HOUR AND NOW() + INTERVAL 5 MINUTE');
    $stmt->execute([hash('sha256', $token)]);
    return (bool)$stmt->fetchColumn();
}

function auth_reset_password(PDO $pdo, string $token, string $password): bool {
    if (auth_password_error($password) || !preg_match('/^[a-f0-9]{64}$/', $token)) return false;
    $stmt = $pdo->prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_sent_at = NULL,
        failed_login_attempts = 0, locked_until = NULL WHERE reset_token = ? AND is_active = 1
        AND reset_sent_at BETWEEN NOW() - INTERVAL 1 HOUR AND NOW() + INTERVAL 5 MINUTE');
    $stmt->execute([password_hash($password, PASSWORD_DEFAULT), hash('sha256', $token)]);
    return $stmt->rowCount() === 1;
}

function auth_verify_email(PDO $pdo, string $token): bool {
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) return false;
    $stmt = $pdo->prepare('UPDATE users SET is_verified = 1, verification_token = NULL, verification_sent_at = NULL
        WHERE verification_token = ? AND is_verified = 0 AND is_active = 1
        AND verification_sent_at BETWEEN NOW() - INTERVAL 1 DAY AND NOW() + INTERVAL 5 MINUTE');
    $stmt->execute([hash('sha256', $token)]);
    return $stmt->rowCount() === 1;
}

function auth_register(PDO $pdo, array $input): array {
    $fields = [];
    foreach (['full_name', 'email', 'phone', 'role', 'national_id', 'location', 'business_name'] as $name) {
        $fields[$name] = is_string($input[$name] ?? null) ? trim($input[$name]) : '';
    }
    $fields['email'] = auth_email($fields['email']);
    $password = is_string($input['password'] ?? null) ? $input['password'] : '';
    $confirm = is_string($input['confirm'] ?? null) ? $input['confirm'] : '';
    $errors = [];
    if ($fields['full_name'] === '' || mb_strlen($fields['full_name']) > 100) $errors[] = 'Enter a full name of up to 100 characters.';
    if (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL) || strlen($fields['email']) > 150) $errors[] = 'Enter a valid email address.';
    if (!in_array($fields['role'], ['Buyer', 'Farmer'], true)) $errors[] = 'Choose Buyer or Farmer.';
    if ($error = auth_password_error($password)) $errors[] = $error;
    if ($password !== $confirm) $errors[] = 'Passwords do not match.';
    if (!preg_match('/^\d{6,10}$/', $fields['national_id'])) $errors[] = 'Enter a valid National ID number (digits only).';
    if (mb_strlen($fields['location']) < 2 || mb_strlen($fields['location']) > 150) $errors[] = 'Enter a location of 2–150 characters.';
    if (mb_strlen($fields['business_name']) > 150 || ($fields['role'] === 'Farmer' && $fields['business_name'] === '')) $errors[] = 'Enter a farm/business name of up to 150 characters.';
    if (strlen($fields['phone']) > 20) $errors[] = 'Enter a phone number of up to 20 characters.';
    if ($errors) return ['errors' => $errors, 'fields' => $fields];
    $token = bin2hex(random_bytes(32));
    try {
        $stmt = $pdo->prepare('INSERT INTO users (full_name, email, password_hash, role, phone, national_id, location, business_name,
            is_verified, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())');
        $stmt->execute([$fields['full_name'], $fields['email'], password_hash($password, PASSWORD_DEFAULT), $fields['role'], $fields['phone'],
            $fields['national_id'], $fields['location'], $fields['role'] === 'Farmer' ? $fields['business_name'] : null, hash('sha256', $token)]);
        return ['errors' => [], 'fields' => $fields, 'token' => $token];
    } catch (PDOException $error) {
        if (($error->errorInfo[1] ?? null) !== 1062) throw $error;
        return ['errors' => ['The account could not be created with these details. Try signing in or recovering your account.'], 'fields' => $fields];
    }
}
