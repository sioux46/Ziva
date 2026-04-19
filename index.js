// index.js
/* jshint esversion: 10 */
/* jshint -W069 */ // Désactive les avertissements pour les propriétés en notation pointée

//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.04.19.1";

let chatBuffer = [];
let maxChatBuffer = 11;
let buttonInterruptAI = false;

let actualGeolocDefault = "Paris"; // "France";
let actualGeoLoc;

// une minute de silence
let lastSpeechTime = Date.now();
let silenceWatcher = null;

// n minutes restart
let restartWatcher = null;
let lastRestartTime = Date.now();

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
let speakerEnabled = false;

// iOS
let iosAudioUnlocked = false;

//const synth = window.speechSynthesis;

//                       ***************  R E C O G N I T I O N   *******************

let recognitionRunning = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "fr-FR";
recognition.continuous = true;
if ( isNotApple() ) recognition.interimResults = false;
else recognition.interimResults = true;

//----------------------------------------------  ONSTART
// suivre l’état réel du micro
recognition.onstart = ()=> {
  if ( !document.hasFocus() ) return;
  if (!micEnabled) return;
  if ( aiSpeaking && isNotApple() ) return; // barge in interdit
  recognitionRunning = true;
};

//------------------------------------------------ ONEND
// Chrome coupe parfois le micro en mode continu.
recognition.onend = ()=>{

    recognitionRunning = false;
    lastTTSEnd = Date.now();

    if ( !document.hasFocus() ) return;

    // 🔥 SEMI-DUPLEX : ne PAS redémarrer si IA parle
    if(isNotApple() && aiSpeaking){
        return;
    }

    if (micEnabled) {
        restartMicSafe(); // ← ton helper est parfait
    }
};

//------------------------------------------------ ONRESULT
recognition.onresult = e => {

  //if ( aiSpeaking && isNotApple() ) return; // barge in interdit

  let finalText = "";
  let interimText = "";
  let transcript = "";

  if ( !document.hasFocus() ) return;

  //console.log("RESULT RAW:", e.results);
  for (let i = e.resultIndex; i < e.results.length; i++) {
      /*console.log("res", i, {
          transcript: e.results[i][0].transcript,
          isFinal: e.results[i].isFinal
      });*/
      transcript = e.results[i][0].transcript;
      if(e.results[i].isFinal){
          finalText += transcript;
      }
      else{
          if ( isApple() ) interimText += transcript;
      }
  }

  if ( isNotApple() ) {
      if(finalText.trim()){
          submitUser(finalText);
      }
      return;
  }

  // 🔥 texte utilisé pour barge-in immédiat

  const bargeText = finalText || interimText;
  if(!bargeText) return;

  if(!aiSpeaking){ // début silence
      lastSpeechTime = Date.now();
  }

  // 🚨 filtre anti-écho intelligent
  const echoWindow = Date.now() - lastTTSEnd < 1500; // 400

  if ((aiSpeaking || echoWindow) && looksLikeEcho(finalText)) {
      console.warn("------------>>> IGNORED: echo detected");
      console.log("finalText:", finalText);
      return;
  }

    // 🚫 SEMI-DUPLEX : pas de barge-in micro sur non-Apple
  if(isNotApple() && aiSpeaking){
      return;
  }

  // barge-in ultra rapide
  if((aiSpeaking || aiStreaming) && micEnabled){

    interruptAI();

    setTimeout(()=>{
      renderChat();
      // on envoie au LLM seulement si final
      if(finalText){
        // 🔥 GARDE anti fuites
        if(looksLikeEcho(finalText)){
            console.warn("🚫 echo live bloqué (barge-in) finalText: ", finalText);
            return;
        }
        if(finalText.trim()){
            submitUser(finalText);
        }
      }
    }, 40); // 40
    return;
  }

  if(finalText.trim()){
      submitUser(finalText);
  }
};

  //-------------------------------------------------- ONERROR
recognition.onerror= ()=> recognitionRunning = false;


//************************************** F U N C T I O N S ************
//*********************************************************************

