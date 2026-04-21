<?php
//require_once("connectMySql.php");
//$dbname=connect();
//

header("Content-Type: application/json");

// Connexion DB
$host = "localhost";
$dbname = "ziva";
$user = "sioux";
$pass = "sioux";

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $user, $pass);
} catch (Exception $e) {
    echo json_encode(["success" => false]);
    exit;
}

// Récupérer JSON
$data = json_decode(file_get_contents("php://input"), true);

if (!isset($data["user_id"])) {
    echo json_encode(["success" => false]);
    exit;
}

$userId = $data["user_id"];

// Vérifier existence
$stmt = $pdo->prepare("SELECT id FROM users WHERE identifier = ?");
$stmt->execute([$userId]);

if ($stmt->fetch()) {
    echo json_encode(["success" => true]);
} else {
    echo json_encode(["success" => false]);
}
