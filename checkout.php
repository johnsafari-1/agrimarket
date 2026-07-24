<?php
require_once __DIR__ . '/config.php';
require_login('Buyer');
$page_title = 'Checkout';

$cart = $_SESSION['cart'] ?? [];
if (!$cart) {
    set_flash('info', 'Your cart is empty.');
    header('Location: index.php');
    exit;
}

// Load current product rows for the cart
$ids  = array_map('intval', array_keys($cart));
$in   = implode(',', $ids);
$rows = $pdo->query("SELECT * FROM products WHERE product_id IN ($in)")->fetchAll();

$items = [];
$total = 0;
foreach ($rows as $r) {
    $q = min((int)$cart[$r['product_id']]['quantity'], (int)$r['quantity']);
    if ($q < 1) continue;
    $items[] = ['p' => $r, 'q' => $q, 'sub' => $q * $r['price']];
    $total += $q * $r['price'];
}
if (!$items) {
    set_flash('warning', 'The items in your cart are no longer available.');
    header('Location: cart.php');
    exit;
}

$errors = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $address = trim($_POST['delivery_address'] ?? '');
    $method  = $_POST['payment_method'] ?? '';
    $phone   = trim($_POST['phone_number'] ?? '');
    if ($address === '') $errors[] = 'Delivery address is required.';
    if (!in_array($method, ['M-Pesa', 'Card', 'Cash on Delivery'], true)) $errors[] = 'Select a payment method.';

    // Normalise to Safaricom's expected 2547XXXXXXXX / 2541XXXXXXXX format.
    if ($method === 'M-Pesa') {
        $digits = preg_replace('/\D/', '', $phone);
        if (preg_match('/^0(7|1)\d{8}$/', $digits))      $phone = '254' . substr($digits, 1);
        elseif (preg_match('/^254(7|1)\d{8}$/', $digits)) $phone = $digits;
        else $errors[] = 'Enter a valid Safaricom M-Pesa number, e.g. 07XXXXXXXX.';
    }

    if (!$errors) {
        try {
            $pdo->beginTransaction();

            // 1. Create order
            $stmt = $pdo->prepare(
                "INSERT INTO orders (buyer_id, total_amount, status, delivery_address) VALUES (?, ?, 'Pending', ?)"
            );
            $stmt->execute([current_user_id(), $total, $address]);
            $order_id = (int)$pdo->lastInsertId();

            // 2. Create order items + decrement stock
            $item_stmt  = $pdo->prepare(
                'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)'
            );
            $stock_stmt = $pdo->prepare(
                'UPDATE products SET quantity = quantity - ? WHERE product_id = ? AND quantity >= ?'
            );
            foreach ($items as $it) {
                $item_stmt->execute([$order_id, $it['p']['product_id'], $it['q'], $it['p']['price']]);
                $stock_stmt->execute([$it['q'], $it['p']['product_id'], $it['q']]);
                if ($stock_stmt->rowCount() === 0) {
                    throw new RuntimeException('Insufficient stock for ' . $it['p']['product_name']);
                }
            }

            // 3. Record transaction
            $txn = $pdo->prepare(
                "INSERT INTO transactions (order_id, amount, payment_method, phone_number, payment_status)
                 VALUES (?, ?, ?, ?, 'Pending')"
            );
            $txn->execute([$order_id, $total, $method, $method === 'M-Pesa' ? $phone : null]);
            $txn_id = (int)$pdo->lastInsertId();

            $pdo->commit();
            $_SESSION['cart'] = [];

            // 4. For M-Pesa, trigger the STK push now and send the buyer to the waiting screen.
            if ($method === 'M-Pesa') {
                try {
                    $res = Mpesa::stkPush($phone, $total, 'Order' . $order_id, 'AgriMarket order');
                    if (!empty($res['CheckoutRequestID'])) {
                        $pdo->prepare(
                            'UPDATE transactions SET checkout_request_id = ?, merchant_request_id = ? WHERE txn_id = ?'
                        )->execute([$res['CheckoutRequestID'], $res['MerchantRequestID'] ?? null, $txn_id]);
                        header('Location: mpesa_wait.php?order_id=' . $order_id);
                        exit;
                    }
                    set_flash('warning', 'Order #' . $order_id . ' was placed, but the M-Pesa prompt could not be'
                        . ' sent (' . ($res['errorMessage'] ?? $res['ResponseDescription'] ?? 'unknown error') . '). '
                        . 'You can retry payment from the order page.');
                } catch (Exception $mex) {
                    set_flash('warning', 'Order #' . $order_id . ' was placed, but M-Pesa could not be reached: '
                        . $mex->getMessage());
                }
                header('Location: order.php?id=' . $order_id);
                exit;
            }

            set_flash('success', "Order #$order_id placed successfully. You can track its status below.");
            header('Location: order.php?id=' . $order_id);
            exit;
        } catch (Exception $ex) {
            $pdo->rollBack();
            $errors[] = 'Order failed: ' . $ex->getMessage();
        }
    }
}
include __DIR__ . '/header.php';
?>
<h3 class="mb-3"><i class="bi bi-bag-check"></i> Checkout</h3>
<?php foreach ($errors as $err): ?>
  <div class="alert alert-danger py-2"><?= e($err) ?></div>
