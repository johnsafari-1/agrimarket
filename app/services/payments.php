<?php
/**
 * Record the outcome of an STK Push against the matching transaction row,
 * and move the order to Confirmed once payment is verified as successful.
 * Shared by mpesa_callback.php (Safaricom -> our server) and mpesa_status.php
 * (our server -> Safaricom query, used for the in-browser waiting screen).
 */
function apply_mpesa_result(PDO $pdo, string $checkoutRequestId, bool $success, string $resultDesc, ?string $receipt) {
    if ($checkoutRequestId === '') return;

    $stmt = $pdo->prepare('SELECT * FROM transactions WHERE checkout_request_id = ?');
    $stmt->execute([$checkoutRequestId]);
    $txn = $stmt->fetch();
    if (!$txn || $txn['payment_status'] !== 'Pending') return; // already handled or unknown

    if ($success) {
        $pdo->prepare(
            "UPDATE transactions SET payment_status = 'Completed', paid_at = NOW(),
                    mpesa_receipt_number = ?, result_desc = ? WHERE txn_id = ?"
        )->execute([$receipt, $resultDesc, $txn['txn_id']]);
        // Payment confirmed online, so the order can move straight to Confirmed.
        $pdo->prepare("UPDATE orders SET status = 'Confirmed' WHERE order_id = ? AND status = 'Pending'")
            ->execute([$txn['order_id']]);
    } else {
        $pdo->prepare(
            "UPDATE transactions SET payment_status = 'Failed', result_desc = ? WHERE txn_id = ?"
        )->execute([$resultDesc, $txn['txn_id']]);
    }
}
