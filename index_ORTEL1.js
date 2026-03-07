// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.03.03.1";

let chatBuffer = [];

// états IA
let aiStreaming = false;
let aiSpeaking  = false;
let aiBusy      = false;
let aiGeneration = 0;
let ttsKilledGeneration = -1;
let assistantMessageCommitted = false;

let interruptedGeneration = -1;

// SOURCE DE VÉRITÉ UNIQUE
let assistantPending = "";   // texte reçu du LLM
let assistantVisible = "";   // texte réellement parlé (vérité)
let aiWasInterrupted = false;
let assistantFrozen = false; // en cas d'interrution
                              // set in interruptAI, clear in sendToAI_php
// TTS
let ttsBuffer = "";
let ttsQueue = [];
let lastTTSEnd = 0;

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
    lastTTSEnd = Date.now();
    if(micEnabled){
        try{ recognition.start(); }catch(e){}
    }
};

//-------------------------------
  recognition.onresult = e => {

      // A revoir pour tablette ???
      /*// ignore écho trop proche du TTS
      if(Date.now() - lastTTSEnd < 400){ // 2400
        console.log("Echo: " + (Date.now() - lastTTSEnd));
        return;
      }*/

      let finalText = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
          if(e.results[i].isFinal){
              finalText += e.results[i][0].transcript;
          }
      }

      if(!finalText) return;

      // 🚨 filtre anti-écho intelligent
      const echoWindow = Date.now() - lastTTSEnd < 2600;

      if ((aiSpeaking || echoWindow) && looksLikeEcho(finalText)) {
          console.log("------------>>> IGNORED: echo detected");
          console.log("finalText:", finalText);
          return;
      }

      // barge-in
      if(aiSpeaking || aiStreaming){
          interruptAI();

          setTimeout(()=>{
              // garantit que le snapshot est bien écrit
              renderChat();
              submitUser(finalText);
          }, 100); //  TRES TRES SENSIBLE ???
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

    // 🔒 idempotence dure
    if(aiWasInterrupted) return;

    console.log("interruptAI:");
    //console.log("assistantVisible: " + assistantVisible);
    //console.log("assistantPending: " + assistantPending);

    // ===============================
    // 1️⃣ marquer interruption AVANT tout
    // ===============================
    aiWasInterrupted = true;
    assistantFrozen = true;
    interruptedGeneration = aiGeneration;

    // 🔥 kill toute future TTS de cette génération
    ttsKilledGeneration = aiGeneration;

    // ===============================
    // 2️⃣ snapshot EXACT de ce qui a été parlé
    // ===============================
    const snapshot = cleanAssistantText(assistantVisible || assistantPending);

    // ===============================
    // 3️⃣ STOP réseau IMMÉDIAT
    // ===============================
    if(xhrLLM){
        try{ xhrLLM.abort(); }catch(e){}
        xhrLLM = null;
    }

    aiStreaming = false;

    // ===============================
    // 4️⃣ STOP audio nucléaire
    // ===============================
    try{
        speechSynthesis.cancel();
    }catch(e){}

    aiSpeaking = false;

    // ===============================
    // 5️⃣ purge buffers TTS
    // ===============================
    ttsBuffer = "";
    ttsQueue.length = 0;

    // ===============================
    // 6️⃣ commit IMMÉDIAT du snapshot
    // ===============================
    if(snapshot && snapshot.trim().length > 0){
        commitAssistant(snapshot);
    }

    // ===============================
    // 7️⃣ libérer IA
    // ===============================
    aiBusy = false;

    // ===============================
    // 8️⃣ rendu final propre
    // ===============================
    renderChat();
}

/////////////////////////                         S Y N T H E S I S

//////////////////////////////////////////////////      p l a y TTS
function playTTS(){

    const myGen = aiGeneration;

    // ===============================
    // 🚨 gardes nucléaires immédiates
    // ===============================
    if(!speakerEnabled) return;
    if(aiSpeaking) return;
    if(assistantFrozen) return;
    if(aiWasInterrupted) return;
    if(ttsKilledGeneration === myGen) return;
    if(myGen !== aiGeneration) return;
    if(ttsQueue.length === 0) return;

    const item = ttsQueue.shift();
    if(!item) return;

    const u = new SpeechSynthesisUtterance(item.tts);

    u.lang  = "fr-FR";
    u.rate  = 1;
    u.pitch = 1.6;

    // ===============================
    // ▶️ ONSTART (point critique)
    // ===============================
    u.onstart = ()=>{

        // 🔒 triple verrou anti-race
        if(myGen !== aiGeneration) return;
        if(assistantFrozen) return;
        if(aiWasInterrupted) return;
        if(ttsKilledGeneration === myGen) return;

        aiSpeaking = true;

        // ✅ append SEULEMENT si toujours valide
        assistantVisible += item.raw;

        renderLiveAssistant(assistantVisible);
    };

    // ===============================
    // ⏹️ ONEND
    // ===============================
    u.onend = ()=>{

        aiSpeaking = false;
        lastTTSEnd = Date.now();

        // 🔒 ne rien relancer si interrompu
        if(myGen !== aiGeneration) return;
        if(assistantFrozen) return;
        if(aiWasInterrupted) return;
        if(ttsKilledGeneration === myGen) return;

        // ▶️ continuer la file
        playTTS();
    };

    // ===============================
    // ❌ ONERROR
    // ===============================
    u.onerror = ()=>{

        aiSpeaking = false;

        if(assistantFrozen) return;
        if(aiWasInterrupted) return;
        if(ttsKilledGeneration === myGen) return;

        playTTS();
    };

    // ===============================
    // 🚀 SPEAK (protégé)
    // ===============================
    try{
        speechSynthesis.speak(u);
    }catch(e){
        aiSpeaking = false;
    }
}
//// fin playTTS

