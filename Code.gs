// Code.gs — Signalement Travaux Marcq (complet) — Hippodrome supprimé
// ⚠️ Changez les mots de passe ci-dessous avant déploiement.

const ADMIN_PASSWORD = "CHANGE-ME-ADMIN";
const SECTOR_PASSWORDS = {
  "Hautes Loges - Briqueterie": "CHANGE-ME",
  "Bourg": "CHANGE-ME",
  "Buisson - Delcencerie": "CHANGE-ME",
  "Mairie - Quesne": "CHANGE-ME",
  "Pont - Plouich - Clémenceau": "CHANGE-ME",
  "Cimetière Delcencerie": "CHANGE-ME",
  "Cimetière Pont": "CHANGE-ME",
  "Ferme aux Oies": "CHANGE-ME"
};

const SH_PARAM = "PARAMETRES";
const SH_REPORTS = "REPORTS";
const SH_HISTORY = "HISTORY";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function doGet() {
  return jsonOut({ ok:true, service:"signalement-travaux-marcq", version:1 });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = getParams_(e);
    const action = (p.action || "").trim();
    if (!action) return jsonOut({ ok:false, error:"Missing action" });
    if (action === "login") return handleLogin_(p);

    const session = requireSession_(p);

    switch(action) {
      case "nextDossier": return handleNextDossier_(session);
      case "saveReport": return handleSaveReport_(session, p);
      case "listReports": return handleListReports_(session);
      case "deleteReport": return handleDeleteReport_(session, p);
      case "getHistory": return handleGetHistory_(session);
      default: return jsonOut({ ok:false, error:"Unknown action: " + action });
    }
  } catch(err) {
    return jsonOut({ ok:false, error:String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function handleLogin_(p) {
  const role = (p.role || "").trim();
  const secteur = (p.secteur || "").trim();
  const password = (p.password || "");
  if (!role || !password) return jsonOut({ ok:false, error:"Role/password required" });

  if (role === "admin") {
    if (password !== ADMIN_PASSWORD) return jsonOut({ ok:false, error:"Bad credentials" });
    const token = createSession_({ role:"admin" });
    logHistory_("admin","admin","", "LOGIN", "");
    return jsonOut({ ok:true, token, role:"admin" });
  }

  if (role === "secteur") {
    if (!secteur) return jsonOut({ ok:false, error:"Secteur required" });
    const expected = SECTOR_PASSWORDS[secteur];
    if (!expected) return jsonOut({ ok:false, error:"Secteur inconnu" });
    if (password !== expected) return jsonOut({ ok:false, error:"Bad credentials" });
    const token = createSession_({ role:"secteur", secteur });
    logHistory_("secteur:"+secteur, "secteur", secteur, "LOGIN", "");
    return jsonOut({ ok:true, token, role:"secteur", secteur });
  }

  return jsonOut({ ok:false, error:"Invalid role" });
}

function createSession_(payload) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("sess_"+token, JSON.stringify(payload), SESSION_TTL_SECONDS);
  return token;
}

function requireSession_(p) {
  const token = (p.token || "").trim();
  if (!token) throw new Error("Missing token");
  const raw = CacheService.getScriptCache().get("sess_"+token);
  if (!raw) throw new Error("Session expirée / invalide");
  const s = JSON.parse(raw);
  s.token = token;
  return s;
}

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
  const dossierNumber = `MARCQ-${year}-${String(counter).padStart(4,"0")}`;
  logHistory_(who_(session), session.role, session.secteur || "", "NEXT_DOSSIER", dossierNumber);
  return jsonOut({ ok:true, dossierNumber });
}

function handleSaveReport_(session, p) {
  const r = JSON.parse(p.reportJson || "{}");
  if (!r.id) throw new Error("Missing report id");
  if (session.role === "secteur" && r.secteur !== session.secteur) throw new Error("Interdit (autre secteur)");

  const sh = ss_().getSheetByName(SH_REPORTS);
  const row = findRowById_(sh, r.id);
  const now = new Date().toISOString();
  const values = [
    r.id||"", r.dossierNumber||"", r.secteur||"", r.interventionType||"interne",
    r.address||"", r.dateDemande||"", r.dateExecution||"", r.nature||"", r.comment||"",
    Number(r.lat||0), Number(r.lng||0), !!r.done, JSON.stringify(r.photos||[]),
    row ? sh.getRange(row,14).getValue()||now : now,
    now,
    false
  ];
  if (row) sh.getRange(row,1,1,values.length).setValues([values]);
  else sh.appendRow(values);
  logHistory_(who_(session), session.role, session.secteur||"", row ? "UPDATE_REPORT":"CREATE_REPORT", r.id);
  return jsonOut({ ok:true });
}

function handleListReports_(session) {
  const sh = ss_().getSheetByName(SH_REPORTS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return jsonOut({ ok:true, reports:[] });
  const headers = data[0];
  const rows = data.slice(1);
  const reports = rows.map(rowToObj_(headers))
    .filter(r => String(r.deleted) !== "true")
    .filter(r => session.role === "admin" ? true : (r.secteur === session.secteur));
  return jsonOut({ ok:true, reports });
}

function handleDeleteReport_(session, p) {
  if (session.role !== "admin") throw new Error("Suppression réservée admin");
  const id = (p.id||"").trim();
  const sh = ss_().getSheetByName(SH_REPORTS);
  const row = findRowById_(sh, id);
  if (!row) return jsonOut({ ok:false, error:"Not found" });
  sh.getRange(row,16).setValue(true);
  sh.getRange(row,15).setValue(new Date().toISOString());
  logHistory_(who_(session), "admin", "", "DELETE_REPORT", id);
  return jsonOut({ ok:true });
}

function handleGetHistory_(session) {
  if (session.role !== "admin") throw new Error("Historique réservé admin");
  const sh = ss_().getSheetByName(SH_HISTORY);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return jsonOut({ ok:true, history:[] });
  const headers = data[0];
  const rows = data.slice(1);
  return jsonOut({ ok:true, history: rows.map(rowToObj_(headers)) });
}

function logHistory_(user, role, secteur, action, details) {
  const sh = ss_().getSheetByName(SH_HISTORY) || ss_().insertSheet(SH_HISTORY);
  if (sh.getLastRow() === 0) sh.appendRow(["date","user","role","secteur","action","details"]);
  sh.appendRow([new Date().toISOString(), user, role, secteur, action, details]);
}
function who_(s) { return s.role === "admin" ? "admin" : ("secteur:"+ (s.secteur||"")); }

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function jsonOut(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function getParams_(e) {
  const p = {};
  if (e && e.parameter) Object.keys(e.parameter).forEach(k => p[k] = e.parameter[k]);
  if (e && e.postData && e.postData.contents) {
    const c = e.postData.contents;
    if (c && c.trim().startsWith("{")) {
      try { Object.assign(p, JSON.parse(c)); } catch(_){}
    }
  }
  return p;
}

function findRowById_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return null;
  const ids = sh.getRange(2,1,last-1,1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(id));
  return idx === -1 ? null : (idx+2);
}

function rowToObj_(headers) {
  return function(values) {
    const o = {};
    headers.forEach((h,i) => o[String(h).trim()] = values[i]);
    try { if (o.photosJson && typeof o.photosJson === "string") o.photos = JSON.parse(o.photosJson); } catch(_) { o.photos = []; }
    o.done = (String(o.done)==="true" || o.done===true);
    o.deleted = (String(o.deleted)==="true" || o.deleted===true);
    return o;
  };
}
