// index.js - Version Android Optimisée
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.03.07.1-android";

let chatBuffer = [];
let lastSpeechTime = Date.now();
let silenceWatcher = null;
let aiStreaming = false;
let aiSpeaking = false;
let aiBusy = false;
let aiGeneration = 0;
let ttsKilledGeneration = -1;
let assistantMessageCommitted = false;
let interruptedGeneration = -1;
let assistantPending = "";
let assistantVisible = "";
let aiWasInterrupted = false;
let assistantFrozen = false;
let ttsBuffer = "";
let ttsQueue = [];
let lastTTSEnd = 0;
let xhrLLM = null;
let micEnabled = false;
let speakerEnabled = true;
let iosAudioUnlocked = false;
let recognitionRunning = false;

const synth = window.speechSynthesis;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "fr-FR";
recognition.continuous = true;
recognition.interimResults = true;

//------------------------------
// Suivre l’état réel du micro
recognition.onstart = () => {
    recognitionRunning = true;
};

//------------------------------
// Android : gestion du micro plus robuste
recognition.onend = () => {
    recognitionRunning = false;
    lastTTSEnd = Date.now();
    if (micEnabled) {
        setTimeout(() => {
            try {
                recognition.start();
            } catch (e) {
                logAndroidIssue("Erreur de redémarrage du micro : " + e);
            }
        }, 200);
    }
};

//-------------------------------
recognition.onresult = e => {
    let finalText = "";
    let interimText = "";

    for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
            finalText += transcript;
        } else {
            interimText += transcript;
        }
    }

    const bargeText = finalText || interimText;
    if (!bargeText) return;

    if (!aiSpeaking) {
        lastSpeechTime = Date.now();
    }

    const echoWindow = Date.now() - lastTTSEnd < 400;
    if ((aiSpeaking || echoWindow) && looksLikeEcho(finalText)) {
        console.log("------------>>> IGNORED: echo detected");
        console.log("finalText:", finalText);
        return;
    }

    if ((aiSpeaking || aiStreaming) && bargeText) {
        interruptAI();
        setTimeout(() => {
            renderChat();
            if (finalText) {
                submitUser(finalText);
            }
        }, 40);
        return;
    }
    if (finalText) {
        submitUser(finalText);
    }
};

//-------------------------------
recognition.onerror = () => {
    recognitionRunning = false;
    logAndroidIssue("Erreur de reconnaissance vocale");
};

//************************************** F U N C T I O N S ************
//*********************************************************************

// STOP GLOBAL barge-in
function interruptAI() {
    if (aiWasInterrupted) return;
    console.log("interruptAI:");
    aiWasInterrupted = true;
    assistantFrozen = true;
    interruptedGeneration = aiGeneration;
    ttsKilledGeneration = aiGeneration;
    const snapshot = cleanAssistantText(assistantVisible);
    assistantPending = assistantVisible;

    if (xhrLLM) {
        try {
            xhrLLM.abort();
        } catch (e) {
            logAndroidIssue("Erreur d'annulation de la requête : " + e);
        }
        xhrLLM = null;
    }

    aiStreaming = false;

    try {
        speechSynthesis.cancel();
    } catch (e) {
        logAndroidIssue("Erreur d'annulation de la synthèse vocale : " + e);
    }

    aiSpeaking = false;
    ttsBuffer = "";
    ttsQueue.length = 0;

    if (snapshot && snapshot.trim().length > 0) {
        assistantMessageCommitted = false;
        renderLiveAssistant(assistantVisible);
        commitAssistant(snapshot);
    }

    aiBusy = false;
    renderChat();
}

//---------------------------
// Android : synthèse vocale optimisée
function playTTS() {
    const myGen = aiGeneration;
    if (!speakerEnabled || aiSpeaking || assistantFrozen || aiWasInterrupted || ttsKilledGeneration === myGen || myGen !== aiGeneration || ttsQueue.length === 0) {
        return;
    }

    const item = ttsQueue.shift();
    if (!item) return;

    const u = new SpeechSynthesisUtterance(item.tts);
    u.lang = "fr-FR";
    u.rate = 0.9;
    u.pitch = 1.4;

    u.onstart = () => {
        if (myGen !== aiGeneration || assistantFrozen || aiWasInterrupted || ttsKilledGeneration === myGen) {
            return;
        }
        aiSpeaking = true;
        assistantVisible += item.raw;
        renderLiveAssistant(assistantVisible);
    };

    u.onend = () => {
        aiSpeaking = false;
        lastTTSEnd = Date.now();
        if (myGen !== aiGeneration || assistantFrozen || aiWasInterrupted || ttsKilledGeneration === myGen) {
            return;
        }
        playTTS();
    };

    u.onerror = () => {
        aiSpeaking = false;
        if (assistantFrozen || aiWasInterrupted || ttsKilledGeneration === myGen) {
            return;
        }
        playTTS();
    };

    try {
        speechSynthesis.speak(u);
    } catch (e) {
        aiSpeaking = false;
        logAndroidIssue("Erreur de synthèse vocale : " + e);
    }
}