<?php endforeach; ?>

<div class="row g-4">
  <div class="col-md-7">
    <div class="card shadow-sm">
      <div class="card-header bg-white fw-bold">Order Summary</div>
      <ul class="list-group list-group-flush">
        <?php foreach ($items as $it): ?>
          <li class="list-group-item d-flex justify-content-between">
            <span><?= e($it['p']['product_name']) ?> &times; <?= $it['q'] ?> <?= e($it['p']['unit']) ?></span>
            <span><?= format_money($it['sub']) ?></span>
          </li>
        <?php endforeach; ?>
        <li class="list-group-item d-flex justify-content-between fw-bold">
          <span>Total</span><span><?= format_money($total) ?></span>
        </li>
      </ul>
    </div>
  </div>
  <div class="col-md-5">
    <div class="card shadow-sm">
      <div class="card-header bg-white fw-bold">Delivery &amp; Payment</div>
      <div class="card-body">
        <form method="post">
          <?= csrf_field() ?>
          <div class="mb-3">
            <label class="form-label">Delivery Address</label>
            <textarea name="delivery_address" class="form-control" rows="3" required
              placeholder="Town, estate, street / landmark"><?= e($_POST['delivery_address'] ?? '') ?></textarea>
          </div>
          <div class="mb-3">
            <label class="form-label">Payment Method</label>
            <select name="payment_method" id="payment_method" class="form-select" required
                    onchange="document.getElementById('mpesa_phone_wrap').classList.toggle('d-none', this.value !== 'M-Pesa')">
              <?php $selected_method = $_POST['payment_method'] ?? 'Cash on Delivery'; ?>
              <option value="Cash on Delivery" <?= $selected_method === 'Cash on Delivery' ? 'selected' : '' ?>>Cash on Delivery</option>
              <option value="M-Pesa" <?= $selected_method === 'M-Pesa' ? 'selected' : '' ?>>M-Pesa (STK push to your phone)</option>
              <option value="Card" <?= $selected_method === 'Card' ? 'selected' : '' ?>>Card (pay on confirmation)</option>
            </select>
            <div class="form-text">Choosing M-Pesa sends a Lipa Na M-Pesa payment prompt straight to your phone.</div>
          </div>
          <div class="mb-3 <?= $selected_method === 'M-Pesa' ? '' : 'd-none' ?>" id="mpesa_phone_wrap">
            <label class="form-label">M-Pesa Phone Number</label>
            <input type="text" name="phone_number" class="form-control" placeholder="07XXXXXXXX"
                   value="<?= e($_POST['phone_number'] ?? '') ?>">
            <div class="form-text">Use the sandbox test number 0708374149 for testing.</div>
          </div>
          <button class="btn btn-success w-100"><i class="bi bi-check2-circle"></i> Place Order</button>
        </form>
      </div>
    </div>
  </div>
</div>
<?php include __DIR__ . '/footer.php'; ?>
