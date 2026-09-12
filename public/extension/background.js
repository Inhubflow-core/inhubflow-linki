// InHubFlow Connect — Background Service Worker (Engine MV3)
// Coordina la ejecución de tareas de LinkedIn en segundo plano en pestañas silenciosas

const DEFAULT_SERVER_URL = "https://b2b.inhubflow.online";
const ALARM_NAME = "inhubflow_worker_tick";
const TICK_INTERVAL_MINUTES = 1;

let isProcessingTask = false;

// Helpers para almacenamiento persistente
async function getStorageData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["serverUrl", "enabled", "accountId", "stats", "lastStatus", "lastStatusTime", "lastError"],
      (items) => {
        resolve({
          serverUrl: items.serverUrl || DEFAULT_SERVER_URL,
          enabled: items.enabled !== false, // Activo por defecto
          accountId: items.accountId || null,
          stats: items.stats || {
            connectsToday: 0,
            maxConnects: 20,
            messagesToday: 0,
            maxMessages: 20,
            lastRunTime: null,
          },
          lastStatus: items.lastStatus || "inactivo",
          lastStatusTime: items.lastStatusTime || null,
          lastError: items.lastError || null,
        });
      }
    );
  });
}

async function setStorageData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}

async function updateWorkerStatus(status, error = null) {
  const current = await getStorageData();
  await setStorageData({
    lastStatus: status,
    lastStatusTime: new Date().toISOString(),
    lastError: error,
  });
  console.log(`[InHubFlow ServiceWorker] Estado actualizado: ${status}`, error || "");
}

// Inicialización de Alarmas
chrome.runtime.onInstalled.addListener(() => {
  console.log("[InHubFlow] Extensión instalada/actualizada v1.2.0. Configurando alarma...");
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: TICK_INTERVAL_MINUTES,
  });
  // Tick inicial
  setTimeout(() => runWorkerCycle("instalacion"), 2000);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[InHubFlow] Navegador iniciado. Asegurando alarma...");
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: TICK_INTERVAL_MINUTES,
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runWorkerCycle("alarma");
  }
});

