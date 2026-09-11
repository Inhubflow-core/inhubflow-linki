# 📘 Guía Maestra: Diagnóstico y Resolución de Errores en Secuencias de LinkedIn

> **InHubFlow / Linki Engine**  
> *Base de conocimiento técnico sobre causas raíz, síntomas y soluciones aplicadas para la ejecución de campañas y mensajes directos.*

---

## 🎯 Propósito de este Documento
Durante la puesta a punto del motor de automatización y secuencias de LinkedIn, se identificaron varios fallos críticos que provocaban desconexiones constantes, bucles de redirección y falsos positivos de entrega.

Este documento consolida la explicación técnica detallada de cada error, la solución aplicada en el código y el **Checklist de Verificación** para cuando se incorporen nuevas funciones o se despliegue a nuevos clientes.

---

## 🧭 Resumen de Errores Identificados y Resueltos

| # | Error / Síntoma | Causa Raíz Técnica | Solución Implementada |
|---|-----------------|--------------------|------------------------|
| **1** | **Bucle de redirecciones (`ERR_TOO_MANY_REDIRECTS`)** | Forzar dominio raíz `.linkedin.com` a cookies emitidas por LinkedIn para `.www.linkedin.com`. | Preservar dominios exactos y subdominios en `cookie-state.ts` y `session.ts`. |
| **2** | **Deslogueo forzado en el navegador ("Olá novamente")** | Mismatch de huella TLS y User-Agent (Playwright Chromium 145 vs Chrome real 153). LinkedIn detectó secuestro de sesión. | Usar el motor de Google Chrome nativo y eliminar la cookie efímera `__cf_bm`. |
| **3** | **Cuenta se desconecta sola (`is_authenticated = 0`)** | `runner.ts` marcaba reautenticación automática cada vez que `visitProfile` chocaba contra el bucle 302. | Solucionar la causa del bucle para que el runner no desactive la cuenta. |
| **4** | **Falso positivo de mensaje enviado** | Se pulsaba `Ctrl+Enter` sin enfocar el campo editable ni verificar la entrega en el DOM. | Validar foco, clicar botón físico de envío y verificar transcript del chat. |
| **5** | **Fallo al abrir chat en perfiles de 1º grado** | El botón "Enviar mensaje" era un enlace `<a>` a `/messaging/compose/?recipient=...` y la barra fija superior tapaba el clic. | Soporte a `/messaging/compose/` en `message.ts` y navegación/clic DOM directo. |

---

## 🔍 Análisis Detallado por Error

### 1. Bucle Infinito de Redirecciones (`ERR_TOO_MANY_REDIRECTS`)

* **Síntoma:** Al intentar acceder a `https://www.linkedin.com/feed/` o al perfil del prospecto, la página generaba más de 15 a 20 redirecciones `302` consecutivas hacia la misma URL, hasta colapsar con `net::ERR_TOO_MANY_REDIRECTS`.
* **Causa Raíz:**  
  Cuando un usuario inicia sesión en `www.linkedin.com`, LinkedIn emite cookies como `li_at`, `bscookie` y `JSESSIONID` vinculadas al dominio `.www.linkedin.com`.  
  El código antiguo de Linki tenía una función que forzaba **todas** las cookies al dominio raíz `.linkedin.com`. Al recibir cookies en un ámbito alterado, los servidores perimetrales de LinkedIn devolvían:
  ```http
  HTTP/1.1 302 Found
  Location: https://www.linkedin.com/feed/
  Set-Cookie: li_at=delete me; Domain=.www.linkedin.com; Expires=Thu, 01-Jan-1970 00:00:00 GMT
  Clear-Site-Data: "storage"
  ```
  Como Playwright retenía la cookie en `.linkedin.com`, en la siguiente redirección la volvía a enviar, LinkedIn volvía a ordenar su borrado y redirigir, creando un bucle infinito.
