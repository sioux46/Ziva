// util.js
/* jshint esversion: 10 */
/* jshint -W069 */ // Désactive les avertissements pour les propriétés en notation pointée
///////////////////////////  Mistral //////////////////

//////
async function fetchCoordinatesData(location) {

    let loc = location.replace(/,.*/, ""); // ne garder que le premier mot
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=fr&format=json`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.results && data.results.length > 0) {
            return {
                lat: data.results[0].latitude,
                lon: data.results[0].longitude
            };
        }
    } catch(e){
        console.warn("Erreur latitude/longitude: géocoding-api:", e);
        //

    }

    return { lat: geoCoor.latitude, lon: geoCoor.longitude }; // position actuelle
    //return obtenirPosition(); // geoloc de l'apareil
}

///////
async function fetchWeatherData(params) {
  const query = new URLSearchParams(params).toString();

  try {
    const response = await fetch(`weather.php?${query}`);
    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }
    return await response.json();
    } catch (error) {
      console.error("Erreur météo :", error);
      return null;
  }
}

//////////////////////////////////
let debounceTimer = null;
let isLoading = false;
////// question is about meteo ?
function classifyUserQuestion(text) {

    let loc;
    try { loc = actualGeoLoc.city }
    catch(e) {
      loc = actualGeolocDefault;
      //console.warn('Echec de la retro-localisation', e);
      $("#chat").text($("#chat").text() + "\nERREUR: Géolocalisation absente !!!\n" + actualGeolocDefault + " par défaut.");
    }

    const classificationPrompt =  `
Voici la date : ${new Date()}.
L'utilisateur vient de dire : "${text}".
1.
- extraire la localisation (ville, région, pays) mentionnée ( utiliser ${loc} par défaut).
- Déterminer la date de départ ("start_date") et la date de fin ("end_date").
2.
- Si l'utilisateur indique sa satisfaction ("merci", "Entendu", "c'est bon", "j'ai compris", etc.), répondre "is_weather": "non".
- Si la question concerne la météo, répondre "is_weather": "oui".
- Dans tout autre cas, répondre "is_weather": "non".
-3.
- Réponds TOUJOURS ET UNIQUEMENT avec du JSON valide formater comme ceci:
{
"is_weather": "oui" ou "non",
"location": "nom de la localisation ou par défaut ${loc}",
"start_date": "<année>-<mois>-<jour>" (exemple: "2026-04-12"),
"end_date": "<année>-<mois>-<jour>" (exemple: "2026-04-14")
}
- Ne rien ajouter après le json.
`
    /*
    "reason": "explication très courte de la décision"

        1.
        L'utilisateur vient de dire : "${text}".
        - Si l'utilisateur indique sa satisfaction ("merci", "Entendu", "c'est bon", "j'ai compris", etc.), répondre "is_weather": "non".
        - Si sa question concerne la météo, répondre "is_weather": "oui".
          sinon: répondre "is_weather": "non".
        - extrais la localisation (ville, région, pays) mentionnée ( utilise ${loc} par défaut).
        - Détermine la date de départ ("start_date") et la date de fin ("end_date").
        - Ignorer tous les autre sujets évoqués par l'utilisateur.
        2.
        - Réponds TOUJOURS ET UNIQUEMENT avec du JSON valide formater comme ceci:
        {
        "is_weather": "oui" ou "non",
        "location": "nom de la localisation ou par défaut ${loc}",
        "start_date": "<année>-<mois>-<jour>" (exemple: "2026-04-12"),
        "end_date": "<année>-<mois>-<jour>" (exemple: "2026-04-14"),
        "reason": "explication très courte de la décision"
        }
        - Ne rien ajouter après le json.*/

    // Pas de format Markdown. ???
    //     - NE METS AUCUN TEXTE AUTOUR.` + " PAS DE '```json' au début et pas de '```' à la fin. " +


    const classificationChatBuffer = structuredClone(chatBuffer);
    classificationChatBuffer.push({ role: "user", content: text });
    classificationChatBuffer.push({ role: "system", content: classificationPrompt });


    return new Promise((resolve, reject) => {
        // 🔥 DEBOUNCE (500ms)
        clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {

            // 🔒 BLOQUE requêtes concurrentes
            if (isLoading) {
                console.warn("Requête ignorée (déjà en cours)");
                return;
            }

            isLoading = true;

            $.ajax({
                url: "chatLLM2.php",
                method: "POST",
                data: {
                    chatBuffer: JSON.stringify(classificationChatBuffer),
                    csrf: document.querySelector('meta[name="csrf-token"]').content
                },

                success: function(response) {
                  let decodedResponse;
                  try {
                      decodedResponse = JSON.parse(response);
                      isLoading = false;
                      console.log("decodedResponse: ", decodedResponse);
                      resolve(decodedResponse);
                  } catch (e) {
                      //console.log("badJsonResponse: ", response);
                      if ( response == "" ) {
                        decodedResponse = {"is_weather":"non"};
                        console.warn("------------->>>>  RESPONSE VIDE !!! <<<<-------");
                      }
                      else {
                        decodedResponse = response.match(/\{[\s\S]*\}/)[0];
                        console.log("decodedResponse: ", decodedResponse);
                        decodedResponse = JSON.parse(decodedResponse);
                      }
                      isLoading = false;
                      resolve(decodedResponse);
                  }
                },
                error: function(xhr, status, error) {
                    console.warn("Erreur AJAX :", error);
                    const loc = window.location.href;
                    window.location.href = loc;
                    isLoading = false;
                    reject(error);
                }
            });

        }, 500); // ⏱️ debounce delay
    });}

    /*return new Promise((resolve, reject) => {
        $.ajax({
            url: "chatLLM2.php",
            method: "POST",
            data: {
                chatBuffer: JSON.stringify(classificationChatBuffer),
                csrf: document.querySelector('meta[name="csrf-token"]').content
            },
            success: function(response) {
              let decodedResponse;
              try {
                  console.log("response: ", response);
                  decodedResponse = JSON.parse(response);
                  isLoading = false;
                  resolve(decodedResponse);
              } catch (e) {
                  //console.log("badJsonResponse: ", response);
                  if ( response == "" ) {
                    decodedResponse = {"is_weather":"non"};
                    console.warn("------------->>>>  RESPONSE VIDE !!! <<<<-------");
                  }
                  else {
                    decodedResponse = response.match(/\{[\s\S]*\}/)[0];
                    console.log("decodedResponse: ", decodedResponse);
                    decodedResponse = JSON.parse(decodedResponse);
                  }
                  isLoading = false;
                  resolve(decodedResponse);
              }
            },
            error: function(xhr, status, error) {
                console.warn("Erreur AJAX :", error);
                const loc = window.location.href;
                window.location.href = loc;
                isLoading = false;
                reject(error);
            }
        });
    });*/




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



