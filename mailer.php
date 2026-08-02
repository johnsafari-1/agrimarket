<?php
require_once __DIR__ . '/PHPMailer/src/Exception.php';
require_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/src/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as PHPMailerException;

function send_email(string $toEmail, string $toName, string $subject, string $htmlBody, string $altBody): bool {
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host          = SMTP_HOST;
        $mail->SMTPAuth      = true;
        $mail->Username      = SMTP_USER;
        $mail->Password      = SMTP_PASS;
        $mail->SMTPSecure    = (defined('SMTP_SECURE') && SMTP_SECURE === 'tls')
            ? PHPMailer::ENCRYPTION_STARTTLS
            : PHPMailer::ENCRYPTION_SMTPS;
        $mail->Port          = SMTP_PORT;
        $mail->Timeout       = 10;
        $mail->SMTPKeepAlive = false;

        $mail->setFrom(SMTP_USER, APP_NAME);
        $mail->addAddress($toEmail, $toName);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $htmlBody;
        $mail->AltBody = $altBody;

        $mail->send();
        return true;
    } catch (PHPMailerException $e) {
        error_log('Email send failed to ' . $toEmail . ': ' . $mail->ErrorInfo);
        return false;
    }
}

function send_verification_email(string $toEmail, string $toName, string $token): bool {
    $link = rtrim(SITE_URL, '/') . '/verify.php?token=' . urlencode($token);

    $html = '
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color:#2e5339;">' . e(APP_NAME) . '</h2>
        <p>Hi ' . e($toName) . ',</p>
        <p>Thanks for signing up. Click the button below to verify your email address and activate your account:</p>
        <p style="text-align:center; margin: 24px 0;">
          <a href="' . e($link) . '" style="background:#2e5339;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Verify my account
          </a>
        </p>
        <p>Or copy this link into your browser:<br><a href="' . e($link) . '">' . e($link) . '</a></p>
        <p style="color:#888;font-size:12px;">If you did not create this account, you can ignore this email.</p>
      </div>';

    $alt = "Verify your {$toEmail} account: {$link}";

    return send_email($toEmail, $toName, 'Verify your ' . APP_NAME . ' account', $html, $alt);
}

function send_password_reset_email(string $toEmail, string $toName, string $token): bool {
    $link = rtrim(SITE_URL, '/') . '/reset_password.php?token=' . urlencode($token);

    $html = '
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color:#2e5339;">' . e(APP_NAME) . '</h2>
        <p>Hi ' . e($toName) . ',</p>
        <p>We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
        <p style="text-align:center; margin: 24px 0;">
          <a href="' . e($link) . '" style="background:#2e5339;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Reset my password
          </a>
        </p>
        <p>Or copy this link into your browser:<br><a href="' . e($link) . '">' . e($link) . '</a></p>
        <p style="color:#888;font-size:12px;">If you did not request this, you can safely ignore this email — your password will not change.</p>
      </div>';

    $alt = "Reset your {$toEmail} password: {$link} (expires in 1 hour)";

    return send_email($toEmail, $toName, 'Reset your ' . APP_NAME . ' password', $html, $alt);
}
