// The address is needed for the status lookup; it is intentionally not displayed on the page.
const CONFIG = {
  address: "della-asm.tun.ply.gg",
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

  li.append(img, name);
  return li;
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

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// online: from the status check (null until the first one). snapshot: map-info.json. picked: user's choice.
const mapState = { online: null, snapshot: null, picked: null, shown: undefined };

function mapMode() {
  const live = mapState.online === true;
  const snap = Boolean(mapState.snapshot?.available);
  if (mapState.picked === "live" && live) return "live";
  if (mapState.picked === "snapshot" && snap) return "snapshot";
  if (live) return "live";
  if (snap) return "snapshot";
  return null;
}

function applyMap() {
  if (mapState.online === null || mapState.snapshot === null) return;
  const mode = mapMode();

  $("map-live").disabled = mapState.online !== true;
  $("map-snapshot").disabled = !mapState.snapshot.available;
  for (const id of ["map-live", "map-snapshot"]) {
    $(id).setAttribute("aria-pressed", String($(id).dataset.mode === mode));
  }

  const privacy = "surface only · explored areas only";
  if (mode === "live") {
    $("map-updated").textContent = `Live · players shown · ${privacy}`;
  } else if (mode === "snapshot") {
    const when = mapState.snapshot.updated ? ` from ${timeAgo(mapState.snapshot.updated)}` : "";
    $("map-updated").textContent = `Snapshot${when} · ${privacy}`;
  } else {
    $("map-updated").textContent = `Surface only · explored areas only`;
  }

  if (mode === mapState.shown) return;
  mapState.shown = mode;

  if (!mode) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "The map fills in as players explore.";
    $("map-frame").replaceChildren(p);
    $("map-link").hidden = true;
    return;
  }
  const src = mode === "live" ? CONFIG.liveMapUrl : "map/";
  const frame = document.createElement("iframe");
  frame.src = src;
  frame.title = mode === "live" ? "Live world map" : "World map snapshot";
  frame.loading = "lazy";
  $("map-frame").replaceChildren(frame);
  $("map-link").href = src;
  $("map-link").hidden = false;
}

async function loadSnapshotInfo() {
  try {
    const res = await fetch("map-info.json", { cache: "no-store" });
    mapState.snapshot = res.ok ? await res.json() : { available: false };
  } catch {
    mapState.snapshot = { available: false };
  }
  applyMap();
}

for (const id of ["map-live", "map-snapshot"]) {
  $(id).addEventListener("click", () => {
    mapState.picked = $(id).dataset.mode;
    applyMap();
  });
}

$("max").textContent = `Up to ${CONFIG.maxPlayers}`;
loadSnapshotInfo();
refresh();
