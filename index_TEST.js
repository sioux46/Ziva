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
let dropInterruptedAssistant = false;

let interruptedGeneration = -1;

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

//------------------------------
// suivre l’état réel du micro
recognition.onstart = ()=> recognitionRunning = true;

//------------------------------
// Chrome coupe parfois le micro en mode continu.
recognition.onend = ()=>{
    recognitionRunning = false;

    if(micEnabled){
        try{ recognition.start(); }catch(e){}
    }
};

//-------------------------------
recognition.onresult = e => {

    let finalText = "";

    for (let i = e.resultIndex; i < e.results.length; i++) {
        if(e.results[i].isFinal){
            finalText += e.results[i][0].transcript;
        }
    }
    //console.log("recognition.onresult ----> " + finalText);


    if(!finalText) return;

    // barge-in barge-in IMMÉDIAT dès phrase valide
    if(aiSpeaking || aiStreaming){
      interruptAI();

      setTimeout(()=>{
          // garantit que le snapshot est bien écrit
          renderChat();
          submitUser(finalText);
      }, 220);
    }
    else{
      submitUser(finalText);
    }
  };

//----------------------
recognition.onerror= ()=> recognitionRunning = false;


//************************************** F U N C T I O N S ************
//*********************************************************************

// STOP GLOBAL barge-in  //////////    i n t e r r u p t AI
function interruptAI(){

    //console.log("interruptAI:");
    //console.log("assistantVisible: " + assistantVisible);
    //console.log("assistantPending: " + assistantPending);

    aiWasInterrupted = true;
    assistantFrozen = true;
    dropInterruptedAssistant = true;

    // 🔥 KILL SWITCH GLOBAL
    aiGeneration++;   // ← CRITIQUE CRITIQUE CRITIQUE

    // tuer la génération courante
    interruptedGeneration = aiGeneration;

    // 🔥 snapshot EXACT de ce qui a été parlé
    const snapshot = cleanAssistantText(assistantVisible);

    // abort réseau immédiat
    if(xhrLLM){
        xhrLLM.abort();
        xhrLLM = null;
    }

    aiStreaming = false;

    // 🔥 STOP AUDIO IMMÉDIAT
    try{
        speechSynthesis.cancel();
        speechSynthesis.resume();
    }catch(e){}

    aiSpeaking = false;

    // 🔥 commit IMMÉDIAT de la version tronquée
    if(snapshot && snapshot.trim().length > 0){
        commitAssistant(snapshot);
    }

    // nettoyage buffers
    ttsBuffer = "";
    ttsQueue.length = 0;
    currentUtterance = null;

    aiBusy = false;

    renderChat();
}
//////  plus rien à faire : tout est déjà géré dans interruptAI
/*function finalizeInterrupt(snapshot){

  const safeText = cleanAssistantText(snapshot);

  if(safeText && safeText.trim().length > 0){
      commitAssistant(safeText);
  }

  ttsBuffer = "";
  ttsQueue.length = 0;
  currentUtterance = null;
  aiBusy = false;

  renderChat();
}*/

//////
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

    if(!speakerEnabled) return;
    if(aiSpeaking) return;
    if(ttsQueue.length === 0) return;

    const myGen = aiGeneration;

    let item = ttsQueue.shift();
    if(!item) return;

    aiSpeaking = true;

    let u = new SpeechSynthesisUtterance(item.tts);
    currentUtterance = u;

    u.lang = "fr-FR";
    u.rate = 1;
    u.pitch = 1.6;

    u.onstart = ()=>{

        // 🔥 GARDE ABSOLUE
        if(
            assistantFrozen ||
            aiWasInterrupted ||
            myGen !== aiGeneration
        ){
            aiSpeaking = false;
            try{ speechSynthesis.cancel(); }catch(e){}
            return;
        }

        // ✅ append UNIQUEMENT si validé
        assistantVisible += item.raw;
        renderLiveAssistant(assistantVisible);
    };

    u.onend = ()=>{
        aiSpeaking = false;

        if(
            assistantFrozen ||
            aiWasInterrupted ||
            myGen !== aiGeneration
        ) return;

        // 🔥 RELANCE FORCÉE
        setTimeout(()=>{
            playTTS();
            flushTTS(); // très important
        }, 0);
    };

    u.onerror = ()=>{
        aiSpeaking = false;
        if(assistantFrozen) return;
        playTTS();
    };

    speechSynthesis.speak(u);
}
//// fin playTTS