// STOP GLOBAL barge-in  //////////    i n t e r r u p t AI
function interruptAI(){

    const isBtn = buttonInterruptAI === true;

    // reset immédiat du flag bouton
    if ( buttonInterruptAI ) {
      buttonInterruptAI = false;
    }

    // 🤖 ANDROID : filtrage
    if(isNotApple() && !isBtn){ // isAndroid()

        console.log("⛔ Android-Windows: blocage interruption micro");
        return; // ❌ STOP ici → pas de vraie interruption
    }

    // 🔥 relancer micro si besoin
    if(isNotApple() && micEnabled){
      restartMicSafe();
    }

    // 🔒 idempotence dure
    if(aiWasInterrupted) return;

    console.log("interruptAI:");
    console.log("aiSpeaking: ", aiSpeaking);

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

        assistantMessageCommitted = false;
        if(snapshot){
            commitAssistant(snapshot);
        }
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

//                      ****************  S Y N T H E S I S  ******************

////////////////////////////      p l a y TTS
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

    const u = new SpeechSynthesisUtterance(supIconesUnicode(item.tts));

    u.lang  = "fr-FR";
    u.rate  = 1;
    u.pitch = 1.8;

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

        // 🔥 SEMI-DUPLEX
        if(isNotApple() && micEnabled  && document.hasFocus() ){
            try{
                recognition.abort(); // mieux que stop
            }catch(e){}
            recognitionRunning = false;
        }

        assistantVisible += item.raw;
        renderChat();
    };

    // ===============================
    // ⏹️ ONEND
    // ===============================
    u.onend = ()=>{

        aiSpeaking = false;
        lastTTSEnd = Date.now();

        // réactivation micro
        if( isNotApple() && micEnabled  && document.hasFocus() ){
            setTimeout(()=>{
                try{ recognition.start(); }
                catch(e){}
            }, 150);
        }

        // 🔒 ne rien relancer si interrompu
        if(myGen !== aiGeneration) return;
        if(assistantFrozen) return;
        if(aiWasInterrupted) return;
        if(ttsKilledGeneration === myGen) return;

        // continuer la file
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

//////////////////////////////////////
function speakChunk(){

    if(aiWasInterrupted) return;
    if(assistantFrozen) return;
    if(aiGeneration === interruptedGeneration) return;
    if(ttsBuffer.length < 80) return;  // 50 10 5 20  ???

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

/////////////////////////////////////
////// push user dans  chatBuffer
function addUser(text){
    if ( chatBuffer.length > maxChatBuffer ) chatBuffer.shift();
    chatBuffer.push({role:"user", content:text});
    renderChat();
}

///////////////////////////////////////
function isInternalLeak(text){
    return text.startsWith("INTERRUPTION: -->")
        && looksLikeEcho(text.replace("INTERRUPTION: -->","").trim());
}

/////////////////////////////////////////
function restartMicSafe(){
    if ( !document.hasFocus() ) return;
    if( !micEnabled  ) return;

    setTimeout(()=>{
        try{ recognition.start(); }
        catch(e){}
    }, 250);
}

//////
/*let isLoading = false;
let timer;

function submitUser(text) {
  if (isLoading) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
      doSubmitUser(text);
  }, 500); // 500ms minimum
}*/
/////////////////////////////////////////////////////////////////
async function submitUser(text) {   //    S U B M I T   U S E R ***********
/////////////////////////////////////////////////////////////////

    if (aiBusy) return;
    aiBusy = true;

    text = text.trim().replace(/\s+/g, " "); // bonus filtre écho


    // 🔥 PROTECTION FINALE ANTI-FUITE
    if(isInternalLeak(text)){
        console.warn("🚫 isInternalLeak bloqué:", text);
        aiBusy = false;
        return;
    }

    try {

        console.log("param de classifyUserQuestion(text): ", text);
        const classification = await classifyUserQuestion(text);
        console.log("is_weather: ", classification.is_weather);

        // ===============================
        // 🌦️ CAS MÉTÉO
        // ===============================
        if (classification.is_weather === "oui") {
            let wData = "";
            let weather = "";
            const coords = await fetchCoordinatesData(classification.location);

            let url = "";

            url = {
              latitude: coords.lat,
              longitude: coords.lon,
              hourly: "weather_code,temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m",
              start_date: classification.start_date,
              end_date: classification.end_date,
              timezone: "Europe/Paris"
            }

            const weatherData = await fetchWeatherData(url);
            wData = weatherData.hourly;

            weather = {
                      "weather_code": wData.weather_code,
                      "temperature": wData.temperature_2m,
                      "apparent_temperature": wData.apparent_temperature,
                      "precipitation": wData.precipitation,
                      "windspeed": wData.windspeed_10m,
                      "winddirection": wData.winddirection_10m,
                      "time": wData.time
            }

            console.log("weatherData: ", weatherData);
            console.log("weather: ", weather);
            let weatherPrompt = `
              Date du jour: ${Date()}.
              Voici les données météo en JSON :
              ${JSON.stringify(weather)}.
              - Résume la météo actuelle en français pour l'utilisateur, en réponse à sa question : "${text}".
              - Ne pas donner l'année pour les dates.
              - Ne pas dire "8,7°C" mais dire "8 degrés".
              - Ne pas dire "2,4 km/h" mais dire "2 kilomètres heure".
              - Ne pas dire "1,1 mm mais 1 millimètre".
              - Ne pas dire "171°" mais 171 degrés.
              - Ne pas dire "min" mais minimum.
              - Ne pas dire "max" mais maximum.
              - Ne pas dire "de 6 degrés minimum à 10 degrés maximum" mais "de 6 degrés à 10 degrés".
              - Pour la direction du vent, ne pas donner les degrés mais les points cardinaux.
              - Ne pas parler du temps qu'il a fait avant l'heure actuelle.
              - Utiliser des icônes unicode pour illustrer les conditions météo.
            `;

            if (aiWasInterrupted) text = "INTERRUPTION: --> " + text;
            //else text = "--> " + text;

            addUser(text);

            // 🔥 injection dans le LLM principal
            const newBuffer = structuredClone(chatBuffer);
            newBuffer.push({
                role: "system",
                content: weatherPrompt
            });

            sendToAI_php(newBuffer, "sysM");
        }

        // ===============================
        // 💬 CAS NORMAL
        // ===============================
        else {
            console.log( "Is_weather: NON");

            if (aiWasInterrupted) text = "INTERRUPTION: --> " + text;
            //else text = "--> " + text;

            addUser(text);
            sendToAI_php(chatBuffer, "userM");
        }

    } catch (e) {

        console.warn("Erreur classification:", e, "Traité comme cas normal");

        if (aiWasInterrupted) text = "INTERRUPTION: --> " + text;
        //else text = "--> " + text;

        addUser(text);
        sendToAI_php(chatBuffer, "userM");
    }

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

////////////////////////////////
function renderChat() {
    let out = "";
    for (let m of chatBuffer) {
      if(m.role === "user"){
        out += "👤 -->\n" + m.content + "\n";
      }
      if(m.role === "assistant"){
        out += "<-- 🤖 \n" + m.content + "\n";
      }
    }
    // Ajoute le texte en cours de génération
    if (assistantVisible && !assistantMessageCommitted) {
        out += "<-- 🤖 \n" + assistantVisible + "\n";
    }

    const chat = $("#chat")[0];
    //const isNearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 50;
    if ( aiWasInterrupted ) out += "\nINTERRUPTION: -->";
    $("#chat").val(out);

    chat.scrollTo({
      top: chat.scrollHeight,
      behavior: "smooth"
    });
    /*if (isNearBottom) {
      chat.scrollTop = chat.scrollHeight;
    }*/
}

////////////////////////////////////////
function findCutPoint(text){

    if(!text) return -1;

    // ===============================
    // 1️⃣ ponctuation forte (priorité max)
    // ===============================
    //let strong = /([.!?\n])(?=\s+[A-ZÀ-Ÿ-])/g;
    let strong = /([.!?])(?=\s+)/g;
    let m, lastStrong = -1;

    while ((m = strong.exec(text)) !== null) {
        lastStrong = m.index + 1;
    }
    if(lastStrong !== -1) {
      //console.log("-------->>> strong cut");
      return lastStrong;
    }

    //  saut de ligne = forte
    let nl = text.lastIndexOf("\n");
    if(nl > 40) {
      //console.log("-------->>> cut saut de ligne");
      return nl + 1;
    }

    // ===============================
    // 2️⃣ ponctuation moyenne
    // ===============================
    const mid = [";", ":", "—", "–", ")"];
    for(let p of mid){
        let idx = text.lastIndexOf(p);
        if(idx > 30) {
          //console.log("-------->>> moyenne cut");
          return idx + 1;
        }
    }

    // ===============================
    // 3️⃣ virgule agressive (clé barge-in)
    // ===============================
    if(text.length > 60){
        let c = text.lastIndexOf(",");
        if(c > 30) {
          //console.log("-------->>> virgule agressive (clé barge-in)");
          return c + 1;
        }
    }

    // ===============================
    // 4️⃣ 🔥 NOUVEAU : coupe de secours par longueur
    // (super important pour la réactivité)
    // ===============================
    //if(text.length > 80){  //  120 ???
    if(text.length > 60) { // 120

        // coupe au dernier espace propre
        let space = text.lastIndexOf(" ");
        if(space > 40) {
          //console.log("-------->>> cut au dernier espace propre");
          return space;
        }
    }

    return -1;
}

///////////////////////////////////////
function formatTTS(text){

    return text

        // normaliser espaces
        .replace(/\s+/g," ")

        // respiration légère
        .replace(/,/g,", ")

        // pause moyenne
        .replace(/;/g,"; ")
        .replace(/:/g,": ")

        // tirets parlés
        .replace(/\s-\s/g," — ")

        // ligne -> pause douce
        .replace(/\n+/g,", ")

        .trim();
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

    const clean = (text || "").trim();
    if(!clean) return;

    if(assistantFrozen && aiWasInterrupted === true) {
      if(chatBuffer.length && chatBuffer.at(-1).role === "assistant"){
          chatBuffer.pop(); // sup der elem
      }
    }

    if ( chatBuffer.length > maxChatBuffer ) chatBuffer.shift();
    chatBuffer.push({
        role: "assistant",
        content: clean
    });

    lastRestartTime = Date.now();
    startRestartWatcher();


    assistantMessageCommitted = true;
    assistantPending = "";
}

///////////////////////////////////////////
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

    // 🔥 garde absolue simple (nouvelle)
    if(assistantVisible && userText.length > 6){
        if(assistantVisible.toLowerCase().includes(userText.toLowerCase())){
            return true;
        }
    }

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

//////////////////////////////////////////////////////////////////////
////////////////////////////////////////////        STREAMING MISTRAL
//////////////////////////////////////////////////////////////////////
function sendToAI_php(chatBuffer, origine){

    const csrf = document.querySelector('meta[name="csrf-token"]').content;
    let city;

    try { city = actualGeoLoc.city }
    catch(e) {
      city = actualGeolocDefault;
      console.warn('Echec de la retro-localisation', e);
      $("#chat").val($("#chat").val() + "\nERREUR: Géolocalisation absente !!!\n" + actualGeolocDefault + " par défaut.");
    }

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
    form.append("localisation", JSON.stringify(city));
    form.append("origine", JSON.stringify(origine));
    form.append("date", JSON.stringify(Date()));

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
            tok = tok.replace(/\*+/g, '').replace(/"+/g, '');

            // NE PLUS ÉCRIRE SI GELÉ
            if(!assistantFrozen){
              assistantPending += tok;
              ttsBuffer += tok;

              // fallback visuel si pas de TTS
              if(!speakerEnabled){
                //assistantVisible = assistantPending; // avant
                // 🔥 toujours garder une source visible // après
                assistantVisible += tok;   // ⚠️ pas = mais +=
                renderChat();
              }
              //console.log("assistantPending: ", assistantPending);
              //console.log("ttsBuffer: ", ttsBuffer);
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
//////////////////////////////// F I N   M I S T R A L  XMLHttpRequest
/////////////////////////////////////////////////////////////////////////

//////
function unlockIOSAudio(){
    if(iosAudioUnlocked) return;
    iosAudioUnlocked = true;

    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
}

//////
function startSilenceWatcher(){ // couper le mic après 1mn de silence

    if(silenceWatcher) clearInterval(silenceWatcher);
    silenceWatcher = setInterval(()=>{
        if(!micEnabled) return;

        const silence = Date.now() - lastSpeechTime;
        if(silence > 240000){   // 4 minute
            console.log("Micro coupé : 1 minute de silence");
            clearInterval(silenceWatcher);
            silenceWatcher = null;

            $("#micBtn").trigger("click"); // simule clic bouton
        }

    }, 1000);
}

//////
function startRestartWatcher(){ // restart 20 mm inactivité

    if(restartWatcher) clearInterval(restartWatcher);
    restartWatcher = setInterval( () => {
        const silence = Date.now() - lastRestartTime;
        if(silence > 1200000){   //  20 minutes
            clearInterval(restartWatcher);
            restartWatcher = null;

            const loc = window.location.href;
            window.location.href = loc;
        }

    }, 1000);
}

//////
function isAndroid() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    return /android/i.test(userAgent);
}
function isWindows() {
    return /Windows/i.test(navigator.userAgent);
}
function isNotApple() {
    return isAndroid() || isWindows(); // même traitement pour les deux
}
function isApple() {
    return !isNotApple();
}

//////
function sendTextInput(){

  const input = $("#textInput");
  let text = input.val().trim();
  if(!text) return;

  // 🔥 comportement IDENTIQUE au vocal
  if(aiSpeaking || aiStreaming){
    buttonInterruptAI = true;
    interruptAI();
  }

  input.val("");
  submitUser(text);
}

// ******************************************************************
// ******************************************************************
// *********************************************   $ready$  R E A D Y
$(document).ready(function () {

  $("#version").text(zivaVersion);

  //////////////////////////////      micro
  //if ( $("#micBtn").hasClass("btn-danger") ) micEnabled = true;

  $("#micBtn").on("click", () => {
    unlockIOSAudio();
    micEnabled = !micEnabled;

    if(micEnabled){
      try { recognition.start(); }catch(e){}
      lastSpeechTime = Date.now();
      startSilenceWatcher();
    }else{
        recognition.stop();
    }

    if (  micEnabled ) $("#micBtn").addClass("btn-danger");
    else $("#micBtn").removeClass("btn-danger").css("background-color: transparent !important;");
  });

  /////////////////////////////     haut-parleur
  $("#spkBtn").on("click", () => {
    unlockIOSAudio();  //  déverrouille iOS
    speakerEnabled=!speakerEnabled;
    if (  speakerEnabled ) $("#spkBtn").addClass("btn-warning");
    else $("#spkBtn").removeClass("btn-warning").css("background-color: transparent !important;");
  });

//-----------------------
  $("#cutBtn").on("click", () => {
    buttonInterruptAI = true;
    interruptAI();
  });

//-----------------------
  $("#trashBtn").on("click", () => {
    $("#chat").val("");
    chatBuffer = [];
    if( micEnabled /*&& isAndroid()*/ ){
      setTimeout(()=>{
        try{ recognition.start(); }
        catch(e){ console.log("recog start:", e); }
      }, 250); // 🔥 indispensable Android
    }
  });

//----------------------
// clic bouton envoi texte
$("#sendBtn").on("click", sendTextInput);

// keyboard ENTER
$("#textInput").on("keydown", function(e){
  if(e.key === "Enter"){
    e.preventDefault();
    sendTextInput();
  }
});
$("#textInput").focus();

//--------------------- effet click/touch
["sendBtn", "cutBtn", "trashBtn"].forEach(id => {
  const btn = document.getElementById(id);

  // Mobile
  btn.addEventListener("touchstart", () => btn.classList.add("active"));
  btn.addEventListener("touchend", () => btn.classList.remove("active"));

  // Souris
  btn.addEventListener("mousedown", () => btn.classList.add("active"));
  btn.addEventListener("mouseup", () => btn.classList.remove("active"));

  // Sécurité : si la souris sort du bouton
  btn.addEventListener("mouseleave", () => btn.classList.remove("active"));
});

//---------------------
  setTimeout(function() {
    getLocation();   // pour charger geoCoor
    //$("#showTravellerButton").trigger("click");  // show traveller display on startup
}, 1000);

//---------------------
$(window).focus( function() {
  startSilenceWatcher(); // start mic listening interval
  startRestartWatcher(); // start unactivity interval
});


//----------------------
//if ( isNotApple() ) $("#cutBtn").prop("disabled", false);
//else $("#cutBtn").prop("disabled", true);


}); // *********************************************  F I N   R E A D Y
//  *******************************************************************
