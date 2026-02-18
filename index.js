// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.02.18.1";

let chatBuffer = [];

let aiStreaming = false;
let aiSpeaking  = false;
let aiBusy      = false;

let xhrLLM = null;

let micEnabled = false;
let speakerEnabled = true;

let voiceBuffer = "";

let lastSentUtterance = -1;
let recognitionRunning = false;

let llmFullText   = "";   // tout ce que Mistral a envoyé
let ttsSpoken    = "";   // ce qui a été réellement prononcé
let ttsBuffer    = "";   // ce qui est en attente de parole

let lastSpoken = 0;
let ttsQueue = [];
let ttsBusy = false;
let chatPlain = "";   // texte pur, jamais du HTML

let speakIndex = 0; // Synchroniser le surlignage avec la voix

let iosAudioUnlocked = false;

const synth = window.speechSynthesis;


//                                              R E C O G N I T I O N

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "fr-FR";
recognition.continuous = true;
recognition.interimResults = true;

// suivre l’état réel du micro
recognition.onstart = ()=> recognitionRunning = true;
recognition.onend   = ()=> recognitionRunning = false;
recognition.onerror= ()=> recognitionRunning = false;

// BARGE-IN instantané
recognition.onresult = e => {

    // barge-in
    if(aiSpeaking || aiStreaming){
        stopAI();
    }

    let finalText = "";

    for (let i = e.resultIndex; i < e.results.length; i++) {
        if(e.results[i].isFinal){
            finalText += e.results[i][0].transcript;
        }
    }

    if(!finalText) return;   // ignore les intermédiaires

    voiceBuffer = finalText;
    $("#input").val(finalText);

    submitUser(finalText);  // une seule fois
};

//************************************** F U N C T I O N S ************
//********************************************************************

function unlockIOSAudio(){
    if(iosAudioUnlocked) return;
    iosAudioUnlocked = true;

    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
}

// STOP GLOBAL (TTS + STREAM)
function stopAI(){

    // stop LLM
    if(xhrLLM){
        xhrLLM.abort();
        xhrLLM = null;
        aiStreaming = false;
    }

    // stop voix
    if(aiSpeaking){
        synth.cancel();
        aiSpeaking = false;
    }

    // reset buffers
    llmFullText = "";
    ttsSpoken   = "";
    ttsBuffer   = "";
    ttsQueue    = [];

    aiBusy = false;
}

// start sécurisé  ???
function startMic(){
    if(!micEnabled) return;
    if(recognitionRunning) return;
    try{
        recognition.start();
    }catch(e){}
}


//                                                   S Y N T H E S I S

function speakChunk(){
    if(!speakerEnabled) return;
    if(ttsBuffer.length < 8) return;

    // chercher un vrai point de coupure sémantique
    let cut = findCutPoint(ttsBuffer);
    if(cut === -1) return;

    // TEXTE SOURCE (exactement ce qui est affiché)
    let raw = ttsBuffer.slice(0, cut + 1);

    // retirer du buffer
    ttsBuffer = ttsBuffer.slice(cut + 1);

    // TEXTE POUR LA VOIX (avec respiration)
    let tts = raw
        .replace(/,/g, ",<break>")
        .replace(/:/g, ":<break>")
        .replace(/\.\s/g, ". <breath> ")
        .replace(/\n+/g, " <breath> ");

    // pousser les deux versions
    ttsQueue.push({
        raw: raw,
        tts: tts
    });

    playTTS();
}

function findCutPoint(text){
    // coupe sur vraie fin de phrase
    let re = /([.!?])(?=\s+[A-ZÀ-Ÿ])/g;
    let m, last = -1;
    while ((m = re.exec(text)) !== null) {
        last = m.index + 1;
    }

    // sinon coupe sur virgule longue
    if (last === -1 && text.length > 120) {
        let c = text.lastIndexOf(",");
        if (c > 40) last = c + 1;
    }

    return last;
}

