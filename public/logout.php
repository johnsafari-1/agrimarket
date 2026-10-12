<?php
require_once dirname(__DIR__) . '/app/bootstrap.php';
$_SESSION = [];
session_destroy();
header('Location: login.php');
exit;
