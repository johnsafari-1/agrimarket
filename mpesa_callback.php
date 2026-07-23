<?php
/**
 * Safaricom posts the STK Push result here (see MPESA_CALLBACK_URL in config.php).
 * This must be a publicly reachable HTTPS URL — on local XAMPP, expose it with
 * `ngrok http 80` and put the ngrok URL in config.php. No login/session exists
 * here since Safaricom's servers are calling it, not the buyer's browser.
 *
 * NOTE: mpesa_status.php (used for the in-browser waiting screen) queries
 * Safaricom directly and works even without this callback being reachable,
 * so payments still complete correctly during local development.
 */
require_once __DIR__ . '/config.php';

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

// Always log what we received, for debugging during the university demo.
file_put_contents(__DIR__ . '/mpesa_callback.log', date('c') . ' ' . $raw . PHP_EOL, FILE_APPEND);

$stkCallback = $data['Body']['stkCallback'] ?? null;
if ($stkCallback) {
    $checkoutRequestId = $stkCallback['CheckoutRequestID'] ?? '';
    $resultCode        = $stkCallback['ResultCode'] ?? 1;
    $resultDesc         = $stkCallback['ResultDesc'] ?? '';

    $receipt = null;
    if ($resultCode === 0 && !empty($stkCallback['CallbackMetadata']['Item'])) {
        foreach ($stkCallback['CallbackMetadata']['Item'] as $item) {
            if (($item['Name'] ?? '') === 'MpesaReceiptNumber') {
                $receipt = $item['Value'];
            }
        }
    }

    apply_mpesa_result($pdo, $checkoutRequestId, $resultCode === 0, $resultDesc, $receipt);
}

// Safaricom expects a 200 OK with this exact acknowledgement shape.
header('Content-Type: application/json');
echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
