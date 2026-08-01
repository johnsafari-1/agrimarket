<?php
require_once __DIR__ . '/config.php';
$page_title = 'Verify your account';

$token = $_GET['token'] ?? '';
$outcome = null; // 'ok' | 'already' | 'expired' | 'invalid'

if ($token !== '') {
    $stmt = $pdo->prepare('SELECT user_id, is_verified, verification_sent_at FROM users WHERE verification_token = ?');
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if (!$user) {
        $outcome = 'invalid';
    } elseif ($user['is_verified']) {
        $outcome = 'already';
    } else {
        $sentAt = $user['verification_sent_at'] ? strtotime($user['verification_sent_at']) : 0;
        if ($sentAt && (time() - $sentAt) > 24 * 3600) {
            $outcome = 'expired';
        } else {
            $pdo->prepare('UPDATE users SET is_verified = 1, verification_token = NULL WHERE user_id = ?')
                ->execute([$user['user_id']]);
            $outcome = 'ok';
        }
    }
} else {
    $outcome = 'invalid';
}

include __DIR__ . '/header.php';
?>
<div class="row justify-content-center">
  <div class="col-md-6">
    <div class="card shadow-sm">
      <div class="card-body text-center py-5">
        <?php if ($outcome === 'ok'): ?>
          <i class="bi bi-check-circle-fill text-success" style="font-size:3rem;"></i>
          <h3 class="mt-3">Your account is verified!</h3>
          <p class="text-muted">You can now sign in and start using AgriMarket.</p>
          <a href="login.php" class="btn btn-success mt-2">Sign in</a>

        <?php elseif ($outcome === 'already'): ?>
          <i class="bi bi-check-circle text-success" style="font-size:3rem;"></i>
          <h3 class="mt-3">Already verified</h3>
          <p class="text-muted">This account was already verified. You can sign in directly.</p>
          <a href="login.php" class="btn btn-success mt-2">Sign in</a>

        <?php elseif ($outcome === 'expired'): ?>
          <i class="bi bi-clock-history text-warning" style="font-size:3rem;"></i>
          <h3 class="mt-3">This link has expired</h3>
          <p class="text-muted">Verification links are valid for 24 hours. Request a new one below.</p>
          <a href="resend_verification.php" class="btn btn-outline-success mt-2">Resend verification email</a>

        <?php else: ?>
          <i class="bi bi-x-circle text-danger" style="font-size:3rem;"></i>
          <h3 class="mt-3">Invalid verification link</h3>
          <p class="text-muted">This link doesn't match any pending account. It may have already been used.</p>
          <a href="resend_verification.php" class="btn btn-outline-success mt-2">Resend verification email</a>
        <?php endif; ?>
      </div>
    </div>
  </div>
</div>
<?php include __DIR__ . '/footer.php'; ?>
