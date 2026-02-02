// index.js
//
// Nomenclature : [Années depuis 2020].[Mois].[Jour].[Nombre dans la journée]
var zivaVersion = "v6.01.23.1";

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
    const response = await fetch("https://www.siouxlog.fr/api/chat", {
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

// Exemple d'utilisation :
const chatBuffer = [
    { role: "system", content: "Vous êtes un assistant intelligent." },
    { role: "user", content: "Bonjour, comment ça va ?" },
    { role: "assistant", content: "Bonjour ! Je vais bien, merci. Et vous ?" },
    { role: "user", content: "Très bien, merci !" }
];

//////
function test8000() {
  sendToAI(chatBuffer).then(reply => {
    console.log("AI:", reply);
});
}
