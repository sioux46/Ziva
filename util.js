//
//
///////////////////////////  Mistral //////////////////

//////
function fetchWeatherFromMistral(location, userQuestion) {
    // 1. Envoyer la question à Mistral pour obtenir les coordonnées ou la confirmation
    const weatherPrompt = `L'utilisateur demande la météo pour ${location}. Donne-moi les coordonnées GPS (latitude, longitude) pour cette localisation, ou utilise Paris par défaut. Réponds uniquement avec un objet JSON comme ceci : {"latitude":XX.XX, "longitude":YY.YY}.`;
    const weatherChatBuffer = structuredClone(chatBuffer);
    weatherChatBuffer.push({ role: "user", content: weatherPrompt });

    // Appel à Mistral pour obtenir les coordonnées
    $.ajax({
        url: "chatLLM2.php",
        method: "POST",
        data: {
            chatBuffer: JSON.stringify(weatherChatBuffer),
            csrf: document.querySelector('meta[name="csrf-token"]').content
        },
        success: function(response) {
            try {
                // 1. Décoder la réponse (si elle est une chaîne JSON échappée)
                let decodedResponse;
                try {
                    decodedResponse = typeof response === "string" ? JSON.parse(response) : response;
                } catch (e) {
                    // Si ce n'est pas un JSON valide, utiliser la réponse brute
                    decodedResponse = response;
                }

                // 2. Extraire le contenu JSON depuis le format Markdown

                const jsonMatch = decodedResponse.match(/```json\n([\s\S]*?)\n```/);
                if (!jsonMatch || jsonMatch.length < 2) {
                    throw new Error("Format de réponse inattendu (bloc JSON non trouvé)");
                }
                const jsonStr = jsonMatch[1].trim();

                // 3. Parser le JSON extrait
                const coors = JSON.parse(jsonStr);
                fetchWeather(coors.latitude, coors.longitude, userQuestion);

            } catch (e) {
                console.error("Erreur lors du parsing des coordonnées :", e);
                fetchWeather(48.84, 2.36, userQuestion); // Paris par défaut
            }
        },
        error: function(xhr, status, error) {
            console.error("Erreur lors de la récupération des coordonnées :", error);
            fetchWeather(48.84, 2.36, userQuestion); // Paris par défaut
        }
    });
}

//////
function fetchWeather(latitude, longitude, userQuestion) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=Europe/Paris`;

    $.ajax({
        url: url,
        method: 'GET',
        dataType: 'json',
        success: function(data) {
            // Envoyer les données météo à Mistral pour traduction et réponse
            const weatherData = JSON.stringify(data);
            const weatherPrompt = `Voici les données météo en JSON : ${weatherData}. Résume la météo actuelle en français pour l'utilisateur, en réponse à sa question : "${userQuestion}". Donne un minimum de détails (une phrase courte)`;
            const weatherChatBuffer = structuredClone(chatBuffer);
            weatherChatBuffer.push({ role: "user", content: weatherPrompt });

            $.ajax({
                url: "chatLLM2.php",
                method: "POST",
                data: {
                    chatBuffer: JSON.stringify(weatherChatBuffer),
                    csrf: document.querySelector('meta[name="csrf-token"]').content
                },
                success: function(response) {
                    try {
                        const mistralResponse = JSON.parse(response).replace(/\*+/g, '"');
                        //const weatherResponse = mistralResponse.choices[0].message.content;

                        addUser(userQuestion);
                        chatBuffer.push({ role: "assistant", content: mistralResponse });
                        renderChat();
                        aiBusy = false;
                        micEnabled = true;
                    } catch (e) {
                        console.error("Erreur lors du parsing de la réponse météo :", e);
                        aiBusy = false;
                        micEnabled = true;
                    }
                },
                error: function(xhr, status, error) {
                    console.error("Erreur lors de la récupération de la réponse météo :", error);
                    aiBusy = false;
                    micEnabled = true;
                }
            });
        },
        error: function(xhr, status, error) {
            console.error("Erreur lors de la récupération des données météo :", error);
            aiBusy = false;
            micEnabled = true;
        }
    });
}

