function dateInterventionEl() { return document.getElementById("dateIntervention"); }


function toNum(v){
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return n;
}

(() => {
  "use strict";

  // =========================
  // CONFIG (optionnel synchro GAS)
  // =========================
  // Si vous avez déjà une WebApp Google Apps Script comme l’appli “Patrimoine arboré”,
  // vous pouvez mettre l’URL ici pour activer login + sync.
  // L’app fonctionne aussi 100% en local si API_URL = "".
  const STORAGE_KEY = "signalement_travaux_v1";
  
  // 🌐 Google Apps Script WebApp (API)
  // Collez ici l'URL de la WebApp déployée (Apps Script).
  const GAS_URL = "https://script.google.com/macros/s/AKfycbyiuSQAJACiUHcyq-Pol_7flD7VwN0IiZfaB8GC3EoeLbaRgX4_2jJoCO02VtfIdixR/exec"; // <-- colle ici ton URL /exec

  const SECTEURS = ["Hautes Loges - Briqueterie", "Bourg", "Buisson - Delcencerie", "Mairie - Quesne", "Pont - Plouich - Clémenceau", "Cimetière Delcencerie", "Cimetière Pont", "Ferme aux Oies"];

  function apiEnabled() {
    return !!GAS_URL;
  }

async function apiPost(action, data) {
  if (!GAS_URL) throw new Error("GAS_URL manquant");
  const payload = new URLSearchParams();
  payload.set("action", action);
  Object.entries(data || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) v = "";
    payload.set(k, typeof v === "string" ? v : JSON.stringify(v));
  });

  // ✅ Apps Script: éviter le preflight CORS => PAS de Content-Type JSON
  return fetch(GAS_URL, { method: "POST", body: payload })
    .then(async (r) => {
      const txt = await r.text();
      console.log("GAS RAW RESPONSE:", txt);
      try { return JSON.parse(txt); } catch(e) { throw new Error("Bad JSON from GAS: " + txt); }
    });
}




  // 🔐 Session (token) persistée
  const TOKEN_KEY = "marcq_auth_token";
  const USER_KEY = "marcq_auth_user";

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function loadSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    if (!token || !userRaw) return null;
    try {
      const user = JSON.parse(userRaw);
      currentUser = user;
      updateUIAfterLogin();
      return { token, user };
    } catch {
      return null;
    }
  }
// 🔐 Auth état
let currentUser = null; // { role:'admin'|'secteur', secteur?: string }

function isAdmin() { return currentUser && currentUser.role === "admin"; }
function canSeeReport(r) {
  if (isAdmin()) return true;
  if (!currentUser) return false;
  return r.secteur === currentUser.secteur;
}

function populateLoginSecteurs() {
  const sel = document.getElementById("loginSecteur");
  if (!sel) return;
  sel.innerHTML = "";
  SECTEURS.forEach(s => {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    sel.appendChild(o);
  });
}

async function loginViaGAS() {
  const role = document.getElementById("loginRole")?.value || "admin";
  const secteur = document.getElementById("loginSecteur")?.value || "";
  const password = document.getElementById("loginPassword")?.value || "";

  if (!password) { alert("Mot de passe requis"); return; }
  if (role === "secteur" && !secteur) { alert("Choisis un secteur"); return; }

  const data = await apiPost("login", { role, secteur, password });

  const user = { role: data.role, secteur: data.secteur || "" };
  currentUser = user;
      updateUIAfterLogin();
  setSession(data.token, user);

  const modal = document.getElementById("loginModal");
  if (modal) modal.remove();

  await refreshFromServer();
}

function loginOfflineDemo() {
  const role = document.getElementById("loginRole")?.value || "admin";
  const secteur = document.getElementById("loginSecteur")?.value || "";
  currentUser = (role === "admin") ? { role: "admin" } : { role: "secteur", secteur };
  const modal = document.getElementById("loginModal");
  if (modal) modal.remove();
  renderAll();
}

async function logout() {
  clearSession();
  location.reload();
}

async function openHistoryAdmin() {
  if (!isAdmin()) { alert("Historique réservé admin"); return; }
  const sess = loadSession();
  if (!sess) { alert("Session manquante"); return; }

  const data = await apiPost("getHistory", { token: sess.token });
  const list = (data.history || [])
    .slice(-200)
    .reverse()
    .map(h => `${h.date} | ${h.role}${h.secteur ? "(" + h.secteur + ")" : ""} | ${h.action} | ${h.details}`)
    .join("\n");

  const panel = document.getElementById("adminPanel");
  const out = document.getElementById("historyList");
  if (out) out.textContent = list || "Aucune action";
  if (panel) panel.style.display = "block";
}

