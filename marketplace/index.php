<?php
require_once __DIR__ . '/config.php';
$page_title = 'Marketplace';

// --- Search, filter, sort (Objective 2) ---
$search   = trim($_GET['q'] ?? '');
$category = $_GET['category'] ?? '';
$sort     = $_GET['sort'] ?? 'newest';

$categories = ['Cereals','Vegetables','Fruits','Dairy','Poultry','Livestock','Tubers','Other'];

$sql = "SELECT p.*, u.full_name AS farmer_name
        FROM products p
        JOIN users u ON u.user_id = p.farmer_id
        WHERE p.status = 'Available' AND p.quantity > 0 AND u.is_active = 1";
$params = [];

if ($search !== '') {
    $sql .= ' AND (p.product_name LIKE ? OR p.description LIKE ?)';
    $params[] = "%$search%";
    $params[] = "%$search%";
}
if (in_array($category, $categories, true)) {
    $sql .= ' AND p.category = ?';
    $params[] = $category;
}
$sql .= match ($sort) {
    'price_asc'  => ' ORDER BY p.price ASC',
    'price_desc' => ' ORDER BY p.price DESC',
    default      => ' ORDER BY p.listed_at DESC',
};

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$products = $stmt->fetchAll();

include __DIR__ . '/header.php';
?>
<div class="hero-banner mb-4">
  <div class="hero-copy">
    <span class="hero-eyebrow">Kenya's farm-direct marketplace</span>
    <h1>Fresh from the farm,<br>straight to <em>you</em>.</h1>
    <p>Farmers list what they've harvested. Buyers order straight from them. No broker in between marking up the price.</p>
    <a href="#browse" class="btn btn-lg hero-cta">Browse the Marketplace</a>
  </div>
  <div class="hero-photo">
    <img src="assets/images/hero-market.jpg" alt="Fresh produce stall at a Kenyan market">
  </div>
</div>

<div class="category-strip mb-4">
  <a href="index.php?category=Vegetables" class="category-card">
    <img src="assets/images/category-vegetables.jpg" alt="Fresh vegetables">
    <span>Shop Vegetables</span>
  </a>
  <a href="index.php?category=Fruits" class="category-card">
    <img src="assets/images/category-fruits.jpg" alt="Fresh fruit stall">
    <span>Shop Fruits</span>
  </a>
</div>

<style>
  .hero-banner{
    display:grid; grid-template-columns:1.1fr 1fr; align-items:stretch;
    background:linear-gradient(120deg,#1B2416,#263320);
    border-radius:1rem; overflow:hidden; min-height:340px;
  }
  .hero-copy{ padding:2.75rem 2.5rem; display:flex; flex-direction:column; justify-content:center; color:#F3EEE0; }
  .hero-eyebrow{
    font-family:'IBM Plex Mono',monospace; font-size:.72rem; letter-spacing:.12em; text-transform:uppercase;
    color:#E3A857; margin-bottom:.9rem; display:block;
  }
  .hero-copy h1{ font-weight:700; font-size:clamp(1.9rem,3vw,2.6rem); line-height:1.12; margin-bottom:1rem; color:#fff; }
  .hero-copy h1 em{ font-style:italic; color:#E3A857; }
  .hero-copy p{ color:#EAE2CC; max-width:36ch; margin-bottom:1.5rem; }
  .hero-cta{
    align-self:flex-start; background:#E3A857; border:none; color:#1B2416; font-weight:600;
  }
  .hero-cta:hover{ background:#cf9645; color:#1B2416; }
  .hero-photo{ position:relative; min-height:260px; }
  .hero-photo img{ width:100%; height:100%; object-fit:cover; display:block; }
  .hero-photo::after{
    content:""; position:absolute; inset:0;
    background:linear-gradient(90deg, rgba(27,36,22,0.55), transparent 35%);
  }
  @media (max-width:820px){
    .hero-banner{ grid-template-columns:1fr; }
    .hero-photo{ min-height:200px; order:-1; }
  }

  .category-strip{ display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  .category-card{
    position:relative; display:block; border-radius:.75rem; overflow:hidden; min-height:150px;
    text-decoration:none;
  }
  .category-card img{ width:100%; height:100%; object-fit:cover; position:absolute; inset:0; transition:transform .25s ease; }
  .category-card:hover img{ transform:scale(1.05); }
  .category-card::before{
    content:""; position:absolute; inset:0; background:linear-gradient(0deg, rgba(27,36,22,0.75), rgba(27,36,22,0.05));
  }
  .category-card span{
    position:absolute; left:1.1rem; bottom:.9rem; color:#fff; font-weight:600; font-size:1.05rem;
    text-shadow:0 1px 4px rgba(0,0,0,.4);
  }
  @media (max-width:600px){ .category-strip{ grid-template-columns:1fr; } }
</style>

<form id="browse" class="row g-2 mb-4" method="get">
  <div class="col-md-5">
    <input type="text" name="q" class="form-control" placeholder="Search products..." value="<?= e($search) ?>">
  </div>
  <div class="col-md-3">
    <select name="category" class="form-select">
      <option value="">All categories</option>
      <?php foreach ($categories as $c): ?>
        <option value="<?= e($c) ?>" <?= $category === $c ? 'selected' : '' ?>><?= e($c) ?></option>
      <?php endforeach; ?>
    </select>
  </div>
  <div class="col-md-2">
    <select name="sort" class="form-select">
      <option value="newest"     <?= $sort === 'newest' ? 'selected' : '' ?>>Newest first</option>
      <option value="price_asc"  <?= $sort === 'price_asc' ? 'selected' : '' ?>>Price: low to high</option>
      <option value="price_desc" <?= $sort === 'price_desc' ? 'selected' : '' ?>>Price: high to low</option>
    </select>
  </div>
  <div class="col-md-2">
    <button class="btn btn-success w-100">Search</button>
  </div>
</form>

<?php if (!$products): ?>
  <div class="alert alert-info">
    No products found. Try a different search or category.
    <?php if (current_role() === 'Buyer' || !is_logged_in()): ?>
      &mdash; or <a href="requests.php">post a request</a> describing exactly what you need and let farmers come to you.
    <?php endif; ?>
  </div>
<?php endif; ?>

<div class="row g-4">
  <?php foreach ($products as $p): ?>
    <div class="col-sm-6 col-md-4 col-lg-3">
      <div class="card card-product h-100 shadow-sm">
        <?php if ($p['image_url']): ?>
          <img src="<?= e($p['image_url']) ?>" class="card-img-top" alt="<?= e($p['product_name']) ?>">
        <?php else: ?>
          <div class="card-img-top d-flex align-items-center justify-content-center bg-light" style="height:180px;">
            <i class="bi bi-image"></i>
          </div>
        <?php endif; ?>
        <div class="card-body d-flex flex-column">
          <span class="badge bg-secondary align-self-start mb-1"><?= e($p['category']) ?></span>
          <h6 class="card-title mb-1"><?= e($p['product_name']) ?></h6>
          <div class="fw-bold text-success"><?= format_money($p['price']) ?> / <?= e($p['unit']) ?></div>
          <div class="small text-muted mb-2">
            <?= (int)$p['quantity'] ?> <?= e($p['unit']) ?> available &middot; by <?= e($p['farmer_name']) ?>
          </div>
          <a href="product.php?id=<?= (int)$p['product_id'] ?>" class="btn btn-outline-success btn-sm mt-auto">View Details</a>
        </div>
      </div>
    </div>
  <?php endforeach; ?>
</div>
<?php include __DIR__ . '/footer.php'; ?>
