<?php
require_once __DIR__ . '/config.php';
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

    $chk = $pdo->prepare(
        'SELECT o.status FROM orders o
         JOIN order_items i ON i.order_id = o.order_id
         JOIN products p ON p.product_id = i.product_id
         WHERE o.order_id = ? AND p.farmer_id = ? LIMIT 1'
    );
    $chk->execute([$oid, $fid]);
    $row = $chk->fetch();

    if ($row && in_array($new, $allowed_transitions[$row['status']] ?? [], true)) {
        if ($new === 'Confirmed') {
            $est_date   = trim($_POST['estimated_delivery_date'] ?? '');
            $est_window = $_POST['estimated_delivery_window'] ?? '';
            $valid_date = $est_date !== '' && strtotime($est_date) !== false && $est_date >= date('Y-m-d');
            $valid_win  = in_array($est_window, ['Morning', 'Afternoon', 'Evening'], true);
            if (!$valid_date || !$valid_win) {
                set_flash('danger', 'Give a valid expected delivery date (today or later) and time window before confirming.');
                header('Location: farmer_orders.php');
                exit;
            }
            $pdo->prepare('UPDATE orders SET status = ?, estimated_delivery_date = ?, estimated_delivery_window = ? WHERE order_id = ?')
                ->execute([$new, $est_date, $est_window, $oid]);
        } else {
            $pdo->prepare('UPDATE orders SET status = ? WHERE order_id = ?')->execute([$new, $oid]);
        }
        if ($new === 'Delivered') {
            $pdo->prepare(
                "UPDATE transactions SET payment_status = 'Completed', paid_at = NOW()
                 WHERE order_id = ? AND payment_status = 'Pending'"
            )->execute([$oid]);
        }
        if ($new === 'Cancelled') {
            // Return stock for all items in the order
            $items = $pdo->prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?');
            $items->execute([$oid]);
            $restock = $pdo->prepare('UPDATE products SET quantity = quantity + ? WHERE product_id = ?');
            foreach ($items->fetchAll() as $it) $restock->execute([(int)$it['quantity'], (int)$it['product_id']]);
        }
        set_flash('success', "Order #$oid marked as $new.");
    } else {
        set_flash('danger', 'Invalid status change.');
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

include __DIR__ . '/header.php';
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
<?php include __DIR__ . '/footer.php'; ?>
