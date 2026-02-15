// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.02.11.1";
let chatBuffer = [];
let aiBusy = false;
let aiSpeaking = false;
let xhrLLM = null;

//                                              R E C O G N I T I O N

// Reconnaissance vocale
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "fr-FR";
recognition.continuous = true;
recognition.interimResults = true;

let voiceBuffer = "";
let silenceTimer = null;

// Buffer de phrase + détection du silence
recognition.onresult = e => {

  if(aiSpeaking) {
    console.log("couper la parole");
    speechSynthesis.cancel();   // coupe la voix IA
    xhrLLM.abort();             // coupe Mistral
    aiSpeaking=false;
  }


  let txt = "";
  for (let i = e.resultIndex; i < e.results.length; i++)
      txt += e.results[i][0].transcript;

  voiceBuffer = txt;
  $("#input").val(txt);

  resetSilenceTimer();
};

let speakerEnabled = true;
const synth = window.speechSynthesis;

let micEnabled=false;

//                                                   S Y N T H E S I S



//************************************************** F U N C T I O N  ************
//********************************************************************************

////// Synthèse vocale
function speak(text){
  if(!speakerEnabled) return;

  aiSpeaking = true;
  recognition.stop();   // micro OFF pendant la parole
  voiceBuffer="";

  let u = new SpeechSynthesisUtterance(text);
  u.lang="fr-FR";

  u.onend = ()=>{
     if(micEnabled) recognition.start(); // micro ON après
  };

  synth.cancel(); // stop ancien audio
  synth.speak(u);
}

//////
function resetSilenceTimer(){
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(()=>{
        if(voiceBuffer.trim().length>2){
            submitUser(voiceBuffer);
            voiceBuffer="";
            $("#input").val("");
        }
    },1500); // 1.5s de silence
}

function addUser(text){
   chatBuffer.push({role:"user", content:text});
   $("#chat").text($("#chat").text() + "QUESTION: " + text + "\n");
}

function addAI(text){
   chatBuffer.push({role:"assistant", content:text});
}

////// Envoi vers backend
function submitUser(text){
  if(aiBusy) return;      // verrou
  aiBusy = true;

  addUser(text);
  sendToAI_php(chatBuffer);
}


//////////////////////////////////////////////////////////////////
function sendToAI_php(chatBuffer) {
// **** LLM call ****  $chat

const csrf = document.querySelector('meta[name="csrf-token"]').content;
var url;
if ( window.location.href.lastIndexOf("8888") != -1 ) // si dans MAMP
      url = "chatLLM.php"; // "http://ziva.local:8888/api/chat";
else  url = "chatLLM.php";  // "https://www.siouxlog.fr/api/chat";

  console.log("LLM: " + url);
  console.log("Question: " + chatBuffer);
  waitingForGPT = true;
  $.ajax({
    'url': url,
    'type': 'post',
    'xhrFields': {
      withCredentials: true   // ← envoie le cookie de session
    },
    'data': {
              chatBuffer: JSON.stringify(chatBuffer),
              csrf: csrf,  // ← token CSRF
            },
    'complete': function(xhr, result) {

      // waitingForGPT = false;

      if (result != 'success') {
        console.log("Fatal error API LLM !!!!");
      }
      else {
        var reponse = JSON.parse(xhr.responseText);
        console.log("Reponse du LLM pour l'utilisateur: " + reponse);


        if ( reponse.match(/^Error/) ) {
          reponse = "Désolé mais je n'ai pas compris votre question. Pouvez-vous la reformuler ?";
        }
        else {
          console.log("Reponse: " + reponse);
          // let rep = fullText;   // construit par le streaming
          addAI(reponse);  // MÉMOIRE
          $("#chat").text($("#chat").text() + "REPONSE: " + reponse + "\n");
          xhrLLM = xhr; // Stocke la requête LLM
          speak(reponse);
        }
      }
    }
  });
}

// ****************************************************************************************
// *******************************************************************   $ready$  R E A D Y
$(document).ready(function () {

// Boutons micro / haut-parleur
$("#micBtn").click(()=>{
  micEnabled=!micEnabled;
  micEnabled ? recognition.start() : recognition.stop();
  $("#micBtn").toggleClass("btn-danger",micEnabled);
});

$("#spkBtn").click(()=>{
   speakerEnabled=!speakerEnabled;
   $("#spkBtn").toggleClass("btn-warning",speakerEnabled);
});

}); // *********************************************  F I N   R E A D Y
//  *******************************************************************









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
