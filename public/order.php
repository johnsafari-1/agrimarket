<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
require_once APP_PATH . '/services/order_transitions.php';
require_login();
$page_title = 'Order Details';

$id = (int)($_GET['id'] ?? 0);
$stmt = $pdo->prepare(
    'SELECT o.*, u.full_name AS buyer_name, u.phone AS buyer_phone
     FROM orders o JOIN users u ON u.user_id = o.buyer_id WHERE o.order_id = ?'
);
$stmt->execute([$id]);
$order = $stmt->fetch();

if (!$order) {
    set_flash('warning', 'Order not found.');
    header('Location: index.php');
    exit;
}

// Access control: buyer who owns it, farmer with items in it, or admin.
$stmt = $pdo->prepare(
    'SELECT i.*, p.product_name, p.unit, p.farmer_id, u.full_name AS farmer_name
     FROM order_items i
     JOIN products p ON p.product_id = i.product_id
     JOIN users u ON u.user_id = p.farmer_id
     WHERE i.order_id = ?'
);
$stmt->execute([$id]);
$items = $stmt->fetchAll();

$is_owner  = current_user_id() == $order['buyer_id'];
$is_seller = in_array(current_user_id(), array_column($items, 'farmer_id'));
if (!$is_owner && !$is_seller && current_role() !== 'Admin') {
    set_flash('danger', 'You do not have access to that order.');
    header('Location: index.php');
    exit;
}

// Buyer may cancel while order is still Pending.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'cancel') {
    require_csrf();
    try {
        $changed = current_role() === 'Buyer'
            && transition_order($pdo, $id, (int)current_user_id(), 'Buyer', 'Pending', 'Cancelled');
        set_flash($changed ? 'info' : 'warning', $changed
            ? 'Order cancelled and stock returned to the farmer.'
            : 'This order cannot be cancelled. Its status may have changed; review the latest details.');
    } catch (Throwable $error) {
        error_log('Order cancellation failed: ' . $error->getMessage());
        set_flash('danger', 'The order could not be cancelled. Please try again.');
    }
    header('Location: order.php?id=' . $id);
    exit;
}

// Transaction record(s)
$txn_stmt = $pdo->prepare('SELECT * FROM transactions WHERE order_id = ? ORDER BY txn_id DESC');
$txn_stmt->execute([$id]);
$txns = $txn_stmt->fetchAll();

$statuses = ['Pending', 'Confirmed', 'Shipped', 'Delivered'];
$current_index = array_search($order['status'], $statuses);

$events_stmt = $pdo->prepare('SELECT status, note, UNIX_TIMESTAMP(created_at) AS event_epoch FROM order_events WHERE order_id = ? ORDER BY event_id');
$events_stmt->execute([$id]);
$events = $events_stmt->fetchAll();
include ROOT_PATH . '/resources/views/layout/header.php';
include ROOT_PATH . '/resources/views/orders/show.php';
include ROOT_PATH . '/resources/views/layout/footer.php';
