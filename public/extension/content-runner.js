// InHubFlow Connect — Content Runner (Client-Side Human Automation Engine)
(function () {
  if (window.__inhubflow_runner_loaded) return;
  window.__inhubflow_runner_loaded = true;

  console.log("[InHubFlow] Content runner initialized on:", window.location.href);

  // Si estamos en la plataforma InHubFlow, habilitar el puente de comunicación con la UI
  const hostname = window.location.hostname;
  if (hostname.includes("inhubflow") || hostname === "localhost" || hostname === "127.0.0.1") {
    console.log("[InHubFlow Connect] Bridge activo en la plataforma InHubFlow.");
    window.__inhubflow_extension_active = true;
    window.dispatchEvent(new CustomEvent("inhubflow_extension_ready", { detail: { active: true, version: "1.2.0" } }));

    window.addEventListener("inhubflow_sync_linkedin", (e) => {
      console.log("[InHubFlow Connect] Disparando sincronización forzada desde UI:", e.detail);
      chrome.runtime.sendMessage({ action: "sync_inbox_now", accountId: e.detail?.accountId }, (res) => {
        window.dispatchEvent(new CustomEvent("inhubflow_sync_completed", { detail: res }));
      });
    });
    return;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function humanType(element, text) {
    element.focus();
    // Dispatch focus event
    element.dispatchEvent(new Event("focus", { bubbles: true }));

    // Clear existing placeholder content if needed
    if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
      element.value = "";
    }

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (element.isContentEditable) {
        document.execCommand("insertText", false, char);
      } else {
        element.value += char;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      // Human typing delay between 35ms and 85ms
      await sleep(randomBetween(35, 85));
    }

    await sleep(200);
  }

  // Smooth natural scroll simulation
  async function simulateHumanScroll() {
    const scrollAmount = randomBetween(250, 450);
    window.scrollBy({ top: scrollAmount, behavior: "smooth" });
    await sleep(randomBetween(1500, 2500));
    window.scrollBy({ top: -Math.floor(scrollAmount * 0.6), behavior: "smooth" });
    await sleep(randomBetween(1000, 1800));
  }

  function isFirstDegreeConnection() {
    const text = document.body ? document.body.innerText : "";
    const firstMatch = /(?:^|[\s•·(])1(?:st|\.?[º°ª]|\.?er)(?:\s*(?:degree|grado|grau|degr[eé]|grad))?(?=$|[\s•·),.;])/i;
    return firstMatch.test(text);
  }

  // ─── ACTION: VISIT PROFILE ──────────────────────────────────────────────────
  async function handleVisit(task) {
    await sleep(randomBetween(2000, 3000));
    await simulateHumanScroll();
    const firstDegree = isFirstDegreeConnection();
    return {
      status: "completed",
      isFirstDegree: firstDegree,
      connectionStatus: firstDegree ? "already_connected" : "not_connected",
    };
  }

  // ─── ACTION: CONNECT ────────────────────────────────────────────────────────
  async function handleConnect(task) {
    await sleep(randomBetween(1500, 2500));
    await simulateHumanScroll();

    if (isFirstDegreeConnection()) {
      return {
        status: "completed",
        connectionStatus: "already_connected",
      };
    }

    // Search for Connect button on profile top card
    const topCard = document.querySelector("main section, div[role='main'] section, .pv-top-card, header") || document.body;
    const buttons = Array.from(topCard.querySelectorAll("button, a"));

    let connectBtn = buttons.find((btn) => {
      const txt = (btn.innerText || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
      return (
        txt === "conectar" ||
        txt === "connect" ||
        aria.includes("conectar") ||
        aria.includes("connect with") ||
        aria.includes("conectar com")
      );
    });

    // If not directly visible, check the "More..." ("Más...", "Mais...") dropdown
    if (!connectBtn) {
      const moreBtn = buttons.find((btn) => {
        const txt = (btn.innerText || "").trim().toLowerCase();
        const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
        return (
          txt === "mais" ||
          txt === "más" ||
          txt === "more" ||
          aria.includes("mais ações") ||
          aria.includes("más acciones") ||
          aria.includes("more actions")
        );
      });

      if (moreBtn) {
        moreBtn.click();
        await sleep(randomBetween(800, 1400));
        const dropdownItems = Array.from(document.querySelectorAll("div.artdeco-dropdown__content button, [role='menuitem']"));
        connectBtn = dropdownItems.find((item) => {
          const txt = (item.innerText || "").trim().toLowerCase();
          const aria = (item.getAttribute("aria-label") || "").trim().toLowerCase();
          return txt.includes("conectar") || txt.includes("connect") || aria.includes("conectar");
        });
      }
    }

    if (!connectBtn) {
      return {
        status: "failed",
        error: "Botón 'Conectar' no encontrado en el perfil (puede tener invitaciones bloqueadas o pendiente)",
      };
    }

    connectBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(randomBetween(600, 1200));
    connectBtn.click();
    await sleep(randomBetween(1500, 2500));

    // Check for modal: "Adicionar nota" vs "Enviar sem nota"
    const modal = document.querySelector(".artdeco-modal, div[role='dialog']");
    if (modal) {
      const modalButtons = Array.from(modal.querySelectorAll("button"));

      if (task.note && task.note.trim()) {
        const addNoteBtn = modalButtons.find((btn) => {
          const t = (btn.innerText || "").toLowerCase();
          return t.includes("adicionar nota") || t.includes("añadir nota") || t.includes("add a note") || t.includes("nota");
        });
        if (addNoteBtn) {
          addNoteBtn.click();
          await sleep(randomBetween(800, 1400));
        }

        const textarea = modal.querySelector("textarea, [name='message'], div[contenteditable='true']");
        if (textarea) {
          await humanType(textarea, task.note.trim());
          await sleep(randomBetween(600, 1200));
        }
      }

      // Click Send button inside modal
      const sendBtn = Array.from(modal.querySelectorAll("button")).find((btn) => {
        const t = (btn.innerText || "").toLowerCase();
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
        return (
          t.includes("enviar") ||
          t.includes("send") ||
          aria.includes("enviar") ||
          aria.includes("send")
        );
      });

      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        await sleep(randomBetween(1200, 2000));
      }
    }

    return {
      status: "completed",
      connectionStatus: "submitted",
    };
  }

  // ─── ACTION: MESSAGE ────────────────────────────────────────────────────────
  async function handleMessage(task) {
    console.log("[InHubFlow] handleMessage iniciado para:", task.fullName, "en URL:", window.location.href);

    // Helper: Poll for active compose box across DOM (up to timeoutMs)
    async function findComposeBox(timeoutMs = 15000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        // Expand any minimized bubbles in the bottom-right overlay
        const minimized = document.querySelectorAll(
          ".msg-overlay-conversation-bubble--is-minimized, aside#msg-overlay.msg-overlay-container--is-minimized, [data-control-name='overlay.expand']"
        );
        for (const b of Array.from(minimized)) {
          const btn = b.querySelector("button, header") || b;
          try { btn.click(); } catch (e) {}
        }

        // Search for any active contenteditable or textarea compose element
        const candidateSelectors = [
          "form.msg-form div.msg-form__contenteditable[contenteditable='true']",
          "form.msg-form div[role='textbox']",
          "form.msg-form [contenteditable='true']",
          ".msg-thread form.msg-form div[contenteditable='true']",
          ".msg-convo-wrapper div[contenteditable='true']",
          ".msg-overlay-conversation-bubble div.msg-form__contenteditable[contenteditable='true']",
          ".msg-overlay-conversation-bubble div.msg-form__contenteditable",
          ".msg-overlay-conversation-bubble [contenteditable='true']",
          "div.msg-form__contenteditable[contenteditable='true']",
          "div.msg-form__contenteditable",
          "div[role='textbox'].msg-form__message-texteditor",
          "div[role='textbox'][contenteditable='true']",
          "div[role='textbox']",
          "form.msg-form textarea",
          "textarea.msg-form__textarea",
          "textarea[name='message']",
        ];

        for (const sel of candidateSelectors) {
          const elements = Array.from(document.querySelectorAll(sel));
          for (const el of elements) {
            if (el.closest("#global-nav, .global-nav, .msg-search-form, header")) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 20) {
              return el;
            }
          }
        }

        await sleep(500);
      }
      return null;
    }

    async function typeAndSendMessage(composeBox, body) {
      console.log("[InHubFlow] Enfocando cuadro de redacción...");
      composeBox.focus();
      composeBox.click();
      await sleep(400);

      await humanType(composeBox, body);
      await sleep(randomBetween(600, 1000));

      composeBox.dispatchEvent(new Event("input", { bubbles: true }));
      composeBox.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        composeBox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      } catch (e) {}

      // Contenedor del formulario
      const container = composeBox.closest("form.msg-form") ||
                        composeBox.closest(".msg-convo-wrapper") ||
                        composeBox.closest(".msg-overlay-conversation-bubble") ||
                        composeBox.closest(".msg-thread") ||
                        document;

      // Buscar botón de envío
      let sendBtn = container.querySelector("button[type='submit'], button.msg-form__send-button, button[data-control-name='send']");
      if (!sendBtn) {
        const allButtons = Array.from(container.querySelectorAll("button"));
        sendBtn = allButtons.find((b) => {
          const txt = (b.innerText || "").trim().toLowerCase();
          const aria = (b.getAttribute("aria-label") || "").trim().toLowerCase();
          return txt === "enviar" || txt === "send" || aria.includes("enviar") || aria.includes("send");
        });
      }

      if (sendBtn) {
        console.log("[InHubFlow] Botón de enviar encontrado. Activando y haciendo clic...");
        sendBtn.removeAttribute("disabled");
        sendBtn.disabled = false;
        sendBtn.focus();
        sendBtn.click();
        const inner = sendBtn.querySelector("span");
        if (inner) inner.click();
        await sleep(1000);
      }

      // Enviar con Control+Enter como respaldo garantizado
      composeBox.focus();
      composeBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, ctrlKey: true, bubbles: true }));
      composeBox.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, ctrlKey: true, bubbles: true }));
      await sleep(randomBetween(1500, 2500));

      return {
        status: "completed",
      };
    }

    // CASO 1: Si ya estamos en la interfaz de mensajería (linkedin.com/messaging/...)
    if (window.location.href.includes("/messaging/")) {
      console.log("[InHubFlow] Interfaz de mensajería detectada. Esperando cuadro de redacción...");
      const composeBox = await findComposeBox(15000);
      if (!composeBox) {
        return {
          status: "failed",
          error: "No se encontró el cuadro de redacción en la pantalla de mensajes de LinkedIn",
        };
      }
      return await typeAndSendMessage(composeBox, task.body);
    }

    // CASO 2: Estamos en la página de perfil (/in/...)
    await sleep(randomBetween(2000, 3000));
    await simulateHumanScroll();

    function getProfileButtons() {
      const topCard = document.querySelector(".pv-top-card, .pvs-profile-actions, .pv-top-card-v2-ctas, main section") || document.querySelector("main, div[role='main']");
      if (!topCard) return [];
      const raw = Array.from(topCard.querySelectorAll("button, a"));
      return raw.filter((el) => {
        return !el.closest("#global-nav, .global-nav, aside#msg-overlay, .msg-overlay-container, footer");
      });
    }

    let buttons = getProfileButtons();
    for (let attempt = 0; attempt < 16 && buttons.length < 2; attempt++) {
      await sleep(500);
      buttons = getProfileButtons();
    }

    function isMsgButton(btn) {
      if (btn.closest("#global-nav, .global-nav, aside#msg-overlay, .msg-overlay-container, footer")) {
        return false;
      }
      const txt = (btn.innerText || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();

      // Excluir botones InMail bloqueados
      if (btn.querySelector("svg[data-test-icon*='lock'], .artdeco-button__icon--lock")) {
        return false;
      }

      // Excluir pestañas de la bandeja
      if (txt === "mensajes" || txt === "messages" || txt === "mensagens") return false;
      if (aria === "mensajes" || aria === "messages" || aria === "mensagens") return false;

      return (
        txt === "mensaje" ||
        txt === "message" ||
        txt === "mensagem" ||
        txt === "enviar mensaje" ||
        txt === "send message" ||
        txt === "enviar mensagem" ||
        aria.includes("enviar mensaje") ||
        aria.includes("send message") ||
        aria.includes("enviar mensagem") ||
        aria.startsWith("mensaje a") ||
        aria.startsWith("message ") ||
        aria.startsWith("mensagem para") ||
        (aria.includes("mensaje") && !aria.includes("lista de"))
      );
    }

    // Comprobar si ya hay una burbuja de redacción abierta
    let composeBox = await findComposeBox(1500);
    if (composeBox) {
      return await typeAndSendMessage(composeBox, task.body);
    }

    let msgBtn = buttons.find(isMsgButton);

    if (!msgBtn) {
      const moreBtn = buttons.find((btn) => {
        const txt = (btn.innerText || "").trim().toLowerCase();
        const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
        return (
          txt === "más" ||
          txt === "more" ||
          txt === "mais" ||
          aria.includes("más acciones") ||
          aria.includes("more actions") ||
          aria.includes("mais ações")
        );
      });

      if (moreBtn) {
        moreBtn.click();
        await sleep(randomBetween(800, 1400));
        const dropdownItems = Array.from(document.querySelectorAll("div.artdeco-dropdown__content button, div.artdeco-dropdown__content a, [role='menuitem']"));
        msgBtn = dropdownItems.find(isMsgButton);
      }
    }

    if (!msgBtn) {
      const hasConnect = buttons.some((b) => {
        const t = (b.innerText || "").toLowerCase();
        return t === "conectar" || t === "connect" || t === "seguir" || t === "follow";
      });
      const hasPending = buttons.some((b) => {
        const t = (b.innerText || "").toLowerCase();
        const a = (b.getAttribute("aria-label") || "").toLowerCase();
        return t.includes("pendiente") || t.includes("pending") || a.includes("pendiente") || a.includes("pending");
      });

      if (hasConnect || hasPending) {
        return {
          status: "failed",
          error: `${task.fullName || "El contacto"} aún no es contacto de 1er grado (invitación pendiente o sin conectar). LinkedIn solo permite mensajes directos a contactos aceptados.`,
        };
      }

      return {
        status: "failed",
        error: "Botón de enviar mensaje no disponible en el perfil",
      };
    }

    // Si el botón tiene enlace directo a mensajería (/messaging/thread/new/...)
    const directHref = msgBtn.getAttribute("href") || (msgBtn.tagName === "A" ? msgBtn.href : null);
    if (directHref && (directHref.includes("/messaging/") || directHref.includes("/thread/"))) {
      const fullMessagingUrl = directHref.startsWith("http") ? directHref : "https://www.linkedin.com" + directHref;
      console.log("[InHubFlow] Botón de mensaje redirige a pantalla completa:", fullMessagingUrl);
      return {
        status: "navigate_to_messaging",
        nextUrl: fullMessagingUrl,
      };
    }

    // Clic en el botón si no es enlace directo
    msgBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(randomBetween(500, 800));
    msgBtn.focus();
    msgBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    msgBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    msgBtn.click();
    const inner = msgBtn.querySelector("span, span.artdeco-button__text");
    if (inner) inner.click();

    composeBox = await findComposeBox(8000);
    if (composeBox) {
      return await typeAndSendMessage(composeBox, task.body);
    }

    // Si tras el clic navegó a mensajería
    await sleep(2000);
    if (window.location.href.includes("/messaging/")) {
      composeBox = await findComposeBox(10000);
      if (composeBox) {
        return await typeAndSendMessage(composeBox, task.body);
      }
    }

    return {
      status: "failed",
      error: "El cuadro de redacción de mensaje no se abrió tras hacer clic en Enviar mensaje",
    };
  }

  // Listen for execution commands from background.js
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "execute_task" && request.task) {
      let sent = false;
      const deliver = (result) => {
        if (sent) return;
        sent = true;
        try { sendResponse(result); } catch (e) { /* channel closed */ }
        try { chrome.runtime.sendMessage({ action: "task_result_ack", result, taskId: request.task.id }); } catch (e) { /* ignore */ }
      };

      (async () => {
        try {
          console.log("[InHubFlow] Executing task:", request.task.type, request.task.fullName);
          let result;
          if (request.task.type === "visit") {
            result = await handleVisit(request.task);
          } else if (request.task.type === "connect") {
            result = await handleConnect(request.task);
          } else if (request.task.type === "message") {
            result = await handleMessage(request.task);
          } else {
            result = { status: "failed", error: "Tipo de tarea desconocido: " + request.task.type };
          }
          deliver(result);
        } catch (err) {
          console.error("[InHubFlow] Execution error:", err);
          deliver({
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      return true; // Keep message channel open for async response
    }
  });

  console.log("[InHubFlow] Content runner ready to receive tasks");

  // Lector automático de mensajes si el usuario tiene LinkedIn Mensajería abierta
  if (window.location.href.includes("/messaging")) {
    console.log("[InHubFlow] Monitor de mensajería activo en esta pestaña.");
    let lastScrapedHash = "";

    function scrapeActiveThread() {
      try {
        const linkEl = document.querySelector(".msg-title-bar a[href*='/in/'], .msg-entity-lockup a[href*='/in/'], a.msg-thread__link-to-profile, a[href*='/in/']");
        const titleEl = document.querySelector(".msg-title-bar__title, .msg-entity-lockup__entity-title, h2");
        if (!linkEl && !titleEl) return;

        const senderProfileUrl = linkEl ? linkEl.href.split("?")[0] : null;
        const senderName = titleEl ? titleEl.innerText.trim() : (linkEl ? linkEl.innerText.trim() : null);

        const items = document.querySelectorAll(".msg-s-message-list__event, .msg-s-event-listitem, .msg-s-message-group");
        if (!items || items.length === 0) return;

        const messages = [];
        for (const it of items) {
          const bodyEl = it.querySelector(".msg-s-event-listitem__body, .msg-s-message-group__message, p");
          if (!bodyEl) continue;
          const body = bodyEl.innerText.trim();
          if (!body) continue;

          const isSelf = it.classList.contains("msg-s-message-listitem--self") || 
                         it.classList.contains("msg-s-message-group--self") ||
                         it.closest(".msg-s-message-listitem--self") !== null;

          const timeEl = it.querySelector("time");
          const timeStr = timeEl ? (timeEl.getAttribute("datetime") || timeEl.innerText.trim()) : null;

          messages.push({
            externalThreadId: window.location.href,
            externalMessageId: `dom_${it.getAttribute("id") || (messages.length + "_" + body.slice(0, 10))}`,
            direction: isSelf ? "outbound" : "inbound",
            body,
            receivedAt: timeStr || new Date().toISOString(),
            senderName: isSelf ? "Tú" : senderName,
            senderProfileUrl: isSelf ? null : senderProfileUrl,
          });
        }

        const hash = messages.map((m) => m.body).join("|");
        if (messages.length > 0 && hash !== lastScrapedHash) {
          lastScrapedHash = hash;
          console.log(`[InHubFlow] Hilo activo detectado con ${messages.length} mensajes. Sincronizando con la plataforma...`);
          chrome.runtime.sendMessage({
            action: "ingest_dom_messages",
            messages,
          });
        }
      } catch (err) {
        // Silencioso
      }
    }

    setInterval(scrapeActiveThread, 4000);
    setTimeout(scrapeActiveThread, 1500);
  }
})();
