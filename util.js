// index.js
//
//
//*********************** METEO ******************************

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
    /*
    coords: GeolocationCoordinates
      accuracy: 14.657
      altitude: null
      altitudeAccuracy: null
      heading: null
      latitude: 48.8617475
      longitude: 2.3491577
      speed: null
      GeolocationCoordinates
    timestamp: 1713084988086

    Code météo (WMO):
    https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
*/
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

////// météo france
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