//////
function speakChunk(){

    if(aiWasInterrupted) return;
    if(assistantFrozen) return;
    if(aiGeneration === interruptedGeneration) return;
    if(ttsBuffer.length < 20) return;  // 3

    let cut = findCutPoint(ttsBuffer);
    if(cut === -1) return;

    let raw = ttsBuffer.slice(0, cut + 1);
    ttsBuffer = ttsBuffer.slice(cut + 1);

    let tts = formatTTS(raw); // pauses audio

    ttsQueue.push({
        raw: raw,   // texte exact visible
        tts: tts    // texte modifié pour la voix
    });
    playTTS();
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

    if(assistantFrozen) return; // CRITIQUE
    if(ttsBuffer.trim().length === 0) return;

    let raw = ttsBuffer;

    let tts = formatTTS(raw); // pauses audio

    ttsQueue.push({
        raw: raw,
        tts: tts
    });

    ttsBuffer = "";
    playTTS();
}

//////
/*function renderChat(){
    let out = "";

    for(let m of chatBuffer){
        out += m.content + "\n";
    }
    //out += ttsSpoken + "\n";
    $("#chat").text(out);
    console.log(out);
}*/

function renderChat() {
    let out = "";
    for (let m of chatBuffer) {
        out += m.content + "\n";
    }
    // Ajoute le texte en cours de génération
    if (assistantVisible && !assistantMessageCommitted) {
        out += assistantVisible + "\n";
    }

    // supprimer doublon dans #chat
    out = supDoublons(out);

    $("#chat").text(out);
    console.log("---------------- renderChat >>> " + out);
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

    // supprimer doublon dans #chat
    out = supDoublons(out);

    // rendu TEXTE PUR (jamais html)
    $("#chat").text(out);
    console.log("---------------- renderLIve >>> " + out);
}

//////
function supDoublons(out) {

  // supprimer doublon dans #chat
  const sansDoublon = out.split('\n').slice(0, -1).join('\n'); // sup der ligne
  if ( sansDoublon != "" ) {
    if ( out.split('\n').pop() == sansDoublon.split('\n').pop() ) {
      out = sansDoublon;
    }
  }
  return out;
}

/*//////
function findCutPoint(text){

    // ponctuation forte
    let strong = /([.!?\n])(?=\s+[A-ZÀ-Ÿ-])/g;
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
}*/

//////
function findCutPoint(text){

    if(!text) return -1;

    // ===============================
    // 1️⃣ ponctuation forte (priorité max)
    // ===============================
    //let strong = /([.!?\n])(?=\s+[A-ZÀ-Ÿ0-9«"'-])/g;
    let strong = /([.!?])(?=\s+)/g;
    let m, lastStrong = -1;

    while ((m = strong.exec(text)) !== null) {
        lastStrong = m.index + 1;
    }
    if(lastStrong !== -1) return lastStrong;

    // ===============================
    // 2️⃣ ponctuation moyenne
    // ===============================
    const mid = [";", ":", "—", "–", ")"];
    for(let p of mid){
        let idx = text.lastIndexOf(p);
        if(idx > 30) return idx + 1;
    }

    // ===============================
    // 3️⃣ virgule agressive (clé barge-in)
    // ===============================
    if(text.length > 60){
        let c = text.lastIndexOf(",");
        if(c > 30) return c + 1;
    }

    // ===============================
    // 4️⃣ 🔥 NOUVEAU : coupe de secours par longueur
    // (super important pour la réactivité)
    // ===============================
    if(text.length > 120){

        // coupe au dernier espace propre
        let space = text.lastIndexOf(" ");
        if(space > 40) return space;
    }

    return -1;
}

//////
function formatTTS(text){

    return text

        // virgules → petite pause
        .replace(/,/g, ", ")

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

  text = text.trim();

  // ✅ garder phrase complète si elle finit proprement
  if(/[.!?]$/.test(text)){
      return text;
  }

  // ✅ sinon couper au dernier espace (sécurité)
  const lastSpace = text.lastIndexOf(" ");
  if(lastSpace !== -1){
      return text.slice(0, lastSpace).trim();
  }

  return text;
}

