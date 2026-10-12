<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
require_once APP_PATH . '/services/order_transitions.php';
require_login('Farmer');
$page_title = 'Manage Orders';
$fid = current_user_id();

$allowed_transitions = [
    'Pending'   => ['Confirmed', 'Cancelled'],
    'Confirmed' => ['Shipped', 'Cancelled'],
    'Shipped'   => ['Delivered'],
];

// Status update (only for orders containing this farmer's products)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $oid = (int)($_POST['order_id'] ?? 0);
    $new = $_POST['new_status'] ?? '';

    try {
        $changed = transition_order(
            $pdo, $oid, (int)$fid, 'Farmer', $_POST['expected_status'] ?? '', $new,
            trim($_POST['estimated_delivery_date'] ?? ''), $_POST['estimated_delivery_window'] ?? '',
            is_string($_POST['delivery_note'] ?? null) ? $_POST['delivery_note'] : ''
        );
        set_flash($changed ? 'success' : 'warning', $changed
            ? "Order #$oid marked as $new."
            : 'The order could not be updated. Its status may have changed; review the latest details.');
    } catch (InvalidArgumentException $error) {
        set_flash('danger', $error->getMessage());
    } catch (Throwable $error) {
        error_log('Order status update failed: ' . $error->getMessage());
        set_flash('danger', 'The order could not be updated. Please try again.');
    }
    header('Location: farmer_orders.php');
    exit;
}

$stmt = $pdo->prepare(
    "SELECT o.order_id, o.order_date, o.status, o.delivery_address, o.estimated_delivery_date, o.estimated_delivery_window,
            u.full_name AS buyer_name, u.user_id AS buyer_id,
            SUM(i.quantity * i.unit_price) AS my_amount,
            GROUP_CONCAT(CONCAT(p.product_name, ' x', i.quantity) SEPARATOR ', ') AS item_list
     FROM orders o
     JOIN order_items i ON i.order_id = o.order_id
     JOIN products p ON p.product_id = i.product_id
     JOIN users u ON u.user_id = o.buyer_id
     WHERE p.farmer_id = ?
     GROUP BY o.order_id, o.order_date, o.status, o.delivery_address, o.estimated_delivery_date, o.estimated_delivery_window, u.full_name, u.user_id
     ORDER BY o.order_date DESC"
);
$stmt->execute([$fid]);
$orders = $stmt->fetchAll();

include ROOT_PATH . '/resources/views/layout/header.php';
?>
<h3 class="mb-3"><i class="bi bi-truck"></i> Orders for My Products</h3>

<?php if (!$orders): ?>
  <div class="alert alert-info">No orders for your products yet.</div>
<?php else: ?>
  <div class="table-responsive">
    <table class="table align-middle bg-white shadow-sm">
      <thead class="table-success">
        <tr><th>Order #</th><th>Buyer</th><th>My Items</th><th>Amount</th><th>Date</th><th>Status</th><th>Expected Delivery</th><th style="width:260px;">Update Status</th></tr>
      </thead>
      <tbody>
        <?php foreach ($orders as $o): ?>
          <tr>
            <td><a href="order.php?id=<?= (int)$o['order_id'] ?>">#<?= (int)$o['order_id'] ?></a></td>
            <td><?= e($o['buyer_name']) ?><br>
                <a class="small" href="messages.php?to=<?= (int)$o['buyer_id'] ?>"><i class="bi bi-chat-dots"></i> Message</a></td>
            <td class="small"><?= e($o['item_list']) ?></td>
            <td><?= format_money($o['my_amount']) ?></td>
            <td><?= e(date('d M Y', strtotime($o['order_date']))) ?></td>
            <td><?= status_badge($o['status']) ?></td>
            <td class="small">
              <?php if ($o['estimated_delivery_date']): ?>
                <?= e(date('d M', strtotime($o['estimated_delivery_date']))) ?>, <?= e($o['estimated_delivery_window']) ?>
              <?php else: ?>
                <span class="text-muted">&mdash;</span>
              <?php endif; ?>
            </td>
            <td>
              <?php $next = $allowed_transitions[$o['status']] ?? []; ?>
              <?php if ($next): ?>
                <form method="post" class="d-flex gap-1 align-items-start flex-wrap order-status-form">
                  <?= csrf_field() ?>
                  <input type="hidden" name="order_id" value="<?= (int)$o['order_id'] ?>">
                  <input type="hidden" name="expected_status" value="<?= e($o['status']) ?>">
                  <input type="text" name="delivery_note" maxlength="500" class="form-control form-control-sm" placeholder="Delivery update (optional)" aria-label="Delivery update for order <?= (int)$o['order_id'] ?>">
                  <select name="new_status" class="form-select form-select-sm status-select" style="width:auto;">
                    <?php foreach ($next as $n): ?>
                      <option value="<?= e($n) ?>"><?= e($n) ?></option>
                    <?php endforeach; ?>
                  </select>
                  <span class="confirm-delivery-fields d-flex gap-1">
                    <input type="date" name="estimated_delivery_date" class="form-control form-control-sm" style="width:140px;" min="<?= e(date('Y-m-d')) ?>">
                    <select name="estimated_delivery_window" class="form-select form-select-sm" style="width:auto;">
                      <option value="Morning">Morning</option>
                      <option value="Afternoon">Afternoon</option>
                      <option value="Evening">Evening</option>
                    </select>
                  </span>
                  <button class="btn btn-sm btn-success">Update</button>
                </form>
              <?php else: ?>
                <span class="text-muted small">No further action</span>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
<?php endif; ?>
<script>
  // Only show the estimated-delivery date/window inputs when "Confirmed" is the selected transition.
  document.querySelectorAll('.order-status-form').forEach(function (form) {
    var select = form.querySelector('.status-select');
    var fields = form.querySelector('.confirm-delivery-fields');
    function sync() {
      fields.style.display = (select.value === 'Confirmed') ? 'flex' : 'none';
    }
    select.addEventListener('change', sync);
    sync();
  });
</script>
<?php include ROOT_PATH . '/resources/views/layout/footer.php'; ?>
