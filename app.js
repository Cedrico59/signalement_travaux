
/* === APP TOGGLE CLEAN V13 === */
console.log("APP LOADED V13 CLEAN");

window.showArchives = window.showArchives ?? false;

function getToken_() {
  try {
    const candidates = [];
    candidates.push(localStorage.getItem("marq_auth_token"));
    candidates.push(localStorage.getItem("token"));
    candidates.push(localStorage.getItem("authToken"));
    candidates.push(window.token);
    const t = candidates.find(x => typeof x === "string" && x.trim().length > 10);
    return t || null;
  } catch(e) { return null; }
}

async function apiPost_(action, payload) {
  const url = (typeof API_URL !== "undefined") ? API_URL : (window.API_URL || window.apiUrl);
  if (!url) throw new Error("API_URL manquant");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

let layerToggle_ = null;
function getMap_() {
  return window._leafletMap || window.map || (typeof map !== "undefined" ? map : null);
}

function renderMarkers_(items) {
  const m = getMap_();
  if (!m || typeof L === "undefined") return;
  if (!layerToggle_) layerToggle_ = L.layerGroup().addTo(m);
  layerToggle_.clearLayers();

  items.forEach(r => {
    const lat = Number(String(r.lat ?? r.Latitude ?? "").replace(",", "."));
    const lng = Number(String(r.lng ?? r.Longitude ?? "").replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const mk = L.marker([lat, lng]).addTo(layerToggle_);
    const title = r.dossierNumber || r.id || "Signalement";
    mk.bindPopup("<b>" + title + "</b>");
  });
}

async function reloadReportsOrArchives__() {
  const token = getToken_();
  if (!token) {
    console.warn("Token manquant - reconnecte toi");
    return;
  }
  const action = window.showArchives ? "getArchives" : "getReports";
  const data = await apiPost_(action, { token });
  if (data && Array.isArray(data.reports)) {
    renderMarkers_(data.reports);
  } else {
    console.warn("Aucun report recu", data);
  }
}

function ensureBtn_() {
  let btn = document.getElementById("toggleArchivesBtn");
  if (btn) return btn;
  const host = document.querySelector(".top-actions") || document.querySelector("header") || document.body;
  btn = document.createElement("button");
  btn.id = "toggleArchivesBtn";
  btn.type = "button";
  btn.textContent = "Archives";
  btn.style.marginLeft = "8px";
  btn.style.padding = "8px 10px";
  btn.style.borderRadius = "10px";
  btn.style.background = "#1f2937";
  btn.style.color = "white";
  btn.style.border = "1px solid #374151";
  host.appendChild(btn);
  return btn;
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = ensureBtn_();
  btn.addEventListener("click", async () => {
    window.showArchives = !window.showArchives;
    btn.textContent = window.showArchives ? "Reports" : "Archives";
    console.log("MODE =", window.showArchives ? "ARCHIVES" : "REPORTS");
    try { await reloadReportsOrArchives__(); } catch(e) { console.warn(e); }
  });
});
