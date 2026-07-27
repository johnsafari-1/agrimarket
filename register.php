<?php
/**
 * Registration handler (logic only).
 * The registration FORM lives on login.php ("Create account" tab).
 * On validation errors, input + errors are round-tripped back via session.
 */
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: login.php?tab=register');
    exit;
}
require_csrf();

$full_name = trim($_POST['full_name'] ?? '');
$email     = trim($_POST['email'] ?? '');
$phone     = trim($_POST['phone'] ?? '');
$role      = $_POST['role'] ?? '';
$password  = $_POST['password'] ?? '';
$confirm   = $_POST['confirm'] ?? '';

$errors = [];
if ($full_name === '') $errors[] = 'Full name is required.';
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = 'A valid email address is required.';
if (!in_array($role, ['Farmer', 'Buyer'], true)) $errors[] = 'Please choose whether you are a Farmer or a Buyer.';
if (strlen($password) < 6) $errors[] = 'Password must be at least 6 characters.';
if ($password !== $confirm) $errors[] = 'Passwords do not match.';

if (!$errors) {
    $stmt = $pdo->prepare('SELECT user_id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        $errors[] = 'An account with that email already exists.';
    }
}

if ($errors) {
    $_SESSION['reg_errors'] = $errors;
    $_SESSION['reg_old']    = ['full_name' => $full_name, 'email' => $email, 'phone' => $phone, 'role' => $role];
    header('Location: login.php?tab=register');
    exit;
}

$token = bin2hex(random_bytes(32));

$stmt = $pdo->prepare(
    'INSERT INTO users (full_name, email, password_hash, role, phone, is_verified, verification_token, verification_sent_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, NOW())'
);
$stmt->execute([$full_name, $email, password_hash($password, PASSWORD_DEFAULT), $role, $phone, $token]);

$sent = send_verification_email($email, $full_name, $token);

if ($sent) {
    set_flash('success', 'Account created! We\'ve sent a verification link to ' . e($email) . ' — click it to activate your account before signing in.');
} else {
    set_flash('warning', 'Account created, but the verification email could not be sent right now. Use "Resend verification email" on the sign-in page once you\'re ready to try again.');
}
header('Location: login.php');
exit;
