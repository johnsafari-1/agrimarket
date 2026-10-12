<?php
$page_title = $page_title ?? APP_NAME;
$unread = is_logged_in() ? unread_count($pdo) : 0;
$current_page = basename($_SERVER['SCRIPT_NAME'] ?? 'index.php');
$links = [['index.php', 'Marketplace', 'leaf']];
if (current_role() === 'Buyer') $links = array_merge($links, [['my_orders.php', 'My orders', 'truck'], ['cart.php', 'Shopping cart', 'bag'], ['requests.php', 'Product requests', 'grid'], ['messages.php', 'Messages', 'chat']]);
elseif (current_role() === 'Farmer') $links = array_merge($links, [['farmer_dashboard.php', 'Overview', 'grid'], ['farmer_products.php', 'My products', 'bag'], ['farmer_orders.php', 'Customer orders', 'truck'], ['farmer_requests.php', 'Buyer requests', 'grid'], ['messages.php', 'Messages', 'chat']]);
elseif (current_role() === 'Admin') $links = array_merge($links, [['admin_dashboard.php', 'Overview', 'grid'], ['admin_users.php', 'People', 'users'], ['admin_products.php', 'Products', 'bag'], ['admin_orders.php', 'Orders', 'truck'], ['admin_report.php', 'Reports', 'grid']]);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($page_title) ?> | <?= e(APP_NAME) ?></title>
<link href="assets/app.css" rel="stylesheet">
</head>
<body class="<?= is_logged_in() ? 'signed-in' : 'guest' ?>">
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="app-shell">
<aside class="app-sidebar" id="app-navigation" aria-label="Main navigation"><button type="button" class="sidebar-close" data-close-sidebar aria-label="Close navigation">×</button>
  <a class="brand" href="index.php"><span class="brand-mark"><?= ui_icon('leaf') ?></span><span>agri<span class="brand-light">market</span><small>Fresh connections. Better trade.</small></span></a>
  <div class="nav-caption">YOUR MARKETPLACE</div>
  <nav>
    <?php foreach ($links as [$href, $label, $icon]): ?>
      <a class="sidebar-link <?= $current_page === $href || ($href === 'my_orders.php' && $current_page === 'order.php') ? 'active' : '' ?>" href="<?= e($href) ?>" <?= $current_page === $href ? 'aria-current="page"' : '' ?>>
        <?= ui_icon($icon) ?><span><?= e($label) ?></span>
        <?php if ($href === 'messages.php' && $unread): ?><span class="nav-count"><?= $unread ?></span><?php endif; ?>
      </a>
    <?php endforeach; ?>
  </nav>
  <div class="sidebar-bottom"><span class="status-dot"></span> Grown locally. Traded directly.<p>Prices in Kenyan shillings</p></div>
</aside>
<div class="sidebar-backdrop" data-close-sidebar hidden></div>
<div class="app-workspace">
<header class="app-topbar">
  <div class="topbar-location"><button class="menu-button" type="button" data-toggle-sidebar aria-controls="app-navigation" aria-expanded="false" aria-label="Open navigation">☰</button><span class="topbar-breadcrumb">Marketplace <span>/</span> <strong><?= e($page_title) ?></strong></span></div>
  <div class="topbar-account">
    <?php if (is_logged_in()): ?>
      <span class="account-avatar" aria-hidden="true"><?= e(mb_strtoupper(mb_substr($_SESSION['full_name'], 0, 1))) ?></span><span class="account-details"><?= e($_SESSION['full_name']) ?><small><?= e(current_role()) ?> account</small></span>
      <form method="post" action="logout.php" class="signout-form"><?= csrf_field() ?><button class="text-button" type="submit">Sign out</button></form>
    <?php else: ?><a class="text-button" href="login.php">Sign in</a><a class="btn btn-success" href="login.php?tab=register">Join AgriMarket</a><?php endif; ?>
  </div>
</header>
<main id="main-content" class="app-content">
<?php if ($flash = get_flash()): ?>
  <div class="alert alert-<?= e($flash['type']) ?> alert-dismissible" role="status"><?= e($flash['message']) ?><button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Dismiss message"></button></div>
<?php endif; ?>