//////
function commitAssistant(text){

    if(assistantMessageCommitted) return;
    //if(assistantFrozen && aiWasInterrupted === false) return;

    const clean = (text || "").trim();
    if(!clean) return;

    chatBuffer.push({
        role: "assistant",
        content: clean
    });

    assistantMessageCommitted = true;
    assistantPending = "";
}

//////
function normalizeEchoText(t){
    return (t || "")
        .toLowerCase()

        // 🔥 normalisation unicode
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")

        // 🔥 apostrophes unifiées
        .replace(/[’']/g, " ")

        // 🔥 tirets unifiés
        .replace(/[-–—]/g, " ")

        // 🔥 retire ponctuation restante
        .replace(/[^\w\s]/g, " ")

        // vire espace de tête
        .replace(/^\s+/, "")

        // 🔥 espaces propres
        .replace(/\s+/g, " ")
        .trim();
}

function echoScore(a, b){
    if(!a || !b) return 0;

    if(b.includes(a) || a.includes(b)) return 1;

    const aw = a.split(" ");
    let hit = 0;

    for(const w of aw){
        if(w.length < 3) continue;
        if(b.includes(w)) hit++;
    }

    return hit / aw.length;
}

function commonPrefixLength(a, b){
    const max = Math.min(a.length, b.length);
    let i = 0;
    while(i < max && a[i] === b[i]) i++;
    return i;
}

function looksLikeEcho(userText){

    const ref = assistantVisible || assistantPending;
    if (!ref) return false;

    const a = normalizeEchoText(userText);
    const b = normalizeEchoText(ref);

    if (a.length < 6) return false;

    // ===============================
    // 🔥 préfixe long (très fiable)
    // ===============================
    const MIN_PREFIX = 24;

    if (b.startsWith(a) && a.length >= MIN_PREFIX) return true;
    if (a.startsWith(b) && b.length >= MIN_PREFIX) return true;

    // ===============================
    // 🔥 overlap caractère par caractère
    // ===============================
    const prefixLen = commonPrefixLength(a, b);
    if(prefixLen > 28) return true;

    // ===============================
    // 🔥 similarité mots (fallback)
    // ===============================
    const score = echoScore(a, b);

    return score > 0.55;
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

    assistantFrozen = false;
    assistantMessageCommitted = false;
    aiWasInterrupted = false;

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

        if(assistantFrozen) return;
        if(myGen !== aiGeneration || assistantFrozen) return;

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

            // virer les asterix
            tok = tok.replace(/\*/g, "");

            // NE PLUS ÉCRIRE SI GELÉ
            if(!assistantFrozen){
              assistantPending += tok;
              ttsBuffer += tok;

              // fallback visuel si pas de TTS
              if(!speakerEnabled){
                  assistantVisible = assistantPending;
                  //renderLiveAssistant(assistantVisible); ???
              }
              speakChunk();
            }
        }
    };

    xhr.onload = ()=>{

      if(myGen !== aiGeneration) return;

      aiStreaming = false;
      aiBusy = false;

      /*// 🚨 SI INTERRUPTION → JAMAIS DE COMMIT
      if(assistantFrozen){
          return;
      }*/
      // 🚨 si interruption → JAMAIS de commit final
      if(aiWasInterrupted){
          return;
      }

      if(!assistantFrozen){
          flushTTS();
      }



      // FIN NORMALE UNIQUEMENT
      if(!assistantMessageCommitted){

          // ✅ vérité complète du LLM
          const finalText = assistantPending.trim();

          if(finalText){
              commitAssistant(finalText);
          }
      }

    };
    xhr.onerror = ()=>{
        aiStreaming = false;
        aiBusy = false;
    };

    xhr.send(form);
}

//////
function unlockIOSAudio(){
    if(iosAudioUnlocked) return;
    iosAudioUnlocked = true;

    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
}

// ******************************************************************
// *********************************************   $ready$  R E A D Y
$(document).ready(function () {

//  micro
$("#micBtn").on("click", () => {
  unlockIOSAudio();  //  déverrouille iOS
  micEnabled=!micEnabled;
  micEnabled ? recognition.start() : recognition.stop();
  $("#micBtn").toggleClass("btn-danger",micEnabled);
});

// haut-parleur
$("#spkBtn").on("click", () => {
  unlockIOSAudio();  //  déverrouille iOS
  speakerEnabled=!speakerEnabled;
  $("#spkBtn").toggleClass("btn-warning",speakerEnabled);

});

}); // *********************************************  F I N   R E A D Y
//  *******************************************************************
/*$("#spkBtn").trigger("click");
  setTimeout(()=>{
  $("#spkBtn").trigger("click");
}, 5);*/
