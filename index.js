// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.02.11.1";
//const csrf = document.querySelector('meta[name="csrf-token"]').content;


// Exemple d'utilisation :
const chatTestBuffer = [
    { role: "system", content: "Vous êtes un assistant intelligent." },
    { role: "user", content: "Bonjour, comment ça va ?" },
    { role: "assistant", content: "Bonjour ! Je vais bien, merci. Et vous ?" },
    { role: "user", content: "Très bien, merci !" }
];

/////////
async function sendToAI_py(chatBuffer) {
    var url;
    if ( window.location.href.lastIndexOf("8888") != -1 ) // si dans MAMP
          url = "http://ziva.local:8888/api/chat";
    else  url = "https://www.siouxlog.fr/api/chat";
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: chatBuffer })
    });

    const data = await response.json();
    return data.reply;
}

//////
function testPY() {
  sendToAI_py(chatTestBuffer).then(reply => {
    console.log("AI:" + reply);
});
}
function testPHP() {
  sendToAI_php(chatTestBuffer);
}

///////////////////////////////////////////////////////////////////////////////////
function sendToAI_php(globalChatBuffer) {
// **** LLM call ****  $chat

const csrf = document.querySelector('meta[name="csrf-token"]').content;
var url;
if ( window.location.href.lastIndexOf("8888") != -1 ) // si dans MAMP
      url = "chatLLM.php"; // "http://ziva.local:8888/api/chat";
else  url = "chatLLM.php";  // "https://www.siouxlog.fr/api/chat";

  console.log("LLM: " + url);
  waitingForGPT = true;
  $.ajax({
    'url': url,
    'type': 'post',
    'xhrFields': {
      withCredentials: true   // ← envoie le cookie de session
    },
    'data': {
              sysMes: JSON.stringify("Test system"),
              chatBuffer: JSON.stringify(globalChatBuffer),
              csrf: csrf,  // ← token CSRF
            },
    'complete': function(xhr, result) {

      // waitingForGPT = false;

      if (result != 'success') {
        console.log("Fatal error API LLM !!!!");
      }
      else {
        var reponse = JSON.parse(xhr.responseText);
        console.log("Response du LLM pour l'utilisateur: " + reponse);

        if ( reponse.match(/^Error/) ) {
          reponse = "Désolé mais je n'ai pas compris votre question. Pouvez-vous la reformuler ?";
        }
        else {
          console.log("response");
          //doSpeechSynth(repToSpeech);
        }
      }
    }
  });
}