* **Solución Aplicada:**  
  En [`lib/linkedin/cookie-state.ts`](file:///c:/Users/Roberto/Documents/CLIENTES/INHUBFLOW/linki-main/lib/linkedin/cookie-state.ts) y [`lib/linkedin/session.ts`](file:///c:/Users/Roberto/Documents/CLIENTES/INHUBFLOW/linki-main/lib/linkedin/session.ts), se actualizó la normalización para **preservar el dominio original** de cada cookie (respetando `.www.linkedin.com` y `.linkedin.com`).

---

### 2. Revocación Global de Sesión ("Me deslogueó de nuevo")

* **Síntoma:** El usuario conectaba la cuenta mediante la extensión, pero al cabo de unos segundos o al primer intento de automatización, LinkedIn cerraba la sesión activa tanto en el bot como en el navegador Google Chrome real del usuario ("Olá novamente...").
* **Causa Raíz:**  
  LinkedIn y Cloudflare utilizan **Token Binding** y detección de huella digital TLS (`JA3 / JA4 Fingerprint` y `Sec-Ch-Ua`).  
  El usuario iniciaba sesión en Google Chrome v153. La extensión exportaba el User-Agent `Chrome/153`. Pero Playwright ejecutaba internamente un Chromium compilado antiguo (versión 145).  
  Cuando LinkedIn recibía una petición con cabeceras `Chrome 153`, pero la negociación TLS y el binario correspondían a `Chromium 145`, los sistemas de ciberseguridad interpretaban que la cookie `li_at` había sido robada e inyectada en una herramienta automatizada (ataque *Pass-the-Cookie*). En respuesta, LinkedIn ejecutaba una **revocación global de credenciales** en sus servidores, deslogueando todos los dispositivos del usuario.
* **Solución Aplicada:**
  1. Configuración de `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` para utilizar el binario nativo de **Google Chrome 153** en local (`C:\Program Files\Google\Chrome\Application\chrome.exe`) y `/usr/bin/chromium` en Linux/Docker.
  2. Filtrado de la cookie efímera `__cf_bm` (Cloudflare Bot Management), permitiendo que Cloudflare emita tokens frescos sin disparar bloqueos.

---

### 3. Falso Positivo de Entrega de Mensajes

* **Síntoma:** Un script anterior de prueba informaba que el mensaje a un prospecto (More Fernández) había sido enviado con éxito; sin embargo, en la bandeja de entrada real de LinkedIn el mensaje nunca existió.
* **Causa Raíz:**  
  El script ejecutaba un atajo de teclado a ciegas (`page.keyboard.press("Control+Enter")`) sin verificar:
  1. Si el cuadro de texto (`contenteditable`) estaba efectivamente enfocado.
  2. Si el botón de envío (`button.msg-form__send-button`) existía y fue pulsado.
  3. Si el texto del mensaje apareció en el historial de la conversación.
* **Solución Aplicada:**  
  Se implementó un protocolo estricto de **3 pasos de verificación**:
  1. Enfoque explícito del contenedor editable `div.msg-form__contenteditable[contenteditable="true"]`.
  2. Clic directo en el botón físico de envío vía DOM (`button[type="submit"]` o `button.msg-form__send-button`).
  3. Comprobación obligatoria (`assertMessageDelivered`): el script inspecciona el transcript de mensajes (`.msg-s-message-list-content`) para confirmar que el texto enviado aparece renderizado con su timestamp en la conversación de LinkedIn.

---

### 4. Soporte para Enlaces Directos de Composición (`/messaging/compose/`)

* **Síntoma:** Al visitar perfiles de conexiones de 1º grado, el motor de Linki no lograba abrir el cuadro de chat o se quedaba esperando hasta agotar el tiempo (`TimeoutError`).
* **Causa Raíz:**  
  En la interfaz actual de LinkedIn, el botón "Enviar mensaje" en perfiles de 1º grado ya no es un simple botón que abre un modal emergente flotante en todos los casos. En muchos perfiles es un enlace `<a>` cuya propiedad `href` apunta directamente a:
  ```
  /messaging/compose/?profileUrn=...&recipient=ACoAAF...
  ```
  El código de [`message.ts`](file:///c:/Users/Roberto/Documents/CLIENTES/INHUBFLOW/linki-main/lib/linkedin/message.ts) únicamente comprobaba si el enlace contenía `/messaging/thread/`, ignorando los enlaces de tipo `/messaging/compose/`. Además, al hacer scroll, la barra superior fija de navegación de LinkedIn interceptaba los clics de puntero.
* **Solución Aplicada:**  
  En [`message.ts`](file:///c:/Users/Roberto/Documents/CLIENTES/INHUBFLOW/linki-main/lib/linkedin/message.ts#L216) se añadió soporte para enlaces tanto de `thread` como de `compose`. Si el enlace contiene `/messaging/compose/`, el navegador navega directamente a la URL de composición con el destinatario precargado, donde el cuadro de texto está inmediatamente disponible.

---

## 📋 Checklist de Verificación para Campañas y Secuencias

Antes de lanzar una campaña o cuando un usuario reporte que un paso no se ejecutó, revisa estos 5 puntos en orden:

### 1. Estado de la Cuenta en Base de Datos
* [ ] Comprobar que en la tabla `accounts` el campo `is_authenticated` sea igual a `1`.
* [ ] Si está en `0`, la cuenta requiere reconexión mediante la extensión InHubFlow Connect.

### 2. Comprobación de Sesión Viva
* [ ] Verificar que una petición simple al Feed (`https://www.linkedin.com/feed/`) devuelva **HTTP 200** (no redirija a `/login` ni a `/checkpoint`).

### 3. Coherencia de Huella y Entorno (Local vs VPS)
* [ ] **En Local (Windows)**: Asegurar que `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` apunte a `C:\Program Files\Google\Chrome\Application\chrome.exe`.
* [ ] **En VPS Hostinger (Coolify / Docker)**:
  * Asegurar que la variable `HEADLESS` esté configurada en `true`.
  * Asegurar que el contenedor use el Chromium de Linux en `/usr/bin/chromium`.
  * Para producción multicuenta: configurar proxies residenciales dedicados por cuenta para evitar bloqueos por IP de centro de datos.

### 4. Grado de Conexión del Contacto
* [ ] Para pasos de **Mensaje Directo**: El contacto debe ser de **1º grado** (`degree = 1`). Si es de 2º o 3º grado, LinkedIn requerirá InMail de pago o solicitud de contacto previa.
* [ ] Comprobar que el campo `messaging_urn` esté presente o que la URL del perfil sea accesible.

### 5. Confirmación de Entrega
* [ ] Nunca dar un paso como completado sin verificar que el texto del mensaje se encuentre presente en el hilo del chat de LinkedIn.
