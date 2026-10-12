<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { header('Location: login.php?tab=register'); exit; }
require_csrf();
try {
    if (!auth_allow_attempt($pdo, 'register', $_SERVER['REMOTE_ADDR'] ?? 'unknown', 5)) {
        http_response_code(429);
        header('Retry-After: 900');
        exit('Too many account requests. Please try again in 15 minutes.');
    }
    $result = auth_register($pdo, $_POST);
    if ($result['errors']) {
        $_SESSION['reg_errors'] = $result['errors'];
        $_SESSION['reg_old'] = $result['fields'];
        header('Location: login.php?tab=register');
        exit;
    }
    $sent = send_verification_email($result['fields']['email'], $result['fields']['full_name'], $result['token']);
    set_flash($sent ? 'success' : 'warning', $sent
        ? 'Account created. Check your email to verify it before signing in.'
        : 'Account created. The verification email could not be sent. Use Resend verification email to try again.');
} catch (Throwable $error) {
    error_log('Registration unavailable: ' . $error->getMessage());
    set_flash('danger', 'Account creation is temporarily unavailable. Please try again later.');
}
header('Location: login.php');
exit;
