// util.js
/* jshint esversion: 10 */
/* jshint -W069 */ // Désactive les avertissements pour les propriétés en notation pointée
///////////////////////////  Mistral //////////////////

//////
async function fetchCoordinatesData(location) {

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=fr&format=json`;

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
        console.warn("Erreur géocoding:", e);
    }

    return { lat: geoCoor.latitude, lon: geoCoor.longitude }; // position actuelle
    //return obtenirPosition(); // geoloc de l'apareil
}

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

////// question is about meteo ?
function classifyUserQuestion(text) {

    let city;
    try { city = actualGeoLoc.city }
    catch(e) {
      city = actualGeolocDefault;
      console.warn('Echec de la retro-localisation', e);
      $("#chat").text($("#chat").text() + "\nERREUR: Géolocalisation absente !!!\n" + actualGeolocDefault + " par défaut.");
    }

    const classificationPrompt =  `
    L'utilisateur a dit : "${text}".
    Voici la date : ${new Date()}.

    - Si cette question concerne la météo, répondre "is_weather": "oui".
      sinon: répondre "is_weather": "non".
    - extrais la localisation (ville, région, pays) mentionnée ( utilise ${city} par défaut).
    - Détermine si la question porte sur aujourd'hui ("is_today":"oui") ou sur une date ultérieure ("is_today":"non")
    - Détermine si il est fait mention d'une ou plusieurs heures ou d'une période particulière de la journée ou de la nuit ("is_hourly":"oui") ou non  ("is_hourly":"non").

    3. Réponds UNIQUEMENT avec du JSON valide.
    NE METS AUCUN TEXTE AUTOUR.` + " PAS DE ``` au début et à la fin. " +
    `Formater comme ceci:
    {
    "is_weather": "oui" ou "non",
    "is_today": "oui" ou "non",
    "is_hourly": "oui" ou "non",
    "location": "nom de la localisation ou par défaut ${city}",
    "reason": "explication très courte de la décision"
    }
    `
    // Pas de format Markdown. ???

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
                  console.log("response: ", response);
                  let decodedResponse = JSON.parse(response);
                  resolve(decodedResponse);
              } catch (e) {
                  console.warn("Erreur de parsing :", e, response);
                  reject(e);
              }
            },
            error: function(xhr, status, error) {
                console.warn("Erreur AJAX :", error);
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
    console.warn('Echec de la retro-localisation', error);
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