//////
function classifyUserQuestion(text) {
    const classificationPrompt = `
    L'utilisateur a dit : "${text}".
    1. Détermine si cette question concerne la météo (réponds uniquement par "oui" ou "non").
    2. Si oui, extrais la localisation (ville, région, pays) mentionnée, ou utilise "Paris" par défaut.
    3. Réponds avec un objet JSON strictement formaté comme ceci :
    {
      "is_weather": "oui" ou "non",
      "location": "nom de la localisation ou 'Paris'",
      "reason": "explication courte de la décision"
    }
  `;
    const classificationChatBuffer = structuredClone(chatBuffer);
    classificationChatBuffer.push({ role: "user", content: classificationPrompt });

    return new Promise((resolve, reject) => {
        $.ajax({
            url: "chatLLM2.php",
            method: "POST",
            data: {
                chatBuffer: JSON.stringify(classificationChatBuffer),
                csrf: document.querySelector('meta[name="csrf-token"]').content
            },
            success: function(response) {
              try {
                  // 1. Décoder la réponse (si elle est une chaîne JSON échappée)
                  let decodedResponse;
                  try {
                      decodedResponse = typeof response === "string" ? JSON.parse(response) : response;
                  } catch (e) {
                      // Si ce n'est pas un JSON valide, utiliser la réponse brute
                      decodedResponse = response;
                  }

                  // 2. Extraire le contenu JSON depuis le format Markdown
                  const jsonMatch = decodedResponse.match(/```json\n([\s\S]*?)\n```/);
                  if (!jsonMatch || jsonMatch.length < 2) {
                      throw new Error("Format de réponse inattendu (bloc JSON non trouvé)");
                  }
                  const jsonStr = jsonMatch[1].trim();

                  // 3. Parser le JSON extrait
                  const classification = JSON.parse(jsonStr);
                  resolve(classification);
              } catch (e) {
                  console.error("Erreur de parsing :", e, response);
                  reject(e);
              }
            },
            error: function(xhr, status, error) {
                console.error("Erreur AJAX :", error);
                reject(error);
            }
        });
    });
}

//////
// Fonction pour convertir le code WMO en description textuelle
function getWeatherDescription(code) {
    const descriptions = {
        0: "Ciel dégagé",
        1: "Principalement dégagé",
        2: "Partiellement nuageux",
        3: "Couvert",
        45: "Brouillard",
        48: "Brouillard givrant",
        51: "Bruine légère",
        53: "Bruine modérée",
        55: "Bruine dense",
        56: "Bruine verglaçante légère",
        57: "Bruine verglaçante dense",
        61: "Pluie légère",
        63: "Pluie modérée",
        65: "Pluie forte",
        66: "Pluie verglaçante légère",
        67: "Pluie verglaçante forte",
        71: "Chute de neige légère",
        73: "Chute de neige modérée",
        75: "Chute de neige forte",
        77: "Neige en grains",
        80: "Averses de pluie légères",
        81: "Averses de pluie modérées",
        82: "Averses de pluie violentes",
        85: "Averses de neige légères",
        86: "Averses de neige fortes",
        95: "Orage",
        96: "Orage avec grêle légère",
        99: "Orage avec grêle forte"
    };
    return descriptions[code] || "Condition inconnue";
}




//*********************** METEO seb ******************************

var watchID = 0;  // geoloc
var geoCoor = {};

////////////////////////////  GEOLOCALISATION   $geoloc

/////
function getLocation() {
  if (navigator.geolocation) {
    watchID = navigator.geolocation.watchPosition(showPosition);
  } else {
    x.innerHTML = "Geolocation is not supported by this browser.";
  }
}

/////
function showPosition(position) {
    actualPosition = position;

    //console.log("geoloc: " + testGeoCount );
    reverseLocation(position.coords.latitude, position.coords.longitude);
    geoCoor.latitude = position.coords.latitude;
    geoCoor.longitude = position.coords.longitude;
}

/////
function reverseLocation(lat, lon) {
const url = 'https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lon + '&format=geocodejson&zoom=18&addressdetails=1';

fetch(url)
  .then(response => {
    if (!response.ok) {
      throw new Error('Erreur réseau');
    }
    return response.json();
  })
  .then(data => {
    actualGeoLoc = data.features[0].properties.geocoding;
    console.log(actualGeoLoc.label);
    /*$("#geoLocText").text(actualGeoLoc.label + "\n[" + testGeoCount + "]");
    $("#geoLocText").text(displayGeoLocLabel());
    testGeoCount++;
    if ( activePage == "#voyage" ) {
      displayMap();
    }*/
  })
  .catch(error => {
    console.error('Echec de la retro-localisation', error);
  });
}

/*////// météo france
function fetchWeather(latitude, longitude) {
  //const latitude = 48.84;
  //const longitude = 2.36;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;

  $.ajax({
      url: url,
      method: 'GET',
      dataType: 'json',
      success: function(data) {
          // envoyer data à mistral
      },
      error: function(xhr, status, error) {
          console.error("Erreur lors de la récupération des données météo :", error);
          $('#weather-data').html("Impossible de charger les données météo.");
      }
  });
}*/


//***********************************************************************
//////
function getBestFemaleVoice() {  // not used

  const voices = speechSynthesis.getVoices();

  const preferred = [
    "Google français",
    //"Samantha",
    "Microsoft Hortense",
    "Amelie"
  ];

  for (let name of preferred) {
    const v = voices.find(v => v.name.includes(name));
    if (v) return v;
  }

  return voices.find(v => v.lang.startsWith("fr"));
}




//***********************************************************************