//---------------------------
function speakChunk() {
    if (aiWasInterrupted || assistantFrozen || aiGeneration === interruptedGeneration || ttsBuffer.length < 5) {
        return;
    }

    let cut = findCutPoint(ttsBuffer);
    if (cut === -1) {
        if (ttsBuffer.length > 100) {
            cut = 100;
            let lastSpace = ttsBuffer.lastIndexOf(" ", cut);
            if (lastSpace > 0) {
                cut = lastSpace;
            }
        } else {
            return;
        }
    }

    let raw = ttsBuffer.slice(0, cut + 1);
    ttsBuffer = ttsBuffer.slice(cut + 1);
    let tts = formatTTS(raw);
    ttsQueue.push({ raw: raw, tts: tts });
    playTTS();
}

//---------------------------
function flushTTS() {
    if (assistantFrozen) return;
    if (ttsBuffer.trim().length === 0) return;
    let raw = ttsBuffer;
    let tts = formatTTS(raw);
    ttsQueue.push({ raw: raw, tts: tts });
    ttsBuffer = "";
    playTTS();
}

//---------------------------
function addUser(text) {
    chatBuffer.push({ role: "user", content: text });
    renderChat();
}

//---------------------------
function submitUser(text) {
    if (aiBusy) return;
    aiBusy = true;
    if (aiWasInterrupted) text = "Interruption: " + text;
    addUser(text);
    sendToAI_php(chatBuffer);
}

//---------------------------
function renderChat() {
    let out = "";
    for (let m of chatBuffer) {
        out += m.content + "\n";
    }
    if (assistantVisible && !assistantMessageCommitted) {
        out += assistantVisible + "\n";
    }
    out = supDoublons(out);
    $("#chat").text(out);
}

//---------------------------
function renderLiveAssistant() {
    let history = "";
    for (let m of chatBuffer) {
        history += m.content + "\n";
    }
    history = supDoublons(history);
    $("#chat").text(history);
}

//---------------------------
function supDoublons(out) {
    const sansDoublon = out.split('\n').slice(0, -1).join('\n');
    if (sansDoublon !== "") {
        if (out.split('\n').pop() === sansDoublon.split('\n').pop()) {
            out = sansDoublon;
        }
    }
    return out;
}

//---------------------------
// Android : détection d'écho ajustée
function looksLikeEcho(userText) {
    const ref = assistantVisible || assistantPending;
    if (!ref) return false;

    const a = normalizeEchoText(userText);
    const b = normalizeEchoText(ref);

    if (a.length < 4) return false;

    const MIN_PREFIX = 16;
    if (b.startsWith(a) && a.length >= MIN_PREFIX) return true;
    if (a.startsWith(b) && b.length >= MIN_PREFIX) return true;

    const prefixLen = commonPrefixLength(a, b);
    if (prefixLen > 20) return true;

    const score = echoScore(a, b);
    return score > 0.4;
}

//---------------------------
function findCutPoint(text) {
    if (!text) return -1;

    let strong = /([.!?])(?=\s+)/g;
    let m, lastStrong = -1;
    while ((m = strong.exec(text)) !== null) {
        lastStrong = m.index + 1;
    }
    if (lastStrong !== -1) {
        return lastStrong;
    }

    const mid = [";", ":", "—", "–", ")"];
    for (let p of mid) {
        let idx = text.lastIndexOf(p);
        if (idx > 30) {
            return idx + 1;
        }
    }

    if (text.length > 60) {
        let c = text.lastIndexOf(",");
        if (c > 30) {
            return c + 1;
        }
    }

    if (text.length > 60) {
        let space = text.lastIndexOf(" ");
        if (space > 40) {
            return space;
        }
    }

    return -1;
}

//---------------------------
function formatTTS(text) {
    return text
        .replace(/,/g, ", ")
        .replace(/;/g, "; ")
        .replace(/:/g, ": ")
        .replace(/\s-\s/g, "... ")
        .replace(/\n+/g, ". ")
        .replace(/\s{2,}/g, " ");
}

//---------------------------
function cleanAssistantText(text) {
    if (!text) return "";
    text = text.trim();
    if (/[.!?]$/.test(text)) {
        return text;
    }
    const lastSpace = text.lastIndexOf(" ");
    if (lastSpace !== -1) {
        return text.slice(0, lastSpace).trim();
    }
    return text;
}

