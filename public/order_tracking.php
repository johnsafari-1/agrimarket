<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
require_once APP_PATH . '/services/tracking.php';
header('Content-Type: application/json');
if (!is_logged_in()) { http_response_code(401); echo json_encode(['error' => 'Please sign in again.']); exit; }
if (current_role() !== 'Buyer') { http_response_code(403); echo json_encode(['error' => 'Access denied.']); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { header('Allow: GET'); http_response_code(405); echo json_encode(['error' => 'Method not allowed.']); exit; }
try {
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $snapshot = $id ? buyer_order_tracking($pdo, $id, (int)current_user_id()) : null;
    if (!$snapshot) { http_response_code(404); echo json_encode(['error' => 'Order not found.']); exit; }
    echo json_encode($snapshot, JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    error_log('Order tracking unavailable: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['error' => 'Tracking is temporarily unavailable. Try again shortly.']);
}