const DEFAULT_CENTER = [50.676, 3.086];

  function getNextLocalDossierNumber() {
    const year = new Date().getFullYear();
    const key = "marcq_dossier_seq_" + year;
    const seq = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(seq));
    return `MARCQ-${year}-${String(seq).padStart(4, "0")}`;
  }

  async function getCentralDossierNumber() {
  // Numérotation centralisée via Apps Script (anti-doublons)
  // Si pas connecté -> fallback compteur local (démo/hors-ligne)
  const sess = loadSession();
  if (!apiEnabled() || !sess) return getNextLocalDossierNumber();
  const data = await apiPost("nextDossier", { token: sess.token });
  return data.dossierNumber;
}
// 🟦 Contour EXACT de Marcq-en-Barœul (source : geo.api.gouv.fr / geometry=contour)
  const MARCQ_POLYGON = [
    [50.653496, 3.118930],
    [50.653182, 3.115914],
    [50.652712, 3.116315],
    [50.652517, 3.115946],
    [50.650790, 3.117616],
    [50.649845, 3.117856],
    [50.650058, 3.118512],
    [50.650286, 3.119263],
    [50.649293, 3.120087],
    [50.648678, 3.119036],
    [50.648294, 3.118179],
    [50.648143, 3.117705],
    [50.647982, 3.116962],
    [50.647923, 3.116558],
    [50.647820, 3.115587],
    [50.650649, 3.112793],
    [50.650679, 3.112257],
    [50.649557, 3.110555],
    [50.650364, 3.110309],
    [50.650746, 3.110179],
    [50.651582, 3.109945],
    [50.652488, 3.109663],
    [50.652982, 3.109166],
    [50.652858, 3.108747],
    [50.652763, 3.108537],
    [50.652612, 3.108108],
    [50.652470, 3.107591],
    [50.652163, 3.107144],
    [50.652116, 3.106925],
    [50.652099, 3.105834],
    [50.652123, 3.105484],
    [50.652184, 3.105034],
    [50.652282, 3.104471],
    [50.652303, 3.103962],
    [50.652300, 3.103383],
    [50.651851, 3.100460],
    [50.651274, 3.098521],
    [50.651004, 3.097752],
    [50.650744, 3.096950],
    [50.650375, 3.095666],
    [50.650192, 3.094750],
    [50.650207, 3.094072],
    [50.650247, 3.093691],
    [50.650994, 3.091215],
    [50.650979, 3.091071],
    [50.651212, 3.090372],
    [50.651414, 3.089662],
    [50.651511, 3.089775],
    [50.651972, 3.090065],
    [50.652291, 3.090149],
    [50.652721, 3.090171],
    [50.653258, 3.090106],
    [50.653766, 3.090073],
    [50.654423, 3.090006],
    [50.654963, 3.089968],
    [50.655220, 3.089919],
    [50.655664, 3.089952],
    [50.656143, 3.090050],
    [50.656557, 3.088827],
    [50.656849, 3.087670],
    [50.656886, 3.087431],
    [50.656892, 3.086892],
    [50.656930, 3.086378],
    [50.657030, 3.085647],
    [50.657139, 3.085193],
    [50.656438, 3.085460],
    [50.655539, 3.085180],
    [50.654857, 3.085048],
    [50.654552, 3.084953],
    [50.654386, 3.084931],
    [50.651551, 3.083540],
    [50.652045, 3.081894],
    [50.652728, 3.082273],
    [50.653027, 3.082343],
    [50.654029, 3.079209],
    [50.655144, 3.079887],
    [50.655542, 3.080086],
    [50.656125, 3.078449],
    [50.657103, 3.079039],
    [50.657690, 3.077987],
    [50.657989, 3.077409],
    [50.658828, 3.076776],
    [50.658995, 3.077012],
    [50.659750, 3.076393],
    [50.660651, 3.076165],
    [50.660655, 3.074310],
    [50.660974, 3.074379],
    [50.660986, 3.074009],
    [50.663178, 3.072032],
    [50.664196, 3.071146],
    [50.666429, 3.068902],
    [50.666752, 3.069146],
    [50.666934, 3.069905],
    [50.667410, 3.069663],
    [50.667639, 3.070605],
    [50.667136, 3.070714],
    [50.667615, 3.072738],
    [50.667761, 3.073103],
    [50.667856, 3.072951],
    [50.668227, 3.072649],
    [50.668556, 3.072327],
    [50.668969, 3.072952],
    [50.669918, 3.074566],
    [50.670520, 3.073867],
    [50.670525, 3.073494],
    [50.670623, 3.073090],
    [50.670634, 3.072764],
    [50.670791, 3.072418],
    [50.670940, 3.072369],
    [50.671092, 3.072437],
    [50.671594, 3.072795],
    [50.672054, 3.072750],
    [50.672468, 3.072682],
    [50.672918, 3.072642],
    [50.673278, 3.072641],
    [50.673475, 3.072676],
    [50.673464, 3.072858],
    [50.673550, 3.073089],
    [50.673840, 3.073566],
    [50.673006, 3.076063],
    [50.674079, 3.078608],
    [50.674658, 3.079116],
    [50.676757, 3.080926],
    [50.677262, 3.081390],
    [50.678554, 3.082539],
    [50.679181, 3.083106],
    [50.679455, 3.083262],
    [50.679939, 3.083405],
    [50.681791, 3.084074],
    [50.682387, 3.084295],
    [50.682766, 3.084407],
    [50.683502, 3.084709],
    [50.683728, 3.084749],
    [50.684372, 3.084995],
    [50.685114, 3.085239],
    [50.685047, 3.085706],
    [50.685830, 3.086647],
    [50.686126, 3.087204],
    [50.686495, 3.087790],
    [50.686811, 3.088050],
    [50.687437, 3.088438],
    [50.687515, 3.088460],
    [50.689132, 3.089390],
    [50.689558, 3.089660],
    [50.690100, 3.090067],
    [50.690642, 3.090573],
    [50.691244, 3.091406],
    [50.691318, 3.091646],
    [50.691308, 3.091934],
    [50.691212, 3.092915],
    [50.691165, 3.093480],
    [50.691203, 3.093751],
    [50.691678, 3.094842],
    [50.692120, 3.095672],
    [50.692435, 3.096307],
    [50.692486, 3.096538],
    [50.692492, 3.096861],
    [50.692412, 3.096909],
    [50.692171, 3.097201],
    [50.691688, 3.097747],
    [50.692794, 3.099536],
    [50.692661, 3.099664],
    [50.692446, 3.099949],
    [50.692100, 3.100498],
    [50.691685, 3.101095],
    [50.691312, 3.101723],
    [50.691637, 3.102140],
    [50.692534, 3.102922],
    [50.692667, 3.103090],
    [50.693538, 3.104396],
    [50.694115, 3.105185],
    [50.694272, 3.105268],
    [50.694511, 3.105196],
    [50.694623, 3.105283],
    [50.694813, 3.105550],
    [50.694941, 3.105655],
    [50.695291, 3.105591],
    [50.695403, 3.105695],
    [50.695716, 3.106304],
    [50.695845, 3.106439],
    [50.696290, 3.106592],
    [50.696385, 3.106706],
    [50.696675, 3.106501],
    [50.697025, 3.106051],
    [50.697258, 3.106054],
    [50.697952, 3.106455],
    [50.698178, 3.106509],
    [50.698327, 3.106329],
    [50.698652, 3.105461],
    [50.699655, 3.103966],
    [50.699793, 3.103958],
    [50.700254, 3.104567],
    [50.700544, 3.104973],
    [50.700892, 3.105277],
    [50.701104, 3.105371],
    [50.701193, 3.105346],
    [50.701277, 3.105835],
    [50.701288, 3.106225],
    [50.701343, 3.106489],
    [50.701429, 3.106670],
    [50.701817, 3.107154],
    [50.702262, 3.107745],
    [50.702349, 3.107921],
    [50.702446, 3.107801],
    [50.702731, 3.107204],
    [50.702896, 3.106761],
    [50.703156, 3.105946],
    [50.704349, 3.107452],
    [50.704639, 3.108569],
    [50.705159, 3.109025],
    [50.704941, 3.109527],
    [50.705601, 3.110445],
    [50.705295, 3.112310],
    [50.705621, 3.112185],
    [50.706722, 3.112112],
    [50.707051, 3.112138],
    [50.707152, 3.111965],
    [50.707558, 3.112296],
    [50.708061, 3.112734],
    [50.708812, 3.112996],
    [50.709301, 3.113322],
    [50.709968, 3.113812],
    [50.710797, 3.115414],
    [50.710194, 3.116772],
    [50.708535, 3.120441],
    [50.708473, 3.120615],
    [50.708284, 3.120644],
    [50.707903, 3.120772],
    [50.707484, 3.120963],
    [50.707416, 3.121053],
    [50.705827, 3.122397],
    [50.704828, 3.123038],
    [50.704226, 3.122006],
    [50.703412, 3.120476],
    [50.702004, 3.121987],
    [50.701932, 3.121845],
    [50.701089, 3.122892],
    [50.700661, 3.123101],
    [50.700263, 3.123246],
    [50.700014, 3.123415],
    [50.699789, 3.123404],
    [50.699705, 3.123278],
    [50.699030, 3.123801],
    [50.697976, 3.125098],
    [50.698066, 3.125252],
    [50.697685, 3.125576],
    [50.697350, 3.125992],
    [50.696644, 3.127104],
    [50.696374, 3.127713],
    [50.695345, 3.129771],
    [50.695708, 3.130221],
    [50.695343, 3.130936],
    [50.695108, 3.131351],
    [50.694461, 3.132316],
    [50.694108, 3.132220],
    [50.693142, 3.131097],
    [50.692511, 3.131276],
    [50.691868, 3.131588],
    [50.690286, 3.129029],
    [50.690077, 3.128642],
    [50.689688, 3.128858],
    [50.689151, 3.127295],
    [50.688709, 3.126414],
    [50.688824, 3.125800],
    [50.689934, 3.124565],
    [50.689702, 3.123659],
    [50.689648, 3.123340],
    [50.689466, 3.122681],
    [50.689425, 3.122595],
    [50.689201, 3.121727],
    [50.689732, 3.120985],
    [50.690297, 3.120125],
    [50.690526, 3.119817],
    [50.689784, 3.118188],
    [50.689454, 3.117297],
    [50.689287, 3.116762],
    [50.689196, 3.116394],
    [50.688948, 3.115519],
    [50.688523, 3.114164],
    [50.688371, 3.113597],
    [50.688259, 3.113397],
    [50.688077, 3.112778],
    [50.687871, 3.112258],
    [50.687748, 3.112195],
    [50.687213, 3.113029],
    [50.686368, 3.114303],
    [50.686031, 3.114795],
    [50.685609, 3.115564],
    [50.685519, 3.115807],
    [50.684919, 3.114746],
    [50.685049, 3.114582],
    [50.684537, 3.113105],
    [50.683930, 3.111523],
    [50.683748, 3.111461],
    [50.683008, 3.109991],
    [50.682664, 3.110386],
    [50.682296, 3.110608],
    [50.682051, 3.109414],
    [50.681625, 3.110210],
    [50.681774, 3.111010],
    [50.681557, 3.111942],
    [50.681401, 3.114516],
    [50.681299, 3.114925],
    [50.681186, 3.115174],
    [50.678500, 3.119872],
    [50.678246, 3.120003],
    [50.676546, 3.120044],
    [50.676140, 3.119924],
    [50.675874, 3.119691],
    [50.675470, 3.119229],
    [50.675248, 3.118998],
    [50.675079, 3.118949],
    [50.674545, 3.118963],
    [50.674486, 3.118819],
    [50.674443, 3.118539],
    [50.674294, 3.118191],
    [50.674076, 3.117270],
    [50.674061, 3.117116],
    [50.673843, 3.116219],
    [50.673617, 3.114819],
    [50.673537, 3.114230],
    [50.671798, 3.113880],
    [50.671456, 3.113655],
    [50.671287, 3.113417],
    [50.671172, 3.113328],
    [50.670880, 3.113009],
    [50.670187, 3.112365],
    [50.669994, 3.112208],
    [50.669465, 3.111838],
    [50.669184, 3.111596],
    [50.668955, 3.111312],
    [50.668632, 3.110732],
    [50.667929, 3.111835],
    [50.667848, 3.112001],
    [50.667136, 3.111329],
    [50.666786, 3.112081],
    [50.666617, 3.112592],
    [50.666523, 3.112807],
    [50.666421, 3.112940],
    [50.666149, 3.113514],
    [50.665978, 3.113779],
    [50.665296, 3.112744],
    [50.665066, 3.113046],
    [50.665229, 3.113448],
    [50.663086, 3.115289],
    [50.662054, 3.115950],
    [50.661547, 3.116395],
    [50.659187, 3.118838],
    [50.658779, 3.119407],
    [50.658265, 3.118197],
    [50.658391, 3.118058],
    [50.657682, 3.116506],
    [50.656958, 3.117414],
    [50.655812, 3.115134],
    [50.655421, 3.115764],
    [50.653866, 3.115882],
    [50.654093, 3.118402],
    [50.653496, 3.118930]
  ];

  // 🔒 Emprise (bbox) utilisée pour bloquer le déplacement de carte
  const MARCQ_BOUNDS = L.latLngBounds([50.647820, 3.068902], [50.710797, 3.132316]);

  function isInMarcq(lat, lng) {
    // Ray casting point-in-polygon
    const x = lng, y = lat;
    let inside = false;
    for (let i = 0, j = MARCQ_POLYGON.length - 1; i < MARCQ_POLYGON.length; j = i++) {
      const yi = MARCQ_POLYGON[i][0], xi = MARCQ_POLYGON[i][1];
      const yj = MARCQ_POLYGON[j][0], xj = MARCQ_POLYGON[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

// modifiez si besoin

  // =========================
  // STATE
  // =========================
  let map;
  let reports = [];
  let selectedId = null;
  let pendingPhotos = [];
  const markers = new Map(); // id -> marker
// =========================
// UNDO suppression (admin)
// =========================
let lastDeleted = null; // { report, markerLatLng, timeoutId }

function showUndoBar(message) {
  let bar = document.getElementById("undoBar");

  // (Re)création propre
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "undoBar";
    bar.style.position = "fixed";
    bar.style.left = "14px";
    bar.style.right = "14px";
    bar.style.bottom = "14px";
    bar.style.zIndex = "4000";
    bar.style.background = "#111a33";
    bar.style.border = "1px solid #20305f";
    bar.style.borderRadius = "14px";
    bar.style.padding = "10px 12px";
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "space-between";
    bar.style.gap = "12px";

    // IMPORTANT : créer aussi les éléments avec createElement (pas innerHTML fragile)
    const msg = document.createElement("span");
    msg.id = "undoMsg";
    msg.style.fontSize = "13px";
    msg.style.flex = "1";

    const btn = document.createElement("button");
    btn.id = "undoBtn";
    btn.className = "secondary";
    btn.type = "button";
    btn.style.width = "auto";
    btn.style.padding = "8px 10px";
    btn.textContent = "↩️ Annuler";

    bar.appendChild(msg);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  // ✅ Sécurité anti-null
  const msgEl = document.getElementById("undoMsg");
  if (msgEl) msgEl.textContent = message;
  bar.style.display = "flex";

  const btnEl = document.getElementById("undoBtn");
  if (btnEl) {
    btnEl.onclick = () => undoDelete().catch(e => alert(e.message));
  }
}


function hideUndoBar() {
  const bar = document.getElementById("undoBar");
  if (bar) bar.style.display = "none";
}

async function undoDelete() {
  if (!lastDeleted) return;

  const saved = lastDeleted; // ✅ on garde tout
  clearTimeout(saved.timeoutId);
  lastDeleted = null;

  // Réinjecte en local
  reports.push(saved.report);
  saveLocal();
  renderAll();

  // resync serveur
  try {
  const sess = loadSession();
  if (apiEnabled() && sess) {
    await apiPost("deleteReport", { token: sess.token, id });
    await refreshFromServer();
    showToast("✅ Supprimé");
  }
} catch (e) {
  console.warn("Suppression serveur échouée", e);
  showToast("⚠️ Erreur suppression");
}


  hideUndoBar();
}



  // =========================
  // DOM
  // =========================
  const el = (id) => document.getElementById(id);

  const listEl = () => el("reportList");
  const countEl = () => el("count");
  const qEl = () => el("q");
  const listWrapper = () => el("listWrapper");

  const editorTitle = () => el("editorTitle");
  const editorHint = () => el("editorHint");

  const ridEl = () => el("rid");
  const latEl = () => el("lat");
  const lngEl = () => el("lng");
  const secteurEl = () => el("secteur");
  const addressEl = () => el("address");
  const dateDemandeEl = () => el("dateDemande");
  const dateExecutionEl = () => el("dateExecution");
  const natureEl = () => el("nature");
  const commentEl = () => el("comment");

  const galleryEl = () => el("gallery");
  const photoStatusEl = () => el("photoStatus");

  const saveBtn = () => el("saveBtn");
  const newBtn = () => el("newBtn");
  const deleteBtn = () => el("deleteBtn");
const doneBtn = () => el("doneBtn");
  const exportBtn = () => el("exportBtn");
  const importBtn = () => el("importBtn");
  const importFile = () => el("importFile");

  const takePhotoBtn = () => el("takePhotoBtn");
  const pickGalleryBtn = () => el("pickGalleryBtn");
  const cameraInput = () => el("cameraInput");
  const galleryInput = () => el("galleryInput");

  const gpsBtn = () => el("gpsBtn");
  const centerBtn = () => el("centerBtn");
  const toggleListBtn = () => el("toggleListBtn");
  const agentModeBtn = () => el("agentModeBtn");

  // Preview
  const previewCard = () => el("previewCard");
  const p_id = () => el("p-id");
  const p_secteur = () => el("p-secteur");
  const p_address = () => el("p-address");
  const p_dateDemande = () => el("p-dateDemande");
  const p_dateExecution = () => el("p-dateExecution");
  const p_nature = () => el("p-nature");
  const p_coords = () => el("p-coords");
  const p_comment = () => el("p-comment");
  const openInNewTabBtn = () => el("openInNewTabBtn");

  // Carousel
  const photoCarousel = () => el("photoCarousel");
  const carouselImage = () => el("carouselImage");
  const carouselCount = () => el("carouselCount");
  let carouselIndex = 0;
  let carouselPhotos = [];

  // =========================
  // HELPERS
  // =========================
  function safeUUID() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function fmtCoord(x) {
    if (typeof x !== "number") return "";
    return x.toFixed(6);
  }

  
  // 🎨 Couleurs secteurs (IDENTIQUES à Patrimoine arboré)
  const SECTOR_COLORS = {
    "Hautes Loges - Briqueterie": "#1565C0",
    "Bourg": "#2E7D32",
    "Buisson - Delcencerie": "#EF6C00",
    "Mairie - Quesne": "#6A1B9A",
    "Pont - Plouich - Clémenceau": "#00838F",
    "Cimetière Delcencerie": "#4E342E",
    "Cimetière Pont": "#C62828",
    "Ferme aux Oies": "#546E7A"
  };

  // =========================
  // LÉGENDE SECTEURS (rétractable)
  // HTML attendu :
  // <div id="sectorLegend" class="legend"></div>
  // =========================
  function buildSectorLegend() {
    const box = document.getElementById("sectorLegend");
    if (!box) return;

    const collapsed = box.dataset.collapsed === "1";
    const itemsHtml = SECTEURS.map(s => {
      const c = getSectorColor(s);
      return `<div class="legend-item" data-secteur="${escapeHtml(s)}">
        <span class="swatch" style="background:${c}"></span>
        <span class="label">${escapeHtml(s)}</span>
      </div>`;
    }).join("");

    box.innerHTML = `
      <div class="legend-header">
        <span>🏷️ Secteurs</span>
        <button type="button" class="legend-toggle" id="legendToggleBtn">${collapsed ? "Ouvrir" : "Réduire"}</button>
      </div>
      <div class="legend-body" style="display:${collapsed ? "none" : "block"}">
        ${itemsHtml}
        <div class="legend-note">
          <div><span class="dot externe"></span> Externe</div>
          <div><span class="dot interne"></span> Interne</div>
        </div>
      </div>
    `;

    const tbtn = document.getElementById("legendToggleBtn");
    if (tbtn) {
      tbtn.onclick = () => {
        box.dataset.collapsed = (box.dataset.collapsed === "1") ? "0" : "1";
        buildSectorLegend();
      };
    }

    box.querySelectorAll(".legend-item").forEach(div => {
      div.addEventListener("click", () => {
        const secteur = div.getAttribute("data-secteur") || "";
        const q = document.getElementById("q");
        if (q) { q.value = secteur; renderList(); }
      });
    });
  }


  function getSectorColor(secteur) {
    return SECTOR_COLORS[secteur] || "#607D8B";
  }

  function getInterventionDotColor(type) {
    return type === "externe" ? "#D32F2F" : "#2E7D32";
  }

  function escapeHtml(str) {
    return (str ?? "").toString()
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function loadLocal() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    // On ignore les éléments hors Marcq
    return (Array.isArray(arr) ? arr : []).filter(r =>
      r && Number.isFinite(r.lat) && Number.isFinite(r.lng) && isInMarcq(r.lat, r.lng)
    );
  } catch {
    return [];
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch (e) {
    console.error("Erreur sauvegarde locale", e);
  }
}


async function refreshFromServer() {
  if (!apiEnabled()) { renderAll(); return; }
  const sess = loadSession();
  if (!sess) { renderAll(); return; }
  const data = await apiPost("listReports", { token: sess.token });
  reports = (data.reports || []).map(r => ({
    ...r,
    lat: Number(r.lat),
    lng: Number(r.lng),
    photos: r.photos || []
  }));
  saveLocal();
  renderAll();
}

function getById(id) { return reports.find(r => r.id === id); }

  function reportMatchesQuery(r, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    const hay = [
      r.id, r.secteur, r.address, r.nature, r.comment,
      `${r.lat}`, `${r.lng}`, r.dateDemande, r.dateExecution
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(s);
  }

  // =========================
  // ICON / MARKERS
  // =========================
  function createWorkIcon(r) {
  const done = !!r.done;
  const blink = !!r.blink; // clignotement persistant (stocké) visible par tous

  // Pastille rouge (à faire) / verte (effectué)
  // ✅ Couleur de marqueur par secteur (comme avant)
  const sectorColors = {
    "Hautes Loges - Briqueterie": "#3b82f6",
    "Bourg": "#22c55e",
    "Buisson - Delcencerie": "#f97316",
    "Mairie - Quesne": "#a855f7",
    "Pont - Plouich - Clémenceau": "#06b6d4",
    "Cimetière Delcencerie": "#ef4444",
    "Cimetière Pont": "#eab308",
    "Ferme aux Oies": "#10b981"
  };

  const baseColor = sectorColors[String(r.secteur || "").trim()] || "#60a5fa";

  // ✅ Pastille rouge/verte = uniquement selon interventionType
// externe = rouge, interne = vert
const dotColor = (String(r.interventionType || "").toLowerCase().startsWith("ex"))
  ? "#ef4444"
  : "#22c55e";


  // ✅ Clignotement UNIQUEMENT si admin a choisi Interne/Externe
  // => on se base sur r.blink (stocké serveur) : true => blink, false => fixe
  const dotClass = "marker-dot" + (blink ? " blink" : "");

  // ✅ Croix blanche si travaux effectués (bouton accessible à tous)
  const showCross = !!r.done;

  // Petit badge I/E selon type d'intervention
  const badge = (String(r.interventionType || "").toLowerCase().startsWith("ex") ? "E" : "I");

  const html = `
    <div class="marker-wrap">
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <!-- pin coloré secteur -->
        <path d="M18 2c6.6 0 12 5.4 12 12 0 8.6-10.2 19.5-11.6 21a0.6 0.6 0 0 1-0.8 0C16.2 33.5 6 22.6 6 14 6 7.4 11.4 2 18 2z"
              fill="${baseColor}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>

        <!-- badge I/E -->
        <circle cx="12" cy="12" r="6" fill="rgba(0,0,0,0.20)" stroke="rgba(255,255,255,0.25)" />
        <text x="12" y="14" text-anchor="middle" font-size="9" fill="#ffffff" font-family="system-ui,Segoe UI,Roboto,Arial">${badge}</text>

        <!-- pastille statut (rouge/vert) -->
        <circle class="${dotClass}" cx="26" cy="10" r="5" fill="${dotColor}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>

        <!-- croix blanche (travaux effectués) -->
        ${showCross ? `
        <path d="M14 18 L22 26 M22 18 L14 26" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
        ` : ""}
      </svg>
    </div>`;

  return L.divIcon({
    className: "work-marker",
    html,
    iconSize: [36, 36],
    iconAnchor: [18, 34]
  });
}



function addOrUpdateMarker(r) {
  if (!r) return;
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!isFinite(lat) || !isFinite(lng)) return;

  let m = markers.get(r.id);

  // 🔴🟢 Clignotement : admin => blink true (interne + externe)
  if (isAdmin()) r.blink = true;

  // option : si terminé, stop blink
const icon = createWorkIcon(r);

  if (!m) {
    m = L.marker([lat, lng], { icon }).addTo(map);
    m.on("click", () => {
      setSelected(r.id);
      highlightSelection();
    });
    markers.set(r.id, m);
  } else {
    m.setLatLng([lat, lng]);
    m.setIcon(icon);
  }
}

function removeMarker(id) {
  const m = markers.get(id);
  if (m) {
    try { map.removeLayer(m); } catch (_) {}
    markers.delete(id);
  }
}



  // =========================
  // PHOTOS: stamp date + GPS
  // =========================
  async function stampPhotoWithMeta(file, lat, lng) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = () => { img.src = reader.result; };
      reader.onerror = reject;

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = img.width;
        canvas.height = img.height;

        ctx.drawImage(img, 0, 0);

        const padding = 20;
        const bandHeight = Math.max(80, Math.floor(canvas.height * 0.08));
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, canvas.height - bandHeight, canvas.width, bandHeight);

        ctx.fillStyle = "#fff";
        ctx.font = `${Math.max(22, Math.floor(canvas.width / 40))}px Arial`;

        const dateStr = new Date().toLocaleString("fr-FR");
        const coordStr = (Number.isFinite(lat) && Number.isFinite(lng))
          ? `Lat: ${lat.toFixed(6)} | Lng: ${lng.toFixed(6)}`
          : "Coordonnées : —";

        ctx.fillText(dateStr, padding, canvas.height - Math.floor(bandHeight * 0.55));
        ctx.fillText(coordStr, padding, canvas.height - Math.floor(bandHeight * 0.15));

        resolve(canvas.toDataURL("image/jpeg", 0.65));
      };

      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function readFilesAsDataUrls(files) {
    const out = [];
    const lat = parseFloat(latEl().value);
    const lng = parseFloat(lngEl().value);

    for (const f of files) {
      const stampedDataUrl = await stampPhotoWithMeta(f, lat, lng);
      out.push({
        id: safeUUID(),
        name: f.name || "photo.jpg",
        type: f.type,
        size: f.size,
        addedAt: Date.now(),
        dataUrl: stampedDataUrl
      });
    }
    return out;
  }

  function updatePhotoStatus() {
    if (!photoStatusEl()) return;
    if (pendingPhotos.length === 0) { photoStatusEl().textContent = ""; return; }
    photoStatusEl().textContent = `📷 ${pendingPhotos.length} photo${pendingPhotos.length>1?"s":""} ajoutée${pendingPhotos.length>1?"s":""}`;
  }

  function getPhotoSrc(p) { return p?.dataUrl || p?.url || ""; }

  function renderGallery(photos) {
    const g = galleryEl();
    if (!g) return;
    g.innerHTML = "";

    if (!photos || photos.length === 0) return;

    photos.forEach((p) => {
      if (!p.id) p.id = safeUUID();

      const wrap = document.createElement("div");
      wrap.className = "photo";

      const img = document.createElement("img");
      img.src = getPhotoSrc(p);
      img.alt = p.name || "Photo";

      const meta = document.createElement("div");
      meta.className = "meta";

      const span = document.createElement("span");
      const date = p.addedAt ? new Date(p.addedAt).toLocaleString("fr-FR") : "";
      span.textContent = `${p.name || "photo"}${date ? " • " + date : ""}`;

      const del = document.createElement("button");
      del.className = "danger";
      del.textContent = "Retirer";
      del.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        // si pending (base64)
        pendingPhotos = pendingPhotos.filter(x => x.id !== p.id);
        const r = selectedId ? getById(selectedId) : null;
        if (r?.photos) r.photos = r.photos.filter(x => x.id !== p.id);
        updatePhotoStatus();
        const allPhotos = [ ...(r?.photos || []), ...pendingPhotos ];
        renderGallery(allPhotos);
        renderPhotoCarousel(allPhotos);
      };

      meta.appendChild(span);
      meta.appendChild(del);
      wrap.appendChild(img);
      wrap.appendChild(meta);
      g.appendChild(wrap);
    });
  }

  // =========================
  // CAROUSEL
  // =========================
  function renderPhotoCarousel(photos) {
    carouselPhotos = (photos || []).filter(p => getPhotoSrc(p));
    carouselIndex = 0;

    if (!photoCarousel()) return;
    if (carouselPhotos.length === 0) {
      photoCarousel().classList.add("hidden");
      return;
    }
    photoCarousel().classList.remove("hidden");
    updateCarouselUI();
  }

  function updateCarouselUI() {
    if (!carouselImage()) return;
    const p = carouselPhotos[carouselIndex];
    carouselImage().src = getPhotoSrc(p);
    if (carouselCount()) carouselCount().textContent = `${carouselIndex+1} / ${carouselPhotos.length}`;
  }

  function carouselPrev() {
    if (carouselPhotos.length === 0) return;
    carouselIndex = (carouselIndex - 1 + carouselPhotos.length) % carouselPhotos.length;
    updateCarouselUI();
  }
  function carouselNext() {
    if (carouselPhotos.length === 0) return;
    carouselIndex = (carouselIndex + 1) % carouselPhotos.length;
    updateCarouselUI();
  }

  // =========================
  // PREVIEW + NEW TAB
  // =========================
  function renderPreview(r) {
    const card = previewCard();
    if (!card) return;

    if (!r) { card.style.display = "none"; return; }
    card.style.display = "block";

    p_id().textContent = r.id || "—";
    p_secteur().textContent = r.secteur || "—";
    p_address().textContent = r.address || "—";
    p_dateDemande().textContent = r.dateDemande || "—";
    p_dateExecution().textContent = r.dateExecution || "—";
    p_nature().textContent = r.nature || "—";
    p_coords().textContent = `${fmtCoord(r.lat)}, ${fmtCoord(r.lng)}`;
    p_comment().textContent = r.comment || "—";

    renderPhotoCarousel(r.photos || []);
  }

