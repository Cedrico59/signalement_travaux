function myFunction() {}

/****************************************************
 * SIGNALMENT TRAVAUX – MARCQ-EN-BARŒUL
 * API Google Apps Script (WebApp)
 * - Auth (admin + secteur)
 * - Numérotation centralisée (dossier)
 * - CRUD signalements
 * - Historique actions
 * - Stockage Google Sheets (par ID)
 *
 * IMPORTANT:
 * - Déployer en "Application Web"
 *   Exécuter en tant que : Moi
 *   Qui a accès : Tout le monde (ou "Tout le monde avec le lien")
 ****************************************************/

const SPREADSHEET_ID = "1OrdG-2R7riNITVrCaFz6DzG3viUY2SBENIaCipZIc04";

// ✅ Mots de passe
const ADMIN_PASSWORD = "marcq2026";
const SECTOR_PASSWORDS = {
  "Hautes Loges - Briqueterie": "marcq",
  "Bourg": "marcq",
  "Buisson - Delcencerie": "marcq",
  "Mairie - Quesne": "marcq",
  "Pont - Plouich - Clémenceau": "marcq",
  "Cimetière Delcencerie": "marcq",
  "Cimetière Pont": "marcq",
  "Ferme aux Oies": "marcq"
};

const SH_PARAM   = "PARAMETRES";
const SH_REPORTS = "REPORTS";
const SH_HISTORY = "HISTORY";
const SH_ARCHIVES = "ARCHIVES";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

// ✅ IMPORTANT : Headers GLOBAUX
const wantedHeaders = [
  "id",
  "Num dossier",
  "Secteur",
  "Demandeur",
  "Type intervention",
  "Adresse",
  "Date demande",
  "Date demande d’intervention",
  "Date exécution",
  "Nature",
  "Commentaire",
  "Lat",
  "Lng",
  "photos",
  "creer",
  "Modifier",
  "Travaux effectués",
  "Pastille clignotante",
  "Suprimé"
];

/* -------------------- ENTRYPOINTS -------------------- */

