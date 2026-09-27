// Combined Pokédex: species.json (every species Cobblemon has added) + pokedex-data.json (who caught / saw what).
const $ = (id) => document.getElementById(id);
const SPRITE = (n) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${n}.png`;

const state = { species: [], data: null, tiles: new Map(), pinned: null };

const pad = (n) => String(n).padStart(4, "0");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Status of one species for the selected view ("" = everyone, otherwise a player index).
function statusOf(id, who) {
  const caught = state.data.caught[id] || [];
  const seen = state.data.seen[id] || [];
  if (who === "") return caught.length ? "caught" : seen.length ? "seen" : "none";
  const i = Number(who);
  return caught.includes(i) ? "caught" : seen.includes(i) ? "seen" : "none";
}

function renderSummary() {
  const { data, species } = state;
  const ids = new Set(species.map((s) => s.id));
  const caught = Object.keys(data.caught).filter((id) => ids.has(id)).length;
  const seenAny = new Set([...Object.keys(data.caught), ...Object.keys(data.seen)].filter((id) => ids.has(id))).size;
  const pct = species.length ? (caught / species.length) * 100 : 0;

  $("dex-caught").textContent = caught;
  $("dex-total").textContent = species.length;
  $("dex-bar-fill").style.width = `${pct}%`;
  $("dex-bar").setAttribute("aria-valuenow", pct.toFixed(1));
  $("dex-seen").textContent = `${pct.toFixed(1)}% complete · ${seenAny} species seen by someone`;
  $("dex-updated").textContent = data.updated ? `Last change ${timeAgo(data.updated)}` : "";

  const list = $("trainers");
  list.replaceChildren();
  const ranked = data.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.caught - a.caught || b.seen - a.seen);
  const best = Math.max(1, ...ranked.map((p) => p.caught));   // bars compare trainers to the leader
  for (const p of ranked) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "trainer";
    btn.dataset.player = p.i;
    btn.innerHTML = `<span class="t-name"></span><span class="t-num"><strong>${p.caught}</strong> caught · ${p.seen} seen</span><span class="bar small"><span style="width:${(p.caught / best) * 100}%"></span></span>`;
    btn.querySelector(".t-name").textContent = p.name;
    btn.title = p.name;   // full name on hover if it's cut off
    btn.addEventListener("click", () => {
      $("f-player").value = $("f-player").value === String(p.i) ? "" : String(p.i);
      applyFilters();
    });
    li.append(btn);
    list.append(li);
  }

  const sel = $("f-player");
  for (const p of data.players.map((p, i) => ({ ...p, i })).sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = p.i;
    o.textContent = p.name;
    sel.append(o);
  }
}

function buildGrid() {
  const grid = $("dex-grid");
  const frag = document.createDocumentFragment();
  for (const s of state.species) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mon";
    b.dataset.id = s.id;
    b.setAttribute("aria-label", `#${s.n} ${s.name}`);
    b.innerHTML = `<img alt="" width="64" height="64" loading="lazy" decoding="async"><span class="mon-n">#${pad(s.n)}</span><span class="mon-name"></span>`;
    const img = b.querySelector("img");
    img.src = SPRITE(s.n);
    img.addEventListener("error", () => img.replaceWith(Object.assign(document.createElement("span"), { className: "mon-ph", textContent: "?" })), { once: true });
    b.querySelector(".mon-name").textContent = s.name;
    b.addEventListener("mouseenter", () => { if (!state.pinned) showTip(b, s); });
    b.addEventListener("mouseleave", () => { if (!state.pinned) hideTip(); });
    b.addEventListener("focus", () => showTip(b, s));
    b.addEventListener("blur", () => { if (state.pinned === b) state.pinned = null; hideTip(); });
    b.addEventListener("click", () => {
      if (state.pinned === b) { state.pinned = null; hideTip(); return; }
      state.pinned = b;
      showTip(b, s);
    });
    state.tiles.set(s.id, b);
    frag.append(b);
  }
  grid.replaceChildren(frag);
}

function names(list) { return list.map((i) => state.data.players[i]?.name).filter(Boolean); }

function showTip(el, s) {
  const tip = $("dex-tip");
  const caught = names(state.data.caught[s.id] || []);
  const seen = names(state.data.seen[s.id] || []);
  tip.replaceChildren();

  const h = document.createElement("div");
  h.className = "tip-head";
  h.textContent = `#${pad(s.n)} ${s.name}`;
  const types = document.createElement("div");
  types.className = "tip-types";
  for (const t of s.t) {
    const span = document.createElement("span");
    span.className = `type type-${t}`;
    span.textContent = cap(t);
    types.append(span);
  }
  tip.append(h, types);

  const row = (label, people, cls) => {
    const p = document.createElement("p");
    p.className = cls;
    const b = document.createElement("strong");
    b.textContent = `${label}: `;
    p.append(b, document.createTextNode(people.join(", ")));
    tip.append(p);
  };
  if (caught.length) row("Caught by", caught, "tip-caught");
  if (seen.length) row("Seen by", seen, "tip-seen");
  if (!caught.length && !seen.length) {
    const p = document.createElement("p");
    p.className = "tip-none";
    p.textContent = "Nobody has found this one yet.";
    tip.append(p);
  }
  if (!s.w) {
    const p = document.createElement("p");
    p.className = "tip-note";
    p.textContent = "Doesn't spawn in the wild.";
    tip.append(p);
  }

  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2 + window.scrollX;
  left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - tw - 8));
  let top = r.top + window.scrollY - th - 8;
  if (r.top - th - 8 < 0) top = r.bottom + window.scrollY + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip() { $("dex-tip").hidden = true; }

function applyFilters() {
  const q = $("f-search").value.trim().toLowerCase().replace(/^#/, "");
  const who = $("f-player").value;
  const gen = $("f-gen").value;
  const show = $("f-show").value;
  let shown = 0, shownCaught = 0;

  for (const s of state.species) {
    const el = state.tiles.get(s.id);
    const st = statusOf(s.id, who);
    el.dataset.state = st;
    const match =
      (!q || s.name.toLowerCase().includes(q) || String(s.n) === q.replace(/^0+/, "")) &&
      (!gen || String(s.g) === gen) &&
      (!show || (show === "caught" && st === "caught") || (show === "seen" && st === "seen") || (show === "missing" && st !== "caught"));
    el.hidden = !match;
    if (match) { shown++; if (st === "caught") shownCaught++; }
  }
  for (const t of document.querySelectorAll(".trainer")) t.setAttribute("aria-pressed", String(t.dataset.player === who));
  $("dex-count").textContent = `Showing ${shown} · ${shownCaught} caught${who ? ` by ${state.data.players[Number(who)].name}` : ""}`;
  state.pinned = null;
  hideTip();
}

async function load() {
  try {
    const [species, data] = await Promise.all([
      fetch("species.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("pokedex-data.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { players: [], caught: {}, seen: {} })),
    ]);
    state.species = species;
    state.data = data;
    renderSummary();
    buildGrid();
    applyFilters();
  } catch {
    $("dex-grid").innerHTML = `<p class="empty">Couldn't load the Pokédex right now.</p>`;
  }
}

for (const id of ["f-search", "f-player", "f-gen", "f-show"]) $(id).addEventListener("input", applyFilters);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { state.pinned = null; hideTip(); } });
document.addEventListener("click", (e) => { if (state.pinned && !e.target.closest(".mon, .dex-tip")) { state.pinned = null; hideTip(); } });
window.addEventListener("scroll", () => { if (!state.pinned) hideTip(); }, { passive: true });
load();
