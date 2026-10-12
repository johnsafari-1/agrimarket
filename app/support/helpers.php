<?php
// ---- Helpers ----
function e($value) {
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

function is_logged_in() {
    return isset($_SESSION['user_id']);
}

function current_user_id() {
    return $_SESSION['user_id'] ?? null;
}

function current_role() {
    return $_SESSION['role'] ?? null;
}

/** Redirect to login unless logged in (optionally restrict to a role). */
function require_login($role = null) {
    if (!is_logged_in()) {
        header('Location: ' . base_path() . 'login.php');
        exit;
    }
    if ($role !== null && current_role() !== $role) {
        header('Location: ' . base_path() . 'index.php');
        exit;
    }
}

/** All pages live in one folder, so base path is always ./ */
function base_path() {
    return './';
}

/** Flash messages (set on one request, shown on the next). */
function set_flash($type, $message) {
    $_SESSION['flash'] = ['type' => $type, 'message' => $message];
}

function get_flash() {
    if (isset($_SESSION['flash'])) {
        $f = $_SESSION['flash'];
        unset($_SESSION['flash']);
        return $f;
    }
    return null;
}

/** Unread message count for the navbar badge. */
function unread_count(PDO $pdo) {
    if (!is_logged_in()) return 0;
    $stmt = $pdo->prepare('SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND is_read = 0');
    $stmt->execute([current_user_id()]);
    return (int)$stmt->fetch()['c'];
}

/** CSRF protection: one token per session, checked on every state-changing POST. */
function csrf_token() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/** Hidden input to drop inside every <form method="post">. */
function csrf_field() {
    return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
}

/** Call at the top of every POST handler. Aborts the request if the token is missing/invalid. */
function require_csrf() {
    $sent     = $_POST['csrf_token'] ?? '';
    $expected = $_SESSION['csrf_token'] ?? '';
    if ($expected === '' || $sent === '' || !hash_equals($expected, $sent)) {
        http_response_code(403);
        die('Your session expired or this request could not be verified. Please go back, refresh the page, and try again.');
    }
}

/** Bootstrap badge colour per order status. */
function status_badge($status) {
    $map = [
        'Pending'   => 'warning',
        'Confirmed' => 'info',
        'Shipped'   => 'primary',
        'Delivered' => 'success',
        'Cancelled' => 'danger',
    ];
    $colour = $map[$status] ?? 'secondary';
    return '<span class="badge bg-' . $colour . '">' . e($status) . '</span>';
}

function format_money($amount) {
    return 'KES ' . number_format((float)$amount, 2);
}