function doGet(e) {
  ensureSheets_();
  return jsonOut_({ ok: true, service: "signalement-travaux-marcq", version: 3 });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_();

    const p = getParams_(e);
    const action = String(p.action || "").trim();
    if (!action) return jsonOut_({ ok: false, error: "Missing action" });

    if (action === "login") return handleLogin_(p);

    const session = requireSession_(p);

    switch (action) {
      case "ping":
        return jsonOut_({ ok: true, who: who_(session) });

      case "nextDossier":
        return handleNextDossier_(session);

      case "saveReport":
        return handleSaveReport_(session, p);

      case "listReports":
        return handleListReports_(session);

      case "getReport":
        return handleGetReport_(session, p);

      case "restoreReport":
      return handleRestoreReport_(session, p);

    case "deleteReport":
        return handleDeleteReport_(session, p);

      case "undeleteReport":
        return handleUndeleteReport_(session, p);

      case "logAction":
        return handleLogAction_(session, p);

      case "getHistory":
        return handleGetHistory_(session);

      default:
        return jsonOut_({ ok: false, error: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

/* -------------------- INIT SHEETS -------------------- */

function ensureSheets_() {
  const ss = ss_();

  // PARAMETRES
  let sh = ss.getSheetByName(SH_PARAM);
  if (!sh) sh = ss.insertSheet(SH_PARAM);
  if (sh.getLastRow() === 0) {
    sh.getRange("A1").setValue("ANNEE");
    sh.getRange("B1").setValue(new Date().getFullYear());
    sh.getRange("A2").setValue("COMPTEUR");
    sh.getRange("B2").setValue(0);
  } else {
    if (!sh.getRange("A1").getValue()) sh.getRange("A1").setValue("ANNEE");
    if (!sh.getRange("B1").getValue()) sh.getRange("B1").setValue(new Date().getFullYear());
    if (!sh.getRange("A2").getValue()) sh.getRange("A2").setValue("COMPTEUR");
    if (sh.getRange("B2").getValue() === "") sh.getRange("B2").setValue(0);
  }

  // REPORTS
  let rep = ss.getSheetByName(SH_REPORTS);
  if (!rep) rep = ss.insertSheet(SH_REPORTS);

  if (rep.getLastRow() === 0) {
    rep.appendRow(wantedHeaders);
  } else {
    const headers = rep.getRange(1, 1, 1, rep.getLastColumn()).getValues()[0].map(String);
    wantedHeaders.forEach(h => {
      if (headers.indexOf(h) === -1) {
        rep.insertColumnAfter(rep.getLastColumn());
        rep.getRange(1, rep.getLastColumn()).setValue(h);
        headers.push(h);
      }
    });
  }

  // HISTORY
  let hist = ss.getSheetByName(SH_HISTORY);
  if (!hist) hist = ss.insertSheet(SH_HISTORY);
  if (hist.getLastRow() === 0) {
    hist.appendRow(["date","user","role","secteur","action","details"]);
  }
}

/* -------------------- AUTH / SESSION -------------------- */

function handleLogin_(p) {
  const role = String(p.role || "").trim();
  const secteur = String(p.secteur || "").trim();
  const password = String(p.password || "");

  if (!role || !password) return jsonOut_({ ok: false, error: "Role/password required" });

  if (role === "admin") {
    if (password !== ADMIN_PASSWORD) return jsonOut_({ ok: false, error: "Bad credentials" });
    const token = createSession_({ role: "admin" });
    logHistory_("admin", "admin", "", "LOGIN", "");
    return jsonOut_({ ok: true, token, role: "admin" });
  }

  if (role === "secteur") {
    if (!secteur) return jsonOut_({ ok: false, error: "Secteur required" });
    const expected = SECTOR_PASSWORDS[secteur];
    if (!expected) return jsonOut_({ ok: false, error: "Secteur inconnu" });
    if (password !== expected) return jsonOut_({ ok: false, error: "Bad credentials" });

    const token = createSession_({ role: "secteur", secteur });
    logHistory_("secteur:" + secteur, "secteur", secteur, "LOGIN", "");
    return jsonOut_({ ok: true, token, role: "secteur", secteur });
  }

  return jsonOut_({ ok: false, error: "Invalid role" });
}

function createSession_(payload) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("sess_" + token, JSON.stringify(payload), SESSION_TTL_SECONDS);
  return token;
}

function requireSession_(p) {
  const token = String(p.token || "").trim();
  if (!token) throw new Error("Missing token");

  const raw = CacheService.getScriptCache().get("sess_" + token);
  if (!raw) throw new Error("Session expirée / invalide");

  const s = JSON.parse(raw);
  s.token = token;
  return s;
}

function who_(s) {
  return s.role === "admin" ? "admin" : ("secteur:" + (s.secteur || ""));
}

/* -------------------- DOSSIER NUMBER -------------------- */

function handleNextDossier_(session) {
  const sh = ss_().getSheetByName(SH_PARAM);
  const year = new Date().getFullYear();

  const storedYear = Number(sh.getRange("B1").getValue());
  let counter = Number(sh.getRange("B2").getValue());

  if (storedYear !== year) {
    sh.getRange("B1").setValue(year);
    counter = 0;
  }
  counter += 1;
  sh.getRange("B2").setValue(counter);

  const dossierNumber = "MARCQ-" + year + "-" + String(counter).padStart(4, "0");
  logHistory_(who_(session), session.role, session.secteur || "", "NEXT_DOSSIER", dossierNumber);

  return jsonOut_({ ok: true, dossierNumber });
}

/* -------------------- REPORTS CRUD -------------------- */

function handleSaveReport_(session, p) {
  const reportJson = p.reportJson;
  if (!reportJson) throw new Error("Missing reportJson");

  const r = JSON.parse(reportJson);

  if (!r.id) throw new Error("Missing report id");
  if (!r.secteur) throw new Error("Missing secteur");

  if (session.role === "secteur" && r.secteur !== session.secteur) {
    throw new Error("Forbidden");
  }

  const sh = ss_().getSheetByName(SH_REPORTS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  const now = new Date().toISOString();
  const row = findRowById_(sh, r.id);

  const photos = JSON.stringify(r.photos || []);
  const done = (r.done === true || String(r.done) === "true");
  const blink = (r.blink === true || String(r.blink) === "true");
  const deleted = (r.deleted === true || String(r.deleted) === "true");

  function col_(name){ const i = headers.indexOf(name); return i === -1 ? null : (i + 1); }

  // Soft migration si colonnes manquent
  wantedHeaders.forEach(h => {
    if (headers.indexOf(h) === -1) {
      sh.insertColumnAfter(sh.getLastColumn());
      sh.getRange(1, sh.getLastColumn()).setValue(h);
      headers.push(h);
    }
  });

  const rowValues = new Array(headers.length).fill("");

  function set_(name, value){
    const c = col_(name);
    if (c) rowValues[c-1] = value;
  }

  set_("id", r.id || "");
  set_("Num dossier", r.dossierNumber || "");
  set_("Secteur", r.secteur || "");
  set_("Demandeur", (session.role === "admin") ? "Admin" : "Responsable secteur");
  set_("Type intervention", r.interventionType || "interne");
  set_("Adresse", r.address || "");
  set_("Date demande", r.dateDemande || "");
  set_("Date demande d’intervention", r.dateIntervention || "");
  set_("Date exécution", r.dateExecution || "");
  set_("Nature", r.nature || "");
  set_("Commentaire", r.comment || "");
  set_("Lat", toNum_(r.lat));
  set_("Lng", toNum_(r.lng));
  set_("photos", photos);
  set_("creer", row ? (sh.getRange(row, col_("creer")).getValue() || now) : now);
  set_("Modifier", now);
  set_("Travaux effectués", done);
  set_("Pastille clignotante", blink);
  set_("Suprimé", deleted || false);

  if (row) {
    sh.getRange(row, 1, 1, headers.length).setValues([rowValues]);
    logHistory_(who_(session), session.role, session.secteur || "", "UPDATE_REPORT", r.id);
  } else {
    sh.appendRow(rowValues);
    logHistory_(who_(session), session.role, session.secteur || "", "CREATE_REPORT", r.id);
  }

  sortReports_(sh);
  applyRowStyles_(sh);

  return jsonOut_({ ok: true });
}

function handleListReports_(session) {
  const sh = ss_().getSheetByName(SH_REPORTS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return jsonOut_({ ok: true, reports: [] });

  const headers = data[0].map(String);
  const rows = data.slice(1);

  const reports = rows
    .map(rowToObj_(headers))
    .filter(r => r.deleted !== true)
    .filter(r => session.role === "admin" ? true : (r.secteur === session.secteur));

  return jsonOut_({ ok: true, reports });
}

function handleGetReport_(session, p) {
  const id = String(p.id || "").trim();
  if (!id) throw new Error("Missing id");

  const sh = ss_().getSheetByName(SH_REPORTS);
  const row = findRowById_(sh, id);
  if (!row) return jsonOut_({ ok: false, error: "Not found" });

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const values = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  const r = rowToObj_(headers)(values);

  if (r.deleted === true) return jsonOut_({ ok: false, error: "Deleted" });

  if (session.role === "secteur" && r.secteur !== session.secteur) {
    throw new Error("Forbidden");
  }

  return jsonOut_({ ok: true, report: r });
}

/**
 * ✅ SUPPRESSION logique (comme avant)
 * - ADMIN ONLY
 * - On met "Suprimé" à TRUE
 */
function handleDeleteReport_(session, p) {
  if (session.role !== "admin") throw new Error("Suppression réservée admin");

  const id = String(p.id || "").trim();
  if (!id) throw new Error("Missing id");

  const ss = ss_();
  const reportsSh = ss.getSheetByName(SH_REPORTS);
  if (!reportsSh) throw new Error("Feuille REPORTS introuvable");

  const archivesSh = getOrCreateSheet_(SH_ARCHIVES);

  const row = findRowById_(reportsSh, id);
  if (!row) return jsonOut_({ ok: false, error: "Not found" });

  const lastCol = reportsSh.getLastColumn();
  const headers = reportsSh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const rowValues = reportsSh.getRange(row, 1, 1, lastCol).getValues()[0];

  // Si ARCHIVES vide : copie en-têtes + colonnes meta
  if (archivesSh.getLastRow() === 0) {
    archivesSh.appendRow(headers.concat(["Archivé le", "Archivé par"]));
  }

  // Ajout dans ARCHIVES
  archivesSh.appendRow(rowValues.concat([new Date().toISOString(), who_(session)]));

  // Suppression réelle dans REPORTS
  reportsSh.deleteRow(row);

  logHistory_(who_(session), "admin", "", "ARCHIVE_AND_DELETE_REPORT", id);

  return jsonOut_({ ok: true });
}

function handleUndeleteReport_(session, p) {
  if (session.role !== "admin") throw new Error("Annulation suppression réservée admin");

  const id = String(p.id || "").trim();
  if (!id) throw new Error("Missing id");

  const sh = ss_().getSheetByName(SH_REPORTS);
  const row = findRowById_(sh, id);
  if (!row) return jsonOut_({ ok: false, error: "Not found" });

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  const supIdx = headers.indexOf("Suprimé");
  if (supIdx !== -1) sh.getRange(row, supIdx + 1).setValue(false);

  const updIdx = headers.indexOf("Modifier");
  if (updIdx !== -1) sh.getRange(row, updIdx + 1).setValue(new Date().toISOString());

  logHistory_(who_(session), "admin", "", "UNDELETE_REPORT", id);

  return jsonOut_({ ok: true });
}

/* -------------------- HISTORY -------------------- */

function handleLogAction_(session, p) {
  const actionName = String(p.actionName || "").trim();
  const details = String(p.details || "").trim();
  if (!actionName) throw new Error("Missing actionName");

  logHistory_(who_(session), session.role, session.secteur || "", actionName, details);
  return jsonOut_({ ok: true });
}

function handleGetHistory_(session) {
  if (session.role !== "admin") throw new Error("Historique réservé admin");

  const sh = ss_().getSheetByName(SH_HISTORY);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return jsonOut_({ ok: true, history: [] });

  const headers = data[0].map(String);
  const rows = data.slice(1);
  const history = rows.map(rowToObj_(headers));

  return jsonOut_({ ok: true, history });
}

function logHistory_(user, role, secteur, action, details) {
  const sh = ss_().getSheetByName(SH_HISTORY);
  sh.appendRow([new Date().toISOString(), user, role, secteur, action, details]);
}

/* -------------------- TRI -------------------- */

function sortReports_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 3) return;

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const sectIdx = headers.indexOf("Secteur");
  const typeIdx = headers.indexOf("Type intervention");
  if (sectIdx === -1 || typeIdx === -1) return;

  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  data.sort((a, b) => {
    const sa = String(a[sectIdx] || "");
    const sb = String(b[sectIdx] || "");
    if (sa < sb) return -1;
    if (sa > sb) return 1;

    const ta = String(a[typeIdx] || "").toLowerCase();
    const tb = String(b[typeIdx] || "").toLowerCase();
    const ka = ta.startsWith("ex") ? 1 : 0;
    const kb = tb.startsWith("ex") ? 1 : 0;
    return ka - kb;
  });

  sh.getRange(2, 1, data.length, lastCol).setValues(data);
}

/* -------------------- UTILS -------------------- */

function ss_() {
  if (SPREADSHEET_ID && String(SPREADSHEET_ID).trim()) {
    return SpreadsheetApp.openById(String(SPREADSHEET_ID).trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ✅ Récupère ou crée une feuille
function getOrCreateSheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getParams_(e) {
  const p = {};
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(k => (p[k] = e.parameter[k]));
  }
  if (e && e.postData && e.postData.contents) {
    const cRaw = String(e.postData.contents);

    if (cRaw.trim().startsWith("{")) {
      try { Object.assign(p, JSON.parse(cRaw)); } catch (_) {}
      return p;
    }

    const parts = cRaw.split("&");
    for (const part of parts) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const k = eq === -1 ? part : part.slice(0, eq);
      const v = eq === -1 ? "" : part.slice(eq + 1);
      const key = decodeURIComponent(k.replace(/\+/g, "%20"));
      const val = decodeURIComponent(v.replace(/\+/g, "%20"));
      if (key) p[key] = val;
    }
  }
  return p;
}

function findRowById_(sh, id) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const idCol = headers.indexOf("id");
  if (idCol === -1) return null;

  const ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v).trim() === String(id).trim());

  return idx === -1 ? null : (idx + 2);
}

function rowToObj_(headers) {
  return function(values) {
    const o = {};
    headers.forEach((h, i) => (o[String(h).trim()] = values[i]));

    const r = {
      id: o["id"],
      dossierNumber: o["Num dossier"],
      secteur: o["Secteur"],
      interventionType: o["Type intervention"],
      address: o["Adresse"],
      dateDemande: o["Date demande"],
      dateIntervention: o["Date demande d’intervention"],
      dateExecution: o["Date exécution"],
      nature: o["Nature"],
      comment: o["Commentaire"],
      lat: Number(o["Lat"]),
      lng: Number(o["Lng"]),
      done: (String(o["Travaux effectués"]) === "true" || o["Travaux effectués"] === true),
      blink: (String(o["Pastille clignotante"]) === "true" || o["Pastille clignotante"] === true),
      photos: [],
      createdAt: o["creer"],
      updatedAt: o["Modifier"],
      deleted: (String(o["Suprimé"]) === "true" || o["Suprimé"] === true)
    };

    try {
      const pj = o["photos"];
      if (pj && typeof pj === "string") r.photos = JSON.parse(pj);
      else if (Array.isArray(pj)) r.photos = pj;
    } catch (_) {
      r.photos = [];
    }

    if (!isFinite(r.lat)) r.lat = 0;
    if (!isFinite(r.lng)) r.lng = 0;

    return r;
  };
}

function toNum_(v) {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : "";
}

/**
 * ✅ Couleurs (persistantes)
 * - Ligne entière bleu pastel si done
 * - Colonne Type intervention : Interne = vert pastel / Externe = rouge pastel
 */
function applyRowStyles_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return;

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);

  const doneIdx = headers.indexOf("Travaux effectués");
  const typeIdx = headers.indexOf("Type intervention");

  for (let r = 2; r <= lastRow; r++) {
    const rowRange = sh.getRange(r, 1, 1, lastCol);
    const vals = rowRange.getValues()[0];

    const done = (doneIdx !== -1) ? (String(vals[doneIdx]) === "true" || vals[doneIdx] === true) : false;
    const type = (typeIdx !== -1) ? String(vals[typeIdx] || "").toLowerCase() : "";

    // reset
    rowRange.setBackground(null);

    // done -> bleu pastel
    if (done) rowRange.setBackground("#dcecff");

    // type -> couleur cellule type (toujours)
    if (typeIdx !== -1) {
      const isEx = type.startsWith("ex");
      const bg = isEx ? "#fde7d9" : "#d9fbe1"; // externe rouge/orange pastel / interne vert pastel
      sh.getRange(r, typeIdx + 1).setBackground(bg);
    }
  }
}


/**
 * ✅ RENVOYER LES ARCHIVES (admin only)
 * Retourne la liste des signalements archivés depuis ARCHIVES
 */
function handleGetArchives_(session, p) {
  if (session.role !== "admin") throw new Error("Archives réservées admin");

  const ss = ss_();
  const sh = ss.getSheetByName(SH_ARCHIVES);
  if (!sh) return jsonOut_({ ok: true, reports: [] });

  const reports = readSheetAsObjects_(sh);
  return jsonOut_({ ok: true, reports });
}
