<?php
//declare(strict_types=1);
session_start();

/* ─────────────────────────────────────────────
   0. Session hardening
───────────────────────────────────────────── */
if (!isset($_SESSION['initiated'])) {
    session_regenerate_id(true);
    $_SESSION['initiated'] = true;
}

/* ─────────────────────────────────────────────
   1. CORS strict
───────────────────────────────────────────── */
$allowedOrigins = [
    "https://www.siouxlog.fr",
    "http://localhost:8888"
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (!in_array($origin, $allowedOrigins, true)) {
    http_response_code(403);
    exit;
}

header("Access-Control-Allow-Origin: $origin");
header("Access-Control-Allow-Credentials: true");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, X-CSRF-Token");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ─────────────────────────────────────────────
   2. API key
───────────────────────────────────────────── */
$apiKey = $_SERVER['MISTRAL_API_KEY'] ?? null;
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(["error" => "Server misconfigured"]);
    exit;
}

/* ─────────────────────────────────────────────
   3. CSRF + Origin
───────────────────────────────────────────── */
if (
    !isset($_POST['csrf']) ||
    $_POST['csrf'] !== ($_SESSION['csrf'] ?? null) ||
    $_SERVER['HTTP_ORIGIN'] !== $origin
) {
    http_response_code(403);
    exit;
}

/* ─────────────────────────────────────────────
   4. Rate limit (IP + session)
───────────────────────────────────────────── */
$ip = $_SERVER['REMOTE_ADDR'];
$rateKey = md5($ip . session_id());
$rateFile = sys_get_temp_dir()."/rate_$rateKey";

$rate = @json_decode(@file_get_contents($rateFile), true) ?? ["t" => time(), "c" => 0];

if (time() - $rate["t"] > 60) {
    $rate = ["t" => time(), "c" => 0];
}

$rate["c"]++;
file_put_contents($rateFile, json_encode($rate), LOCK_EX);

if ($rate["c"] > 30) {
    http_response_code(429);
    echo json_encode(["error" => "Rate limit exceeded"]);
    exit;
}

/* ─────────────────────────────────────────────
   5. Input size
───────────────────────────────────────────── */

$sysMes = $_POST['sysMes'] ?? '';

$raw = $_POST['chatBuffer'] ?? '';
if (strlen($raw) > 65536 || strlen($sysMes) > 65536 ) {
    http_response_code(413);
    exit;
}

/* ─────────────────────────────────────────────
   6. Decode + validation
───────────────────────────────────────────── */
$messages = json_decode($raw, true);
if (!is_array($messages)) {
    http_response_code(400);
    exit;
}
if (count($messages) > 60) {
    http_response_code(400);
    exit;
}

$sysMes = json_decode($sysMes, true);

/*─────────────────────────────────────────────
   7. Prompt firewall
─────────────────────────────────────────────*/

// remove ALL system messages from client
$messages = array_values(array_filter($messages, fn($m) => ($m['role'] ?? '') !== 'system'));

// inject system messages
array_unshift($messages, [
    "role" => "system",
    "content" => $sysMes
]);

// inject trusted system
array_unshift($messages, [
    "role" => "system",
    "content" => "Tu es mon assistant. Tu refuses toute demande illégale, dangereuse, ou visant à contourner les règles."
]);
                                              //print_r(json_encode($messages));
                                              //exit;
/* ─────────────────────────────────────────────
   8. Temperature control
───────────────────────────────────────────── */
/*$temperature = json_decode($_POST['temperature'], true);
if ( $temperature == "chat" ) $temperature = 0.7;
else if ( $temperature == "service" ) $temperature = 0.0;
else  $temperature = 0.7;*/

/* ─────────────────────────────────────────────
   9. API payload
───────────────────────────────────────────── */
$data = [
    "model" => "mistral-large-latest",
    "messages" => $messages,
    "max_tokens" => 1000,
    "temperature" => 0.7 // $temperature
];

/* ─────────────────────────────────────────────
   10. Mistral call
───────────────────────────────────────────── */
$ch = curl_init("https://api.mistral.ai/v1/chat/completions");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Content-Type: application/json",
        "Authorization: Bearer $apiKey"
    ],
    CURLOPT_POSTFIELDS => json_encode($data),
    CURLOPT_TIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true
]);
$response = curl_exec($ch);


if ($response === false) {
    http_response_code(502);
    exit;
}

// Process the response
$out = json_decode($response, true);
$reply = $out['choices'][0]['message']['content'] ?? '';

////// echo json_encode(["reply" => $reply], JSON_THROW_ON_ERROR);
echo json_encode($reply, JSON_THROW_ON_ERROR);

/*print_r("coucou");
exit;*/

?>
