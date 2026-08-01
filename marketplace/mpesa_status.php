<?php
require_once __DIR__ . '/config.php';
require_login('Buyer');
header('Content-Type: application/json');

$order_id = (int)($_GET['order_id'] ?? 0);

// Only the buyer who owns this order may poll its payment status.
$stmt = $pdo->prepare(
    'SELECT t.* FROM transactions t
     JOIN orders o ON o.order_id = t.order_id
     WHERE t.order_id = ? AND o.buyer_id = ? AND t.payment_method = "M-Pesa"
     ORDER BY t.txn_id DESC LIMIT 1'
);
$stmt->execute([$order_id, current_user_id()]);
$txn = $stmt->fetch();

if (!$txn) {
    echo json_encode(['status' => 'Failed', 'message' => 'No M-Pesa transaction found for this order.']);
    exit;
}

if ($txn['payment_status'] !== 'Pending' || !$txn['checkout_request_id']) {
    echo json_encode(['status' => $txn['payment_status'], 'message' => $txn['result_desc'] ?? '']);
    exit;
}

// Still pending: ask Safaricom directly whether the buyer has completed the STK prompt yet.
try {
    $res = Mpesa::queryStkStatus($txn['checkout_request_id']);
    $code = $res['ResultCode'] ?? null; // "0" = success, "1032" = cancelled by user, others = still pending/failed
    if ($code === '0' || $code === 0) {
        apply_mpesa_result($pdo, $txn['checkout_request_id'], true, $res['ResultDesc'] ?? '', null);
        echo json_encode(['status' => 'Completed', 'message' => $res['ResultDesc'] ?? 'Payment received.']);
    } elseif ($code !== null && (string)$code !== '' && str_contains(strtolower($res['ResultDesc'] ?? ''), 'still processing') === false
              && ($res['errorCode'] ?? null) === null) {
        // A definitive non-zero ResultCode from Safaricom (cancelled, insufficient funds, timeout, etc.)
        apply_mpesa_result($pdo, $txn['checkout_request_id'], false, $res['ResultDesc'] ?? 'Payment failed.', null);
        echo json_encode(['status' => 'Failed', 'message' => $res['ResultDesc'] ?? 'Payment failed.']);
    } else {
        // Safaricom returns an errorCode (e.g. 500.001.1001) while the STK push is still awaiting the PIN.
        echo json_encode(['status' => 'Pending', 'message' => 'Waiting for the buyer to complete the M-Pesa prompt...']);
    }
} catch (Exception $e) {
    echo json_encode(['status' => 'Pending', 'message' => 'Still checking...']);
}
