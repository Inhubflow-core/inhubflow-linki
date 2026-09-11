// InHubFlow Connect — Popup Controller (MV3)
document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const stateLoading = document.getElementById("state-loading");
  const stateSuccess = document.getElementById("state-success");
  const stateError = document.getElementById("state-error");

  const statusDot = document.getElementById("status-dot");
  const statusBadge = document.getElementById("status-badge");

  const workerToggle = document.getElementById("worker-toggle");
  const workerStatusText = document.getElementById("worker-status-text");
  const workerStatusSub = document.getElementById("worker-status-sub");
  const statConnects = document.getElementById("stat-connects");
  const statMessages = document.getElementById("stat-messages");

  const btnRunNow = document.getElementById("btn-run-now");
  const btnOpenDashboard = document.getElementById("btn-open-dashboard");

  const tokenPreview = document.getElementById("token-preview");
  const fullTokenVal = document.getElementById("full-token-val");
  const btnToggleView = document.getElementById("btn-toggle-view");
  const btnCopy = document.getElementById("btn-copy");
  const btnCopyText = document.getElementById("btn-copy-text");

  const inputServerUrl = document.getElementById("input-server-url");
  const btnPresetProd = document.getElementById("btn-preset-prod");
  const btnPresetLocal = document.getElementById("btn-preset-local");
  const btnSaveSettings = document.getElementById("btn-save-settings");

  const btnOpenLogin = document.getElementById("btn-open-login");
  const btnRetry = document.getElementById("btn-retry");

  let isMasked = true;
  let displayToken = "";
  let rawToken = "";
  let currentServerUrl = "https://b2b.inhubflow.online";

  function maskToken(str) {
    if (!str || str.length < 16) return str;
    const start = str.slice(0, 8);
    const end = str.slice(-6);
    return `${start}••••••••••••••••••••••${end}`;
  }

  // Actualizar UI del motor desde el estado del Service Worker
  function renderWorkerState(state) {
    if (!state) return;

    if (state.serverUrl) {
      currentServerUrl = state.serverUrl;
      if (inputServerUrl) inputServerUrl.value = state.serverUrl;
    }

    const enabled = state.enabled !== false;
    if (workerToggle) workerToggle.checked = enabled;

    if (!enabled) {
      if (statusDot) {
        statusDot.className = "status-dot dot-paused";
      }
      if (statusBadge) statusBadge.textContent = "Pausado";
      if (workerStatusText) workerStatusText.textContent = "⏸️ Automatización pausada";
      if (workerStatusSub) workerStatusSub.textContent = "Activa el interruptor para reanudar";
    } else {
      if (statusDot) {
        statusDot.className = "status-dot dot-online";
      }
      if (statusBadge) statusBadge.textContent = "Activo";

      // Mensajes de estado
      const lastStatus = state.lastStatus || "en_espera";
      if (state.isProcessing) {
        if (workerStatusText) workerStatusText.textContent = "⚡ Procesando tarea en segundo plano...";
        if (workerStatusSub) workerStatusSub.textContent = "Ejecutando acción silenciosa...";
      } else if (lastStatus.startsWith("ejecutando_")) {
        const type = lastStatus.replace("ejecutando_", "");
        if (workerStatusText) workerStatusText.textContent = `⚡ Ejecutando: ${type}`;
        if (workerStatusSub) workerStatusSub.textContent = state.lastError || "En progreso...";
      } else if (lastStatus === "pausa_usuario_activo") {
        if (workerStatusText) workerStatusText.textContent = "👤 Navegando en LinkedIn";
        if (workerStatusSub) workerStatusSub.textContent = "Pausado temporalmente por cortesía";
      } else if (lastStatus === "completado_exito") {
        if (workerStatusText) workerStatusText.textContent = "🟢 Conectado • Listo";
        if (workerStatusSub) workerStatusSub.textContent = "Última tarea completada con éxito";
      } else if (lastStatus === "error_conexion") {
        if (workerStatusText) workerStatusText.textContent = "⚠️ Error de conexión";
        if (workerStatusSub) workerStatusSub.textContent = "Verifica la URL del servidor InHubFlow";
      } else {
        if (workerStatusText) workerStatusText.textContent = "🟢 Conectado • En espera";
        if (workerStatusSub) workerStatusSub.textContent = "Próximo ciclo automático en ~1 min";
      }
    }

    // Contadores
    if (state.stats) {
      const connects = state.stats.connectsToday || 0;
      const maxConnects = state.stats.maxConnects || 20;
      const messages = state.stats.messagesToday || 0;
      const maxMessages = state.stats.maxMessages || 20;

      if (statConnects) statConnects.textContent = `${connects} / ${maxConnects}`;
      if (statMessages) statMessages.textContent = `${messages} / ${maxMessages}`;
    }
  }

  function fetchWorkerState() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "get_worker_state" }, (res) => {
        if (!chrome.runtime.lastError && res) {
          renderWorkerState(res);
        }
      });
    }
  }

  // Verificar sesión activa de LinkedIn (li_at)
  function checkSession() {
    stateLoading.classList.remove("hidden");
    stateSuccess.classList.add("hidden");
    stateError.classList.add("hidden");

    if (typeof chrome === "undefined" || !chrome.cookies) {
      stateLoading.classList.add("hidden");
      stateError.classList.remove("hidden");
      return;
    }

    chrome.cookies.getAll({ url: "https://www.linkedin.com" }, (cookiesByUrl) => {
      chrome.cookies.getAll({ domain: "linkedin.com" }, (cookiesByDomain) => {
        stateLoading.classList.add("hidden");

        const allCookies = [...(cookiesByUrl || []), ...(cookiesByDomain || [])];
        if (allCookies.length === 0) {
          stateError.classList.remove("hidden");
          return;
        }

        const cookieMap = new Map();
        for (const c of allCookies) {
          if (!c || !c.name || !c.value) continue;
          if (c.name === "__cf_bm" || c.name === "cf_clearance" || c.name.startsWith("_cf")) continue;
          const domain = (c.domain || "linkedin.com").toLowerCase();
          if (!(domain === "linkedin.com" || domain.endsWith(".linkedin.com"))) continue;
          const path = c.path && c.path.startsWith("/") ? c.path : "/";
          const key = `${c.name}|${domain}|${path}`;
          if (!cookieMap.has(key)) cookieMap.set(key, { ...c, domain, path });
        }

        const liAt = Array.from(cookieMap.values()).find((c) => c.name === "li_at");
        if (!liAt || !liAt.value || liAt.value.length < 20) {
          stateError.classList.remove("hidden");
          return;
        }

        displayToken = liAt.value.trim();

        // Generar payload bundle de sesión
        function normalizeSameSite(value) {
          const val = String(value || "").toLowerCase();
          if (val === "none" || val === "no_restriction") return "None";
          if (val === "strict") return "Strict";
          return "Lax";
        }

        const sessionCookies = Array.from(cookieMap.values()).map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: Boolean(c.httpOnly),
          secure: Boolean(c.secure ?? true),
          sameSite: normalizeSameSite(c.sameSite),
          ...(c.session || !Number.isFinite(c.expirationDate) || c.expirationDate <= 0
            ? {}
            : { expires: Math.round(c.expirationDate) }),
        }));

        const payload = {
          v: 2,
          li_at: displayToken,
          userAgent: navigator.userAgent,
          cookies: sessionCookies,
        };

        rawToken = "ihf_" + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
        if (fullTokenVal) fullTokenVal.value = rawToken;
        isMasked = true;
        if (tokenPreview) tokenPreview.textContent = maskToken(displayToken);

        stateSuccess.classList.remove("hidden");

        // Consultar estado del Service Worker
        fetchWorkerState();
      });
    });
  }

  // Toggle automatización activa/pausa
  if (workerToggle) {
    workerToggle.addEventListener("change", () => {
      chrome.runtime.sendMessage({ action: "toggle_worker" }, (res) => {
        fetchWorkerState();
      });
    });
  }

  // Botón "Ejecutar Ahora"
  if (btnRunNow) {
    btnRunNow.addEventListener("click", () => {
      if (workerStatusText) workerStatusText.textContent = "⚡ Buscando tareas activas...";
      if (workerStatusSub) workerStatusSub.textContent = "Conectando con InHubFlow...";

      chrome.runtime.sendMessage({ action: "run_worker_now" }, (res) => {
        setTimeout(fetchWorkerState, 1500);
      });
    });
  }

  // Botón "Dashboard"
  if (btnOpenDashboard) {
    btnOpenDashboard.addEventListener("click", () => {
      const dashUrl = `${currentServerUrl}/campaigns`;
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: dashUrl });
      } else {
        window.open(dashUrl, "_blank");
      }
    });
  }

  // Presets de servidor
  if (btnPresetProd) {
    btnPresetProd.addEventListener("click", () => {
      if (inputServerUrl) inputServerUrl.value = "https://b2b.inhubflow.online";
    });
  }

  if (btnPresetLocal) {
    btnPresetLocal.addEventListener("click", () => {
      if (inputServerUrl) inputServerUrl.value = "http://localhost:3000";
    });
  }

  // Guardar configuración de servidor
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener("click", () => {
      const url = (inputServerUrl ? inputServerUrl.value : "").trim().replace(/\/+$/, "");
      if (!url) return;

      chrome.runtime.sendMessage({ action: "set_server_url", serverUrl: url }, () => {
        currentServerUrl = url;
        btnSaveSettings.textContent = "✅ Guardado";
        setTimeout(() => {
          btnSaveSettings.textContent = "Guardar Servidor";
        }, 1500);
        fetchWorkerState();
      });
    });
  }

  // Ver / Ocultar código de sesión
  if (btnToggleView) {
    btnToggleView.addEventListener("click", () => {
      if (!displayToken) return;
      isMasked = !isMasked;
      if (isMasked) {
        tokenPreview.textContent = maskToken(displayToken);
        btnToggleView.textContent = "👁️ Ver";
      } else {
        tokenPreview.textContent = displayToken;
        btnToggleView.textContent = "🙈 Ocultar";
      }
    });
  }

  // Copiar código de sesión
  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      if (!rawToken) return;
      try {
        await navigator.clipboard.writeText(rawToken);
        if (btnCopyText) btnCopyText.textContent = "✅ ¡Copiado!";
        setTimeout(() => {
          if (btnCopyText) btnCopyText.textContent = "📋 Copiar Código";
        }, 2000);
      } catch {
        const input = document.createElement("textarea");
        input.value = rawToken;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        if (btnCopyText) btnCopyText.textContent = "✅ ¡Copiado!";
        setTimeout(() => {
          if (btnCopyText) btnCopyText.textContent = "📋 Copiar Código";
        }, 2000);
      }
    });
  }

  // Abrir LinkedIn
  if (btnOpenLogin) {
    btnOpenLogin.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: "https://www.linkedin.com/login" });
      } else {
        window.open("https://www.linkedin.com/login", "_blank");
      }
    });
  }

  // Reintentar
  if (btnRetry) {
    btnRetry.addEventListener("click", () => {
      checkSession();
    });
  }

  // Chequeo inicial
  checkSession();

  // Actualizar estado periódicamente mientras el popup esté abierto
  setInterval(fetchWorkerState, 4000);
});
