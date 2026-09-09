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

    // Retrieve all relevant cookies for linkedin.com
    chrome.cookies.getAll({ domain: "linkedin.com" }, (cookies) => {
      stateLoading.classList.add("hidden");

      if (!cookies || cookies.length === 0) {
        rawToken = "";
        displayToken = "";
        stateError.classList.remove("hidden");
        return;
      }

      const liAt = cookies.find((c) => c.name === "li_at" && c.value && c.value.length > 20);
      if (!liAt) {
        rawToken = "";
        displayToken = "";
        stateError.classList.remove("hidden");
        return;
      }

      displayToken = liAt.value.trim();

      // Gather matching session companions required by LinkedIn anti-bot (JSESSIONID, bcookie, bscookie, etc.)
      const allowedNames = new Set(["li_at", "JSESSIONID", "bcookie", "bscookie", "liap", "li_theme", "lang"]);
      const sessionCookies = cookies
        .filter((c) => allowedNames.has(c.name))
        .map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
          path: c.path || "/",
          httpOnly: c.httpOnly ?? true,
          secure: c.secure ?? true,
          sameSite: c.sameSite === "no_restriction" ? "None" : (c.sameSite === "strict" ? "Strict" : "Lax"),
        }));

      const payload = {
        v: 1,
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
