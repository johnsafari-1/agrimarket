<?php
require_once __DIR__ . '/config.php';
$page_title = 'Reset password';
$errors = [];
$done = false;

$token = $_GET['token'] ?? $_POST['token'] ?? '';

$stmt = $pdo->prepare(
    "SELECT user_id FROM users
     WHERE reset_token = ? AND reset_sent_at IS NOT NULL
       AND reset_sent_at >= (NOW() - INTERVAL 1 HOUR)
       AND reset_sent_at <= (NOW() + INTERVAL 5 MINUTE)"
);
$stmt->execute([$token]);
$user = $stmt->fetch();
$valid_token = (bool)$user;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $valid_token) {
    require_csrf();
    $password = $_POST['password'] ?? '';
    $confirm  = $_POST['confirm'] ?? '';

    if (strlen($password) < 6) $errors[] = 'Password must be at least 6 characters.';
    if ($password !== $confirm) $errors[] = 'Passwords do not match.';

    if (!$errors) {
        $pdo->prepare('UPDATE users SET password_hash = ?, reset_token = NULL, failed_login_attempts = 0, locked_until = NULL WHERE user_id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $user['user_id']]);
        $done = true;
    }
}

include __DIR__ . '/header.php';
?>
<div class="row justify-content-center">
  <div class="col-md-5">
    <div class="card shadow-sm">
      <div class="card-body">
        <?php if ($done): ?>
          <div class="text-center py-3">
            <i class="bi bi-check-circle-fill text-success" style="font-size:3rem;"></i>
            <h4 class="mt-3">Password updated</h4>
            <p class="text-muted">You can now sign in with your new password.</p>
            <a href="login.php" class="btn btn-success mt-2">Sign in</a>
          </div>
        <?php elseif (!$valid_token): ?>
          <div class="text-center py-3">
            <i class="bi bi-x-circle text-danger" style="font-size:3rem;"></i>
            <h4 class="mt-3">Invalid or expired link</h4>
            <p class="text-muted">This password reset link is invalid or has expired. Request a new one below.</p>
            <a href="forgot_password.php" class="btn btn-outline-success mt-2">Request a new link</a>
          </div>
        <?php else: ?>
          <h5 class="fw-bold mb-3">Choose a new password</h5>
          <?php foreach ($errors as $err): ?>
            <div class="alert alert-danger py-2"><?= e($err) ?></div>
          <?php endforeach; ?>
          <form method="post">
            <?= csrf_field() ?>
            <input type="hidden" name="token" value="<?= e($token) ?>">
            <div class="mb-3">
              <label class="form-label">New password</label>
              <input type="password" name="password" class="form-control" placeholder="Min. 6 characters" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Confirm new password</label>
              <input type="password" name="confirm" class="form-control" placeholder="Repeat password" required>
            </div>
            <button class="btn btn-success w-100">Update password</button>
          </form>
        <?php endif; ?>
      </div>
    </div>
  </div>
</div>
<?php include __DIR__ . '/footer.php'; ?>
