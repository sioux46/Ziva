// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.02.19.1";

let chatBuffer = [];

// états IA
let aiStreaming = false;
let aiSpeaking  = false;
let aiBusy      = false;
let aiGeneration = 0;
let aiWasInterrupted = false;
let assistantMessageCommitted = false;

// SOURCE DE VÉRITÉ UNIQUE
let assistantPending = "";   // texte reçu du LLM
let assistantVisible = "";   // texte réellement parlé (vérité)
let assistantFrozen  = false;

// TTS
let ttsBuffer = "";
let ttsQueue = [];
let currentUtterance = null;

// réseau
let xhrLLM = null;

let micEnabled = false;
let speakerEnabled = true;

// iOS
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

recognition.onresult = e => {

    //  barge-in immédiat
    if(aiSpeaking || aiStreaming){
        interruptAI();
    }

    let finalText = "";

    for (let i = e.resultIndex; i < e.results.length; i++) {
        if(e.results[i].isFinal){
            finalText += e.results[i][0].transcript;
        }
    }

    if(!finalText) return;

    submitUser(finalText);
};

//************************************** F U N C T I O N S ************
//********************************************************************

// STOP GLOBAL (TTS + STREAM) barge-in  //////////    s t o p AI
function interruptAI(){

    aiGeneration++;
    aiWasInterrupted = true;
    assistantFrozen = true;

    // abort réseau
    if(xhrLLM){
        xhrLLM.abort();
        xhrLLM = null;
    }

    aiStreaming = false;

    // stop audio IMMÉDIAT
    try{ speechSynthesis.cancel(); }catch(e){}
    aiSpeaking = false;

    // COMMIT FIABLE (VISIBLE UNIQUEMENT)
    if(!assistantMessageCommitted && assistantVisible.trim().length > 0){
        chatBuffer.push({
            role: "assistant",
            content: assistantVisible.trim()
        });
        assistantMessageCommitted = true;
    }

    // purge TTS
    ttsBuffer = "";
    ttsQueue.length = 0;
    currentUtterance = null;

    aiBusy = false;

    renderChat();
}

function unlockIOSAudio(){
    if(iosAudioUnlocked) return;
    iosAudioUnlocked = true;

    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
}

/////////////////////////                         S Y N T H E S I S

//////////////////////////////////////////////////      p l a y TTS
function playTTS(){

    if(aiSpeaking) return;
    if(ttsQueue.length === 0) return;

    let item = ttsQueue.shift();
    if(!item) return;

    const myGen = aiGeneration; //  verrou

    aiSpeaking = true;

    let u = new SpeechSynthesisUtterance(item.tts);

    u.lang = "fr-FR";
    u.rate = 0.95;
    u.pitch = 1.1;

    u.onstart = ()=>{

        //  ignore si obsolète
        if(myGen !== aiGeneration) return;
        if(assistantFrozen) return;

        assistantVisible += item.raw;
        renderLiveAssistant(assistantVisible);
    };

    u.onend = ()=>{
        aiSpeaking = false;
        if(myGen !== aiGeneration) return;
        playTTS();
    };

    u.onerror = ()=>{
        aiSpeaking = false;
        playTTS();
    };

    speechSynthesis.speak(u);
}
//// fin playTTS

//////
function speakChunk(){

    if(ttsBuffer.length < 8) return;

    let cut = findCutPoint(ttsBuffer);
    if(cut === -1) return;

    let raw = ttsBuffer.slice(0, cut + 1);
    ttsBuffer = ttsBuffer.slice(cut + 1);

    let tts = raw
        .replace(/,/g, ", ")
        .replace(/\n+/g, " ");

    ttsQueue.push({
        raw: raw,   // texte exact visible
        tts: tts    // texte modifié pour la voix
    });
    playTTS();
}

//////
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

////// MÉMOIRE
function addUser(text){
    chatBuffer.push({role:"user", content:text});
    renderChat();
}

////// ENVOI UTILISATEUR
function submitUser(text){
    if(aiBusy) return;
    aiBusy = true;

    addUser(text);
    sendToAI_php(chatBuffer);
}

////// parle ce qu'il reste même sans ponctuation
function flushTTS(){

    if(ttsBuffer.trim().length === 0) return;

    let raw = ttsBuffer;
    let tts = raw
        .replace(/,/g, ", ")
        .replace(/\n+/g, " ");

    ttsQueue.push({
        raw: raw,
        tts: tts
    });

    ttsBuffer = "";
    playTTS();
}

//////
function renderChat(){
    let out = "";

    for(let m of chatBuffer){
        out += m.content + "\n";
    }
    //out += ttsSpoken + "\n";
    $("#chat").text(out);
    console.log(out);
}

//////
function renderLiveAssistant(text){

    // sécurité
    if(typeof text !== "string") return;

    // texte utilisateur déjà validé
    let history = "";

    for(let m of chatBuffer){
        history += m.content + "\n";
    }

    //  on ajoute le flux assistant en cours
    let out = history + text;

    // rendu TEXTE PUR (jamais html)
    $("#chat").text(out);
}


//////////////////////////////////////////// STREAMING MISTRAL
function sendToAI_php(chatBuffer){

    const csrf = document.querySelector('meta[name="csrf-token"]').content;

    aiGeneration++;
    const myGen = aiGeneration;

    assistantVisible = "";
    assistantFrozen = false;
    assistantMessageCommitted = false;
    aiWasInterrupted = false;

    let lastSize = 0;

    let xhr = new XMLHttpRequest();
    xhrLLM = xhr;
    aiStreaming = true;

    xhr.open("POST","chatLLM.php",true);
    xhr.withCredentials = true;

    let form = new FormData();
    form.append("chatBuffer", JSON.stringify(structuredClone(chatBuffer)));
    form.append("csrf", csrf);

    xhr.onprogress = ()=>{

        if(myGen !== aiGeneration) return;

        let chunk = xhr.responseText.substring(lastSize);
        lastSize = xhr.responseText.length;

        let lines = chunk.split("\n");

        for(let l of lines){

            if(!l.startsWith("data:")) continue;
            if(l.includes("[DONE]")) return;

            let j;
            try{ j = JSON.parse(l.slice(5)); }catch{ continue; }

            let tok = j.choices?.[0]?.delta?.content;
            if(!tok) continue;

            // NE PLUS ÉCRIRE SI GELÉ
            if(!assistantFrozen){
              assistantPending += tok;
              ttsBuffer += tok;
              speakChunk();
            }
        }
    };

    xhr.onload = ()=>{

        if(myGen !== aiGeneration) return;

        aiStreaming = false;
        aiBusy = false;

        flushTTS();

        // FIN NORMALE
        if(!assistantMessageCommitted &&
           !aiWasInterrupted &&
           assistantVisible.trim().length > 0){

            chatBuffer.push({
                role: "assistant",
                content: assistantVisible.trim()
            });

            assistantMessageCommitted = true;
        }
    };

    xhr.onerror = ()=>{
        aiStreaming = false;
        aiBusy = false;
    };

    xhr.send(form);
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
