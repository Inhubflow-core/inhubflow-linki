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
  console.log("[InHubFlow] Extensión instalada/actualizada. Configurando alarma periódica...");
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: TICK_INTERVAL_MINUTES,
  });
  // Tick inicial
  setTimeout(() => runWorkerCycle("instalacion"), 3000);
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

// Sincroniza mensajes entrantes de LinkedIn directamente con la sesión de Chrome (IP residencial)
async function syncLinkedInInbox(serverUrl, accountId) {
  if (!accountId) return;
  try {
    const cookie = await chrome.cookies.get({ url: "https://www.linkedin.com", name: "JSESSIONID" });
    const csrf = (cookie?.value || "").replace(/"/g, "");
    if (!csrf) return;

    const headers = {
      accept: "application/vnd.linkedin.normalized+json+2.1",
      "x-restli-protocol-version": "2.0.0",
      "csrf-token": csrf,
    };

    // 1. Obtener lista de conversaciones recientes
    const convRes = await fetch("https://www.linkedin.com/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX&q=participants&start=0&count=15", {
      headers,
      credentials: "include",
    });

    if (!convRes.ok) {
      console.warn("[InHubFlow ServiceWorker] Voyager conversations status:", convRes.status);
      return;
    }

    const convPayload = await convRes.json();
    const included = convPayload.included || [];
    const elements = convPayload.elements || [];
    const allRecords = [...included, ...elements];

    // Mapa de MiniProfiles para asociar nombre y URL pública a cada URN
    const profiles = new Map();
    for (const r of allRecords) {
      if (!r) continue;
      const urn = r.entityUrn || r.objectUrn;
      if (urn && (r.$type?.includes("MiniProfile") || r.publicIdentifier || r.firstName)) {
        profiles.set(urn, {
          name: `${r.firstName || ""} ${r.lastName || ""}`.trim(),
          publicIdentifier: r.publicIdentifier || null,
          profileUrl: r.publicIdentifier ? `https://www.linkedin.com/in/${r.publicIdentifier}` : null,
          urn,
        });
      }
    }

    // 2. Extraer hilos y buscar eventos en los hilos más recientes
    const observations = [];
    const convItems = allRecords.filter(
      (r) => r && (r.$type === "com.linkedin.voyager.messaging.Conversation" || (r.entityUrn && r.entityUrn.includes("msg_conversation")))
    );

    for (let i = 0; i < Math.min(convItems.length, 10); i++) {
      const conv = convItems[i];
      const convUrn = conv.entityUrn || "";
      const match = convUrn.match(/urn:li:msg_conversation:\((?:[^,]+),(.+)\)$/);
      const threadPathId = match ? match[1] : (conv.id || convUrn);
      if (!threadPathId) continue;

      try {
        const evRes = await fetch(
          `https://www.linkedin.com/voyager/api/messaging/conversations/${encodeURIComponent(threadPathId)}/events?start=0&count=25`,
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
            if (urn && (r.$type?.includes("MiniProfile") || r.publicIdentifier || r.firstName)) {
              profiles.set(urn, {
                name: `${r.firstName || ""} ${r.lastName || ""}`.trim(),
                publicIdentifier: r.publicIdentifier || null,
                profileUrl: r.publicIdentifier ? `https://www.linkedin.com/in/${r.publicIdentifier}` : null,
                urn,
              });
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

            const fromUrn = typeof r.from === "string" ? r.from : (r.from?.entityUrn || r.from?.objectUrn);
            const senderProfile = fromUrn ? profiles.get(fromUrn) : null;

            observations.push({
              externalThreadId: convUrn,
              externalMessageId: r.entityUrn || r.id || `${convUrn}_${r.createdAt || Date.now()}`,
              direction: "inbound",
              body: body.trim(),
              receivedAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
              senderExternalId: fromUrn || null,
              senderName: senderProfile?.name || null,
              senderProfileUrl: senderProfile?.profileUrl || (senderProfile?.publicIdentifier ? `https://www.linkedin.com/in/${senderProfile.publicIdentifier}` : null),
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
    }
  } catch (err) {
    console.warn("[InHubFlow ServiceWorker] Error en sincronización de inbox:", err);
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
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false); // Resolvemos en falso si tardó mucho para no colapsar
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

  const { serverUrl, enabled, accountId, stats } = await getStorageData();

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
    } catch (cookieErr) {
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
      // No bloqueante
    }

    // 2. Solicitar Tarea a la Plataforma
    const taskEndpoint = `${serverUrl}/api/extension/task${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`;
    console.log(`[InHubFlow ServiceWorker] Consultando tarea en: ${taskEndpoint}`);

    let taskResponse;
    try {
      taskResponse = await fetch(taskEndpoint, {
        method: "GET",
        headers: {
          "Accept": "application/json",
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
      console.log(`[InHubFlow ServiceWorker] Sin tareas pendientes (${reason}).`);
      await updateWorkerStatus(reason === "queue_empty" ? "en_espera" : "esperando_condicion");
      isProcessingTask = false;
      return { success: true, task: null, reason };
    }

    console.log(`[InHubFlow ServiceWorker] Tarea recibida: ${task.type} para ${task.fullName} (${task.targetUrl})`);
    await updateWorkerStatus(`ejecutando_${task.type}`, `Procesando ${task.fullName}...`);

    // 3. Abrir pestaña silenciosa en segundo plano (active: false)
    let backgroundTab;
    try {
      backgroundTab = await chrome.tabs.create({
        url: task.targetUrl,
        active: false,
      });
    } catch (tabErr) {
      console.error("[InHubFlow ServiceWorker] Error abriendo pestaña:", tabErr);
      await updateWorkerStatus("error_abriendo_pestana", tabErr.message);
      isProcessingTask = false;
      return { success: false, error: tabErr.message };
    }

    const tabId = backgroundTab.id;

    // 4. Esperar carga completa
    await waitForTabComplete(tabId, 25000);
    // Margen para hidratación de React/SPA en LinkedIn
    await sleep(3500);

    // 5. Inyectar runner
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-runner.js"],
      });
    } catch (injectErr) {
      console.warn("[InHubFlow ServiceWorker] Inyección de script (posiblemente ya inyectado):", injectErr);
    }

    await sleep(1000);

    // 6. Enviar mensaje de ejecución a la pestaña
    let taskResult = await dispatchTaskToTab(tabId, task);

    // Si la acción requirió navegar a la pantalla completa de mensajería (/messaging/thread/new/...)
    if (taskResult && taskResult.status === "navigate_to_messaging" && taskResult.nextUrl) {
      console.log(`[InHubFlow ServiceWorker] Redirigiendo pestaña a pantalla de mensajes: ${taskResult.nextUrl}`);
      await updateWorkerStatus("abriendo_mensajeria", `Abriendo chat con ${task.fullName}...`);

      await chrome.tabs.update(tabId, { url: taskResult.nextUrl });
      await waitForTabComplete(tabId, 25000);
      await sleep(3500);

      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content-runner.js"],
        });
      } catch (e) {}

      await sleep(1000);
      taskResult = await dispatchTaskToTab(tabId, task);
    } else if (taskResult && taskResult.status === "failed") {
      // Si falló pero la pestaña navegó automáticamente a /messaging/ durante la interacción
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        if (tabInfo && tabInfo.url && tabInfo.url.includes("/messaging/")) {
          console.log(`[InHubFlow ServiceWorker] Detectada navegación a mensajería (${tabInfo.url}). Ejecutando envío en la nueva pantalla...`);
          await waitForTabComplete(tabId, 15000);
          await sleep(2500);
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ["content-runner.js"],
            });
          } catch (e) {}
          await sleep(1000);
          taskResult = await dispatchTaskToTab(tabId, task);
        }
      } catch (checkErr) {
        // Ignorar si la pestaña ya fue cerrada
      }
    }

    console.log(`[InHubFlow ServiceWorker] Resultado final de la tarea:`, taskResult);

    // 7. Cerrar pestaña de segundo plano inmediatamente
    try {
      await chrome.tabs.remove(tabId);
    } catch (closeErr) {
      // Ignorar si ya fue cerrada
    }

    // 8. Reportar resultado a la plataforma
    try {
      const reportUrl = `${serverUrl}/api/extension/report`;
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

// Escuchar peticiones desde popup.js
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
        // Disparar ciclo inmediato al activar
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
});