//////
function speakChunk(){

    if(assistantFrozen) return;
    if(aiWasInterrupted) return;
    if(aiGeneration === interruptedGeneration) return;

    while(true){

        let spaceIndex = ttsBuffer.indexOf(" ");
        if(spaceIndex === -1) break;

        let raw = ttsBuffer.slice(0, spaceIndex + 1);
        ttsBuffer = ttsBuffer.slice(spaceIndex + 1);

        let tts = formatTTS(raw);

        ttsQueue.push({
            raw: raw,
            tts: tts
        });
    }

    // 🔥 KICK SAFE
    if(!aiSpeaking){
        playTTS();
    }
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

    if(assistantFrozen) return;
    if(aiWasInterrupted) return;
    if(ttsBuffer.trim().length === 0) return;
    if(aiSpeaking) {
        // 🔥 re-tenter dès que la voix finit. NE PAS PERDRE LE FLUSH
        setTimeout(flushTTS, 60);
        return;
    }

    let raw = ttsBuffer;

    let tts = formatTTS(raw);

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

    // 🚨 si déjà commit → on n'affiche plus de live
    if(assistantMessageCommitted) return;

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

//////
/*function findCutPoint(text){
    // coupe sur vraie fin de phrase
    // let re = /([.!?])(?=\s+)/g;
    let re = /([.!?])(?=\s+[A-ZÀ-Ÿ])/g;

    let m, last = -1;
    while ((m = re.exec(text)) !== null) {
        last = m.index + 1;
    }

    // sinon coupe sur virgule longue
    if (last === -1 && text.length > 140) {
        let c = text.lastIndexOf(",");
        if (c > 60) last = c + 1;
    }

    return last;
}*/
function findCutPoint(text){

    // ponctuation forte
    let strong = /([.!?])(?=\s+[A-ZÀ-Ÿ-])/g;
    let m, last = -1;

    while ((m = strong.exec(text)) !== null) {
        last = m.index + 1;
    }
    if(last !== -1) return last;

    //  saut de ligne = forte
    let nl = text.lastIndexOf("\n");
    if(nl > 40) return nl + 1;

    //  ponctuation moyenne
    let mid = text.lastIndexOf(";");
    if(mid > 80) return mid + 1;

    mid = text.lastIndexOf(":");
    if(mid > 80) return mid + 1;

    //  virgule (faible, prudente)
    if(text.length > 160){
        let c = text.lastIndexOf(",");
        if(c > 80) return c + 1;
    }

    return -1;
}

//////
function formatTTS(text){

    return text

        // virgules → petite pause
        // .replace(/,/g, ", ")

        // point-virgule → pause moyenne
        .replace(/,/g, ", ")
        .replace(/;/g, "; ")
        .replace(/:/g, ": ")

        // respiration naturelle
        .replace(/\s-\s/g, "... ")

        // sauts de ligne → pause
        .replace(/\n+/g, ". ")

        // espaces multiples
        .replace(/\s{2,}/g, " ");
}

//////
function cleanAssistantText(text){

    if(!text) return "";

    text = text.trimEnd();

    const lastSpace = text.lastIndexOf(" ");

    if(lastSpace !== -1){
        return text.slice(0, lastSpace).trim();
    }

    return text.trim();
}

//////
function commitAssistant(text){

    if(aiWasInterrupted && assistantMessageCommitted) return;

    const clean = (text || "").trim();
    if(!clean) return;

    chatBuffer.push({
        role: "assistant",
        content: clean
    });

    assistantMessageCommitted = true;

    // 🔥 CRITIQUE — empêche le double affichage
    assistantVisible = "";
    assistantPending = "";
    assistantFrozen = true;
}
////////////////////////////////////////////        STREAMING MISTRAL
function sendToAI_php(chatBuffer){

    const csrf = document.querySelector('meta[name="csrf-token"]').content;

    // évite les reliquats inter-requêtes.
    assistantPending = "";
    assistantVisible = "";
    ttsBuffer = "";
    ttsQueue.length = 0;

    aiGeneration++;
    const myGen = aiGeneration;

    assistantVisible = "";
    assistantFrozen = false;
    assistantMessageCommitted = false;
    aiWasInterrupted = false;
    dropInterruptedAssistant = false;

    let lastSize = 0;
    //------------------------------------------
    let xhr = new XMLHttpRequest();
    xhrLLM = xhr; // copie dans variable globale
    aiStreaming = true;

    xhr.open("POST","chatLLM.php",true);
    xhr.withCredentials = true;

    let form = new FormData();
    form.append("chatBuffer", JSON.stringify(structuredClone(chatBuffer)));
    form.append("csrf", csrf);

    xhr.onprogress = ()=>{ // toutes les 50ms

        // 🔥 coupe-circuit dur
        if(myGen !== aiGeneration || assistantFrozen || aiWasInterrupted) return;

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

            // 🔥 double garde (très important)
            if(assistantFrozen || aiWasInterrupted || myGen !== aiGeneration){
                continue;
            }

              assistantPending += tok;
              ttsBuffer += tok;

              // fallback visuel si pas de TTS
              if(!speakerEnabled){
                  assistantVisible = assistantPending;
                  renderLiveAssistant(assistantVisible);
              }
              speakChunk();

        }
    };

    xhr.onload = ()=>{

        if(myGen !== aiGeneration) return;

        aiStreaming = false;
        aiBusy = false;

        // 🔥 on vide le buffer UNE SEULE FOIS
        if(!assistantFrozen && !aiWasInterrupted){
            flushTTS();
        }

        // 🔥 commit différé = laisse le dernier onstart passer
        setTimeout(()=>{

            if(myGen !== aiGeneration) return;
            if(assistantMessageCommitted) return;

            let finalText = "";

            // ✅ interruption → uniquement ce qui a été parlé
            if(aiWasInterrupted){
                finalText = assistantVisible.trim();
            }
            // ✅ fin normale → priorité à ce qui a été parlé
            else{
                finalText =
                    assistantVisible.trim().length > 0
                    ? assistantVisible.trim()
                    : assistantPending.trim(); // fallback sécurité
            }

            commitAssistant(finalText);

        }, 120); // ← CRITIQUE
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
