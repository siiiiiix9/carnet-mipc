// ===== Carnet MIPC — logique principale =====

const QUESTIONS = [
  { id: "fait", label: "Fait marquant", prompt: "Quel est le fait marquant de ta journée — école, entreprise, échange ?" },
  { id: "tension", label: "Tension", prompt: "Une tension, une frustration ou une surprise rencontrée aujourd'hui ?" },
  { id: "theorie", label: "Théorie ↔ terrain", prompt: "Un concept vu en cours qui résonne avec quelque chose de vécu sur le terrain ?" },
  { id: "decision", label: "Décision", prompt: "Une décision difficile, prise ou observée, aujourd'hui ?" },
  { id: "parcours", label: "Écho parcours", prompt: "Un lien avec ton parcours antérieur — pharma, Just Perfect Mask, entrepreneuriat ?" },
  { id: "question", label: "Question ouverte", prompt: "Une question à creuser plus tard, pour le mémoire ou pour toi ?" },
  { id: "motcle", label: "Mot-clé", prompt: "Un mot-clé ou tag pour retrouver cette journée plus tard." },
];

const SETTINGS_KEY = "carnet-settings";
const CACHE_KEY = "carnet-cache";
const PENDING_KEY = "carnet-pending";

const state = {
  view: "loading", // loading | settings | home | entry | recap | detail
  entries: {},
  sha: null,
  qIndex: 0,
  draft: {},
  detailKey: null,
  listening: false,
  speechError: null,
  saving: false,
  syncStatus: "idle", // idle | syncing | offline | error
  justSaved: false,
};

// ---------- Utilitaires ----------

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDateLong(dateKey) {
  const d = new Date(dateKey + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
}

function formatDateShort(dateKey) {
  const d = new Date(dateKey + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null;
  } catch (e) {
    return null;
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function getCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function setCache(entries) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
}
function getPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function setPending(p) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(p));
}

// ---------- GitHub API ----------

function githubHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

