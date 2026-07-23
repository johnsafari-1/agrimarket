<?php
require_once __DIR__ . '/config.php';
require_login('Buyer');
$page_title = 'My Requests';
$bid = current_user_id();

$categories = ['Cereals','Vegetables','Fruits','Dairy','Poultry','Livestock','Tubers','Other'];
$errors = [];
$new_matches = [];
$new_request_id = null;

// --- Search existing listings for anything that resembles the description ---
function find_matches(PDO $pdo, string $title, string $description, string $category): array {
    $words = preg_split('/[^\p{L}\p{N}]+/u', $title . ' ' . $description, -1, PREG_SPLIT_NO_EMPTY);
    $words = array_slice(array_unique(array_filter($words, fn($w) => mb_strlen($w) >= 3)), 0, 6);

    $sql = "SELECT p.*, u.full_name AS farmer_name
            FROM products p JOIN users u ON u.user_id = p.farmer_id
            WHERE p.status = 'Available' AND p.quantity > 0 AND u.is_active = 1";
    $params = [];

    $clauses = [];
    if ($category !== '' && in_array($category, ['Cereals','Vegetables','Fruits','Dairy','Poultry','Livestock','Tubers','Other'], true)) {
        $clauses[] = 'p.category = ?';
        $params[] = $category;
    }
    if ($words) {
        $word_clauses = [];
        foreach ($words as $w) {
            $word_clauses[] = '(p.product_name LIKE ? OR p.description LIKE ?)';
            $params[] = "%$w%";
            $params[] = "%$w%";
        }
        $clauses[] = '(' . implode(' OR ', $word_clauses) . ')';
    }
    if ($clauses) {
        $sql .= ' AND (' . implode(' AND ', $clauses) . ')';
    } elseif (!$words) {
        return []; // nothing meaningful to match on
    }
    $sql .= ' ORDER BY (p.category = ' . ($category !== '' ? '?' : "'\\0'") . ') DESC, p.listed_at DESC LIMIT 6';
    if ($category !== '') $params[] = $category;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

// --- Create a new request ---
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'create') {
    $title       = trim($_POST['title'] ?? '');
    $description = trim($_POST['description'] ?? '');
    $category    = $_POST['category'] ?? 'Other';
    $quantity    = max(1, (int)($_POST['quantity'] ?? 1));
    $unit        = trim($_POST['unit'] ?? 'kg') ?: 'kg';
    $budget_max  = trim($_POST['budget_max'] ?? '');
    $budget_max  = $budget_max === '' ? null : max(0, (float)$budget_max);

    if ($title === '')                     $errors[] = 'Give your request a short title.';
    if (mb_strlen($description) < 10)      $errors[] = 'Describe what you need in a bit more detail (at least 10 characters).';
    if (!in_array($category, $categories, true)) $category = 'Other';

    if (!$errors) {
        $stmt = $pdo->prepare(
            'INSERT INTO product_requests (buyer_id, title, description, category, quantity, unit, budget_max)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$bid, $title, $description, $category, $quantity, $unit, $budget_max]);
        $new_request_id = (int)$pdo->lastInsertId();
        $new_matches = find_matches($pdo, $title, $description, $category);
        set_flash('success', 'Your request has been posted. Farmers can now see it and respond' .
            ($new_matches ? ', and we found some listings that might already match below.' : '.'));
    }
}

// --- Accept an offer ---
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'accept_offer') {
    $offer_id = (int)($_POST['offer_id'] ?? 0);
    $stmt = $pdo->prepare(
        'SELECT ro.*, pr.buyer_id, pr.quantity AS req_qty
         FROM request_offers ro JOIN product_requests pr ON pr.request_id = ro.request_id
         WHERE ro.offer_id = ? AND pr.buyer_id = ?'
    );
    $stmt->execute([$offer_id, $bid]);
    $offer = $stmt->fetch();

    if ($offer && $offer['status'] === 'Pending') {
        $pdo->beginTransaction();
        $pdo->prepare("UPDATE request_offers SET status = 'Accepted' WHERE offer_id = ?")->execute([$offer_id]);
        $pdo->prepare("UPDATE request_offers SET status = 'Declined' WHERE request_id = ? AND offer_id != ?")
            ->execute([$offer['request_id'], $offer_id]);
        $pdo->prepare("UPDATE product_requests SET status = 'Fulfilled' WHERE request_id = ?")
            ->execute([$offer['request_id']]);
        $pdo->commit();

        if ($offer['product_id']) {
            // Linked to a real listing: drop it in the cart at the requested quantity, ready to check out.
            $stmt = $pdo->prepare("SELECT quantity FROM products WHERE product_id = ? AND status = 'Available'");
            $stmt->execute([$offer['product_id']]);
            $p = $stmt->fetch();
            if ($p) {
                $_SESSION['cart'] = $_SESSION['cart'] ?? [];
                $_SESSION['cart'][$offer['product_id']]['quantity'] = min((int)$offer['req_qty'], (int)$p['quantity']);
                set_flash('success', 'Offer accepted! The matching product has been added to your cart — proceed to checkout when ready.');
                header('Location: cart.php');
                exit;
            }
        }
        set_flash('success', 'Offer accepted! Message the farmer to arrange payment and delivery.');
        header('Location: messages.php?to=' . (int)$offer['farmer_id']);
        exit;
    }
    set_flash('warning', 'That offer is no longer available.');
    header('Location: requests.php');
    exit;
}

