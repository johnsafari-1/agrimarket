<?php
require_once __DIR__ . '/tracking.php';
/**
 * Change an order and its stock/payment records in one transaction.
 * The order row is locked before checking permissions and the expected status,
 * so duplicate or stale requests cannot repeat cancellation side effects.
 */
function transition_order(
    PDO $pdo,
    int $orderId,
    int $actorId,
    string $actorRole,
    string $expectedStatus,
    string $newStatus,
    ?string $deliveryDate = null,
    ?string $deliveryWindow = null,
    string $note = ''
): bool {
    if ($pdo->inTransaction()) {
        throw new LogicException('Order transitions must own their database transaction.');
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT buyer_id, status FROM orders WHERE order_id = ? FOR UPDATE');
        $stmt->execute([$orderId]);
        $order = $stmt->fetch(PDO::FETCH_ASSOC);

        $allowed = false;
        if ($order && $order['status'] === $expectedStatus) {
            if ($actorRole === 'Buyer') {
                $allowed = (int)$order['buyer_id'] === $actorId
                    && $expectedStatus === 'Pending' && $newStatus === 'Cancelled';
            } elseif ($actorRole === 'Farmer') {
                $transitions = [
                    'Pending' => ['Confirmed', 'Cancelled'],
                    'Confirmed' => ['Shipped', 'Cancelled'],
                    'Shipped' => ['Delivered'],
                ];
                $seller = $pdo->prepare(
                    'SELECT i.item_id FROM order_items i
                     JOIN products p ON p.product_id = i.product_id
                     WHERE i.order_id = ? AND p.farmer_id = ? LIMIT 1'
                );
                $seller->execute([$orderId, $actorId]);
                $allowed = (bool)$seller->fetchColumn()
                    && in_array($newStatus, $transitions[$expectedStatus] ?? [], true);
            }
        }

        if (!$allowed) {
            $pdo->rollBack();
            return false;
        }
        $note = trim($note);
        if (mb_strlen($note) > 500) throw new InvalidArgumentException('Keep delivery updates under 500 characters.');

        if ($newStatus === 'Confirmed') {
            $date = DateTimeImmutable::createFromFormat('!Y-m-d', $deliveryDate ?? '');
            if (!$date || $date->format('Y-m-d') !== $deliveryDate
                || $deliveryDate < date('Y-m-d')
                || !in_array($deliveryWindow, ['Morning', 'Afternoon', 'Evening'], true)) {
                throw new InvalidArgumentException('Give a valid expected delivery date (today or later) and time window before confirming.');
            }
            $pdo->prepare(
                'UPDATE orders SET status = ?, estimated_delivery_date = ?, estimated_delivery_window = ? WHERE order_id = ?'
            )->execute([$newStatus, $deliveryDate, $deliveryWindow, $orderId]);
        } else {
            $pdo->prepare('UPDATE orders SET status = ? WHERE order_id = ?')->execute([$newStatus, $orderId]);
        }

        if ($newStatus === 'Cancelled') {
            // Consistent product order reduces deadlocks between different orders.
            $items = $pdo->prepare(
                'SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id, item_id FOR UPDATE'
            );
            $items->execute([$orderId]);
            $restock = $pdo->prepare('UPDATE products SET quantity = quantity + ? WHERE product_id = ?');
            foreach ($items->fetchAll(PDO::FETCH_ASSOC) as $item) {
                $restock->execute([(int)$item['quantity'], (int)$item['product_id']]);
            }
        } elseif ($newStatus === 'Delivered') {
            // Online payments require their provider result; delivery is not proof of payment.
            $pdo->prepare(
                "UPDATE transactions SET payment_status = 'Completed', paid_at = NOW()
                 WHERE order_id = ? AND payment_status = 'Pending' AND payment_method = 'Cash on Delivery'"
            )->execute([$orderId]);
        }

        $messages = ['Confirmed' => 'Farmer confirmed the order.', 'Shipped' => 'Order dispatched for delivery.',
            'Delivered' => 'Order delivered.', 'Cancelled' => 'Order cancelled.'];
        record_order_event($pdo, $orderId, $newStatus, $actorId, $note !== '' ? $note : $messages[$newStatus]);
        $pdo->commit();
        return true;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
