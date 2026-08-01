<?php
require_once __DIR__ . '/config.php';
require_login('Farmer');
$page_title = 'Buyer Requests';
$fid = current_user_id();

$errors = [];

// --- Submit an offer ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $request_id = (int)($_POST['request_id'] ?? 0);
    $product_id = (int)($_POST['product_id'] ?? 0) ?: null;
    $message    = trim($_POST['message'] ?? '');
    $price      = (float)($_POST['price'] ?? 0);

    $stmt = $pdo->prepare("SELECT * FROM product_requests WHERE request_id = ? AND status = 'Open'");
    $stmt->execute([$request_id]);
    $req = $stmt->fetch();

    if (!$req) {
        $errors[] = 'That request is no longer open.';
    } elseif ($message === '' || $price <= 0) {
        $errors[] = 'Give a short message and a price to offer.';
    } else {
        if ($product_id) {
            // Make sure the selected product really belongs to this farmer
            $chk = $pdo->prepare('SELECT product_id FROM products WHERE product_id = ? AND farmer_id = ?');
            $chk->execute([$product_id, $fid]);
            if (!$chk->fetch()) $product_id = null;
        }
        $pdo->prepare(
            'INSERT INTO request_offers (request_id, farmer_id, product_id, message, price) VALUES (?, ?, ?, ?, ?)'
        )->execute([$request_id, $fid, $product_id, $message, $price]);
        set_flash('success', 'Your offer has been sent to the buyer.');
        header('Location: farmer_requests.php');
        exit;
    }
}

// --- Open requests board ---
$stmt = $pdo->query(
    "SELECT pr.*, u.full_name AS buyer_name
     FROM product_requests pr JOIN users u ON u.user_id = pr.buyer_id
     WHERE pr.status = 'Open'
     ORDER BY pr.created_at DESC"
);
$open_requests = $stmt->fetchAll();

// Which of these have I already offered on?
$my_offer_request_ids = [];
if ($open_requests) {
    $ids = implode(',', array_map(fn($r) => (int)$r['request_id'], $open_requests));
    $rows = $pdo->prepare(
        "SELECT request_id, status FROM request_offers WHERE farmer_id = ? AND request_id IN ($ids)"
    );
    $rows->execute([$fid]);
    foreach ($rows->fetchAll() as $r) $my_offer_request_ids[$r['request_id']] = $r['status'];
}

// My own products, for the "link a listing" dropdown
$stmt = $pdo->prepare("SELECT product_id, product_name, price, unit FROM products WHERE farmer_id = ? AND status = 'Available' ORDER BY product_name");
$stmt->execute([$fid]);
$my_products = $stmt->fetchAll();

include __DIR__ . '/header.php';
?>
<h3 class="mb-1"><i class="bi bi-clipboard-heart"></i> Buyer Requests</h3>
<p class="text-muted">Buyers who couldn't find what they wanted post here. Offer a price and, if you have a matching
  listing, link it so the buyer can add it straight to their cart.</p>

<?php foreach ($errors as $err): ?>
  <div class="alert alert-danger py-2"><?= e($err) ?></div>
<?php endforeach; ?>

<?php if (!$open_requests): ?>
  <div class="alert alert-info">No open requests right now.</div>
<?php endif; ?>

<div class="row g-4">
  <?php foreach ($open_requests as $r): $mine = $my_offer_request_ids[$r['request_id']] ?? null; ?>
    <div class="col-md-6">
      <div class="card shadow-sm h-100">
        <div class="card-header bg-white d-flex justify-content-between align-items-center">
          <strong><?= e($r['title']) ?></strong>
          <span class="badge bg-secondary"><?= e($r['category']) ?></span>
        </div>
        <div class="card-body d-flex flex-column">
          <p><?= nl2br(e($r['description'])) ?></p>
          <p class="small text-muted">
            Wants <?= (int)$r['quantity'] ?> <?= e($r['unit']) ?>
            <?php if ($r['budget_max']): ?> &middot; budget up to <?= format_money($r['budget_max']) ?><?php endif; ?>
            &middot; by <?= e($r['buyer_name']) ?> &middot; <?= e(date('d M Y', strtotime($r['created_at']))) ?>
          </p>

          <?php if ($mine): ?>
            <div class="mt-auto alert alert-<?= $mine === 'Accepted' ? 'success' : ($mine === 'Declined' ? 'secondary' : 'info') ?> py-2 mb-0">
              You already offered on this &mdash; status: <?= e($mine) ?>
            </div>
          <?php else: ?>
            <form method="post" class="mt-auto pt-2 border-top">
              <?= csrf_field() ?>
              <input type="hidden" name="request_id" value="<?= (int)$r['request_id'] ?>">
              <?php if ($my_products): ?>
                <div class="mb-2">
                  <label class="form-label small mb-1">Link one of your listings (optional)</label>
                  <select name="product_id" class="form-select form-select-sm">
                    <option value="">&mdash; No specific listing &mdash;</option>
                    <?php foreach ($my_products as $p): ?>
                      <option value="<?= (int)$p['product_id'] ?>"><?= e($p['product_name']) ?> (<?= format_money($p['price']) ?>/<?= e($p['unit']) ?>)</option>
                    <?php endforeach; ?>
                  </select>
                </div>
              <?php endif; ?>
              <div class="row g-2">
                <div class="col-8">
                  <input type="text" name="message" class="form-control form-control-sm" placeholder="Short message to the buyer" required>
                </div>
                <div class="col-4">
                  <input type="number" step="0.01" name="price" class="form-control form-control-sm" placeholder="Price (KES)" required>
                </div>
              </div>
              <button class="btn btn-sm btn-success w-100 mt-2"><i class="bi bi-send"></i> Send Offer</button>
            </form>
          <?php endif; ?>
        </div>
      </div>
    </div>
  <?php endforeach; ?>
</div>
<?php include __DIR__ . '/footer.php'; ?>
