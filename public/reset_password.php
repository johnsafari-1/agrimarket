<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
$page_title = 'Reset password';
$errors = [];
$done = false;

$input = $_POST['token'] ?? $_GET['token'] ?? '';
$token = is_string($input) ? $input : '';
$valid_token = auth_valid_reset($pdo, $token);
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
    $confirm = is_string($_POST['confirm'] ?? null) ? $_POST['confirm'] : '';
    if ($error = auth_password_error($password)) $errors[] = $error;
    if ($password !== $confirm) $errors[] = 'Passwords do not match.';
    if (!$errors && $valid_token) {
        $done = auth_reset_password($pdo, $token, $password);
        $valid_token = $done;
        if ($done) { $_SESSION = []; session_regenerate_id(true); }
    }
}

include ROOT_PATH . '/resources/views/layout/header.php';
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
              <input type="password" name="password" autocomplete="new-password" minlength="15" maxlength="72" class="form-control" placeholder="At least 15 characters" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Confirm new password</label>
              <input type="password" name="confirm" autocomplete="new-password" minlength="15" maxlength="72" class="form-control" placeholder="Repeat password" required>
            </div>
            <button class="btn btn-success w-100">Update password</button>
          </form>
        <?php endif; ?>
      </div>
    </div>
  </div>
</div>
<?php include ROOT_PATH . '/resources/views/layout/footer.php'; ?>