async function githubGetFile(settings) {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/journal.json`;
  const res = await fetch(url, { headers: githubHeaders(settings.token) });
  if (res.status === 404) return { entries: {}, sha: null };
  if (!res.ok) throw new Error("github-get-failed:" + res.status);
  const data = await res.json();
  const content = b64DecodeUnicode(data.content.replace(/\n/g, ""));
  return { entries: JSON.parse(content), sha: data.sha };
}

async function githubPutFile(settings, entries, sha, message) {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/journal.json`;
  const body = {
    message: message || `Entrée du ${todayKey()}`,
    content: b64EncodeUnicode(JSON.stringify(entries, null, 2)),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(settings.token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("github-put-failed:" + res.status + ":" + (err.message || ""));
  }
  const data = await res.json();
  return data.content.sha;
}

async function syncPendingIfAny() {
  const settings = getSettings();
  if (!settings) return;
  const pending = getPending();
  const keys = Object.keys(pending);
  if (keys.length === 0) return;
  try {
    state.syncStatus = "syncing";
    render();
    const remote = await githubGetFile(settings);
    const merged = { ...remote.entries, ...pending };
    const newSha = await githubPutFile(settings, merged, remote.sha, "Synchro entrées en attente");
    state.entries = merged;
    state.sha = newSha;
    setCache(merged);
    setPending({});
    state.syncStatus = "idle";
  } catch (e) {
    state.syncStatus = "error";
  }
  render();
}

// ---------- Chargement initial ----------

async function init() {
  const settings = getSettings();
  state.entries = getCache();
  if (!settings) {
    state.view = "settings";
    render();
    return;
  }
  state.view = "home";
  render();
  try {
    state.syncStatus = "syncing";
    render();
    const remote = await githubGetFile(settings);
    state.entries = remote.entries;
    state.sha = remote.sha;
    setCache(remote.entries);
    state.syncStatus = "idle";
  } catch (e) {
    state.syncStatus = "offline";
  }
  await syncPendingIfAny();
  render();
}

window.addEventListener("online", syncPendingIfAny);

// ---------- Actions ----------

function goSettings() {
  state.view = "settings";
  render();
}

function submitSettings(owner, repo, token) {
  saveSettings({ owner: owner.trim(), repo: repo.trim(), token: token.trim() });
  state.view = "home";
  init();
}

function startEntry() {
  const existing = state.entries[todayKey()];
  state.draft = existing ? { ...existing.answers } : {};
  state.qIndex = 0;
  state.view = "entry";
  render();
}

function updateDraft(id, value) {
  state.draft[id] = value;
}

function goNext() {
  if (state.qIndex < QUESTIONS.length - 1) {
    state.qIndex++;
    render();
  } else {
    state.view = "recap";
    render();
  }
}
function goPrev() {
  if (state.qIndex > 0) {
    state.qIndex--;
    render();
  }
}
function editFromRecap(i) {
  state.qIndex = i;
  state.view = "entry";
  render();
}

async function saveEntry() {
  state.saving = true;
  render();
  const key = todayKey();
  const newEntry = { answers: { ...state.draft }, savedAt: new Date().toISOString() };
  const settings = getSettings();

  if (!settings) {
    state.entries = { ...state.entries, [key]: newEntry };
    setCache(state.entries);
    state.saving = false;
    state.justSaved = true;
    state.view = "home";
    render();
    setTimeout(() => { state.justSaved = false; render(); }, 3000);
    return;
  }

  try {
    const remote = await githubGetFile(settings);
    const merged = { ...remote.entries, [key]: newEntry };
    const newSha = await githubPutFile(settings, merged, remote.sha, `Entrée du ${formatDateShort(key)}`);
    state.entries = merged;
    state.sha = newSha;
    setCache(merged);
  } catch (e) {
    // hors ligne ou erreur réseau : on garde en attente localement
    const pending = getPending();
    pending[key] = newEntry;
    setPending(pending);
    state.entries = { ...state.entries, [key]: newEntry };
    setCache(state.entries);
    state.syncStatus = "offline";
  }

  state.saving = false;
  state.justSaved = true;
  state.view = "home";
  render();
  setTimeout(() => { state.justSaved = false; render(); }, 3000);
}

function openDetail(key) {
  state.detailKey = key;
  state.view = "detail";
  render();
}
function closeDetail() {
  state.view = "home";
  render();
}

function exportAll() {
  const dates = Object.keys(state.entries).sort();
  let out = "# Carnet MIPC — export\n\n";
  dates.forEach((d) => {
    out += `## ${formatDateShort(d)}\n\n`;
    QUESTIONS.forEach((q) => {
      const val = state.entries[d].answers[q.id];
      out += `**${q.label}** — ${val && val.trim() ? val : "_(passé)_"}\n\n`;
    });
    out += "\n";
  });
  const blob = new Blob([out], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carnet-mipc-export-${todayKey()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Dictée vocale ----------

let recognition = null;
let baseText = "";
let shouldContinue = false;

function toggleListening(questionId) {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) {
    state.speechError = "Dictée vocale non disponible sur ce navigateur.";
    render();
    return;
  }
  if (state.listening) {
    shouldContinue = false;
    recognition && recognition.stop();
    state.listening = false;
    render();
    return;
  }
  state.speechError = null;
  baseText = state.draft[questionId] || "";
  shouldContinue = true;
  startRecognitionSession(questionId, SpeechRecognitionAPI);
}

function startRecognitionSession(questionId, SpeechRecognitionAPI) {
  recognition = new SpeechRecognitionAPI();
  recognition.lang = "fr-FR";
  // Volontairement PAS "continuous: true" : en continu, Chrome a un bug connu
  // qui refait remonter d'anciens segments déjà validés sous de nouveaux
  // index, ce qui duplique le texte. On préfère enchaîner des sessions
  // courtes (relancées automatiquement dans onend) : chaque session repart
  // propre, sans ce bug d'index.
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    // Sur Chrome mobile (Android), le moteur ne fait pas toujours remonter
    // les nouveaux mots un par un à des index séparés : il peut réémettre
    // TOUT le texte reconnu jusqu'ici sous un nouvel index à chaque mot
    // ("test", puis "test 1", puis "test 1 2"…). Additionner tous les index
    // dupliquait donc le texte. On ne regarde que le DERNIER résultat, qui
    // contient toujours la version la plus complète et la plus à jour de
    // l'énoncé en cours — les index précédents sont ignorés.
    const last = event.results[event.results.length - 1];
    const t = last[0].transcript;
    const sep = baseText && !baseText.endsWith(" ") ? " " : "";
    if (last.isFinal) {
      baseText = baseText + sep + t;
      state.draft[questionId] = baseText;
    } else {
      state.draft[questionId] = baseText + sep + t;
    }
    const ta = document.getElementById("answer-textarea");
    if (ta) ta.value = state.draft[questionId] || "";
  };
  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return; // silence normal, onend va relancer
    state.speechError = event.error === "not-allowed" ? "Micro refusé — vérifie les autorisations du navigateur." : "Erreur de dictée, réessaie.";
    shouldContinue = false;
    state.listening = false;
    render();
  };
  recognition.onend = () => {
    if (shouldContinue) {
      try {
        startRecognitionSession(questionId, SpeechRecognitionAPI);
        return;
      } catch (e) {
        // tombe dans l'arrêt normal ci-dessous
      }
    }
    state.listening = false;
    render();
  };
  try {
    recognition.start();
    state.listening = true;
    render();
  } catch (e) {
    state.speechError = "Impossible de démarrer la dictée.";
    render();
  }
}

// ---------- Rendu ----------

const root = document.getElementById("root");

function render() {
  root.innerHTML = "";
  if (state.view === "loading") root.appendChild(renderLoading());
  else if (state.view === "settings") root.appendChild(renderSettings());
  else if (state.view === "home") root.appendChild(renderHome());
  else if (state.view === "entry") root.appendChild(renderEntry());
  else if (state.view === "recap") root.appendChild(renderRecap());
  else if (state.view === "detail") root.appendChild(renderDetail());
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return e;
}

function renderLoading() {
  return el("div", { class: "center-screen" }, [el("p", { class: "mono muted" }, "chargement…")]);
}

function renderSettings() {
  const settings = getSettings() || {};
  const wrap = el("div", { class: "container" });
  wrap.appendChild(el("h1", { class: "title" }, "Configuration GitHub"));
  wrap.appendChild(el("p", { class: "subtitle" }, "Le journal se synchronise automatiquement avec un dépôt GitHub privé. À remplir une seule fois."));

  const ownerInput = el("input", { class: "input", placeholder: "nom d'utilisateur GitHub", value: settings.owner || "" });
  const repoInput = el("input", { class: "input", placeholder: "nom du repo (ex: carnet-mipc)", value: settings.repo || "" });
  const tokenInput = el("input", { class: "input", type: "password", placeholder: "fine-grained personal access token", value: settings.token || "" });

  wrap.appendChild(el("label", { class: "label" }, "Utilisateur"));
  wrap.appendChild(ownerInput);
  wrap.appendChild(el("label", { class: "label" }, "Dépôt (repo)"));
  wrap.appendChild(repoInput);
  wrap.appendChild(el("label", { class: "label" }, "Token"));
  wrap.appendChild(tokenInput);

  wrap.appendChild(el("button", {
    class: "btn-primary",
    onclick: () => submitSettings(ownerInput.value, repoInput.value, tokenInput.value),
  }, "Enregistrer et continuer"));

  wrap.appendChild(el("div", { class: "help-box" }, [
    el("p", { class: "help-title" }, "Avant de continuer :"),
    el("p", { class: "help-text" }, "1. Crée un dépôt privé sur GitHub (ex: carnet-mipc)."),
    el("p", { class: "help-text" }, "2. Génère un fine-grained personal access token limité à ce seul dépôt, permission « Contents: Read and write »."),
    el("p", { class: "help-text" }, "Le token reste uniquement sur ton téléphone, jamais partagé ailleurs qu'avec l'API GitHub."),
  ]));

  if (getSettings()) {
    wrap.appendChild(el("button", { class: "btn-link", onclick: () => { state.view = "home"; render(); } }, "← Annuler"));
  }

  return wrap;
}

function renderHome() {
  const dates = Object.keys(state.entries).sort().reverse();
  const wrap = el("div", { class: "container" });

  const header = el("div", { class: "row-between" }, [
    el("h1", { class: "mono title-sm" }, "Carnet MIPC"),
    el("span", { class: "mono accent-text small" }, `${dates.length} entrée${dates.length !== 1 ? "s" : ""}`),
  ]);
  wrap.appendChild(header);
  wrap.appendChild(el("p", { class: "subtitle" }, "Cinq minutes par jour pour capter la matière de ton mémoire."));

  if (state.syncStatus === "offline") {
    wrap.appendChild(el("div", { class: "banner banner-warn" }, "Hors ligne — les entrées sont sauvegardées localement et se synchroniseront au retour du réseau."));
  }
  if (state.syncStatus === "error") {
    wrap.appendChild(el("div", { class: "banner banner-warn" }, "Erreur de synchronisation GitHub — vérifie ton token dans les réglages."));
  }
  if (state.justSaved) {
    wrap.appendChild(el("div", { class: "banner banner-ok" }, `✓ ENTRÉE ENREGISTRÉE — ${formatDateShort(todayKey())}`));
  }

  const todayEntry = state.entries[todayKey()];
  wrap.appendChild(el("button", {
    class: "btn-primary",
    onclick: startEntry,
  }, todayEntry ? "Modifier l'entrée d'aujourd'hui" : "Entrée du jour →"));

  const toolRow = el("div", { class: "row-between small-top" }, [
    el("button", { class: "btn-link", onclick: exportAll }, "⭳ exporter"),
    el("button", { class: "btn-link", onclick: goSettings }, "⚙ réglages"),
  ]);
  wrap.appendChild(toolRow);

  if (dates.length > 0) {
    wrap.appendChild(el("h2", { class: "mono section-label" }, "Journal"));
    const list = el("div", { class: "list" });
    dates.forEach((d) => {
      const preview = state.entries[d].answers.fait || state.entries[d].answers.tension || "(sans réponse)";
      list.appendChild(el("button", {
        class: "entry-card",
        onclick: () => openDetail(d),
      }, [
        el("span", { class: "mono accent-text card-date" }, formatDateShort(d)),
        el("span", { class: "card-preview" }, preview),
      ]));
    });
    wrap.appendChild(list);
  } else {
    wrap.appendChild(el("p", { class: "mono muted center-pad" }, "aucune entrée pour l'instant"));
  }

  return wrap;
}

function renderEntry() {
  const q = QUESTIONS[state.qIndex];
  const isLast = state.qIndex === QUESTIONS.length - 1;
  const wrap = el("div", { class: "container" });

  const dots = el("div", { class: "dots" });
  QUESTIONS.forEach((_, i) => dots.appendChild(el("div", { class: "dot" + (i <= state.qIndex ? " dot-active" : "") })));
  wrap.appendChild(el("div", { class: "row-between" }, [dots, el("button", { class: "icon-btn", onclick: () => { state.view = "home"; render(); } }, "✕")]));

  wrap.appendChild(el("span", { class: "mono accent-text small uppercase" }, `${String(state.qIndex + 1).padStart(2, "0")} / ${String(QUESTIONS.length).padStart(2, "0")} — ${q.label}`));
  wrap.appendChild(el("p", { class: "question-text" }, q.prompt));

  const textarea = el("textarea", {
    id: "answer-textarea",
    class: "textarea",
    rows: "15",
    placeholder: "Écris ici, dicte au micro, ou laisse vide et passe à la suite…",
    oninput: (e) => updateDraft(q.id, e.target.value),
  });
  textarea.value = state.draft[q.id] || "";
  wrap.appendChild(textarea);

  const micBtn = el("button", {
    class: "mic-btn" + (state.listening ? " mic-active" : ""),
    onclick: () => toggleListening(q.id),
  }, state.listening ? "● Écoute… (touche pour arrêter)" : "🎙 Dicter au micro");
  wrap.appendChild(micBtn);

  if (state.speechError) wrap.appendChild(el("p", { class: "error-text" }, state.speechError));

  const navRow = el("div", { class: "nav-row" });
  if (state.qIndex > 0) navRow.appendChild(el("button", { class: "btn-secondary btn-square", onclick: goPrev }, "←"));
  navRow.appendChild(el("button", { class: "btn-primary flex-1", onclick: goNext }, isLast ? "Voir le récapitulatif" : "Suivant →"));
  wrap.appendChild(navRow);

  return wrap;
}

function renderRecap() {
  const wrap = el("div", { class: "container" });
  wrap.appendChild(el("div", { class: "stamp" }, formatDateLong(todayKey())));
  wrap.appendChild(el("h2", { class: "title-sm" }, "Récapitulatif"));

  QUESTIONS.forEach((q, i) => {
    const val = state.draft[q.id];
    wrap.appendChild(el("button", { class: "recap-card", onclick: () => editFromRecap(i) }, [
      el("span", { class: "mono accent-text small uppercase" }, q.label),
      el("p", { class: "recap-text" }, val && val.trim() ? val : "— passé —"),
    ]));
  });

  wrap.appendChild(el("button", {
    class: "btn-save",
    onclick: saveEntry,
  }, state.saving ? "Enregistrement…" : "Sauvegarder l'entrée"));

  return wrap;
}

function renderDetail() {
  const entry = state.entries[state.detailKey];
  const overlay = el("div", { class: "overlay", onclick: closeDetail });
  const modal = el("div", { class: "modal", onclick: (e) => e.stopPropagation() });
  modal.appendChild(el("div", { class: "row-between" }, [
    el("span", { class: "mono accent-text small uppercase" }, formatDateLong(state.detailKey)),
    el("button", { class: "icon-btn", onclick: closeDetail }, "✕"),
  ]));
  QUESTIONS.forEach((q) => {
    const val = entry.answers[q.id];
    modal.appendChild(el("div", { class: "detail-block" }, [
      el("span", { class: "mono accent-text small uppercase" }, q.label),
      el("p", { class: "recap-text" }, val && val.trim() ? val : "— passé —"),
    ]));
  });
  overlay.appendChild(modal);
  return overlay;
}

init();
