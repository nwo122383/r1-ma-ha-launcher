(() => {
  // Defaults (yours already known)
  const DEFAULT_MA_URL = "http://192.168.4.55:8095";
  // Put your HA URL here if you want (local or Nabu Casa).
  // If you leave it blank, the HA button will open the settings dialog.
  const DEFAULT_HA_URL = "";

  const LS_KEY = "ma_ha_launcher_v1";

  /** @type {{ maUrl: string, haUrl: string, autoOpenMA: boolean }} */
  let state = {
    maUrl: DEFAULT_MA_URL,
    haUrl: DEFAULT_HA_URL,
    autoOpenMA: false,
  };

  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  const maUrlLabel = $("maUrlLabel");
  const haUrlLabel = $("haUrlLabel");
  const openMA = $("openMA");
  const openHA = $("openHA");
  const openSettings = $("openSettings");
  const settingsDialog = /** @type {HTMLDialogElement} */ ($("settingsDialog"));
  const maUrlInput = /** @type {HTMLInputElement} */ ($("maUrlInput"));
  const haUrlInput = /** @type {HTMLInputElement} */ ($("haUrlInput"));
  const saveSettings = $("saveSettings");
  const autoOpenMA = /** @type {HTMLInputElement} */ ($("autoOpenMA"));
  const statusCard = $("statusCard");
  const statusLine = $("statusLine");

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state = {
        maUrl: typeof parsed.maUrl === "string" ? parsed.maUrl : DEFAULT_MA_URL,
        haUrl: typeof parsed.haUrl === "string" ? parsed.haUrl : DEFAULT_HA_URL,
        autoOpenMA: !!parsed.autoOpenMA,
      };
    } catch {
      // ignore
    }
  }

  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function setStatus(kind, text) {
    statusCard.classList.remove("ok", "bad");
    if (kind) statusCard.classList.add(kind);
    statusLine.textContent = text;
  }

  function normalizeUrl(url) {
    const trimmed = (url || "").trim();
    if (!trimmed) return "";
    // If user typed 192.168.x.x:8095 without scheme, add http://
    if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
    return trimmed;
  }

  async function pingMA(url) {
    // We can’t do a true “ping”, but we can attempt a lightweight GET.
    // MA usually serves HTML on /, which is fine.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(url, { method: "GET", mode: "no-cors", signal: controller.signal });
      // no-cors means we won't know res.ok; if it didn't throw, treat as likely reachable
      clearTimeout(t);
      return true;
    } catch {
      clearTimeout(t);
      return false;
    }
  }

  function render() {
    maUrlLabel.textContent = state.maUrl || "—";
    haUrlLabel.textContent = state.haUrl || "—";
    autoOpenMA.checked = state.autoOpenMA;

    maUrlInput.value = state.maUrl;
    haUrlInput.value = state.haUrl;

    if (!state.haUrl) {
      openHA.textContent = "Set Home Assistant URL";
    } else {
      openHA.textContent = "Open Home Assistant";
    }
  }

  function go(url) {
    if (!url) return;
    // top-level navigation (more reliable than iframe; avoids mixed-content iframe blocks)
    window.location.href = url;
  }

  // Events
  openMA.addEventListener("click", () => {
    if (!state.maUrl) return settingsDialog.showModal();
    setStatus("", "Opening Music Assistant…");
    go(state.maUrl);
  });

  openHA.addEventListener("click", () => {
    if (!state.haUrl) return settingsDialog.showModal();
    setStatus("", "Opening Home Assistant…");
    go(state.haUrl);
  });

  openSettings.addEventListener("click", () => settingsDialog.showModal());

  saveSettings.addEventListener("click", (e) => {
    e.preventDefault();
    state.maUrl = normalizeUrl(maUrlInput.value) || DEFAULT_MA_URL;
    state.haUrl = normalizeUrl(haUrlInput.value);
    state.autoOpenMA = autoOpenMA.checked;
    saveState();
    settingsDialog.close();
    render();
    setStatus("", "Saved.");
  });

  autoOpenMA.addEventListener("change", () => {
    state.autoOpenMA = autoOpenMA.checked;
    saveState();
  });

  // Boot
  loadState();
  render();

  // Quick connectivity hint
  (async () => {
    if (!state.maUrl) return;
    setStatus("", "Checking Music Assistant…");
    const ok = await pingMA(state.maUrl);
    if (ok) setStatus("ok", "Music Assistant looks reachable.");
    else setStatus("bad", "Can’t reach Music Assistant (LAN/Wi-Fi?).");

    // Optional: auto-open MA
    if (state.autoOpenMA) {
      setTimeout(() => go(state.maUrl), 600);
    }
  })();
})();
