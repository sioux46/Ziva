// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.01.23.1";

// Exemple d'utilisation :
const chatTestBuffer = [
    { role: "system", content: "Vous êtes un assistant intelligent." },
    { role: "user", content: "Bonjour, comment ça va ?" },
    { role: "assistant", content: "Bonjour ! Je vais bien, merci. Et vous ?" },
    { role: "user", content: "Très bien, merci !" }
];

////////
async function askAssistant(message) {
  const response = await fetch("chatLLM_MISTRAL_L.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: message
    })
  });

  const data = await response.json();
  return data.reply;
}

/////////
async function sendToAI(chatBuffer) {
    var url;
    if ( window.location.href.lastIndexOf("8888") != -1 ) // si dans MAMP
          // url = "http://127.0.0.1:8000/chat";
          url = "http://ziva.local:8888/api/chat";
    else  url = "https://www.siouxlog.fr/api/chat";
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messages: chatBuffer,
            model: "mistral-large-latest",
            temperature: 0.7
        })
    });

    const data = await response.json();
    return data.reply;
}

//////
function test8000() {
  sendToAI(chatTestBuffer).then(reply => {
    console.log("AI:", reply);
});
}
