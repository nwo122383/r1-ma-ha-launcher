(() => {
  const LS_KEY = "r1_ma_remote_v3";

  const DEFAULTS = {
    maUrl: "http://192.168.4.55:8095",
    token: "",
    playerId: "",
    vol: 30,
    muted: false,
    darkMode: true,
    invertWheel: false,
    wheelStep: 2,
  };

  let state = { ...DEFAULTS };
  let lastWheelAt = 0;
  let volCommitTimer = null;
  let pollingTimer = null;

  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  const playerSelect = /** @type {HTMLSelectElement} */ ($("playerSelect"));
  const statusText = $("statusText");
  const npTitle = $("npTitle");
  const npSub = $("npSub");

  const prevBtn = $("prevBtn");
  const playPauseBtn = $("playPauseBtn");
  const nextBtn = $("nextBtn");

  const volValue = $("volValue");
  const volFill = $("volFill");
  const volDownBtn = $("volDownBtn");
  const volUpBtn = $("volUpBtn");
  const muteBtn = $("muteBtn");

  const openFullMABtn = $("openFullMABtn");

  const darkModeToggle = /** @type {HTMLInputElement} */ ($("darkModeToggle"));
  const invertWheelToggle = /** @type {HTMLInputElement} */ ($("invertWheelToggle"));
  const wheelStep = /** @type {HTMLSelectElement} */ ($("wheelStep"));

  const toast = $("toast");
  const toastLine = $("toastLine");

  const openSettings = $("openSettings");
  const reloadBtn = $("reloadBtn");
  const settingsDialog = /** @type {HTMLDialogElement} */ ($("settingsDialog"));
  const maUrlInput = /** @type {HTMLInputElement} */ ($("maUrlInput"));
  const maTokenInput = /** @type {HTMLInputElement} */ ($("maTokenInput"));
  const saveSettings = $("saveSettings");

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state = {
        ...DEFAULTS,
        ...parsed,
        wheelStep: Number(parsed.wheelStep ?? DEFAULTS.wheelStep) || DEFAULTS.wheelStep,
      };
    } catch {
      // ignore
    }
  }

  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function setToast(kind, msg) {
    toast.classList.remove("ok", "bad");
    if (kind) toast.classList.add(kind);
    toastLine.textContent = msg;
  }

  function applyTheme() {
    const root = document.documentElement;
    if (state.darkMode) root.classList.remove("light");
    else root.classList.add("light");
  }

  function normalizeUrl(url) {
    const trimmed = (url || "").trim();
    if (!trimmed) return "";
    if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
    return trimmed;
  }

  function apiUrl() {
    return `${state.maUrl.replace(/\/+$/, "")}/api`;
  }

  function fullMaUrl() {
    return `${state.maUrl.replace(/\/+$/, "")}/`;
  }

  async function maCommand(command, args = {}) {
    if (!state.maUrl) throw new Error("Missing MA URL");
    if (!state.token) throw new Error("Missing MA token");

    const body = {
      message_id: String(Date.now()),
      command,
      args,
    };

    const res = await fetch(apiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`,
        "Accept": "application/json, text/html",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MA API error ${res.status}: ${text || res.statusText}`);
    }

    return await res.json();
  }

  async function loadPlayers() {
    const candidates = ["players/all", "players/get", "players/list"];
    let lastErr = null;

    for (const cmd of candidates) {
      try {
        const data = await maCommand(cmd, {});
        const list =
          data?.result?.players ||
          data?.result ||
          data?.players ||
          data?.items ||
          [];

        if (Array.isArray(list)) return list;
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error("Unable to load players");
  }

  function pickPlayerLabel(p) {
    const name =
      p?.display_name ||
      p?.name ||
      p?.player_name ||
      p?.id ||
      p?.player_id ||
      "Unknown";
    const id = p?.player_id || p?.id || "";
    return { name: String(name), id: String(id) };
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function setVolumeUI(vol) {
    const v = clamp(Math.round(vol), 0, 100);
    state.vol = v;
    volValue.textContent = String(v);
    volFill.style.width = `${v}%`;
  }

  function renderMuteText() {
    muteBtn.textContent = state.muted ? "Unmute" : "Mute";
  }

  async function cmdPlayPause() {
    await maCommand("players/cmd/play_pause", { player_id: state.playerId });
  }

  async function cmdNext() {
    await maCommand("players/cmd/next", { player_id: state.playerId });
  }

  async function cmdPrev() {
    await maCommand("players/cmd/previous", { player_id: state.playerId });
  }

  async function cmdMuteToggle() {
    try {
      await maCommand("players/cmd/mute_toggle", { player_id: state.playerId });
      state.muted = !state.muted;
    } catch {
      // fallback mute behavior if mute_toggle isn't supported
      if (!state.muted) {
        state._preMuteVol = state.vol;
        await cmdVolumeSet(0, true);
        state.muted = true;
      } else {
        const restore = typeof state._preMuteVol === "number" ? state._preMuteVol : 30;
        await cmdVolumeSet(restore, true);
        state.muted = false;
      }
    }
    saveState();
    renderMuteText();
  }

  async function cmdVolumeSet(vol, immediate = false) {
    const v = clamp(Math.round(vol), 0, 100);
    setVolumeUI(v);
    saveState();

    if (volCommitTimer) clearTimeout(volCommitTimer);

    const commit = async () => {
      try {
        await maCommand("players/cmd/volume_set", { player_id: state.playerId, volume_level: v });
        setToast("ok", `Volume ${v}%`);
      } catch (e) {
        setToast("bad", `Volume failed: ${String(e?.message || e)}`);
      }
    };

    if (immediate) {
      await commit();
    } else {
      volCommitTimer = setTimeout(commit, 220);
    }
  }

  async function pollNowPlaying() {
    if (!state.playerId) return;

    const candidates = [
      { cmd: "players/get", args: { player_id: state.playerId } },
      { cmd: "players/details", args: { player_id: state.playerId } },
      { cmd: "players/info", args: { player_id: state.playerId } },
    ];

    for (const c of candidates) {
      try {
        const data = await maCommand(c.cmd, c.args);
        const p = data?.result?.player || data?.result || data?.player || null;

        const title =
          p?.current_item?.name ||
          p?.now_playing?.title ||
          p?.media_title ||
          "—";
        const artist =
          p?.current_item?.artists?.[0]?.name ||
          p?.now_playing?.artist ||
          p?.media_artist ||
          "—";

        const vol =
          p?.volume_level ??
          p?.volume ??
          p?.volume_percent ??
          null;

        if (typeof vol === "number") setVolumeUI(vol);

        npTitle.textContent = String(title ?? "—");
        npSub.textContent = String(artist ?? "—");

        statusText.textContent = "Connected";
        setToast("ok", "Connected");
        return;
      } catch {
        // continue
      }
    }

    statusText.textContent = "Connected (limited)";
  }

  function renderSettings() {
    maUrlInput.value = state.maUrl || "";
    // keep token hidden; if user saves without typing, we keep existing token
    maTokenInput.value = state.token ? "••••••••••" : "";
    darkModeToggle.checked = !!state.darkMode;
    invertWheelToggle.checked = !!state.invertWheel;
    wheelStep.value = String(state.wheelStep || 2);
  }

  function renderPlayers(players) {
    const current = state.playerId;
    playerSelect.innerHTML = "";

    const opts = players.map((p) => {
      const { name, id } = pickPlayerLabel(p);
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      if (id && id === current) opt.selected = true;
      return opt;
    });

    if (!opts.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No players found";
      playerSelect.appendChild(opt);
    } else {
      for (const opt of opts) playerSelect.appendChild(opt);

      if (!state.playerId) {
        state.playerId = opts[0].value;
        saveState();
      }
    }
  }

  async function connect() {
    applyTheme();

    if (!state.maUrl || !state.token) {
      statusText.textContent = "Set URL + Token";
      setToast("bad", "Open Settings and paste your MA token.");
      return;
    }

    try {
      setToast("", "Loading players…");
      const players = await loadPlayers();
      renderPlayers(players);
      statusText.textContent = "Connected";
      setToast("ok", "Players loaded.");

      if (pollingTimer) clearInterval(pollingTimer);
      pollingTimer = setInterval(pollNowPlaying, 2500);
      await pollNowPlaying();
    } catch (e) {
      statusText.textContent = "Error";
      setToast("bad", String(e?.message || e));
    }
  }

  function wheelToDelta(ev) {
    const dy = Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ? ev.deltaY : ev.deltaX;
    return dy;
  }

  function onWheel(ev) {
    const now = Date.now();
    if (now - lastWheelAt < 35) return;
    lastWheelAt = now;

    ev.preventDefault();

    const dy = wheelToDelta(ev);
    const dir = dy > 0 ? -1 : 1; // default: wheel down reduces volume
    const invert = state.invertWheel ? -1 : 1;

    const step = Number(state.wheelStep || 2);
    const next = state.vol + dir * invert * step;
    cmdVolumeSet(next, false);
  }

  // --- UI Events ---
  openFullMABtn.addEventListener("click", () => {
    setToast("", "Opening Music Assistant UI…");
    window.location.href = fullMaUrl();
  });

  openSettings.addEventListener("click", () => {
    renderSettings();
    settingsDialog.showModal();
  });

  reloadBtn.addEventListener("click", () => window.location.reload());

  saveSettings.addEventListener("click", (e) => {
    e.preventDefault();

    const newUrl = normalizeUrl(maUrlInput.value) || DEFAULTS.maUrl;
    const tokenField = maTokenInput.value.trim();
    const keepMasked = tokenField.startsWith("•");

    state.maUrl = newUrl;
    if (!keepMasked) state.token = tokenField;

    state.invertWheel = invertWheelToggle.checked;
    state.darkMode = darkModeToggle.checked;
    state.wheelStep = Number(wheelStep.value || "2") || 2;

    saveState();
    settingsDialog.close();
    applyTheme();
    connect();
  });

  darkModeToggle.addEventListener("change", () => {
    state.darkMode = darkModeToggle.checked;
    saveState();
    applyTheme();
  });

  wheelStep.addEventListener("change", () => {
    state.wheelStep = Number(wheelStep.value || "2") || 2;
    saveState();
  });

  playerSelect.addEventListener("change", async () => {
    state.playerId = playerSelect.value;
    saveState();
    setToast("", "Player selected.");
    await pollNowPlaying();
  });

  playPauseBtn.addEventListener("click", async () => {
    if (!state.playerId) return;
    try {
      await cmdPlayPause();
      setToast("ok", "Play/Pause");
      await pollNowPlaying();
    } catch (e) {
      setToast("bad", String(e?.message || e));
    }
  });

  nextBtn.addEventListener("click", async () => {
    if (!state.playerId) return;
    try {
      await cmdNext();
      setToast("ok", "Next");
    } catch (e) {
      setToast("bad", String(e?.message || e));
    }
  });

  prevBtn.addEventListener("click", async () => {
    if (!state.playerId) return;
    try {
      await cmdPrev();
      setToast("ok", "Previous");
    } catch (e) {
      setToast("bad", String(e?.message || e));
    }
  });

  volUpBtn.addEventListener("click", () => cmdVolumeSet(state.vol + 5, true));
  volDownBtn.addEventListener("click", () => cmdVolumeSet(state.vol - 5, true));

  muteBtn.addEventListener("click", async () => {
    if (!state.playerId) return;
    try {
      await cmdMuteToggle();
      setToast("ok", state.muted ? "Muted" : "Unmuted");
    } catch (e) {
      setToast("bad", String(e?.message || e));
    }
  });

  // Wheel volume everywhere
  window.addEventListener("wheel", onWheel, { passive: false });

  // Boot
  loadState();
  applyTheme();
  renderMuteText();
  setVolumeUI(state.vol);
  connect();
})();
