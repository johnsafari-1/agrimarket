<?php
require_once __DIR__ . '/config.php';
require_login('Buyer');
$page_title = 'Confirm M-Pesa Payment';

$order_id = (int)($_GET['order_id'] ?? 0);
$stmt = $pdo->prepare('SELECT * FROM orders WHERE order_id = ? AND buyer_id = ?');
$stmt->execute([$order_id, current_user_id()]);
$order = $stmt->fetch();
if (!$order) {
    set_flash('warning', 'Order not found.');
    header('Location: index.php');
    exit;
}
include __DIR__ . '/header.php';
?>
<div class="row justify-content-center">
  <div class="col-md-6">
    <div class="card shadow-sm text-center">
      <div class="card-body py-5">
        <div id="waiting-state">
          <div class="spinner-border text-success mb-3" style="width:3rem;height:3rem;" role="status"></div>
          <h5>Check your phone</h5>
          <p class="text-muted">We sent an M-Pesa payment prompt for order #<?= (int)$order_id ?>.
            Enter your M-Pesa PIN to complete payment of <?= format_money($order['total_amount']) ?>.</p>
          <p class="small text-muted" id="wait-message">Waiting for confirmation...</p>
        </div>
        <div id="done-state" class="d-none">
          <i class="bi" id="done-icon" style="font-size:3rem;"></i>
          <h5 id="done-title" class="mt-2"></h5>
          <p class="text-muted" id="done-message"></p>
          <a href="order.php?id=<?= (int)$order_id ?>" class="btn btn-success">View Order</a>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
let attempts = 0;
const maxAttempts = 40; // ~2 minutes at 3s intervals
function poll() {
  attempts++;
  fetch('mpesa_status.php?order_id=<?= (int)$order_id ?>')
    .then(r => r.json())
    .then(data => {
      if (data.status === 'Completed') return finish(true, 'Payment received!', data.message);
      if (data.status === 'Failed')    return finish(false, 'Payment not completed', data.message || 'The transaction was not successful.');
      document.getElementById('wait-message').textContent = data.message || 'Waiting for confirmation...';
      if (attempts >= maxAttempts) return finish(false, 'Still pending', 'This is taking a while. Check the order page shortly, or try paying again.');
      setTimeout(poll, 3000);
    })
    .catch(() => setTimeout(poll, 3000));
}
function finish(success, title, message) {
  document.getElementById('waiting-state').classList.add('d-none');
  document.getElementById('done-state').classList.remove('d-none');
  document.getElementById('done-icon').className = 'bi ' + (success ? 'bi-check-circle text-success' : 'bi-x-circle text-danger');
  document.getElementById('done-title').textContent = title;
  document.getElementById('done-message').textContent = message;
}
setTimeout(poll, 3000);
</script>
<?php include __DIR__ . '/footer.php'; ?>