//---------------------------
function commitAssistant(text) {
    if (assistantMessageCommitted) return;
    const clean = (text || "").trim();
    if (!clean) return;
    if (assistantFrozen && aiWasInterrupted === true) {
        chatBuffer = chatBuffer.slice(0, -1);
    }
    chatBuffer.push({ role: "assistant", content: clean });
    assistantMessageCommitted = true;
    assistantPending = "";
}

//---------------------------
function normalizeEchoText(t) {
    return (t || "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[’']/g, " ")
        .replace(/[-–—]/g, " ")
        .replace(/[^\w\s]/g, " ")
        .replace(/^\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
}

//---------------------------
function echoScore(a, b) {
    if (!a || !b) return 0;
    if (b.includes(a) || a.includes(b)) return 1;
    const aw = a.split(" ");
    let hit = 0;
    for (const w of aw) {
        if (w.length < 3) continue;
        if (b.includes(w)) hit++;
    }
    return hit / aw.length;
}

//---------------------------
function commonPrefixLength(a, b) {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) i++;
    return i;
}

//---------------------------
// Android : logs améliorés
function logAndroidIssue(message) {
    console.error("[ANDROID-ISSUE] " + message);
    // Optionnel : envoyer les logs à un serveur
}

//---------------------------
function sendToAI_php(chatBuffer) {
    const csrf = document.querySelector('meta[name="csrf-token"]').content;
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
    let xhr = new XMLHttpRequest();
    xhrLLM = xhr;
    aiStreaming = true;

    xhr.open("POST", "chatLLM.php", true);
    xhr.withCredentials = true;

    let form = new FormData();
    form.append("chatBuffer", JSON.stringify(structuredClone(chatBuffer)));
    form.append("csrf", csrf);

    xhr.onprogress = () => {
        if (assistantFrozen) return;
        if (myGen !== aiGeneration || assistantFrozen) return;

        let chunk = xhr.responseText.substring(lastSize);
        lastSize = xhr.responseText.length;

        let lines = chunk.split("\n");
        for (let l of lines) {
            if (!l.startsWith("data:")) continue;
            if (l.includes("[DONE]")) return;

            let j;
            try {
                j = JSON.parse(l.slice(5));
            } catch {
                continue;
            }

            let tok = j.choices?.[0]?.delta?.content;
            if (!tok) continue;

            tok = tok.replace(/\*/g, "");

            if (!assistantFrozen) {
                assistantPending += tok;
                ttsBuffer += tok;

                if (!speakerEnabled) {
                    assistantVisible = assistantPending;
                }
                speakChunk();
            }
        }
    };

    xhr.onload = () => {
        if (myGen !== aiGeneration) return;
        aiStreaming = false;
        aiBusy = false;

        if (aiWasInterrupted) {
            return;
        }

        if (!assistantFrozen) {
            flushTTS();
        }

        if (!assistantMessageCommitted) {
            const finalText = assistantPending.trim();
            if (finalText) {
                commitAssistant(finalText);
            }
        }
    };

    xhr.onerror = () => {
        aiStreaming = false;
        aiBusy = false;
        logAndroidIssue("Erreur de chargement de la requête LLM");
    };

    xhr.send(form);
}
/////////////////////////////////////// F I N    M I S T R A L

//////
function unlockIOSAudio(){
    if(iosAudioUnlocked) return;
    iosAudioUnlocked = true;

    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
}

//////
function startSilenceWatcher(){

    if(silenceWatcher) clearInterval(silenceWatcher);
    silenceWatcher = setInterval(()=>{
        if(!micEnabled) return;

        const silence = Date.now() - lastSpeechTime;
        if(silence > 60000){   // 1 minute
            console.log("Micro coupé : 1 minute de silence");
            clearInterval(silenceWatcher);
            silenceWatcher = null;

            $("#micBtn").trigger("click"); // simule clic bouton
        }

    }, 1000);
}


// ******************************************************************
// *********************************************   $ready$  R E A D Y
$(document).ready(function () {

///////  micro
$("#micBtn").on("click", () => {
  unlockIOSAudio();

  micEnabled = !micEnabled;

  if(micEnabled){
      recognition.start();
      lastSpeechTime = Date.now();
      startSilenceWatcher();
  }else{
      recognition.stop();
  }

  $("#micBtn").toggleClass("btn-danger",micEnabled);
});

/////// haut-parleur
$("#spkBtn").on("click", () => {
  unlockIOSAudio();  //  déverrouille iOS
  speakerEnabled=!speakerEnabled;
  $("#spkBtn").toggleClass("btn-warning",speakerEnabled);

});

}); // *********************************************  F I N   R E A D Y
//  *******************************************************************
