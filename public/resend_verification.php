<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
$page_title = 'Resend verification email';
$errors = [];
$sent_message = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $email = auth_email($_POST['email'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 150) {
        $errors[] = 'Enter a valid email address.';
    } else {
        $sent_message = 'If this account is eligible, a new link will be sent. Check your inbox or try again later.';
        try {
            if (auth_allow_attempt($pdo, 'verification', $_SERVER['REMOTE_ADDR'] ?? 'unknown', 5)) {
                $message = auth_issue_token($pdo, $email, 'verification');
                if ($message) send_verification_email($message['email'], $message['name'], $message['token']);
            }
        } catch (Throwable $error) {
            error_log('Account recovery unavailable: ' . $error->getMessage());
            http_response_code(503);
            $sent_message = null;
            $errors[] = 'This service is temporarily unavailable. Please try again later.';
        }
    }
}

include ROOT_PATH . '/resources/views/layout/header.php';
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
<?php include ROOT_PATH . '/resources/views/layout/footer.php'; ?>
