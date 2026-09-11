document.addEventListener("DOMContentLoaded", () => {
  const stateLoading = document.getElementById("state-loading");
  const stateSuccess = document.getElementById("state-success");
  const stateError = document.getElementById("state-error");

  const tokenPreview = document.getElementById("token-preview");
  const fullTokenVal = document.getElementById("full-token-val");
  const btnToggleView = document.getElementById("btn-toggle-view");
  const btnCopy = document.getElementById("btn-copy");
  const btnCopyText = document.getElementById("btn-copy-text");

  const btnOpenLogin = document.getElementById("btn-open-login");
  const btnRetry = document.getElementById("btn-retry");

  let isMasked = true;
  let rawToken = "";

  function maskToken(str) {
    if (!str || str.length < 16) return str;
    const start = str.slice(0, 8);
    const end = str.slice(-6);
    return `${start}••••••••••••••••••••••${end}`;
  }

  let displayToken = "";

  function checkSession() {
    stateLoading.classList.remove("hidden");
    stateSuccess.classList.add("hidden");
    stateError.classList.add("hidden");

    if (typeof chrome === "undefined" || !chrome.cookies) {
      // Fallback for non-extension preview
      stateLoading.classList.add("hidden");
      stateError.classList.remove("hidden");
      return;
    }

    // Retrieve all cookies for linkedin.com across domain and url queries
    chrome.cookies.getAll({ url: "https://www.linkedin.com" }, (cookiesByUrl) => {
      chrome.cookies.getAll({ domain: "linkedin.com" }, (cookiesByDomain) => {
        stateLoading.classList.add("hidden");

        const allCookies = [...(cookiesByUrl || []), ...(cookiesByDomain || [])];
        if (allCookies.length === 0) {
          rawToken = "";
          displayToken = "";
          stateError.classList.remove("hidden");
          return;
        }

        const cookieMap = new Map();
        for (const c of allCookies) {
          if (!c || typeof c.name !== "string" || typeof c.value !== "string" || !c.name || !c.value) continue;
          const domain = typeof c.domain === "string" && c.domain ? c.domain.toLowerCase() : "linkedin.com";
          if (!(domain === "linkedin.com" || domain.endsWith(".linkedin.com"))) continue;
          const path = typeof c.path === "string" && c.path.startsWith("/") ? c.path : "/";
          const key = `${c.name}|${domain}|${path}`;
          // URL and domain queries can return the same cookie. Preserve one
          // deterministic record without collapsing distinct path/domain cookies.
          if (!cookieMap.has(key)) cookieMap.set(key, { ...c, domain, path });
        }

        const liAt = Array.from(cookieMap.values()).find((c) => c.name === "li_at");
        if (!liAt || !liAt.value || liAt.value.length < 20) {
          rawToken = "";
          displayToken = "";
          stateError.classList.remove("hidden");
          return;
        }

        displayToken = liAt.value.trim();

        function normalizeSameSite(value) {
          const normalized = String(value || "").toLowerCase();
          if (normalized === "none" || normalized === "no_restriction") return "None";
          if (normalized === "strict") return "Strict";
          return "Lax";
        }

        // Include all valid session cookies normalized for Playwright. Session
        // cookies intentionally remain session cookies; do not invent an expiry.
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

        // Keep the token that will be displayed/captured aligned with the
        // cookie selected for the generated bundle.
        const liAtCookie = sessionCookies.find((c) => c.name === "li_at");
        if (!liAtCookie || liAtCookie.value.length < 20) {
          rawToken = "";
          displayToken = "";
          stateError.classList.remove("hidden");
          return;
        }
        displayToken = liAtCookie.value.trim();


        const payload = {
          v: 2,
          li_at: displayToken,
          userAgent: navigator.userAgent,
          cookies: sessionCookies,
        };

        rawToken = "ihf_" + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
        fullTokenVal.value = rawToken;
        isMasked = true;
        tokenPreview.textContent = maskToken(displayToken);
        btnToggleView.textContent = "👁️ Ver";
        stateSuccess.classList.remove("hidden");
      });
    });
  }

  // Toggle view full token vs masked
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

  // Copy token to clipboard
  btnCopy.addEventListener("click", async () => {
    if (!rawToken) return;

    try {
      await navigator.clipboard.writeText(rawToken);
      btnCopyText.textContent = "✅ ¡Copiado con Éxito!";
      btnCopy.style.background = "linear-gradient(135deg, #10b981, #059669)";
      btnCopy.style.boxShadow = "0 4px 14px rgba(16, 185, 129, 0.4)";

      setTimeout(() => {
        btnCopyText.textContent = "Copiar Código de Conexión";
        btnCopy.style.background = "";
        btnCopy.style.boxShadow = "";
      }, 2500);
    } catch {
      // Fallback copy
      const input = document.createElement("textarea");
      input.value = rawToken;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);

      btnCopyText.textContent = "✅ ¡Copiado!";
      setTimeout(() => {
        btnCopyText.textContent = "Copiar Código de Conexión";
      }, 2500);
    }
  });

  // Open LinkedIn in new tab
  btnOpenLogin.addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: "https://www.linkedin.com/login" });
    } else {
      window.open("https://www.linkedin.com/login", "_blank");
    }
  });

  // Retry
  btnRetry.addEventListener("click", () => {
    checkSession();
  });

  // Initial check
  checkSession();
});
