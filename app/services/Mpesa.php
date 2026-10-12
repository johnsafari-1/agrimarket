<?php
/**
 * Minimal Safaricom Daraja (M-Pesa) API client.
 * Handles OAuth, Lipa Na M-Pesa Online (STK Push), and the STK query
 * endpoint used to poll a transaction's result without needing a public
 * callback URL reachable from the internet (handy for local XAMPP dev).
 *
 * Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 */
class Mpesa
{
    private static function baseUrl(): string
    {
        return MPESA_ENV === 'production'
            ? 'https://api.safaricom.co.ke'
            : 'https://sandbox.safaricom.co.ke';
    }

    /** Low-level HTTP helper (cURL) so this file has no external dependencies. */
    private static function request(string $method, string $path, array $headers = [], $body = null)
    {
        $ch = curl_init(self::baseUrl() . $path);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 30,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = json_encode($body);
        }
        curl_setopt_array($ch, $opts);
        $response = curl_exec($ch);
        $error    = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            throw new RuntimeException('M-Pesa connection error: ' . $error);
        }
        $decoded = json_decode($response, true);
        return $decoded ?? ['raw' => $response];
    }

    /** Get (and internally re-use for the request lifecycle) an OAuth access token. */
    public static function getAccessToken(): string
    {
        $creds = base64_encode(MPESA_CONSUMER_KEY . ':' . MPESA_CONSUMER_SECRET);
        $res = self::request('GET', '/oauth/v1/generate?grant_type=client_credentials', [
            'Authorization: Basic ' . $creds,
        ]);
        if (empty($res['access_token'])) {
            throw new RuntimeException('Could not get M-Pesa access token: ' . json_encode($res));
        }
        return $res['access_token'];
    }

    /**
     * Initiate an STK Push (the "Lipa Na M-Pesa Online" pop-up on the buyer's phone).
     * @param string $phone      Format 2547XXXXXXXX or 2541XXXXXXXX
     * @param float  $amount
     * @param string $accountRef Shows up as the account reference (e.g. "Order #12")
     * @param string $description Shows up as the transaction description
     * @return array Daraja response, includes CheckoutRequestID / MerchantRequestID on success
     */
    public static function stkPush(string $phone, float $amount, string $accountRef, string $description): array
    {
        $token     = self::getAccessToken();
        $timestamp = date('YmdHis');
        $password  = base64_encode(MPESA_SHORTCODE . MPESA_PASSKEY . $timestamp);

        $body = [
            'BusinessShortCode' => MPESA_SHORTCODE,
            'Password'          => $password,
            'Timestamp'         => $timestamp,
            'TransactionType'   => 'CustomerPayBillOnline',
            'Amount'            => (int)round($amount), // Daraja sandbox requires whole numbers
            'PartyA'            => $phone,
            'PartyB'            => MPESA_SHORTCODE,
            'PhoneNumber'       => $phone,
            'CallBackURL'       => MPESA_CALLBACK_URL,
            'AccountReference'  => substr($accountRef, 0, 12),
            'TransactionDesc'   => substr($description, 0, 13),
        ];

        return self::request('POST', '/mpesa/stkpush/v1/processrequest', [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ], $body);
    }

    /**
     * Query the result of a previously-initiated STK push. Lets us poll for
     * the outcome directly (server-to-Safaricom) instead of relying on the
     * callback reaching this server, which requires a public URL.
     */
    public static function queryStkStatus(string $checkoutRequestId): array
    {
        $token     = self::getAccessToken();
        $timestamp = date('YmdHis');
        $password  = base64_encode(MPESA_SHORTCODE . MPESA_PASSKEY . $timestamp);

        $body = [
            'BusinessShortCode' => MPESA_SHORTCODE,
            'Password'          => $password,
            'Timestamp'         => $timestamp,
            'CheckoutRequestID' => $checkoutRequestId,
        ];

        return self::request('POST', '/mpesa/stkpushquery/v1/query', [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ], $body);
    }
}
