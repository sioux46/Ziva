<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://www.siouxlog.fr');

// 1️⃣ Récupérer la query string
$queryString = $_SERVER['QUERY_STRING'] ?? '';

if (empty($queryString)) {
    http_response_code(400);
    echo json_encode(["error" => "Query string manquante"]);
    exit;
}

// 2️⃣ Sécurité minimale
if (preg_match('/https?:\/\//i', $queryString)) {
    http_response_code(400);
    echo json_encode(["error" => "Paramètres invalides"]);
    exit;
}

// 3️⃣ 🔥 CACHE → AVANT appel API
$cacheKey = md5($queryString);
$cacheDir = __DIR__ . "/cache";
$cacheFile = $cacheDir . "/$cacheKey.json";
$cacheTime = 600; // 10 minutes

// Créer dossier cache si besoin
if (!is_dir($cacheDir)) {
    mkdir($cacheDir, 0755, true);
}

// Si cache valide → on renvoie direct
if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTime) {
    echo file_get_contents($cacheFile);
    exit;
}

// 4️⃣ Construire URL API
$url = "https://api.open-meteo.com/v1/forecast?" . $queryString;

// 5️⃣ Appel API
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

// 6️⃣ Si succès → on sauvegarde le cache
if ($httpCode === 200) {
    file_put_contents($cacheFile, $response);
}

// 7️⃣ Retour réponse
http_response_code($httpCode);
echo $response;
