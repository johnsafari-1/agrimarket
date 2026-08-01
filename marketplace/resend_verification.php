<?php
require_once __DIR__ . '/config.php';
$page_title = 'Resend verification email';
$errors = [];
$sent_message = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $email = trim($_POST['email'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'Enter a valid email address.';
    } else {
        $stmt = $pdo->prepare('SELECT user_id, full_name, is_verified, verification_sent_at FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        // Same generic message whether or not the account exists / is already verified,
        // so this can't be used to check which emails are registered.
        $sent_message = "If that email has a pending account, we've sent a fresh verification link.";

        if ($user && !$user['is_verified']) {
            $lastSent = $user['verification_sent_at'] ? strtotime($user['verification_sent_at']) : 0;
            if (time() - $lastSent >= 60) { // simple cooldown so this can't be used to spam an inbox
                $token = bin2hex(random_bytes(32));
                $pdo->prepare('UPDATE users SET verification_token = ?, verification_sent_at = NOW() WHERE user_id = ?')
                    ->execute([$token, $user['user_id']]);
                send_verification_email($email, $user['full_name'], $token);
            }
        }
    }
}

include __DIR__ . '/header.php';
?>
<div class="row justify-content-center">
  <div class="col-md-5">
    <div class="card shadow-sm">
      <div class="card-header bg-white fw-bold">Resend verification email</div>
      <div class="card-body">
        <?php if ($sent_message): ?>
          <div class="alert alert-success"><?= e($sent_message) ?></div>
        <?php endif; ?>
        <?php foreach ($errors as $err): ?>
          <div class="alert alert-danger py-2"><?= e($err) ?></div>
        <?php endforeach; ?>
        <form method="post">
          <?= csrf_field() ?>
          <div class="mb-3">
            <label class="form-label">Your account email</label>
            <input type="email" name="email" class="form-control" required value="<?= e($_POST['email'] ?? '') ?>">
          </div>
          <button class="btn btn-success w-100">Send verification link</button>
        </form>
        <div class="text-center mt-3">
          <a href="login.php">Back to sign in</a>
        </div>
      </div>
    </div>
  </div>
</div>
<?php include __DIR__ . '/footer.php'; ?>