async function toggleDone(id) {
  const r = getById(id);
  if (!r) return;

  // ✅ On touche UNIQUEMENT au done (croix blanche)
  r.done = !r.done;

  saveLocal();
  renderAll();
  showToast(r.done ? "Travaux effectués ✅" : "Travaux réouverts ↩️");

  try {
    const sess = loadSession();
    if (apiEnabled() && sess) {
      // Sync du champ done (et garder blink tel quel)
      await apiPost("saveReport", {
        token: sess.token,
        reportJson: JSON.stringify(r)
      });
      showToast("Enregistré ✅");
      await refreshFromServer();
    }
  } catch (e) {
    console.warn("Sync done échouée", e);
  }
}




  function openInNewTab() {
    if (!selectedId) return;
    const r = getById(selectedId);
    if (!r) return;

    const firstPhoto = (r.photos || []).find(p => getPhotoSrc(p));
    const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiche signalement – ${escapeHtml(r.id)}</title>
<style>
body{font-family:system-ui,Arial,sans-serif;background:#0b1020;color:#eef1ff;padding:20px}
.card{max-width:780px;margin:auto;background:#111a33;border:1px solid #20305f;border-radius:16px;padding:20px}
img{width:100%;max-height:520px;object-fit:contain;border-radius:12px;margin-bottom:16px;background:#0b1020}
small{color:#9db0ff}
p{margin:6px 0}
</style></head>
<body><div class="card">
${firstPhoto ? `<img src="${getPhotoSrc(firstPhoto)}" alt="Photo">` : ""}
<h1 style="margin:0 0 8px;font-size:18px;">Fiche signalement</h1>
<p><b>ID :</b> ${escapeHtml(r.id)}</p>
<p><b>Secteur :</b> ${escapeHtml(r.secteur || "—")}</p>
<p><b>Adresse :</b> ${escapeHtml(r.address || "—")}</p>
<p><b>Date demande :</b> ${escapeHtml(r.dateDemande || "—")}</p>
<p><b>Date demande d'intervention :</b> ${escapeHtml(r.dateIntervention || "—")}</p>
<p><b>Date d’exécution :</b> ${escapeHtml(r.dateExecution || "—")}</p>
<p><b>Nature :</b> ${escapeHtml(r.nature || "—")}</p>
<p><b>Coordonnées :</b> ${fmtCoord(r.lat)}, ${fmtCoord(r.lng)}</p>
<p><b>Commentaire :</b></p>
<small>${escapeHtml(r.comment || "—")}</small>
</div></body></html>`;

    const win = window.open();
    if (!win) return;
    win.document.open(); win.document.write(html); win.document.close();
  }

  // =========================
  // FORM
  // =========================
  function clearForm(keepCoords=true) {
    secteurEl().value = "";
    addressEl().value = "";
    dateDemandeEl().value = "";
    if (dateInterventionEl()) dateInterventionEl().value = "";
    dateExecutionEl().value = "";
    natureEl().value = "";
    commentEl().value = "";
    pendingPhotos = [];
    updatePhotoStatus();
    if (!keepCoords) { latEl().value=""; lngEl().value=""; }
    renderGallery([]);
    renderPhotoCarousel([]);
  }

  function setSelected(id) {
    pendingPhotos = [];
    selectedId = id;
    const r = id ? getById(id) : null;

    if (r && !canSeeReport(r)) { alert("Accès interdit à ce secteur."); return; }

    if (!r) {
      editorTitle().textContent = "Ajouter un signalement";
      editorHint().textContent = "Clique sur la carte pour choisir l’emplacement, puis complète la fiche.";
      deleteBtn().disabled = true;
  if (doneBtn) doneBtn().disabled = true;
      ridEl().value = "";
      clearForm(false);
      renderPreview(null);
      return;
    }

    editorTitle().textContent = "Fiche signalement";
    editorHint().textContent = "Modifie les infos puis clique sur Enregistrer.";
    deleteBtn().disabled = false;
  if (doneBtn) doneBtn().disabled = false;

    ridEl().value = r.id || "";
    const dn = document.getElementById('dossierNumber');
    if (dn) dn.value = r.dossierNumber || "";
    latEl().value = fmtCoord(r.lat);
    lngEl().value = fmtCoord(r.lng);
    secteurEl().value = r.secteur || "";
    addressEl().value = r.address || "";
    dateDemandeEl().value = formatDateForInput(r.dateDemande);
    dateExecutionEl().value = formatDateForInput(r.dateExecution);
    // Date demande d’intervention (admin)
    if (typeof dateInterventionEl === "function" && dateInterventionEl()) {
      dateInterventionEl().value = formatDateForInput(r.dateIntervention);
    }
    // Type intervention
    const typeSel = document.getElementById('interventionType');
    if (typeSel) typeSel.value = (r.interventionType || "interne");
    natureEl().value = r.nature || "";
    commentEl().value = r.comment || "";

    renderGallery(r.photos || []);
    renderPreview(r);
  }

  // =========================
  // LIST
  // =========================
  function highlightSelection() {
    const list = listEl();
    if (!list) return;
    for (const node of list.querySelectorAll(".item")) {
      node.style.outline = (node.dataset.id === selectedId) ? "2px solid rgba(106,166,255,.65)" : "none";
    }
  }

  function renderList() {
    const list = listEl();
    const count = countEl();
    const q = (qEl()?.value || "").trim();

    if (!list || !count) return;

    const visible = reports.filter(r => canSeeReport(r));
    const filtered = visible.filter(r => reportMatchesQuery(r, q));
    count.textContent = `${filtered.length} / ${visible.length}`;
    list.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = q ? "Aucun résultat." : "Aucun signalement. Clique sur la carte pour en ajouter un.";
      list.appendChild(empty);
      return;
    }

    for (const r of filtered) {
      const item = document.createElement("div");
      item.className = "item";
      item.dataset.id = r.id;

      const left = document.createElement("div");
      const title = document.createElement("b");
      title.textContent = r.nature || "Travaux (nature non précisée)";

      const meta = document.createElement("small");
      meta.textContent =
        `${fmtCoord(r.lat)}, ${fmtCoord(r.lng)}` +
        (r.address ? " • " + r.address : "") +
        (r.secteur ? " • " + r.secteur : "") +
        (r.dateDemande ? " • Demande: " + r.dateDemande : "");

      left.appendChild(title);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "actions";

      const seeBtn = document.createElement("button");
      seeBtn.className = "secondary";
      seeBtn.textContent = "Voir";
      seeBtn.onclick = () => {
        map.setView([r.lat, r.lng], Math.max(map.getZoom(), 16));
        const m = markers.get(r.id);
        if (m) m.openPopup();
        setSelected(r.id);
        highlightSelection();
      };

      right.appendChild(seeBtn);

      item.onclick = (e) => {
        if (e.target?.tagName?.toLowerCase() === "button") return;
        setSelected(r.id);
        highlightSelection();
      };

      item.appendChild(left);
      item.appendChild(right);
      list.appendChild(item);
    }

    highlightSelection();
  }

  function renderAll() {
    renderMarkers();
    renderList();
    if (selectedId) renderPreview(getById(selectedId) || null);
    else renderPreview(null);
    highlightSelection();
    buildSectorLegend();
  }


  // =========================
  // MAP
  // =========================
  function initMap() {
    map = L.map("map", { zoomControl:true, minZoom: 12, maxZoom: 19, maxBounds: MARCQ_BOUNDS, maxBoundsViscosity: 1.0 }).fitBounds(MARCQ_BOUNDS);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    
    // Affichage du contour Marcq-en-Barœul (comme Patrimoine arboré)
    const marcqLayer = L.polygon(MARCQ_POLYGON, {
      color: "#00e5ff",
      weight: 3,
      fill: false
    }).addTo(map);
function handleMapSelect(e) {
      if (!isInMarcq(e.latlng.lat, e.latlng.lng)) {
        alert("⚠️ Le signalement doit être situé à Marcq-en-Barœul.");
        return;
      }
      const { lat, lng } = e.latlng;

      selectedId = null;
      deleteBtn().disabled = true;
  if (doneBtn) doneBtn().disabled = true;
      editorTitle().textContent = "Ajouter un signalement";
      editorHint().textContent = "Complète la fiche puis clique sur Enregistrer.";

      clearForm(false);
      latEl().value = fmtCoord(lat);
      lngEl().value = fmtCoord(lng);

      renderPreview(null);
      highlightSelection();
    }

    map.on("click", handleMapSelect);
    map.on("tap", handleMapSelect);
  }

  // =========================
  // GPS
  // =========================
  function locateUserGPS() {
    if (!navigator.geolocation) { alert("La géolocalisation n’est pas supportée sur cet appareil."); return; }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        if (!isInMarcq(lat, lng)) {
          alert("📍 Votre position GPS est hors Marcq-en-Barœul.");
          return;
        }

        map.setView([lat, lng], 17);

        selectedId = null;
        deleteBtn().disabled = true;
  if (doneBtn) doneBtn().disabled = true;
        editorTitle().textContent = "Ajouter un signalement (GPS)";
        editorHint().textContent = "Position GPS détectée automatiquement.";

        clearForm(false);
        latEl().value = fmtCoord(lat);
        lngEl().value = fmtCoord(lng);

        // marqueur temporaire
        L.circleMarker([lat, lng], { radius:8, color:"#00e5ff", fillColor:"#00e5ff", fillOpacity:.9 }).addTo(map);

        renderPreview(null);
        highlightSelection();
      },
      () => alert("Impossible d’obtenir la position GPS."),
      { enableHighAccuracy:true, timeout: 10000, maximumAge: 0 }
    );
  }

  // =========================
  // SAVE / DELETE
  // =========================
  async function buildFromForm(existing=null) {
    const lat = parseFloat(latEl().value);
    const lng = parseFloat(lngEl().value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Coordonnées invalides (clique sur la carte ou GPS).");

    if (!isInMarcq(lat, lng)) {
      throw new Error("Le signalement doit être situé à Marcq-en-Barœul.");
    }


    // ✅ Validation : secteur obligatoire
    if (!secteurEl().value) {
      throw new Error("Secteur obligatoire");
    }
    const base = existing || {};
    const photos = [
      ...(base.photos || []),
      ...pendingPhotos
    ];

    return {
      ...base,
      id: base.id || safeUUID(),
      dossierNumber: base.dossierNumber || await getCentralDossierNumber(),
      lat, lng,
      secteur: secteurEl().value || "",
      address: addressEl().value || "",
      dateDemande: dateDemandeEl().value || "",
    dateIntervention: (dateInterventionEl() ? (dateInterventionEl().value || "").slice(0,10) : ""),
      dateExecution: dateExecutionEl().value || "",
      nature: natureEl().value || "",
      comment: commentEl().value || "",
      interventionType: document.getElementById('interventionType')?.value || 'interne',
      photos,
      updatedAt: Date.now()
    };
  }

  function persistAndRefresh(focusId = selectedId) {
    saveLocal();
    renderMarkers();
    renderList();
    if (focusId) setSelected(focusId);
  }

  // =========================
  // UI WIRING
  // =========================
  
function showToast(message, opts = {}) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.position = "fixed";
    el.style.right = "16px";
    el.style.bottom = "16px";
    el.style.zIndex = 9999;
    el.style.maxWidth = "320px";
    el.style.padding = "12px 14px";
    el.style.borderRadius = "12px";
    el.style.background = "rgba(20,26,40,0.95)";
    el.style.border = "1px solid rgba(255,255,255,0.12)";
    el.style.color = "#fff";
    el.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    el.style.fontSize = "14px";
    document.body.appendChild(el);
  }
  el.innerHTML = "";
  const msg = document.createElement("div");
  msg.textContent = message;
  el.appendChild(msg);

  if (opts.actionText && typeof opts.onAction === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary";
    btn.style.marginTop = "10px";
    btn.textContent = opts.actionText;
    btn.onclick = () => {
      try { opts.onAction(); } finally { hideToast(); }
    };
    el.appendChild(btn);
  }

  el.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => hideToast(), opts.durationMs || 2400);
}
function hideToast() {
  const el = document.getElementById("toast");
  if (el) el.style.display = "none";
}



function applySessionUI(sess){
  // Top title
  const top = document.getElementById("topSectorTitle");
  if (top) {
    if (!sess) top.textContent = "—";
    else if (sess.role === "admin") top.textContent = "Administrateur";
    else top.textContent = String(sess.secteur || "").trim() || "Secteur";
  }
  // Admin-only date field
  const wrap = document.getElementById("adminDateInterventionWrap");
  if (wrap) wrap.style.display = (sess && sess.role === "admin") ? "block" : "none";
}


function wireUI() {
  applySessionUI(loadSession());
    qEl()?.addEventListener("input", renderList);

    exportBtn().onclick = () => {
      const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), reports }, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "signalements-travaux-export.json";
      a.click();
      URL.revokeObjectURL(url);
    };

    importBtn().onclick = () => importFile().click();
    importFile().addEventListener("change", async () => {
      const f = importFile().files?.[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const obj = JSON.parse(txt);
        if (!obj || !Array.isArray(obj.reports)) throw new Error("Fichier invalide (attendu: {reports:[...]})");
        reports = (obj.reports || []).filter(r => r && Number.isFinite(r.lat) && Number.isFinite(r.lng) && isInMarcq(r.lat, r.lng));
        persistAndRefresh(null);
        alert("Import OK");
      } catch (e) {
        alert("Import impossible: " + e.message);
      } finally {
        importFile().value = "";
      }
    });

    // Photos
    takePhotoBtn().onclick = () => cameraInput().click();
    pickGalleryBtn().onclick = () => galleryInput().click();

    cameraInput().addEventListener("change", async () => {
      if (!cameraInput().files || !cameraInput().files[0]) return;
      const photos = await readFilesAsDataUrls(cameraInput().files);
      pendingPhotos.push(...photos);
      cameraInput().value = "";
      updatePhotoStatus();
      const r = selectedId ? getById(selectedId) : null;
      const allPhotos = [ ...(r?.photos || []), ...pendingPhotos ];
      renderGallery(allPhotos);
      renderPhotoCarousel(allPhotos);
    });

    galleryInput().addEventListener("change", async () => {
      if (!galleryInput().files || galleryInput().files.length === 0) return;
      const photos = await readFilesAsDataUrls(galleryInput().files);
      pendingPhotos.push(...photos);
      galleryInput().value = "";
      updatePhotoStatus();
      const r = selectedId ? getById(selectedId) : null;
      const allPhotos = [ ...(r?.photos || []), ...pendingPhotos ];
      renderGallery(allPhotos);
      renderPhotoCarousel(allPhotos);
    });

    // Carousel buttons
    const leftBtn = photoCarousel()?.querySelector(".carousel-btn.left");
    const rightBtn = photoCarousel()?.querySelector(".carousel-btn.right");
    if (leftBtn) leftBtn.addEventListener("click", carouselPrev);
    if (rightBtn) rightBtn.addEventListener("click", carouselNext);

    // GPS
    gpsBtn().onclick = locateUserGPS;
    centerBtn().onclick = () => {
      const lat = parseFloat(latEl().value);
      const lng = parseFloat(lngEl().value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      map.setView([lat,lng], Math.max(map.getZoom(), 16));
    };

    // Save
    saveBtn().onclick = async () => {
    console.log('SAVE CLICK');

      try {
        const existing = selectedId ? getById(selectedId) : null;
        const obj = await buildFromForm(existing);

        if (existing) {
          const idx = reports.findIndex(x => x.id === existing.id);
          if (idx >= 0) {
            reports[idx] = obj;
          } else {
            reports.push(obj);
          }
        } else {
          reports.push(obj);
        }

        pendingPhotos = [];
        updatePhotoStatus();
        persistAndRefresh(obj.id);

        // Sync serveur (Apps Script)
        try {
          const sess = loadSession();
          if (apiEnabled() && sess) {
            // ✅ Enregistre/Met à jour le signalement côté Google Sheets
            console.log('SENDING saveReport');
    await apiPost("saveReport", {
              token: sess.token,
              reportJson: JSON.stringify(obj)
            });

            // ✅ Re-synchronisation depuis le serveur (source de vérité)
            await refreshFromServer();
            showToast("✅ Enregistré");
          }
        } catch (e) {
          console.warn("Sync serveur échouée", e);
          showToast("⚠️ Erreur synchronisation");
        }

      } catch (e) {
        alert(e.message || String(e));
      }
    };

    newBtn().onclick = () => setSelected(null);

    deleteBtn().onclick = async () => {
  if (!selectedId) return;

  if (!isAdmin()) {
    alert("Suppression réservée aux administrateurs.");
    return;
  }

  if (!confirm("Supprimer ce signalement ?")) return;

  const id = selectedId;
  const r = getById(id);
  if (!r) return;

  // suppression locale + undo
  reports = reports.filter(x => x.id !== id);
  removeMarker(id);
  selectedId = null;
  persistAndRefresh(null);
  setSelected(null);

  // prépare undo (10s)
  if (lastDeleted?.timeoutId) clearTimeout(lastDeleted.timeoutId);
  lastDeleted = {
    report: r,
    timeoutId: setTimeout(() => { lastDeleted = null; hideUndoBar(); }, 10000)
  };
  if (loadSession() && loadSession().user && loadSession().user.role === "admin") showUndoBar("Signalement supprimé. Annuler ?");

  // suppression serveur (logique)
  try {
    const sess = loadSession();
    if (apiEnabled() && sess) {
      await apiPost("deleteReport", { token: sess.token, id });
    }
  } catch (e) {
    console.warn("Suppression serveur échouée", e);
  }
};

    // Preview open
    openInNewTabBtn().onclick = openInNewTab;
    const mailBtn = document.getElementById("mailBtn");
    const printBtn = document.getElementById("printBtn");
    const pdfBtn = document.getElementById("pdfBtn");
    const doneBtn = document.getElementById("doneBtn");
    const historyBtn = document.getElementById("historyBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const closeAdminPanelBtn = document.getElementById("closeAdminPanelBtn");

    if (mailBtn) mailBtn.addEventListener("click", () => sendByEmail());
    if (printBtn) printBtn.addEventListener("click", () => printFiche());
    if (pdfBtn) pdfBtn.addEventListener("click", () => exportPDF());
    if (doneBtn) doneBtn.addEventListener("click", () => selectedId && toggleDone(selectedId));
    if (historyBtn) historyBtn.addEventListener("click", () => openHistoryAdmin().catch(e => alert(e.message)));
    if (logoutBtn) logoutBtn.addEventListener("click", () => logout());
    if (closeAdminPanelBtn) closeAdminPanelBtn.addEventListener("click", () => (document.getElementById("adminPanel").style.display="none"));

    // Toggle list
    toggleListBtn().onclick = () => {
      const lw = listWrapper();
      const open = lw.style.display !== "none";
      lw.style.display = open ? "none" : "block";
      toggleListBtn().textContent = open ? "Ouvrir" : "Réduire";
    };

    // Agent mode
    agentModeBtn().onclick = () => {
      document.body.classList.toggle("agent-mode");
    };
  }

  
  function updateTopBar() {
    const t = document.getElementById('topSectorTitle');
    const b = document.getElementById('topUserBadge');
    if (t) {
      if (!currentUser) t.textContent = '—';
      else if (currentUser.role === 'admin') t.textContent = 'Administrateur';
      else t.textContent = currentUser.secteur || 'Secteur';
    }
    if (b) {
      if (!currentUser) b.textContent = 'Non connecté';
      else b.textContent = (currentUser.role === 'admin') ? '🛠 Admin' : '👤 Secteur';
    }
  }

  function updateAdminFieldsVisibility() {
    const wrap = document.getElementById('adminDateInterventionWrap');
    if (!wrap) return;
    wrap.style.display = isAdmin() ? 'block' : 'none';
  }

  function updateUIAfterLogin() {
    updateTopBar();
    updateAdminFieldsVisibility();
  }

// =========================
  // INIT
  // =========================
  function init() {
    initMap();
    wireUI();

    reports = loadLocal();
    renderMarkers();
    renderList();
    setSelected(null);
  }
function renderMarkers() {
  // Nettoie tous les marqueurs affichés
  for (const m of markers.values()) map.removeLayer(m);
  markers.clear();

  // Recrée uniquement ceux visibles
  for (const r of reports.filter(r => canSeeReport(r))) {
    addOrUpdateMarker(r);
  }
}

  
  function buildFicheText(r) {
    return `Signalement de travaux – Marcq-en-Barœul

Numéro de dossier : ${r.dossierNumber || ""}
ID : ${r.id}
Secteur : ${r.secteur}
Type : ${r.interventionType === "externe" ? "Externe" : "Interne"}
Adresse : ${r.address}
Date demande : ${r.dateDemande}
Date demande d'intervention : ${r.dateIntervention}
Date exécution : ${r.dateExecution}
Nature : ${r.nature}

Commentaire :
${r.comment}

Coordonnées :
${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}
`;
  }

  function sendByEmail() {
    if (!selectedId) return;
    const r = getById(selectedId);
    if (!r) return;

    const subject = encodeURIComponent("Signalement de travaux – " + r.secteur);
    const body = encodeURIComponent(buildFicheText(r));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  
  
  async function exportPDF() {
    if (!selectedId) return;
    const r = getById(selectedId);
    if (!r) return;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const pageWidth = pdf.internal.pageSize.getWidth();
    let y = 15;

    // Header with logo
    const logo = document.querySelector("header img")?.src;
    if (logo) pdf.addImage(logo, "PNG", 10, 8, 35, 16);

    pdf.setFontSize(14);
    pdf.text("Signalement de travaux – Ville de Marcq-en-Barœul", pageWidth / 2, 18, { align: "center" });

    y = 30;
    pdf.setFontSize(10);

    const line = (label, value) => {
      pdf.text(`${label} : ${value || ""}`, 12, y);
      y += 6;
    };

    line("Numéro de dossier", r.dossierNumber || "");
    line("ID technique", r.id || "");
    line("Secteur", r.secteur || "");
    line("Type", r.interventionType === "externe" ? "Externe" : "Interne");
    line("Adresse", r.address || "");
    line("Date de demande", r.dateDemande || "");
    line("Date d’exécution", r.dateExecution || "");
    line("Nature des travaux", r.nature || "");
    line("Coordonnées", `${r.lat?.toFixed(6)}, ${r.lng?.toFixed(6)}`);

    y += 4;
    pdf.text("Commentaire :", 12, y);
    y += 6;

    const comment = pdf.splitTextToSize(r.comment || "", pageWidth - 24);
    pdf.text(comment, 12, y);
    y += comment.length * 5;

    // Photos
    if (Array.isArray(r.photos) && r.photos.length) {
      for (const p of r.photos) {
        if (!p.dataUrl) continue;
        pdf.addPage();
        pdf.setFontSize(11);
        pdf.text("Photo du signalement", 12, 15);
        pdf.addImage(p.dataUrl, "JPEG", 15, 25, pageWidth - 30, 120);
      }
    }

    pdf.save(`signalement-${r.dossierNumber || r.id}.pdf`);
  }



  function printFiche() {
    if (!selectedId) return;
    const r = getById(selectedId);
    if (!r) return;

    const html = `
      <html><head><title>Signalement ${r.id}</title>
      <style>
        body{font-family:Arial;padding:20px}
        h1{font-size:18px}
        p{margin:4px 0}
        .box{border:1px solid #444;padding:12px}
      </style></head>
      <body>
        <h1>Signalement de travaux – Marcq-en-Barœul</h1>
        <div class="box">
          <p><b>Numéro de dossier :</b> ${r.dossierNumber || ''}</p>
          <p><b>ID :</b> ${r.id}</p>
          <p><b>Secteur :</b> ${r.secteur}</p>
          <p><b>Type :</b> ${r.interventionType === "externe" ? "Externe" : "Interne"}</p>
          <p><b>Adresse :</b> ${r.address}</p>
          <p><b>Date demande :</b> ${r.dateDemande}</p>
          <p><b>Date demande d'intervention : </b> ${r.dateIntervention}</p>
          <p><b>Date exécution :</b> ${r.dateExecution}</p>
          <p><b>Nature :</b> ${r.nature}</p>
          <p><b>Commentaire :</b><br>${r.comment}</p>
          <p><b>Coordonnées :</b> ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</p>
        </div>
      </body></html>
    `;

    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    w.print();
  }


window.sendByEmail = sendByEmail;
  window.printFiche = printFiche;
  window.exportPDF = exportPDF;
  window.undoDelete = undoDelete;

  window.addEventListener("load", async () => {
    populateLoginSecteurs();

    const sess = loadSession();
    if (sess) {
      currentUser = sess.user;
      updateUIAfterLogin();
      try { await refreshFromServer(); } catch(e) { console.warn(e); }
    } else {
      const lm = document.getElementById("loginModal");
      if (lm) lm.style.display = "flex";
    }

    init();

    // Connexion (modal)
    const loginBtn = document.getElementById("loginBtn");
    const loginOfflineBtn = document.getElementById("loginOfflineBtn");
    if (loginBtn) loginBtn.onclick = () => loginViaGAS().catch(e => alert(e.message));
    if (loginOfflineBtn) loginOfflineBtn.onclick = loginOfflineDemo;
  });
})();

function formatDateForInput(v) {
  if (!v) return "";
  if (typeof v === "string") {
    // already yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    // ISO
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // number timestamp
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return "";
}



/* ===============================
   ✅ FIX ULTIME ARCHIVES/REPORTS
   bouton en HTML + toggle + reload + markers
================================= */

window.showArchives = window.showArchives ?? false;

function getTokenUltimate_(){
  try {
    const keys = ["marq_auth_token","token","authToken","jwt","access_token"];
    for(const k of keys){
      const v = localStorage.getItem(k);
      if(v && v.length > 10) return v;
    }
    return null;
  } catch(e){
    return null;
  }
}

async function apiPostUltimate_(action, payload){
  const url = window.API_URL || window.apiUrl || (typeof API_URL !== "undefined" ? API_URL : null);
  if(!url) throw new Error("API_URL manquant");
  const res = await fetch(url,{
    method:"POST",
    headers:{ "Content-Type":"text/plain;charset=utf-8" },
    body: JSON.stringify({action, ...payload})
  });
  return res.json();
}

let ultimateLayer = null;
function renderUltimateMarkers_(items){
  const mapRef = window._leafletMap || window.map || (typeof map !== "undefined" ? map : null);
  if(!mapRef || typeof L === "undefined") return;

  if(!ultimateLayer) ultimateLayer = L.layerGroup().addTo(mapRef);
  ultimateLayer.clearLayers();

  (items || []).forEach(r=>{
    const lat = Number(String(r.lat ?? r.latitude ?? r.Latitude ?? "").replace(",","."));
    const lng = Number(String(r.lng ?? r.longitude ?? r.Longitude ?? "").replace(",","."));
    if(!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const mk = L.marker([lat,lng]).addTo(ultimateLayer);
    const title = r.dossierNumber || r.id || "Signalement";
    const addr = r.address || r.adresse || "";
    mk.bindPopup("<b>"+title+"</b><br>"+addr);
  });
}

async function reloadUltimate_(){
  const token = getTokenUltimate_();
  if(!token){
    console.warn("Token manquant (marq_auth_token) => reconnecte toi");
    return;
  }

  const action = window.showArchives ? "getArchives" : "getReports";
  const data = await apiPostUltimate_(action, { token });

  if(data && Array.isArray(data.reports)){
    try{ window.reports = data.reports; }catch(e){}
    renderUltimateMarkers_(data.reports);
  }else{
    console.warn("Réponse inattendue", data);
    renderUltimateMarkers_([]);
  }
}

document.addEventListener("DOMContentLoaded", ()=>{
  const btn = document.getElementById("toggleArchivesBtnFixed");
  if(!btn){
    console.warn("Bouton FIX HTML introuvable");
    return;
  }

  btn.textContent = window.showArchives ? "Reports" : "Archives";

  btn.addEventListener("click", async ()=>{
    window.showArchives = !window.showArchives;
    btn.textContent = window.showArchives ? "Reports" : "Archives";
    console.log("MODE =", window.showArchives ? "ARCHIVES" : "REPORTS");
    try{ await reloadUltimate_(); }catch(e){ console.warn(e); }
  });
});
