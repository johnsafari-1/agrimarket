<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
$page_title = 'Sign in';
$errors = [];
$show_resend_link = false;

// Authentication is shared with recovery/session handling in app/services/auth.php.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $email = auth_email($_POST['email'] ?? '');
    $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
    try {
        $allowed = auth_allow_attempt($pdo, 'login', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $user = $allowed ? auth_authenticate($pdo, $email, $password) : null;
        if ($user) {
            auth_start_session($user);
            $dest = ['Farmer' => 'farmer_dashboard.php', 'Admin' => 'admin_dashboard.php'][$user['role']] ?? 'index.php';
            header('Location: ' . $dest);
            exit;
        }
        if (!$allowed) { http_response_code(429); header('Retry-After: 900'); }
        $errors[] = $allowed ? 'Sign-in unsuccessful. Check your details and account verification, or try again later.' : 'Too many attempts. Please try again in 15 minutes.';
    } catch (Throwable $error) {
        error_log('Authentication unavailable: ' . $error->getMessage());
        http_response_code(503);
        $errors[] = 'Sign-in is temporarily unavailable. Please try again later.';
    }
}

$reg_errors = $_SESSION['reg_errors'] ?? [];
$reg_old    = $_SESSION['reg_old'] ?? [];
unset($_SESSION['reg_errors'], $_SESSION['reg_old']);

$active_tab = ($reg_errors || ($_GET['tab'] ?? '') === 'register') ? 'register' : 'login';
$flash = get_flash();

require ROOT_PATH . '/resources/views/auth/login.php';
