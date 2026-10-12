<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
require_login('Buyer');
$page_title = 'My orders';
$buyerId = (int)current_user_id();
$filter = is_string($_GET['status'] ?? null) ? $_GET['status'] : '';
$statuses = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];
if (!in_array($filter, $statuses, true)) $filter = '';
$page = max(1, (int)($_GET['page'] ?? 1));
$counts = $pdo->prepare('SELECT status, COUNT(*) AS count FROM orders WHERE buyer_id = ? GROUP BY status');
$counts->execute([$buyerId]);
$summary = array_fill_keys($statuses, 0);
foreach ($counts->fetchAll() as $count) $summary[$count['status']] = (int)$count['count'];
$total = $filter === '' ? array_sum($summary) : $summary[$filter];
$pages = max(1, (int)ceil($total / 12));
$page = min($page, $pages);
$where = 'o.buyer_id = ?' . ($filter !== '' ? ' AND o.status = ?' : '');
$params = $filter !== '' ? [$buyerId, $filter] : [$buyerId];
$stmt = $pdo->prepare('SELECT o.*, (SELECT GROUP_CONCAT(p.product_name SEPARATOR ", ") FROM order_items i JOIN products p ON p.product_id=i.product_id WHERE i.order_id=o.order_id) AS products,
    (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.order_id) AS item_count,
    (SELECT payment_status FROM transactions t WHERE t.order_id=o.order_id ORDER BY txn_id DESC LIMIT 1) AS payment_status
    FROM orders o WHERE ' . $where . ' ORDER BY o.order_date DESC, o.order_id DESC LIMIT 12 OFFSET ' . (($page - 1) * 12));
$stmt->execute($params);
$orders = $stmt->fetchAll();
include ROOT_PATH . '/resources/views/layout/header.php';
?>
<div class="page-heading"><div><span class="eyebrow">YOUR PURCHASES, IN ONE PLACE</span><h1>My orders</h1><p>Follow your produce from the farm to your doorstep.</p></div><a class="btn btn-success" href="index.php">Shop produce</a></div>
<div class="stats-grid"><div class="stat-tile"><span>On the way &amp; in progress</span><strong><?= $summary['Pending'] + $summary['Confirmed'] + $summary['Shipped'] ?></strong><small>Orders being fulfilled</small></div><div class="stat-tile"><span>Delivered</span><strong><?= $summary['Delivered'] ?></strong><small>Completed deliveries</small></div><div class="stat-tile"><span>Total orders</span><strong><?= array_sum($summary) ?></strong><small>All your purchases</small></div></div>
<nav class="filter-tabs" aria-label="Filter orders"><a href="my_orders.php" class="<?= $filter === '' ? 'active' : '' ?>">All orders</a><?php foreach ($statuses as $status): ?><a href="my_orders.php?status=<?= e($status) ?>" class="<?= $filter === $status ? 'active' : '' ?>"><?= e($status) ?> <small><?= $summary[$status] ?></small></a><?php endforeach; ?></nav>
<?php if (!$orders): ?><div class="empty-state"><?= ui_icon('bag') ?><h2><?= $filter ? 'No ' . e(strtolower($filter)) . ' orders yet.' : 'Your next fresh delivery starts here.' ?></h2><p>Explore local listings and place your first order.</p><a class="btn btn-success" href="index.php">Browse the marketplace</a></div>
<?php else: ?><div class="order-list"><?php foreach ($orders as $order): ?><article class="order-list-card"><div><div class="d-flex gap-2 align-items-center"><h2>Order #<?= (int)$order['order_id'] ?></h2><?= status_badge($order['status']) ?></div><p><?= e($order['products'] ?: 'Product details unavailable') ?></p><div class="order-list-meta"><span><?= e(date('d M Y', strtotime($order['order_date']))) ?></span><span><?= (int)$order['item_count'] ?> item(s)</span><span><?= $order['estimated_delivery_date'] ? 'Expected ' . e(date('d M', strtotime($order['estimated_delivery_date']))) : 'Delivery date pending' ?></span></div></div><div class="order-list-actions"><div><strong><?= format_money($order['total_amount']) ?></strong><small>Payment: <?= e($order['payment_status'] ?? 'Not recorded') ?></small></div><a class="btn btn-outline-success" href="order.php?id=<?= (int)$order['order_id'] ?>">Track order →</a></div></article><?php endforeach; ?></div><div class="pagination"><span>Page <?= $page ?> of <?= $pages ?> · <?= $total ?> orders</span><div><?php if ($page > 1): ?><a class="btn btn-outline-success" href="my_orders.php?status=<?= e($filter) ?>&amp;page=<?= $page - 1 ?>">Previous</a><?php endif; ?><?php if ($page < $pages): ?><a class="btn btn-outline-success" href="my_orders.php?status=<?= e($filter) ?>&amp;page=<?= $page + 1 ?>">Next</a><?php endif; ?></div></div><?php endif; ?>
<?php include ROOT_PATH . '/resources/views/layout/footer.php'; ?>
