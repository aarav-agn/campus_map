// Initialize map
const map = L.map("map").setView([26.8518, 81.0503], 17);

// Tile Layers
const themes = {
  light: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }),
  dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap & © Carto" }),
  satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles © Esri" }),
  minimal: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap & © Carto" })
};
themes.light.addTo(map);

// Theme Switcher
function switchTheme() {
  const theme = document.getElementById("theme").value;
  Object.values(themes).forEach(layer => map.removeLayer(layer));
  themes[theme].addTo(map);
}

// Add building markers
const markers = [];
buildings.forEach((b, idx) => {
  const icon = L.icon({ iconUrl: "icons/" + b.icon, iconSize: [32, 32] });
  const marker = L.marker([b.lat, b.lon], { icon: icon })
    .addTo(map)
    .bindPopup(`
      <div class="popup-card">
        <img src="icons/${b.icon}" alt="${b.name}" class="popup-img">
        <h3>${b.name}</h3>
        <p>${b.info}</p>
        <button onclick="selectDestination(${idx})">Get Directions</button>
      </div>
    `);
  markers.push(marker);
});

// Populate dropdowns
const sourceSelect = document.getElementById("source");
const destinationSelect = document.getElementById("destination");
buildings.forEach((b, idx) => {
  sourceSelect.add(new Option(b.name, idx));
  destinationSelect.add(new Option(b.name, idx));
});

let routeLine = null;
let currentRoute = null;
let destCoords = null;
let userLocation = null;

// Routing
async function getRoute(customSource = null) {
  if (routeLine) map.removeLayer(routeLine);

  const src = customSource || buildings[sourceSelect.value];
  const dest = buildings[destinationSelect.value];
  if (!dest) return;

  destCoords = [dest.lat, dest.lon];

  const url = "https://valhalla1.openstreetmap.de/route";
  const body = {
    locations: [{ lat: src.lat, lon: src.lon }, { lat: dest.lat, lon: dest.lon }],
    costing: "pedestrian",
    directions_options: { units: "kilometers" }
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.trip && data.trip.legs) {
      const shape = data.trip.legs[0].shape;
      const decoded = decode(shape);

      currentRoute = decoded;
      routeLine = L.polyline(decoded, { color: "blue", weight: 4 }).addTo(map);
      map.fitBounds(routeLine.getBounds());

      const distanceKm = data.trip.summary.length.toFixed(2);
      const timeMin = Math.round(data.trip.summary.time / 60);
      L.popup().setLatLng(destCoords).setContent(`🚶 ${distanceKm} km<br>⏱ ${timeMin} min`).openOn(map);
    } else {
      alert("No route found.");
    }
  } catch (err) {
    console.error(err);
    alert("Error fetching route.");
  }
}

// Recalculate using user location
function recalculateRoute() {
  if (!userLocation) {
    alert("User location not available yet.");
    return;
  }
  const src = { lat: userLocation.lat, lon: userLocation.lng };
  getRoute(src);
}

// Decode polyline
function decode(encoded) {
  let coords = [], index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / 1e6, lon / 1e6]);
  }
  return coords;
}

// Search Suggestions
function showSuggestions() {
  const input = document.getElementById("searchBox").value.toLowerCase();
  const suggestions = document.getElementById("suggestions");
  suggestions.innerHTML = "";
  if (input.length > 0) {
    buildings.forEach((b, idx) => {
      if (b.name.toLowerCase().includes(input)) {
        const div = document.createElement("div");
        div.innerText = b.name;
        div.onclick = function () {
          map.setView([b.lat, b.lon], 18);
          markers[idx].openPopup();
          suggestions.innerHTML = "";
          document.getElementById("searchBox").value = b.name;
        };
        suggestions.appendChild(div);
      }
    });
  }
}

function selectDestination(idx) {
  destinationSelect.value = idx;
  getRoute();
}

// Track user location
map.locate({ setView: true, watch: true, maxZoom: 18 });

let userMarker = null;
map.on("locationfound", function (e) {
  userLocation = e.latlng;

  if (userMarker) userMarker.setLatLng(e.latlng);
  else {
    userMarker = L.circleMarker(e.latlng, {
      radius: 8, fillColor: "blue", color: "white",
      weight: 2, opacity: 1, fillOpacity: 0.9
    }).addTo(map).bindPopup("You are here!");
  }

  if (currentRoute) {
    currentRoute = currentRoute.filter(coord => getDistance(e.latlng, { lat: coord[0], lng: coord[1] }) > 5);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(currentRoute, { color: "red", weight: 4 }).addTo(map);

    const nearest = findNearestPoint(e.latlng, currentRoute);
    if (nearest > 20) {
      recalculateRoute();
    }
  }
});

map.on("locationerror", () => alert("Could not access your location."));

// Helper: distance in meters
function getDistance(a, b) {
  const R = 6371e3;
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const c = 2 * Math.atan2(Math.sqrt(Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2), Math.sqrt(1 - (Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2)));
  return R * c;
}

function findNearestPoint(loc, route) {
  let minDist = Infinity;
  route.forEach(coord => {
    const d = getDistance(loc, { lat: coord[0], lng: coord[1] });
    if (d < minDist) minDist = d;
  });
  return minDist;
}

// Toggle Menu
document.getElementById("menuToggle").addEventListener("click", () => {
  const menu = document.getElementById("menuDropdown");
  menu.style.display = menu.style.display === "block" ? "none" : "block";
});

// Sample Events
const events = [
  { time: "09:00 AM", title: "Guest Lecture on AI", location: "Academic Building 3" },
  { time: "11:30 AM", title: "Workshop: Entrepreneurship", location: "Academic Building 5/Library/Auditorium" },
  { time: "02:00 PM", title: "Cultural Fest Rehearsals", location: "Mess/Canteen/Hospitality" },
  { time: "04:00 PM", title: "Sports Meet", location: "Two Wheeler Parking" }
];

function toggleEvents() {
  const overlay = document.getElementById("eventsOverlay");
  const list = document.getElementById("eventsList");

  if (overlay.style.display === "flex") {
    overlay.style.display = "none";
  } else {
    list.innerHTML = "";
    events.forEach(ev => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${ev.time}</strong> - ${ev.title}<br><em>${ev.location}</em>`;
      li.style.cursor = "pointer";
      li.onclick = () => {
        const match = buildings.find(b => ev.location.includes(b.name));
        if (match) {
          map.setView([match.lat, match.lon], 18);
        }
        overlay.style.display = "none";
      };
      list.appendChild(li);
    });
    overlay.style.display = "flex";
  }
}
