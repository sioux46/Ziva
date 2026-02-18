
<?php
session_start();

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}
?>
<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="csrf-token" content="<?= $_SESSION['csrf'] ?>">
    <meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <!-- <meta name="viewport" content="width=device-width, initial-scale=1"> -->
    <title>ZIVA</title>
<!-- ====== Bootstrap link ====== -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-rbsA2VBKQhggwzxH7pPCaAqO46MgnOM80zW1RWuH61DGLwZJEdK2Kadq2F9CUG65" crossorigin="anonymous">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css">
<!-- jQuery library -->
    <script src="https://code.jquery.com/jquery-3.6.4.min.js" crossorigin="anonymous"></script>
    <script src="https://cdn.rawgit.com/mgalante/jquery.redirect/master/jquery.redirect.js"></script>
    <!--    DEVA     -->
    <link rel="stylesheet" href="index.css">
    <!--     Leaflet
    <link rel = "stylesheet" href = "https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
    <script src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/leaflet.js"></script>
    -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <!-- bootdey -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/boxicons/2.1.0/css/boxicons.min.css" integrity="sha512-pVCM5+SN2+qwj36KonHToF2p1oIvoU3bsqxphdOIWMYmgr4ZqD3t5DjKvvetKhXGc/ZG5REYTT6ltKfExEei/Q==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/MaterialDesign-Webfont/5.3.45/css/materialdesignicons.css" integrity="sha256-NAxhqDvtY0l4xn+YVa6WjAcmd94NNfttjNsDmNatFVc=" crossorigin="anonymous" />
    <script src="index.js"></script>
  </head>
  <body>
  <!-- ====== Bootstrap script ====== -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-kenU1KFdBIe4zVF0s0G1M5b4hcpxyD9F7jL+jjXkk+Q2h455rYXK/7HAuoJl+0I4" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.6/dist/umd/popper.min.js" integrity="sha384-oBqDVmMz9ATKxIep9tiCxS/Z9fNfEXiDAYTujMAeBAsjFuCZSmKbSSUnQlmh/jp3" crossorigin="anonymous"></script>
    <script src="https://kit.fontawesome.com/22ad4831d8.js" crossorigin="anonymous"></script>
    <!-- google icons
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    -->
    <!-- resizeImg -->
    <script src="jquery.resizeImg.js"></script>
    <script src="mobileBUGFix.js"></script>
    <!--                          chatTrace    ------------------------------>
    <div class="container p-3">
      <textarea id="chat" class="form-control p-3 mb-2" style="height:600px;overflow:auto"></textarea>
      <!--<textarea id="input" class="form-control"></textarea>-->
      <div class="mt-2">
        <button id="micBtn" class="btn btn-secondary">🎤</button>
        <button id="spkBtn" class="btn btn-secondary">🔊</button>
        <!--<button id="sendBtn" class="btn btn-primary">Envoyer</button>-->
      </div>
    </div>


    <!--<div id="chatTraceContainer" class="container-fluid">
      <div class="row ms-1 me-1 mt-2 pe-2 ps-2">
        <div class="col-4">
          <textarea id="question2Textarea" autofocus class="form-control" placeholder="Tapez votre requête ici..."></textarea>
          <div class="d-flex flex-row-reverse">
            <button id="question2Button" class="btn" type="button">
              <img src="icons/forward.svg" width=36>
            </button>
          </div>

        </div>
        <div class="col-8">
          <textarea id="chatTrace" autofocus class="form-control" value""></textarea>
        </div>
      </div>
    </div>-->

  </body>
</html>
