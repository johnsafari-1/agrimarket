<?php
require_once __DIR__ . '/tracking.php';
/** Serialize provider results with manual transitions and keep tracking atomic. */
function apply_mpesa_result(PDO $pdo, string $checkoutRequestId, bool $success, string $resultDesc, ?string $receipt) {
    if ($checkoutRequestId === '') return;
    $lookup = $pdo->prepare('SELECT order_id FROM transactions WHERE checkout_request_id = ?');
    $lookup->execute([$checkoutRequestId]);
    $orderId = $lookup->fetchColumn();
    if (!$orderId) return;
    $pdo->beginTransaction();
    try {
        $order = $pdo->prepare('SELECT status FROM orders WHERE order_id = ? FOR UPDATE');
        $order->execute([$orderId]);
        $status = $order->fetchColumn();
        $stmt = $pdo->prepare('SELECT txn_id, payment_status FROM transactions WHERE checkout_request_id = ? FOR UPDATE');
        $stmt->execute([$checkoutRequestId]);
        $txn = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$txn || $txn['payment_status'] !== 'Pending') { $pdo->commit(); return; }
        $pdo->prepare('UPDATE transactions SET payment_status = ?, paid_at = IF(?, NOW(), NULL), mpesa_receipt_number = ?, result_desc = ? WHERE txn_id = ?')
            ->execute([$success ? 'Completed' : 'Failed', (int)$success, $receipt, $resultDesc, $txn['txn_id']]);
        if ($success && $status === 'Pending') {
            $pdo->prepare("UPDATE orders SET status = 'Confirmed' WHERE order_id = ?")->execute([$orderId]);
            record_order_event($pdo, (int)$orderId, 'Confirmed', null, 'Payment received; order confirmed.');
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