// --- My requests + their offers ---
$stmt = $pdo->prepare('SELECT * FROM product_requests WHERE buyer_id = ? ORDER BY created_at DESC');
$stmt->execute([$bid]);
$my_requests = $stmt->fetchAll();

$offers_by_request = [];
if ($my_requests) {
    $ids = array_column($my_requests, 'request_id');
    $in  = implode(',', array_map('intval', $ids));
    $rows = $pdo->query(
        "SELECT ro.*, u.full_name AS farmer_name, u.phone AS farmer_phone, p.product_name, p.image_url
         FROM request_offers ro
         JOIN users u ON u.user_id = ro.farmer_id
         LEFT JOIN products p ON p.product_id = ro.product_id
         WHERE ro.request_id IN ($in)
         ORDER BY ro.created_at ASC"
    )->fetchAll();
    foreach ($rows as $r) {
        $offers_by_request[$r['request_id']][] = $r;
    }
}

include __DIR__ . '/header.php';
?>
<h3 class="mb-1"><i class="bi bi-search-heart"></i> Can't find what you need?</h3>
<p class="text-muted">Describe the product you're looking for. We'll check current listings straight away, and farmers can
  respond directly with an offer.</p>

<div class="row g-4">
  <div class="col-md-5">
    <div class="card shadow-sm">
      <div class="card-header bg-white fw-bold">Post a Request</div>
      <div class="card-body">
        <?php foreach ($errors as $err): ?>
          <div class="alert alert-danger py-2"><?= e($err) ?></div>
        <?php endforeach; ?>
        <form method="post">
          <input type="hidden" name="action" value="create">
          <div class="mb-3">
            <label class="form-label">Title</label>
            <input type="text" name="title" class="form-control" required
                   placeholder="e.g. Need 2 bags of dry maize"
                   value="<?= e($_POST['title'] ?? '') ?>">
          </div>
          <div class="mb-3">
            <label class="form-label">Describe exactly what you need</label>
            <textarea name="description" class="form-control" rows="4" required
              placeholder="Variety, quality, quantity, when and where you need it delivered..."><?= e($_POST['description'] ?? '') ?></textarea>
          </div>
          <div class="row g-2">
            <div class="col-6">
              <label class="form-label">Category</label>
              <select name="category" class="form-select">
                <?php foreach ($categories as $c): ?>
                  <option value="<?= e($c) ?>" <?= ($_POST['category'] ?? '') === $c ? 'selected' : '' ?>><?= e($c) ?></option>
                <?php endforeach; ?>
              </select>
            </div>
            <div class="col-3">
              <label class="form-label">Qty</label>
              <input type="number" name="quantity" class="form-control" min="1" value="<?= e($_POST['quantity'] ?? 1) ?>">
            </div>
            <div class="col-3">
              <label class="form-label">Unit</label>
              <input type="text" name="unit" class="form-control" value="<?= e($_POST['unit'] ?? 'kg') ?>">
            </div>
          </div>
          <div class="mb-3 mt-2">
            <label class="form-label">Max budget (optional)</label>
            <input type="number" step="0.01" name="budget_max" class="form-control" placeholder="KES"
                   value="<?= e($_POST['budget_max'] ?? '') ?>">
          </div>
          <button class="btn btn-success w-100"><i class="bi bi-send"></i> Post Request</button>
        </form>
      </div>
    </div>

    <?php if ($new_request_id && $new_matches): ?>
      <div class="card shadow-sm mt-3">
        <div class="card-header bg-white fw-bold">Already in the marketplace</div>
        <ul class="list-group list-group-flush">
          <?php foreach ($new_matches as $m): ?>
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <span><?= e($m['product_name']) ?> &mdash; <?= format_money($m['price']) ?> / <?= e($m['unit']) ?>
                <small class="text-muted d-block">by <?= e($m['farmer_name']) ?>, <?= (int)$m['quantity'] ?> <?= e($m['unit']) ?> available</small></span>
              <a class="btn btn-sm btn-outline-success" href="product.php?id=<?= (int)$m['product_id'] ?>">View</a>
            </li>
          <?php endforeach; ?>
        </ul>
      </div>
    <?php endif; ?>
  </div>

  <div class="col-md-7">
    <h5 class="mb-3">My Requests</h5>
    <?php if (!$my_requests): ?>
      <div class="alert alert-info">You haven't posted any requests yet.</div>
    <?php endif; ?>
    <?php foreach ($my_requests as $r): $offers = $offers_by_request[$r['request_id']] ?? []; ?>
      <div class="card shadow-sm mb-3">
        <div class="card-header bg-white d-flex justify-content-between align-items-center">
          <div>
            <strong><?= e($r['title']) ?></strong>
            <span class="badge bg-secondary ms-1"><?= e($r['category']) ?></span>
          </div>
          <span class="badge bg-<?= $r['status'] === 'Open' ? 'warning' : ($r['status'] === 'Fulfilled' ? 'success' : 'secondary') ?>">
            <?= e($r['status']) ?></span>
        </div>
        <div class="card-body">
          <p class="mb-1"><?= nl2br(e($r['description'])) ?></p>
          <p class="small text-muted mb-2">
            Wants <?= (int)$r['quantity'] ?> <?= e($r['unit']) ?>
            <?php if ($r['budget_max']): ?> &middot; budget up to <?= format_money($r['budget_max']) ?><?php endif; ?>
            &middot; posted <?= e(date('d M Y', strtotime($r['created_at']))) ?>
          </p>
          <?php if (!$offers): ?>
            <div class="text-muted small">No offers yet &mdash; farmers will see this on their requests board.</div>
          <?php else: ?>
            <div class="table-responsive">
              <table class="table table-sm align-middle mb-0">
                <thead><tr><th>Farmer</th><th>Offer</th><th>Price</th><th>Status</th><th></th></tr></thead>
                <tbody>
                <?php foreach ($offers as $o): ?>
                  <tr>
                    <td><?= e($o['farmer_name']) ?></td>
                    <td><?= e($o['product_name'] ?? $o['message']) ?>
                      <?php if ($o['product_name']): ?><div class="small text-muted"><?= e($o['message']) ?></div><?php endif; ?></td>
                    <td><?= format_money($o['price']) ?></td>
                    <td><span class="badge bg-<?= $o['status'] === 'Accepted' ? 'success' : ($o['status'] === 'Declined' ? 'secondary' : 'warning') ?>">
                      <?= e($o['status']) ?></span></td>
                    <td>
                      <?php if ($o['status'] === 'Pending' && $r['status'] === 'Open'): ?>
                        <form method="post" onsubmit="return confirm('Accept this offer? Other offers will be declined.');">
                          <input type="hidden" name="action" value="accept_offer">
                          <input type="hidden" name="offer_id" value="<?= (int)$o['offer_id'] ?>">
                          <button class="btn btn-sm btn-success">Accept</button>
                        </form>
                      <?php elseif ($o['status'] === 'Accepted'): ?>
                        <a class="btn btn-sm btn-outline-primary" href="messages.php?to=<?= (int)$o['farmer_id'] ?>">Message</a>
                      <?php endif; ?>
                    </td>
                  </tr>
                <?php endforeach; ?>
                </tbody>
              </table>
            </div>
          <?php endif; ?>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
</div>
<?php include __DIR__ . '/footer.php'; ?>
