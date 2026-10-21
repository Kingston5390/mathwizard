(() => {
  "use strict";

  const CFG = window.RUG_CONFIG || {};
  const RECENT_KEY = "rug-recent";
  const CLOCK_KEY = "rug-clock24";
  const THEME_KEY = "rug-theme";
  const MAX_RECENT = 6;

  const TAG_EMOJI = {
    Minecraft: "⛏️", Racing: "🏎️", Sports: "⚽", Shooter: "🎯", Horror: "👻", Clicker: "👆",
    Cooking: "🍔", Puzzle: "🧩", Strategy: "🏰", IO: "🌐", Platformer: "🏃", Arcade: "👾",
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    grid: $("grid"), recentGrid: $("recent-grid"), recentSection: $("recent-section"),
    search: $("search"), chips: $("chips"), count: $("count"), empty: $("empty"),
    allTitle: $("all-title"), footerCount: $("footer-count"),
    home: $("home"), player: $("player"), frame: $("game-frame"), playerTitle: $("player-title"),
    loader: $("loader"), loaderName: $("loader-name"), loaderThumb: $("loader-thumb"),
    barFill: $("bar-fill"), loaderStatus: $("loader-status"), retryBtn: $("retry-btn"),
  };

  // localStorage can throw (private mode, blocked storage) - never let that break the page
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let games = [];
  let byId = new Map();
  let activeTag = "All";
  let currentLoad = null; // { controller, blobUrl, id }

  // ---------- Helpers ----------
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function thumbStyle(game) {
    const h = hash(game.id);
    const a = h % 360, b = (a + 40 + (h >> 9) % 80) % 360;
    return `background: linear-gradient(135deg, hsl(${a} 75% 52%), hsl(${b} 80% 38%))`;
  }
  function initials(name) {
    const words = name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
  }
  function fmtMB(bytes) {
    const mb = bytes / 1048576;
    return mb < 1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  function gameUrls(game) {
    const base = CFG.localBase
      ? `${CFG.localBase}/${game.repo}`
      : `https://cdn.jsdelivr.net/gh/${CFG.githubUser}/${game.repo}@${CFG.branch || "main"}`;
    const url = `${base}/${game.path}`;
    if (!game.parts) return [url];
    return Array.from({ length: game.parts }, (_, i) => `${url}.part${i}`);
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Rendering ----------
  function cardHtml(game) {
    return `<button class="card" type="button" data-id="${escapeHtml(game.id)}" title="${escapeHtml(game.name)}">
      <div class="thumb" style="${thumbStyle(game)}">${escapeHtml(initials(game.name))}<span class="emoji">${TAG_EMOJI[game.tag] || "👾"}</span><span class="play">▶</span></div>
      <div class="card-body">
        <span class="card-name">${escapeHtml(game.name)}</span>
        <span class="card-meta"><span>${escapeHtml(game.tag)}</span><span>${fmtMB(game.size)}</span></span>
      </div>
    </button>`;
  }

  function renderChips() {
    const counts = { All: games.length };
    games.forEach((g) => { counts[g.tag] = (counts[g.tag] || 0) + 1; });
    const tags = ["All", ...Object.keys(counts).filter((t) => t !== "All").sort((a, b) => counts[b] - counts[a])];
    els.chips.innerHTML = tags.map((t) =>
      `<button class="chip" role="tab" type="button" data-tag="${escapeHtml(t)}" aria-selected="${t === activeTag}">${t === "All" ? "All" : (TAG_EMOJI[t] || "") + " " + escapeHtml(t)}<small>${counts[t]}</small></button>`
    ).join("");
  }

  function renderGrid() {
    const q = els.search.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const list = games.filter((g) => {
      if (activeTag !== "All" && g.tag !== activeTag) return false;
      const hay = (g.name + " " + g.id + " " + g.tag).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    els.grid.innerHTML = list.map(cardHtml).join("");
    els.empty.hidden = list.length > 0;
    els.count.textContent = `${list.length} game${list.length === 1 ? "" : "s"}`;
    els.allTitle.textContent = q ? `Results for “${els.search.value.trim()}”` : activeTag === "All" ? "All Games" : `${activeTag} Games`;
  }

  function renderRecent() {
    const recent = store.get(RECENT_KEY, []).map((id) => byId.get(id)).filter(Boolean);
    els.recentSection.hidden = recent.length === 0;
    els.recentGrid.innerHTML = recent.map(cardHtml).join("");
  }

  function addRecent(id) {
    const list = store.get(RECENT_KEY, []).filter((x) => x !== id);
    list.unshift(id);
    store.set(RECENT_KEY, list.slice(0, MAX_RECENT));
    renderRecent();
  }

  // ---------- Game loading ----------
  // jsDelivr serves .html as text/plain (so it can't be iframed directly), and caps files at 20 MB.
  // So we fetch the file (or all its .partN pieces), join them, and run it from a local blob: URL.
  async function loadGame(game) {
    stopGame();
    const controller = new AbortController();
    currentLoad = { controller, blobUrl: null, id: game.id };

    els.playerTitle.textContent = game.name;
    els.loaderName.textContent = game.name;
    els.loaderThumb.setAttribute("style", thumbStyle(game));
    els.loaderThumb.textContent = initials(game.name);
    els.loader.hidden = false;
    els.retryBtn.hidden = true;
    els.barFill.style.width = "0%";
    els.loaderStatus.textContent = "Connecting…";
    document.title = `${game.name} · Richards Unblocked Games`;

    const urls = gameUrls(game);
    const loaded = new Array(urls.length).fill(0);
    const total = game.size || 1;
    const update = () => {
      const got = loaded.reduce((a, b) => a + b, 0);
      els.barFill.style.width = `${Math.min(100, (got / total) * 100).toFixed(1)}%`;
      els.loaderStatus.textContent = `${fmtMB(got)} / ${fmtMB(total)}${urls.length > 1 ? ` · ${urls.length} parts` : ""}`;
    };

    try {
      const pieces = await Promise.all(urls.map(async (url, i) => {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("/").pop()}`);
        if (!res.body) { const b = await res.arrayBuffer(); loaded[i] = b.byteLength; update(); return [b]; }
        const reader = res.body.getReader();
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded[i] += value.byteLength;
          update();
        }
        return chunks;
      }));
      if (currentLoad?.id !== game.id) return;
      const blob = new Blob(pieces.flat(), { type: "text/html" });
      currentLoad.blobUrl = URL.createObjectURL(blob);
      els.loaderStatus.textContent = "Starting…";
      els.frame.onload = () => {
        if (currentLoad?.id !== game.id) return;
        els.loader.hidden = true;
        hookFrameKeys();
        try { els.frame.contentWindow.focus(); } catch {}
      };
      els.frame.src = currentLoad.blobUrl;
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error(err);
      els.loaderStatus.textContent = `Couldn't load this game (${err.message}).`;
      els.retryBtn.hidden = false;
    }
  }

  function stopGame() {
    if (!currentLoad) return;
    currentLoad.controller.abort();
    if (currentLoad.blobUrl) URL.revokeObjectURL(currentLoad.blobUrl);
    currentLoad = null;
    els.frame.onload = null;
    els.frame.src = "about:blank";
  }

  // The blob: page is same-origin, so we can listen for the panic keys inside the game too
  function hookFrameKeys() {
    try {
      const win = els.frame.contentWindow;
      win.addEventListener("keydown", onKey, true);
    } catch {}
  }

  // ---------- Routing (#play/<id>) so the back button works ----------
  function route() {
    const m = location.hash.match(/^#play\/(.+)$/);
    const game = m && byId.get(decodeURIComponent(m[1]));
    if (game) {
      els.player.hidden = false;
      document.body.classList.add("playing");
      addRecent(game.id);
      if (currentLoad?.id !== game.id) loadGame(game);
    } else {
      stopGame();
      els.player.hidden = true;
      document.body.classList.remove("playing");
      document.title = "Richards Unblocked Games";
    }
  }
  function play(id) { location.hash = `#play/${encodeURIComponent(id)}`; }
  function goHome() {
    if (location.hash.startsWith("#play/")) history.length > 1 ? history.back() : (location.hash = "");
  }

  // ---------- Utilities ----------
  // When opened through index.svg the site runs inside a frame, so redirect the whole tab
  function panic() {
    const url = CFG.panicUrl || "https://classroom.google.com/";
    try { window.top.location.replace(url); } catch { location.replace(url); }
  }

  function onKey(e) {
    const keys = CFG.panicKeys || ["`", "]"];
    if (keys.includes(e.key)) { e.preventDefault(); panic(); return; }
    if (e.key === "/" && document.activeElement !== els.search && els.player.hidden) {
      e.preventDefault(); els.search.focus();
    }
    if (e.key === "Escape" && document.activeElement === els.search) { els.search.value = ""; renderGrid(); els.search.blur(); }
  }

  function randomGame() {
    const pool = activeTag === "All" ? games : games.filter((g) => g.tag === activeTag);
    if (pool.length) play(pool[Math.floor(Math.random() * pool.length)].id);
  }

  function startClock() {
    let is24 = store.get(CLOCK_KEY, false);
    const timeEl = $("clock-time"), metaEl = $("clock-meta");
    const tick = () => {
      const d = new Date();
      let h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      if (is24) { timeEl.textContent = `${String(h).padStart(2, "0")}:${m}:${s}`; metaEl.textContent = "24H"; }
      else { const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; timeEl.textContent = `${h}:${m}:${s}`; metaEl.textContent = ap; }
    };
    $("clock").addEventListener("click", () => { is24 = !is24; store.set(CLOCK_KEY, is24); tick(); });
    tick();
    setInterval(tick, 1000);
  }

  function initTheme() {
    const btn = $("theme-btn");
    const apply = (t) => {
      document.documentElement.dataset.theme = t;
      btn.textContent = t === "dark" ? "🌙" : "☀️";
      btn.title = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
    };
    apply(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      apply(next);
      try { localStorage.setItem(THEME_KEY, next); } catch {}
    });
  }

  // ---------- Wire up ----------
  function bind() {
    document.addEventListener("keydown", onKey, true);
    const onCard = (e) => { const c = e.target.closest(".card"); if (c) play(c.dataset.id); };
    els.grid.addEventListener("click", onCard);
    els.recentGrid.addEventListener("click", onCard);
    els.search.addEventListener("input", renderGrid);
    els.chips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip"); if (!chip) return;
      activeTag = chip.dataset.tag;
      els.chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-selected", c === chip));
      renderGrid();
    });
    // index.svg adds a <base> pointing at jsDelivr, so a plain href="#" would leave the page
    document.querySelector(".brand").addEventListener("click", (e) => {
      e.preventDefault();
      els.search.value = "";
      renderGrid();
      goHome();
      window.scrollTo(0, 0);
    });
    $("clear-recent").addEventListener("click", () => { store.set(RECENT_KEY, []); renderRecent(); });
    $("random-btn").addEventListener("click", randomGame);
    $("panic-btn").addEventListener("click", panic);
    $("panic-btn-2").addEventListener("click", panic);
    $("back-btn").addEventListener("click", goHome);
    $("reload-btn").addEventListener("click", () => {
      const g = currentLoad && byId.get(currentLoad.id);
      if (g) loadGame(g);
    });
    els.retryBtn.addEventListener("click", () => { const id = currentLoad?.id; if (id) loadGame(byId.get(id)); });
    $("fullscreen-btn").addEventListener("click", () => {
      const el = els.frame;
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    });
    window.addEventListener("hashchange", route);
  }

  async function init() {
    initTheme();
    startClock();
    bind();
    try {
      const res = await fetch("games.json", { cache: "no-cache" });
      const data = await res.json();
      games = data.games.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      byId = new Map(games.map((g) => [g.id, g]));
    } catch (err) {
      console.error(err);
      els.empty.hidden = false;
      els.empty.textContent = "Couldn't load the game list (games.json).";
      return;
    }
    els.footerCount.textContent = `${games.length} games`;
    renderChips();
    renderGrid();
    renderRecent();
    route();
  }

  init();
})();