// Resuelve CSRF de LinkedIn de manera infalible
async function getLinkedInCsrf() {
  try {
    const allCookies = await chrome.cookies.getAll({ domain: "linkedin.com" });
    const jsession = allCookies.find((c) => c && c.name && c.name.toLowerCase() === "jsessionid");
    if (jsession?.value) {
      return jsession.value.replace(/"/g, "").trim();
    }
  } catch (err) {
    console.warn("[InHubFlow ServiceWorker] Error obteniendo cookies por dominio:", err);
  }

  try {
    const cookie = await chrome.cookies.get({ url: "https://www.linkedin.com", name: "JSESSIONID" });
    if (cookie?.value) {
      return cookie.value.replace(/"/g, "").trim();
    }
  } catch (err) {
    console.warn("[InHubFlow ServiceWorker] Error obteniendo cookie por url:", err);
  }

  return null;
}

// Sincroniza mensajes entrantes y salientes de LinkedIn directamente con la sesión de Chrome (IP residencial)
async function syncLinkedInInbox(serverUrl, accountId) {
  if (!accountId) {
    console.warn("[InHubFlow ServiceWorker] syncLinkedInInbox: Falta accountId.");
    return { ok: false, error: "Missing accountId" };
  }

  try {
    const csrf = await getLinkedInCsrf();
    if (!csrf) {
      console.warn("[InHubFlow ServiceWorker] No se pudo obtener JSESSIONID (CSRF). ¿Sesión activa de LinkedIn?");
      return { ok: false, error: "No CSRF token" };
    }

    const headers = {
      accept: "application/vnd.linkedin.normalized+json+2.1",
      "x-restli-protocol-version": "2.0.0",
      "csrf-token": csrf,
    };

    // 0. Identificar el perfil del usuario autenticado (Roberto)
    let myUrn = null;
    let myPublicId = null;
    try {
      const meRes = await fetch("https://www.linkedin.com/voyager/api/me", { headers, credentials: "include" });
      if (meRes.ok) {
        const meData = await meRes.json();
        myUrn = meData.miniProfile?.entityUrn || meData.entityUrn || null;
        myPublicId = meData.miniProfile?.publicIdentifier || null;
      }
    } catch {
      // Continuar con fallback
    }

    // 1. Obtener lista de conversaciones recientes
    const convRes = await fetch(
      "https://www.linkedin.com/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX&q=participants&start=0&count=20",
      { headers, credentials: "include" }
    );

    if (!convRes.ok) {
      console.warn("[InHubFlow ServiceWorker] Voyager conversations status:", convRes.status);
      return { ok: false, error: `Voyager HTTP ${convRes.status}` };
    }

    const convPayload = await convRes.json();
    const included = convPayload.included || [];
    const elements = convPayload.elements || [];
    const allRecords = [...included, ...elements];

    // Mapa de MiniProfiles para asociar nombre y URL pública a cada URN
    const miniProfiles = new Map();
    const memberToMiniProfile = new Map();

    for (const r of allRecords) {
      if (!r) continue;
      const urn = r.entityUrn || r.objectUrn;
      if (!urn) continue;

      if (r.$type?.includes("MiniProfile") || r.publicIdentifier || (r.firstName && r.lastName)) {
        const publicIdentifier = r.publicIdentifier || "";
        const name = `${r.firstName || ""} ${r.lastName || ""}`.trim();
        miniProfiles.set(urn, {
          name,
          publicIdentifier,
          profileUrl: publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null,
          urn,
        });
      }

      if (r.$type?.includes("MessagingMember") || urn.includes("messagingMember")) {
        const miniUrn = r["*miniProfile"] || r.miniProfile;
        if (miniUrn) {
          memberToMiniProfile.set(urn, miniUrn);
        }
      }
    }

    function resolveProfile(urnOrObj) {
      if (!urnOrObj) return null;
      const urn = typeof urnOrObj === "string" ? urnOrObj : (urnOrObj.entityUrn || urnOrObj["*messagingMember"] || urnOrObj.objectUrn || "");
      if (!urn) return null;
      if (miniProfiles.has(urn)) return miniProfiles.get(urn);
      if (memberToMiniProfile.has(urn)) {
        const miniUrn = memberToMiniProfile.get(urn);
        if (miniProfiles.has(miniUrn)) return miniProfiles.get(miniUrn);
      }
      return null;
    }

    // 2. Extraer hilos y buscar eventos en los hilos más recientes
    const observations = [];
    const convItems = allRecords.filter(
      (r) => r && (r.$type === "com.linkedin.voyager.messaging.Conversation" || (r.entityUrn && r.entityUrn.includes("msg_conversation")))
    );

    console.log(`[InHubFlow ServiceWorker] Analizando ${convItems.length} hilos de conversación...`);

    for (let i = 0; i < Math.min(convItems.length, 12); i++) {
      const conv = convItems[i];
      const convUrn = conv.entityUrn || "";
      const match = convUrn.match(/urn:li:msg_conversation:\((?:[^,]+),(.+)\)$/);
      const threadPathId = match ? match[1] : (conv.id || convUrn);
      if (!threadPathId) continue;

      // Identificar al otro participante de este hilo
      let otherParticipant = null;
      const participants = conv.participants || conv["*participants"] || [];
      for (const p of participants) {
        const prof = resolveProfile(p);
        if (prof) {
          const isMe = (myPublicId && prof.publicIdentifier === myPublicId) || (myUrn && prof.urn === myUrn);
          if (!isMe) {
            otherParticipant = prof;
            break;
          }
        }
      }

      try {
        const evRes = await fetch(
          `https://www.linkedin.com/voyager/api/messaging/conversations/${encodeURIComponent(threadPathId)}/events?start=0&count=30`,
          { headers, credentials: "include" }
        );

        if (evRes.ok) {
          const evPayload = await evRes.json();
          const evIncluded = evPayload.included || [];
          const evElements = evPayload.elements || [];
          const evAll = [...evIncluded, ...evElements];

          for (const r of evAll) {
            if (!r) continue;
            const urn = r.entityUrn || r.objectUrn;
            if (!urn) continue;
            if (r.$type?.includes("MiniProfile") || r.publicIdentifier || (r.firstName && r.lastName)) {
              const publicIdentifier = r.publicIdentifier || "";
              const name = `${r.firstName || ""} ${r.lastName || ""}`.trim();
              miniProfiles.set(urn, {
                name,
                publicIdentifier,
                profileUrl: publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null,
                urn,
              });
            }
            if (r.$type?.includes("MessagingMember") || urn.includes("messagingMember")) {
              const miniUrn = r["*miniProfile"] || r.miniProfile;
              if (miniUrn) memberToMiniProfile.set(urn, miniUrn);
            }
          }

          for (const r of evAll) {
            if (!r) continue;
            const isEvent =
              r.$type?.includes("MessageEvent") ||
              r.$type?.includes("Event") ||
              (r.entityUrn && r.entityUrn.includes("fs_event"));
            if (!isEvent) continue;

            const body = r.eventContent?.attributedBody?.text || r.body || "";
            if (!body || !body.trim()) continue;

            const fromUrn = typeof r.from === "string" ? r.from : (r.from?.entityUrn || r.from?.["*messagingMember"] || r.from?.objectUrn);
            const senderProfile = resolveProfile(fromUrn);

            const isSenderMe =
              (myPublicId && senderProfile?.publicIdentifier === myPublicId) ||
              (myUrn && (fromUrn === myUrn || senderProfile?.urn === myUrn));

            const effectiveProfile = isSenderMe ? senderProfile : (senderProfile || otherParticipant);

            observations.push({
              externalThreadId: convUrn,
              externalMessageId: r.entityUrn || r.id || `${convUrn}_${r.createdAt || Date.now()}`,
              direction: isSenderMe ? "outbound" : "inbound",
              body: body.trim(),
              receivedAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
              senderExternalId: fromUrn || null,
              senderName: effectiveProfile?.name || null,
              senderProfileUrl: effectiveProfile?.profileUrl || null,
              senderMessagingUrn: fromUrn || null,
              providerEventId: r.entityUrn || r.id || null,
            });
          }
        }
      } catch (evErr) {
        // Continuar con siguiente hilo
      }
    }

    if (observations.length > 0) {
      console.log(`[InHubFlow ServiceWorker] Enviando ${observations.length} mensajes recopilados al servidor...`);
      const syncRes = await fetch(`${serverUrl}/api/extension/inbox-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, observations }),
      });
      const syncData = await syncRes.json();
      console.log("[InHubFlow ServiceWorker] Respuesta del servidor:", syncData);
      return { ok: true, count: observations.length, syncData };
    } else {
      console.log("[InHubFlow ServiceWorker] No se encontraron mensajes nuevos en este ciclo.");
      return { ok: true, count: 0 };
    }
  } catch (err) {
    console.warn("[InHubFlow ServiceWorker] Error en sincronización de inbox:", err);
    return { ok: false, error: err.message };
  }
}

// Comprueba si el usuario tiene una pestaña activa y enfocada de LinkedIn
async function isUserActivelyBrowsingLinkedIn() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0].url) {
      const url = tabs[0].url.toLowerCase();
      if (url.includes("linkedin.com")) {
        return true;
      }
    }
  } catch (err) {
    console.warn("[InHubFlow] Error consultando pestaña activa:", err);
  }
  return false;
}

// Espera a que una pestaña termine de cargar
function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Envía la tarea a la pestaña y espera respuesta con canal dual (sendResponse + runtime ack)
async function dispatchTaskToTab(tabId, task) {
  return new Promise((resolve) => {
    let isResolved = false;
    const doResolve = (res) => {
      if (isResolved) return;
      isResolved = true;
      chrome.runtime.onMessage.removeListener(ackListener);
      clearTimeout(timeout);
      resolve(res);
    };

    const timeout = setTimeout(() => {
      doResolve({ status: "failed", error: "Tiempo de espera agotado al ejecutar acción en la página" });
    }, 60000);

    const ackListener = (msg) => {
      if (msg && msg.action === "task_result_ack" && msg.result) {
        console.log("[InHubFlow ServiceWorker] Resultado recibido vía runtime ack:", msg.result);
        doResolve(msg.result);
      }
    };
    chrome.runtime.onMessage.addListener(ackListener);

    chrome.tabs.sendMessage(tabId, { action: "execute_task", task }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[InHubFlow ServiceWorker] tabs.sendMessage advertencia:", chrome.runtime.lastError.message);
        setTimeout(() => {
          if (!isResolved) {
            doResolve({
              status: "failed",
              error: chrome.runtime.lastError.message || "Error comunicando con la pestaña",
            });
          }
        }, 1500);
      } else if (response) {
        doResolve(response);
      }
    });
  });
}

// Ciclo principal de ejecución
async function runWorkerCycle(triggerSource = "manual") {
  if (isProcessingTask) {
    console.log(`[InHubFlow ServiceWorker] Ciclo omitido (tarea ya en proceso) [disparador: ${triggerSource}]`);
    return { success: false, reason: "already_running" };
  }

  // LET (no const) para permitir reasignar si el heartbeat o storage actualizan accountId
  let { serverUrl, enabled, accountId, stats } = await getStorageData();

  if (!enabled) {
    await updateWorkerStatus("pausado");
    console.log("[InHubFlow ServiceWorker] Automatización pausada por el usuario.");
    return { success: false, reason: "disabled" };
  }

  // Comprobar cortesía humana: ¿el usuario está navegando LinkedIn activamente?
  const userBrowsing = await isUserActivelyBrowsingLinkedIn();
  if (userBrowsing) {
    console.log("[InHubFlow ServiceWorker] Usuario navegando activamente en LinkedIn. Pospuesto para evitar molestias.");
    await updateWorkerStatus("pausa_usuario_activo");
    return { success: false, reason: "user_active_on_linkedin" };
  }

  isProcessingTask = true;

  try {
    // Obtener li_at para auto-identificación de cuenta/slot en equipos multi-usuario
    let liAtVal = null;
    try {
      if (typeof chrome !== "undefined" && chrome.cookies) {
        const cookie = await chrome.cookies.get({ url: "https://www.linkedin.com", name: "li_at" });
        if (cookie && cookie.value) liAtVal = cookie.value.trim();
      }
    } catch {
      // Ignorar
    }

    // 1. Enviar Heartbeat
    try {
      const hbUrl = `${serverUrl}/api/extension/heartbeat`;
      const hbRes = await fetch(hbUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(liAtVal ? { "x-linkedin-token": liAtVal } : {}),
        },
        body: JSON.stringify({ account_id: accountId, li_at: liAtVal }),
      });
      if (hbRes.ok) {
        const hbData = await hbRes.json();
        if (hbData.accountId && hbData.accountId !== accountId) {
          accountId = hbData.accountId;
          await setStorageData({ accountId });
        }
      }
    } catch (hbErr) {
      console.warn("[InHubFlow ServiceWorker] Heartbeat ping falló (no crítico):", hbErr);
    }

    // 1.5. Sincronización silenciosa del Inbox de LinkedIn (IP residencial)
    try {
      if (accountId) {
        await syncLinkedInInbox(serverUrl, accountId);
      }
    } catch (inboxSyncErr) {
      console.warn("[InHubFlow ServiceWorker] Error en sincronización de inbox:", inboxSyncErr);
    }

    // 2. Solicitar Tarea a la Plataforma
    const taskEndpoint = `${serverUrl}/api/extension/task${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`;
    console.log(`[InHubFlow ServiceWorker] Consultando tarea en: ${taskEndpoint}`);

    let taskResponse;
    try {
      taskResponse = await fetch(taskEndpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(accountId ? { "x-account-id": accountId } : {}),
          ...(liAtVal ? { "x-linkedin-token": liAtVal } : {}),
        },
      });
    } catch (fetchErr) {
      console.error("[InHubFlow ServiceWorker] Error conectando con el servidor:", fetchErr);
      await updateWorkerStatus("error_conexion", fetchErr.message);
      isProcessingTask = false;
      return { success: false, error: fetchErr.message };
    }

    if (!taskResponse.ok) {
      const errText = `HTTP ${taskResponse.status}: ${taskResponse.statusText}`;
      console.warn("[InHubFlow ServiceWorker] Respuesta del servidor en espera:", errText);
      await updateWorkerStatus("en_espera", errText);
      isProcessingTask = false;
      return { success: false, error: errText };
    }

    const taskData = await taskResponse.json();

    // Actualizar estadísticas si el servidor las proporcionó
    if (taskData.stats) {
      await setStorageData({
        stats: {
          ...stats,
          ...taskData.stats,
          lastCheck: new Date().toISOString(),
        },
      });
    }

    const task = taskData.task;
    if (!task) {
      const reason = taskData.reason || "queue_empty";
      console.log(`[InHubFlow ServiceWorker] No hay tareas pendientes (${reason}).`);
      await updateWorkerStatus("en_espera", reason);
      isProcessingTask = false;
      return { success: true, message: "No tasks pending" };
    }

    console.log(`[InHubFlow ServiceWorker] Tarea recibida: ${task.type} para ${task.fullName} (${task.profileUrl})`);
    await updateWorkerStatus(`ejecutando_${task.type}`, `Procesando: ${task.fullName}`);

    // 3. Crear pestaña silenciosa para ejecutar la acción humana
    let tab;
    try {
      tab = await chrome.tabs.create({
        url: task.profileUrl,
        active: false,
      });
    } catch (tabCreateErr) {
      console.error("[InHubFlow ServiceWorker] Error creando pestaña:", tabCreateErr);
      isProcessingTask = false;
      return { success: false, error: tabCreateErr.message };
    }

    const tabId = tab.id;

    // Esperar carga completa
    const loaded = await waitForTabComplete(tabId, 35000);
    if (!loaded) {
      console.warn("[InHubFlow ServiceWorker] Pestaña tardó en cargar, continuando con intento de inyección...");
    }

    // Pequeño retardo natural de estabilización humana (2-4 seg)
    await sleep(2500);

    // Asegurar que el script ejecutor esté inyectado
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-runner.js"],
      });
    } catch (scriptErr) {
      // Ignorar si ya estaba inyectado por manifest
    }

    await sleep(1000);

    // 4. Despachar acción a la pestaña
    let taskResult = await dispatchTaskToTab(tabId, task);

    // Si la acción requirió redirigir a mensajería (/messaging/thread/new/...)
    if (taskResult && taskResult.status === "navigate_to_messaging" && taskResult.nextUrl) {
      console.log("[InHubFlow ServiceWorker] Navegando a pantalla completa de mensajería:", taskResult.nextUrl);
      await chrome.tabs.update(tabId, { url: taskResult.nextUrl });
      await waitForTabComplete(tabId, 30000);
      await sleep(3000);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content-runner.js"],
        });
      } catch (e) { /* ignore */ }
      await sleep(1000);
      taskResult = await dispatchTaskToTab(tabId, task);
    }

    console.log("[InHubFlow ServiceWorker] Resultado de la tarea:", taskResult);

    // Cerrar pestaña silenciosa
    try {
      await chrome.tabs.remove(tabId);
    } catch (closeErr) {
      // Ya cerrada o error no fatal
    }

    // 5. Reportar resultado a la plataforma
    try {
      const reportUrl = `${serverUrl}/api/extension/task`;
      const reportPayload = {
        taskId: task.id,
        targetId: task.targetId,
        runId: task.runId,
        workflowId: task.workflowId,
        stepIndex: task.stepIndex,
        type: task.type,
        status: taskResult.status,
        connectionStatus: taskResult.connectionStatus,
        error: taskResult.error,
      };

      await fetch(reportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportPayload),
      });

      console.log(`[InHubFlow ServiceWorker] Reporte enviado exitosamente a la plataforma.`);
    } catch (reportErr) {
      console.error(`[InHubFlow ServiceWorker] Error enviando reporte:`, reportErr);
    }

    // Actualizar estado final
    const currentData = await getStorageData();
    const updatedStats = { ...currentData.stats, lastRunTime: new Date().toISOString() };
    if (taskResult.status === "completed") {
      if (task.type === "connect" && taskResult.connectionStatus !== "already_connected") {
        updatedStats.connectsToday = (updatedStats.connectsToday || 0) + 1;
      } else if (task.type === "message") {
        updatedStats.messagesToday = (updatedStats.messagesToday || 0) + 1;
      }
    }

    await setStorageData({
      stats: updatedStats,
      lastStatus: taskResult.status === "completed" ? "completado_exito" : "completado_con_error",
      lastStatusTime: new Date().toISOString(),
      lastError: taskResult.error || null,
    });

    isProcessingTask = false;
    return { success: true, result: taskResult };
  } catch (globalErr) {
    console.error("[InHubFlow ServiceWorker] Error inesperado en ciclo:", globalErr);
    await updateWorkerStatus("error_fatal", globalErr.message);
    isProcessingTask = false;
    return { success: false, error: globalErr.message };
  }
}

// Escuchar peticiones desde popup.js y content-runner.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get_worker_state") {
    getStorageData().then((data) => {
      sendResponse({ ...data, isProcessing: isProcessingTask });
    });
    return true;
  }

  if (request.action === "toggle_worker") {
    getStorageData().then(async (data) => {
      const nextEnabled = !data.enabled;
      await setStorageData({ enabled: nextEnabled });
      if (nextEnabled) {
        runWorkerCycle("activacion_usuario");
      } else {
        await updateWorkerStatus("pausado");
      }
      sendResponse({ enabled: nextEnabled });
    });
    return true;
  }

  if (request.action === "set_server_url") {
    setStorageData({ serverUrl: request.serverUrl }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (request.action === "run_worker_now") {
    runWorkerCycle("boton_popup").then((result) => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === "sync_inbox_now") {
    getStorageData().then(async ({ serverUrl, accountId }) => {
      const targetAccountId = request.accountId || accountId;
      console.log("[InHubFlow ServiceWorker] Disparando sincronización forzada de inbox para cuenta:", targetAccountId);

      // Si no hay pestañas de LinkedIn abiertas, abrir una silenciosa para despertar la sesión de cookies
      let tempTabId = null;
      try {
        const tabs = await chrome.tabs.query({ url: "*://*.linkedin.com/*" });
        if (!tabs || tabs.length === 0) {
          console.log("[InHubFlow ServiceWorker] Abriendo pestaña silenciosa de LinkedIn para activar sesión...");
          const newTab = await chrome.tabs.create({ url: "https://www.linkedin.com/messaging/", active: false });
          tempTabId = newTab.id;
          await waitForTabComplete(tempTabId, 15000);
          await sleep(2500);
        }
      } catch (tabErr) {
        console.warn("[InHubFlow ServiceWorker] No se pudo abrir pestaña silenciosa:", tabErr);
      }

      const res = await syncLinkedInInbox(serverUrl, targetAccountId);

      if (tempTabId) {
        try { await chrome.tabs.remove(tempTabId); } catch (e) { /* ignore */ }
      }

      sendResponse(res);
    });
    return true;
  }

  if (request.action === "ingest_dom_messages" && Array.isArray(request.messages)) {
    getStorageData().then(async ({ serverUrl, accountId }) => {
      const targetAccountId = request.accountId || accountId;
      if (!targetAccountId) {
        sendResponse({ ok: false, error: "Missing accountId" });
        return;
      }
      console.log(`[InHubFlow ServiceWorker] Ingestando ${request.messages.length} mensajes recibidos desde DOM activo...`);
      try {
        const syncRes = await fetch(`${serverUrl}/api/extension/inbox-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: targetAccountId,
            observations: request.messages,
          }),
        });
        const syncData = await syncRes.json();
        sendResponse({ ok: true, syncData });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    });
    return true;
  }
});
