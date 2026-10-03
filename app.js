// The address is needed for the status lookup; it is intentionally not displayed on the page.
const CONFIG = {
  // Explicit Playit port: mcstatus.io's SRV lookup for the bare hostname is unreliable (10-03 it fell back to 25565 and said Offline).
  address: "della-asm.tun.ply.gg:37562",
  maxPlayers: 10,
  statusApi: "https://api.mcstatus.io/v2/status/java/",
  liveMapUrl: "https://cobblemon.albacore-trout.ts.net/",
  refreshMs: 60_000,
};

const $ = (id) => document.getElementById(id);

const DEMO = {
  online: {
    online: true,
    players: { online: 2, max: 10, list: [
      { name: "Steve" },
      { name: "Alex" },
    ] },
  },
  offline: { online: false },
};

function setStatus(state, text) {
  $("status").dataset.state = state;
  $("status-text").textContent = text;
}

function playerRow(p) {
  const li = document.createElement("li");
  const letter = document.createElement("span");
  letter.className = "head head-letter";
  letter.textContent = (p.name || "?").charAt(0).toUpperCase();

  const img = document.createElement("img");
  img.className = "head";
  img.alt = "";
  img.width = 32;
  img.height = 32;
  img.loading = "lazy";
  img.src = `https://mc-heads.net/avatar/${encodeURIComponent(p.uuid || p.name)}/32`;
  img.addEventListener("error", () => img.replaceWith(letter), { once: true });

  const name = document.createElement("span");
  name.textContent = p.name || "Unknown player";

  const afk = document.createElement("span");
  afk.className = "afk-badge";
  afk.textContent = "AFK";

  li.dataset.name = (p.name || "").toLowerCase();
  li.append(img, name, afk);
  return li;
}

// AFK names are published by the server PC (tools\afk-status.ps1 → afk.js, served at the live-map address).
// Loaded with a <script> tag because that server sends no CORS headers, so fetch() can't read it.
let afkNames = new Set();
function markAfk() {
  for (const li of $("player-list").children) li.classList.toggle("is-afk", afkNames.has(li.dataset.name));
}
window.cobblemonAfk = (data) => {
  afkNames = new Set((data.afk || []).map((n) => n.toLowerCase()));
  markAfk();
};
function loadAfk() {
  document.getElementById("afk-script")?.remove();
  if (mapState.online !== true || new URLSearchParams(location.search).has("demo")) return;
  const s = document.createElement("script");
  s.id = "afk-script";
  s.src = new URL(`afk.js?t=${Date.now()}`, CONFIG.liveMapUrl).href;
  s.onerror = () => s.remove();
  document.head.append(s);
}

function render(data) {
  const list = $("player-list");
  list.replaceChildren();
  $("empty").hidden = true;
  $("offline-note").hidden = true;

  mapState.online = Boolean(data.online);
  applyMap();

  if (!data.online) {
    setStatus("offline", "Offline");
    $("count").textContent = `0 / ${CONFIG.maxPlayers}`;
    $("offline-note").hidden = false;
    return;
  }

  const online = data.players?.online ?? 0;
  const max = data.players?.max ?? CONFIG.maxPlayers;
  setStatus("online", "Online");
  $("count").textContent = `${online} / ${max}`;

  const players = (data.players?.list ?? []).map((p) => ({ name: p.name_clean ?? p.name, uuid: p.uuid }));
  if (players.length) {
    players.forEach((p) => list.append(playerRow(p)));
    markAfk();
    loadAfk();
  } else if (online > 0) {
    const li = document.createElement("li");
    li.textContent = `${online} player${online === 1 ? "" : "s"} online`;
    list.append(li);
  } else {
    $("empty").hidden = false;
  }
}

function stamp() {
  const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("checked").textContent = `Last checked ${t}`;
}

async function refresh() {
  const demo = new URLSearchParams(location.search).get("demo");
  if (demo && DEMO[demo]) {
    render(DEMO[demo]);
    window.cobblemonAfk({ afk: ["Alex"] });   // preview the AFK badge
    stamp();
    return;
  }
  let next = CONFIG.refreshMs;
  try {
    const res = await fetch(CONFIG.statusApi + encodeURIComponent(CONFIG.address), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
    // mcstatus.io caches each check for ~60 s; ask again right when a fresh one is available.
    if (data.expires_at) next = Math.min(Math.max(data.expires_at - Date.now() + 1500, 5_000), 90_000);
  } catch {
    setStatus("loading", "Status unavailable");
    mapState.online = false;
    applyMap();
    next = 30_000;
  }
  stamp();
  setTimeout(refresh, next);
}

// The map is served live from the server PC, so it only exists while the server is on.
// online: from the status check (null until the first one).
const mapState = { online: null, shown: undefined };

function applyMap() {
  if (mapState.online === null) return;
  const live = mapState.online === true;
  $("map-updated").textContent = live
    ? "Live · players shown · surface only · explored areas only"
    : "Surface only · explored areas only";

  if (live === mapState.shown) return;
  mapState.shown = live;

  if (!live) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "The map is available while the server is online.";
    $("map-frame").replaceChildren(p);
    $("map-link").hidden = true;
    return;
  }
  const frame = document.createElement("iframe");
  frame.src = CONFIG.liveMapUrl;
  frame.title = "Live world map";
  frame.loading = "lazy";
  $("map-frame").replaceChildren(frame);
  $("map-link").href = CONFIG.liveMapUrl;
  $("map-link").hidden = false;
}

$("max").textContent = `Up to ${CONFIG.maxPlayers}`;
refresh();
