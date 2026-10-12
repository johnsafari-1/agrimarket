<?php
function record_order_event(PDO $pdo, int $orderId, string $status, ?int $actorId, string $note): void {
    $pdo->prepare('INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?, ?, ?, ?)')
        ->execute([$orderId, $status, $actorId, $note]);
}

/** Owner-scoped snapshot; return no buyer/phone/provider identifiers. */
function buyer_order_tracking(PDO $pdo, int $orderId, int $buyerId): ?array {
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT order_id, status, total_amount, estimated_delivery_date, estimated_delivery_window,
            UNIX_TIMESTAMP(order_date) AS placed_epoch FROM orders WHERE order_id = ? AND buyer_id = ?');
        $stmt->execute([$orderId, $buyerId]);
        $order = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$order) { $pdo->commit(); return null; }
        $events = $pdo->prepare('SELECT status, note, UNIX_TIMESTAMP(created_at) AS event_epoch FROM order_events WHERE order_id = ? ORDER BY event_id');
        $events->execute([$orderId]);
        $timeline = array_map(static function ($event) {
            return ['status' => $event['status'], 'note' => $event['note'], 'at' => date(DATE_ATOM, (int)$event['event_epoch'])];
        }, $events->fetchAll(PDO::FETCH_ASSOC));
        $payments = $pdo->prepare('SELECT payment_method, payment_status, amount FROM transactions WHERE order_id = ? ORDER BY txn_id DESC');
        $payments->execute([$orderId]);
        $paymentRows = $payments->fetchAll(PDO::FETCH_ASSOC);
        $pdo->commit();
        return ['id' => (int)$order['order_id'], 'status' => $order['status'], 'total' => $order['total_amount'],
            'placed_at' => date(DATE_ATOM, (int)$order['placed_epoch']), 'expected_date' => $order['estimated_delivery_date'],
            'expected_window' => $order['estimated_delivery_window'], 'events' => $timeline, 'payments' => $paymentRows];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
