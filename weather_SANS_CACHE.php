<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://www.siouxlog.fr');

// Récupère toute la query string brute
$queryString = $_SERVER['QUERY_STRING'] ?? '';
//echo $queryString;
//exit;
if (empty($queryString)) {
    http_response_code(400);
    echo json_encode(["error" => "Query string manquante"]);
    exit;
}

// 🔐 Sécurité : empêcher injection d'URL externe
// On interdit tout ce qui pourrait casser l'URL
if (preg_match('/https?:\/\//i', $queryString)) {
    http_response_code(400);
    echo json_encode(["error" => "Paramètres invalides"]);
    exit;
}

// Construire l'URL finale (on force le domaine)
$baseUrl = "https://api.open-meteo.com/v1/forecast";
$url = $baseUrl . "?" . $queryString;

// cURL
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
]);

$response = curl_exec($ch);

if (curl_errno($ch)) {
    http_response_code(500);
    echo json_encode([
        "error" => "Erreur cURL",
        "details" => curl_error($ch)
    ]);
    curl_close($ch);
    exit;
}

$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpCode);
echo $response;
