// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.02.11.1";
let chatBuffer = [];
let aiBusy = false;
let aiSpeaking = false;
let xhrLLM = null;

let voiceQueue="";
let voiceTimer=null;


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

  if( aiSpeaking ) {
    console.log("couper la parole");
    speechSynthesis.cancel();   // coupe la voix IA
    if( xhrLLM ) {
      xhrLLM.abort();           // stop Mistral
      xhrLLM=null;
    }
    aiBusy = false; // autorise nouvelle requête
    aiSpeaking = false;
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
    aiSpeaking=false;
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
    },2000); // 2s // 1.5s de silence
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


//////
function sendToAI_php(chatBuffer){

 const csrf = document.querySelector('meta[name="csrf-token"]').content;

 let url="chatLLM.php";

 let fullText="";
 let lastSize=0;

 let xhr = new XMLHttpRequest();
xhrLLM = xhr;

 xhr.open("POST",url,true);
 xhr.withCredentials=true;

 let form=new FormData();
 form.append("chatBuffer",JSON.stringify(chatBuffer));
 form.append("csrf",csrf);

 xhr.onprogress = ()=>{
    let chunk = xhr.responseText.substring(lastSize);
    lastSize = xhr.responseText.length;

    let lines = chunk.split("\n");

    for(let l of lines){
        if(!l.startsWith("data:")) continue;
        if(l.includes("[DONE]")) return;

        let j;
        try {
           j = JSON.parse(l.slice(5));
        } catch(e){ continue; }




      let tok;
      if (j.choices &&
           j.choices[0] &&
           j.choices[0].delta &&
           j.choices[0].delta.content) {

           tok = j.choices[0].delta.content;
      }
      if(!tok) continue;  // ignore chunks vides


      fullText+=tok;
      $("#chat").text($("#chat").text()+tok);
    }

 };

 xhr.onload = ()=>{
    aiBusy=false;
    addAI(fullText);
    speak(fullText);
 };

 xhr.onerror = ()=>{
    aiBusy=false;
 };

 xhr.send(form);
}

//////

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
