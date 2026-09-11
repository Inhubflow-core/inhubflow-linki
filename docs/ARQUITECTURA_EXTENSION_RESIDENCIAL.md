# InHubFlow — Arquitectura de Extensión Inteligente (Estilo Waalaxy)

Este documento describe la arquitectura de automatización de LinkedIn implementada en InHubFlow (`linki-main`).

---

## 1. Contexto y Diagnóstico del Problema

### El Desafío de los Servidores VPS y Datacenters
Cuando InHubFlow se ejecuta en un servidor en la nube (Hostinger VPS / Coolify en `b2b.inhubflow.online`), todas las peticiones salientes originadas en el servidor llevan la IP del centro de datos (`2.25.177.59`).

LinkedIn cuenta con algoritmos avanzados de detección antifraude:
- Cualquier sesión abierta desde un navegador headless (Playwright/Puppeteer) desde una IP de centro de datos es detectada casi instantáneamente.
- LinkedIn invalida la cookie `li_at` y redirige a un muro de verificación (*checkpoint* o *login*).
- El servidor registraba repetidamente:
  `LinkedIn session expired for [Lead] — account paused for reauthentication`.

---

## 2. La Solución: Arquitectura de Extensión Inteligente

Inspirada en el modelo de Waalaxy y Dux-Soup, toda la actividad de navegación y envío en LinkedIn se traslada al cliente final (ordenador del usuario / IP residencial limpia), mientras que toda la administración de campañas se realiza de forma centralizada en la plataforma web.

```
┌─────────────────────────────────────────────────────────────┐
│                 PLATAFORMA WEB (Coolify VPS)               │
│                  https://b2b.inhubflow.online               │
│                                                             │
│  - Creación de Campañas, Listas y Secuencias                │
│  - Botón "⚡ Ejecutar todo ahora"                           │
│  - API de Tareas: /api/extension/task                       │
│  - API de Reportes: /api/extension/report                   │
│  - Runner del Servidor: LINKEDIN_SERVER_PLAYWRIGHT=false    │
└──────────────────────────────┬──────────────────────────────┘
                               │
               Consulta Tareas │ Reporta Resultados
               (GET /task)     │ (POST /report)
                               │
┌──────────────────────────────▼──────────────────────────────┐
│             PC DEL USUARIO (IP Residencial Limpia)          │
│                Extensión InHubFlow Connect (MV3)            │
│                                                             │
│  - Service Worker de fondo (background.js)                  │
│  - Abre pestañas silenciosas de LinkedIn (active: false)    │
│  - Inyecta content-runner.js                                │
│  - Simula tipeo humano (35–85ms) y scrolling natural        │
│  - Ejecuta acción (visitar, conectar, enviar mensaje)       │
│  - Cierra la pestaña silenciosa y reporta al servidor       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Componentes Implementados

### 1. Extensión de Chrome (`extension/` y `public/extension/`)
- **`background.js`**: Service Worker de Chrome MV3 con alarma periódica (cada 1 minuto). Consulta `/api/extension/task`, abre la pestaña de LinkedIn en segundo plano sin molestar al usuario, y reporta el resultado. Si el usuario está navegando activamente en LinkedIn, la extensión se pausa por cortesía humana.
- **`content-runner.js`**: Script de ejecución que interactúa con la interfaz de LinkedIn:
  - `handleVisit`: Navega el perfil, extrae grado de conexión y datos.
  - `handleConnect`: Hace clic en "Conectar" (o en el menú "Más acciones"), añade la nota personalizada si existe, y envía la solicitud.
  - `handleMessage`: Localiza el botón de mensaje directo, abre el cuadro de chat, simula tipeo humano tecla por tecla y hace clic en Enviar.

### 2. Endpoints API del Servidor
- **`/api/extension/task`**: Busca candidatos pendientes de campañas en estado `running`, respeta los límites diarios (`daily_connection_limit`, `daily_message_limit`), renderiza plantillas de texto y entrega la tarea en formato JSON.
- **`/api/extension/report`**: Recibe el estado de la tarea ejecutada, avanza el workflow al siguiente paso programando el retardo correspondiente, y registra el log de auditoría.
- **`/api/extension/heartbeat`**: Recibe el ping de la extensión y mantiene la cuenta marcada como `is_authenticated = 1` y `extension_active = 1`.

### 3. Blindaje del Runner del Servidor (`lib/linkedin/runner.ts`)
- `executeStep`, `tick()`, `syncCampaignInboxAccounts()` y `reconcileAcceptedConnections()` verifican:
  ```ts
  if (tr.track === "linkedin" && process.env.LINKEDIN_SERVER_PLAYWRIGHT_ENABLED !== "true") {
    return; // Reservado exclusivamente para la extensión
  }
  ```
- Esto garantiza que el VPS **nunca** vuelva a tocar LinkedIn con un navegador headless.

---

## 4. Preguntas Frecuentes y Comportamiento Esperado

### ¿Por qué aparece "Botón de enviar mensaje no disponible en el perfil"?
En LinkedIn, **los mensajes directos gratuitos solo se pueden enviar a contactos de 1er grado** (personas que ya aceptaron tu invitación). Si un prospecto aún no te ha aceptado o es de 2º/3º grado, LinkedIn no muestra el botón de mensaje. Esto no es un error de sesión ni del bot; es una regla de LinkedIn. Las campañas a prospectos fríos deben estructurarse: **Conectar ➔ Delay de espera ➔ Mensaje**.

### ¿El usuario tiene que tocar la extensión para que funcione?
**No**. Una vez instalada la extensión en Chrome y vinculada la cuenta en Configuración, el usuario gestiona todo desde la plataforma web (`https://b2b.inhubflow.online`). La extensión trabaja automáticamente en segundo plano mientras el navegador esté abierto.
