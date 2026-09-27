// The address is needed for the status lookup; it is intentionally not displayed on the page.
const CONFIG = {
  address: "della-asm.tun.ply.gg",
  maxPlayers: 10,
  statusApi: "https://api.mcsrvstat.us/3/",
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

  const players = data.players?.list ?? [];
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
  try {
    const res = await fetch(CONFIG.statusApi + encodeURIComponent(CONFIG.address), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch {
    setStatus("loading", "Status unavailable");
  }
  stamp();
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

async function setupMap() {
  let info;
  try {
    const res = await fetch("map-info.json", { cache: "no-store" });
    if (!res.ok) return;
    info = await res.json();
  } catch {
    return;
  }
  if (!info.available) return;

  const frame = document.createElement("iframe");
  frame.src = "map/";
  frame.title = "World map";
  frame.loading = "lazy";
  $("map-frame").replaceChildren(frame);
  $("map-link").hidden = false;
  if (info.updated) $("map-updated").textContent = `Updated ${timeAgo(info.updated)}`;
}

$("max").textContent = `Up to ${CONFIG.maxPlayers}`;
setupMap();
refresh();
setInterval(refresh, CONFIG.refreshMs);
