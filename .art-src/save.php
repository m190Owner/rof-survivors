<?php
header('Access-Control-Allow-Origin: *');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
$raw = file_get_contents('php://input');
if (strpos($raw, ',') !== false) $raw = substr($raw, strpos($raw, ',') + 1);
file_put_contents(__DIR__ . '/frame.png', base64_decode($raw));
echo 'ok ' . strlen($raw);
