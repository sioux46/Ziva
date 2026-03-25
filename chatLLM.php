<?php
// declare(strict_types=1);
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

session_start();
require_once("sysMesDeva.php");

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
header("Cache-Control: no-cache");
header("X-Accel-Buffering: no");
header("Content-Type: application/json; charset=utf-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    echo json_encode(["error" => "Tentative de piratage !!!"]);
    exit;
}

/* ─────────────────────────────────────────────
   2. API key
───────────────────────────────────────────── */
$apiKey = $_SERVER['MISTRAL_API_KEY'] ?? null;
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(["error" => "MISTRAL_API_KEY missing"]);
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
    echo json_encode(["error" => "CSRF + Origin problem"]);
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

$raw = $_POST['chatBuffer'] ?? '';
if ( strlen($raw) > 65536 ) { // || strlen($sysMes) > 65536 ) {
    http_response_code(413);
    echo json_encode(["error" => "Size limit exceeded"]);
    exit;
}

/* ─────────────────────────────────────────────
   6. Decode + validation
───────────────────────────────────────────── */
$messages = json_decode($raw, true);

$messages = array_values(array_filter($messages, function($m){
    if (!isset($m["role"], $m["content"])) return false;

    // sécurité: on refuse tout assistant vide ou incohérent
    if ($m["role"] === "assistant") {
        $t = trim($m["content"]);

        if ($t === "") return false;

        // coupe les fins incomplètes (phrase ouverte)
        if (preg_match('/[a-zA-ZÀ-ÿ]$/u', $t)) {
            // pas de ponctuation finale → phrase probablement coupée
            return false;
        }
    }

    return true;
}));

if (!is_array($messages)) {
    http_response_code(400);
    exit;
}
if (count($messages) > 60) {
    http_response_code(400);
    exit;
}

/*─────────────────────────────────────────────
   7. Prompt firewall
─────────────────────────────────────────────*/

/*// remove ALL system messages from client
$messages = array_values(array_filter($messages, function ($m) {
    return !isset($m['role']) || $m['role'] !== 'system';
}));*/
//        retourne les messages system à injecter
$sysMes = sysMessages(
    json_decode($_POST['localisation'],true),
    json_decode($_POST['origine'],true)
);


// inject system messages au début
array_unshift($messages, [
    "role" => "system",
    "content" => $sysMes
]);

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
if ( $origine == "sysM" ) $model = "mistral-small-latest";
else $model = "mistral-large-latest";
$data = [
    "model" => $model,
    "messages" => $messages,
    "stream" => true,
    "max_tokens" => 500, // 1000
    "temperature" => 0.7, // $temperature
];

/* ─────────────────────────────────────────────
   10. Mistral call
───────────────────────────────────────────── */
@ini_set('output_buffering','off');
@ini_set('zlib.output_compression',false);
@ini_set('implicit_flush',true);
while (ob_get_level()) ob_end_flush();
ob_implicit_flush(true);

$ch = curl_init("https://api.mistral.ai/v1/chat/completions");
curl_setopt_array($ch, [
    // CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Content-Type: application/json",
        "Authorization: Bearer $apiKey"
    ],
    CURLOPT_POSTFIELDS => json_encode($data),
    CURLOPT_TIMEOUT => 120,
    // CURLOPT_SSL_VERIFYPEER => true
    CURLOPT_WRITEFUNCTION=>function($ch,$chunk){
      echo $chunk;
      flush();
      return strlen($chunk);
    }
]);

curl_exec($ch);
curl_close($ch);
exit;
//-----------------------------------------------------
/*print_r("coucou");
exit;*/
//-----------------------------------------------------

?>