function playTTS(){

    // rien à dire
    if(!speakerEnabled) return;
    if(aiSpeaking) return;
    if(ttsQueue.length === 0) return;

    let item = ttsQueue.shift();
    if(!item || !item.tts) {
      aiSpeaking = false;
      return;
    }

    let raw   = item.raw;
    let chunk = item.tts;

    aiSpeaking = true;

    chunk = chunk
              .replace(/<breath>/g,"   ")
              .replace(/<break>/g," ");

    let u = new SpeechSynthesisUtterance(chunk);
    u.lang = "fr-FR";
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = 1.0;

    // quand la voix démarre
    u.onstart = ()=>{
        // avancer l'index sur le texte exact
        speakIndex += raw.length;

        // ce que l'humain a réellement entendu
        ttsSpoken += raw;

        // mettre à jour le surlignage
        renderChat();
    };

    u.onend = ()=>{
        aiSpeaking = false;

        // continuer tant qu’il y a de la voix
        playTTS();
    };

    u.onerror = ()=>{
        aiSpeaking = false;
        playTTS();
    };

    // ⚠️ stop tout audio précédent (sécurité)
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
}

// MÉMOIRE
function addUser(text){
    chatBuffer.push({role:"user", content:text});
    $("#chat").append(text);
}

// ENVOI UTILISATEUR
function submitUser(text){
    if(aiBusy) return;
    aiBusy = true;

    addUser(text);
    sendToAI_php(chatBuffer);
}

// parle ce qu'il reste même sans ponctuation
function flushTTS(){
    if(!speakerEnabled) return;
    if(ttsBuffer.trim().length === 0) return;

    ttsQueue.push({
        raw: ttsBuffer,
        tts: ttsBuffer
    });

    ttsBuffer = "";
    playTTS();
}

function renderChat(){
  $("#chat").text(chatPlain);
}

//////////////////////////////////////////// STREAMING MISTRAL
function sendToAI_php(chatBuffer){

    const csrf = document.querySelector('meta[name="csrf-token"]').content;

    let fullText = "";
    let lastSize = 0;

    let xhr = new XMLHttpRequest();
    xhrLLM = xhr;
    aiStreaming = true;

    xhr.open("POST","chatLLM.php",true);
    xhr.withCredentials = true;

    let form = new FormData();
    let safeBuffer = structuredClone(chatBuffer);

    form.append("chatBuffer", JSON.stringify(safeBuffer));
    form.append("csrf", csrf);

    xhr.onprogress = ()=>{
        let chunk = xhr.responseText.substring(lastSize);
        lastSize = xhr.responseText.length;

        let lines = chunk.split("\n");

        for(let l of lines){
            if(!l.startsWith("data:")) continue;
            if(l.includes("[DONE]")) return;

            let j = JSON.parse(l.slice(5));

            let tok = j.choices?.[0]?.delta?.content;
            if(!tok) continue;

            fullText += tok;
            ttsBuffer += tok;
            llmFullText += tok;
            chatPlain += tok;
            renderChat();

            speakChunk();
        }
    };

    xhr.onload = ()=>{
        aiStreaming = false;
        aiBusy = false;
        flushTTS();

        if(llmFullText.trim().length > 0){
            chatBuffer.push({
                role: "assistant",
                content: llmFullText.trim()
            });
        }

        llmFullText = "";
    };

    xhr.onerror = ()=>{
        aiStreaming = false;
        aiBusy = false;
    };

    xhr.send(form);
    ttsSpoken = "";
}

// ******************************************************************
// *********************************************   $ready$  R E A D Y
$(document).ready(function () {

//  micro
$("#micBtn").click(()=>{
  unlockIOSAudio();  //  déverrouille iOS
  micEnabled=!micEnabled;
  micEnabled ? recognition.start() : recognition.stop();
  $("#micBtn").toggleClass("btn-danger",micEnabled);
});

// haut-parleur
$("#spkBtn").click(()=>{
  unlockIOSAudio();  //  déverrouille iOS
  speakerEnabled=!speakerEnabled;
  $("#spkBtn").toggleClass("btn-warning",speakerEnabled);
});

}); // *********************************************  F I N   R E A D Y
//  *******************************************************************