//****************************************************************
//*********************** Localisation actuelle (seb) ************

var watchID = 0;  // geoloc
var geoCoor = {}; // coordonnés de l'apareil
var testGeoCount = 0;

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
    //const loc = obtenirPosition();
    //reverseLocation(loc.lat, loc.lon);
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
    //console.log(actualGeoLoc.label + "\n[" + testGeoCount + "]");
    testGeoCount++;
  })
  .catch(error => {
    //console.warn('Echec de la retro-localisation', error);
    $("#chat").text($("#chat").text() + "\nERREUR: Géolocalisation absente !!!");
  });
}

////// géoloc du navigateur
function obtenirPosition() {  // not used
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        //alert(`Votre position : Latitude ${latitude}, Longitude ${longitude}`);
        return {lat: latitude, lon: longitude};
      },
      (error) => {
        alert(`Erreur : ${error.message}`);
      }
    );
  } else {
    alert("La géolocalisation n'est pas disponible.");
  }
}

// Appeler la fonction au chargement de la page ou sur un événement utilisateur
// obtenirPosition();

////// not used
async function getBigCountries() {
  try {
    const response = await fetch("https://restcountries.com/v3.1/all?fields=name,population");
    const data = await response.json();

    // Filtrer les pays avec population > 100M
    const resultats = data
      .filter(country => country.population > 100000000)
      .map(country => ({
        nom: country.name.common,
        population: country.population
      }));

    return resultats;

  } catch (error) {
    console.error("Erreur :", error);
    return [];
  }
}

//////
function supIconesUnicode(chaine) {
  // Expression régulière pour supprimer les emojis et symboles Unicode
  const regex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{24C2}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{03030}\u{200D}\u{20E3}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/gu;
  return chaine.replace(regex, '');
}

// Exemple d'utilisation
//const texteAvecEmojis = "Bonjour 😊 ! Comment ça va ? 🚀";
//const texteSansEmojis = supprimerIconesUnicode(texteAvecEmojis);
//console.log(texteSansEmojis); // "Bonjour  ! Comment ça va ? "

//*********************************************************************
//************************  S N C F  **********************************

/*// Exemple d'appel à l'API Navitia pour obtenir les horaires
const SNCF_KEY = '';
const BASE_URL = 'https://api.navitia.io/v1/coverage/sncf';

async function getTrainSchedules(departure, arrival) {
  const url = `${BASE_URL}/journeys?from=${departure}&to=${arrival}&datetime=now`;
  const response = await fetch(url, {
    headers: {
      'Authorization': SNCF_KEY
    }
  });
  const data = await response.json();
  return data.journeys;
}

// Exemple d'utilisation
getTrainSchedules('Paris', 'Lyon')
  .then(schedules => console.log(schedules))
  .catch(error => console.error(error));*/



//***********************************************************************
/*////// open-meteo
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
          console.warn("Erreur lors de la récupération des données météo :", error);
          $('#weather-data').html("Impossible de charger les données météo.");
      }
  });
}*/


//***********************************************************************
/*////// not user
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
}*/

//***********************************************************************
