// InHubFlow Connect — Content Runner (Client-Side Human Automation Engine)
(function () {
  if (window.__inhubflow_runner_loaded) return;
  window.__inhubflow_runner_loaded = true;

  console.log("[InHubFlow] Content runner initialized on:", window.location.href);

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
    await sleep(randomBetween(2000, 3000));
    await simulateHumanScroll();

    // Helper to get all action buttons on the profile
    function getProfileButtons() {
      return Array.from(document.querySelectorAll(`
        .pv-top-card button, .pv-top-card a,
        .pvs-profile-actions button, .pvs-profile-actions a,
        .pv-top-card-v2-ctas button, .pv-top-card-v2-ctas a,
        main section button, main section a,
        div[role='main'] button, div[role='main'] a,
        button, a
      `));
    }

    // Wait up to 7 seconds for profile buttons to render
    let buttons = getProfileButtons();
    for (let attempt = 0; attempt < 14 && buttons.length < 3; attempt++) {
      await sleep(500);
      buttons = getProfileButtons();
    }

    // Helper matcher for Message button
    function isMsgButton(btn) {
      const txt = (btn.innerText || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
      const isLocked = btn.querySelector("svg[data-test-icon*='lock'], .artdeco-button__icon--lock") !== null;
      if (isLocked) return false;
      return (
        txt === "mensaje" ||
        txt === "message" ||
        txt === "mensagem" ||
        txt.includes("enviar mensaje") ||
        txt.includes("send message") ||
        txt.includes("enviar mensagem") ||
        aria.includes("enviar mensaje") ||
        aria.includes("send message") ||
        aria.includes("enviar mensagem") ||
        aria.startsWith("mensaje ") ||
        aria.startsWith("message ")
      );
    }

    let msgBtn = buttons.find(isMsgButton);

    // If not directly visible, check the "Más..." ("More...") dropdown
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
      // Diagnostic check: is the contact 2nd/3rd degree or pending?
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

    msgBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(randomBetween(600, 1200));
    msgBtn.click();
    await sleep(randomBetween(2000, 3000));

    // Look for active compose box
    const composeSelectors = [
      "div.msg-form__contenteditable[contenteditable='true']",
      "div[role='textbox'].msg-form__message-texteditor",
      "div[role='textbox'][contenteditable='true']",
      "div.msg-form__contenteditable",
      "form.msg-form [contenteditable='true']",
      "form.msg-form textarea",
      "textarea.msg-form__textarea",
      "[contenteditable='true']"
    ];

    let composeBox = null;
    for (const sel of composeSelectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 20) {
          composeBox = el;
          break;
        }
      }
      if (composeBox) break;
    }

    if (!composeBox) {
      return {
        status: "failed",
        error: "El cuadro de redacción de mensaje no se abrió tras hacer clic en Enviar mensaje",
      };
    }

    composeBox.click();
    await sleep(randomBetween(500, 1000));

    // Type the message with human delay
    await humanType(composeBox, task.body);
    await sleep(randomBetween(800, 1500));

    // Locate and click Send button
    const container = composeBox.closest("form") || composeBox.closest(".msg-convo-wrapper") || composeBox.closest(".msg-overlay-conversation-bubble") || document;
    const sendBtn = Array.from(container.querySelectorAll("button")).find((b) => {
      const txt = (b.innerText || "").trim().toLowerCase();
      const aria = (b.getAttribute("aria-label") || "").trim().toLowerCase();
      const type = (b.getAttribute("type") || "").toLowerCase();
      return (
        type === "submit" ||
        txt === "enviar" ||
        txt === "send" ||
        b.classList.contains("msg-form__send-button") ||
        aria.includes("enviar") ||
        aria.includes("send")
      );
    });

    if (!sendBtn || sendBtn.disabled) {
      return {
        status: "failed",
        error: "Botón de enviar mensaje no clickable o deshabilitado",
      };
    }

    sendBtn.click();
    await sleep(randomBetween(1500, 2500));

    return {
      status: "completed",
    };
  }

  // Listen for execution commands from background.js
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "execute_task" && request.task) {
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
          sendResponse(result);
        } catch (err) {
          console.error("[InHubFlow] Execution error:", err);
          sendResponse({
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      return true; // Keep message channel open for async response
    }
  });

  console.log("[InHubFlow] Content runner ready to receive tasks");
})();
