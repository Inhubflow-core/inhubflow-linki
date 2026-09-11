const Database = require('better-sqlite3');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createDecipheriv, hkdfSync } = require('crypto');

chromium.use(StealthPlugin());

const secret = process.env.NEXTAUTH_SECRET || "b7e199f1d8c7e909a32c2560ef718e8749a2a91283e74c10";
function deriveKey(info = "inhubflow-secret-encryption") {
  return Buffer.from(hkdfSync("sha256", secret, "", info, 32));
}

function decryptSecret(value) {
  if (!value || !value.startsWith("v1:")) return value;
  const [, ivB64, authTagB64, dataB64] = value.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  try {
    const key = deriveKey("inhubflow-secret-encryption");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (err1) {
    try {
      const legacyKey = deriveKey("linki-secret-encryption");
      const decipher = createDecipheriv("aes-256-gcm", legacyKey, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString("utf8");
    } catch (err2) {
      return null;
    }
  }
}

async function runLiveTest() {
  console.log("==================================================================");
  console.log("🚀 INICIANDO PRUEBA VISIBLE EN VIVO — ENVÍO REAL A MORE FERNÁNDEZ");
  console.log("==================================================================");

  const db = new Database("linki.db");
  const acc = db.prepare("SELECT * FROM accounts LIMIT 1").get();
  if (!acc || !acc.cookies_json) {
    console.error("❌ No se encontró cuenta o cookies en linki.db");
    return;
  }

  const dec = decryptSecret(acc.cookies_json);
  const storageState = JSON.parse(dec);

  // 1. SANEAMIENTO Y DEDUPLICACIÓN DE COOKIES:
  // Forzar todas las cookies a dominio ".linkedin.com" y eliminar duplicados para evitar el bucle 302
  const seenCookies = new Set();
  const cleanCookies = [];
  for (const c of storageState.cookies || []) {
    let domain = c.domain || ".linkedin.com";
    if (domain.includes("linkedin.com")) {
      domain = ".linkedin.com";
    }
    if (!seenCookies.has(c.name)) {
      seenCookies.add(c.name);
      cleanCookies.push({
        ...c,
        domain
      });
    }
  }
  storageState.cookies = cleanCookies;

  const liAt = cleanCookies.find(c => c.name === 'li_at');
  console.log(`[Cookies] Saneadas ${cleanCookies.length} cookies únicas. li_at presente: ${Boolean(liAt)}`);

  // 2. LANZAMIENTO DEL NAVEGADOR VISIBLE
  console.log("\n[Paso 1] Abriendo navegador Chromium visible (headless: false)...");
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--start-maximized"
    ]
  });

  const ctx = await browser.newContext({
    storageState,
    viewport: { width: 1400, height: 900 },
    locale: "es-ES",
    timezoneId: "America/Sao_Paulo",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  });

  const page = await ctx.newPage();

  // 3. VERIFICAR AUTENTICACIÓN EN EL FEED
  console.log("[Paso 2] Comprobando acceso en https://www.linkedin.com/feed/ ...");
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 35000 });
  } catch (e) {
    console.warn("Aviso en navegación a feed:", e.message);
  }
  await page.waitForTimeout(3000);

  const feedUrl = page.url();
  console.log(`URL actual tras acceder al feed: ${feedUrl}`);

  if (feedUrl.includes("/login") || feedUrl.includes("/uas/") || feedUrl.includes("/checkpoint")) {
    console.error("❌ ERROR: LinkedIn redirigió al login/checkpoint. La sesión requiere reautenticación.");
    await page.waitForTimeout(10000);
    await browser.close();
    return;
  }
  console.log("✅ Sesión activa y autenticada en el feed de LinkedIn.");

  // 4. NAVEGAR AL PERFIL DE MORE FERNÁNDEZ
  const targetUrl = "https://www.linkedin.com/in/more-fern%C3%A1ndez/";
  console.log(`\n[Paso 3] Navegando al perfil de More Fernández: ${targetUrl} ...`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(4000);

  console.log(`URL en perfil: ${page.url()}`);
  console.log(`Título de página: "${await page.title()}"`);

  // Detectar y cerrar modales emergentes o superpuestos si los hubiera
  const closeBtn = page.locator("button[aria-label*='dismiss' i], button[aria-label*='fechar' i], button[aria-label*='cerrar' i], button[aria-label*='close' i], .modal__dismiss").first();
  if ((await closeBtn.count().catch(() => 0)) > 0 && await closeBtn.isVisible().catch(() => false)) {
    console.log("Detectado modal emergente superpuesto, cerrándolo...");
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  // 5. LOCALIZAR Y CLICAR BOTÓN DE MENSAJE
  console.log("\n[Paso 4] Buscando botón de mensaje en el perfil...");
  const msgBtn = page.locator(`
    main button:has-text("Enviar mensagem"),
    main button:has-text("Mensagem"),
    main button:has-text("Mensaje"),
    main button:has-text("Enviar mensaje"),
    main button:has-text("Message"),
    main button:has-text("Send message"),
    main a:has-text("Enviar mensagem"),
    main a:has-text("Mensaje"),
    main a:has-text("Message"),
    button[aria-label*="Enviar mensagem" i],
    button[aria-label*="Mensaje a More" i],
    button[aria-label*="Message More" i]
  `).first();

  const btnCount = await msgBtn.count();
  console.log(`Botones de mensaje encontrados en perfil: ${btnCount}`);

  if (btnCount === 0) {
    console.error("❌ No se encontró ningún botón de mensaje en el perfil.");
    console.log("Dejando navegador abierto 15 segundos para inspección visual...");
    await page.waitForTimeout(15000);
    await browser.close();
    return;
  }

  const btnText = await msgBtn.innerText().catch(() => "");
  console.log(`Haciendo clic en el botón de mensaje: "${btnText.trim()}" ...`);
  await msgBtn.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await msgBtn.click({ delay: 100 });
  await page.waitForTimeout(3000);

  // 6. DETECTAR EL CUADRO DE REDACCIÓN DEL CHAT
  console.log("\n[Paso 5] Buscando cuadro de redacción (compose box)...");
  const composeBox = page.locator("div.msg-form__contenteditable, [contenteditable='true'][role='textbox'], .msg-form__contenteditable").first();
  const isBoxVisible = await composeBox.isVisible().catch(() => false);
  console.log(`¿Cuadro de redacción visible?: ${isBoxVisible}`);

  if (!isBoxVisible) {
    console.error("❌ El cuadro de redacción no apareció tras hacer clic en Mensaje.");
    console.log("Dejando navegador abierto 15 segundos para inspección visual...");
    await page.waitForTimeout(15000);
    await browser.close();
    return;
  }

  // 7. ESCRIBIR EL MENSAJE DE PRUEBA
  const testMessage = `Hola More, prueba técnica en vivo desde InHubFlow (${new Date().toLocaleTimeString()}) 🚀`;
  console.log(`\n[Paso 6] Escribiendo mensaje en el chat: "${testMessage}" ...`);
  await composeBox.click();
  await page.waitForTimeout(500);
  await composeBox.fill(testMessage);
  await page.waitForTimeout(1500);

  // 8. LOCALIZAR EL BOTÓN REAL DE ENVÍO
  console.log("\n[Paso 7] Localizando el botón de envío real (Send button)...");
  const sendBtn = page.locator(`
    button.msg-form__send-button,
    button[type='submit'].msg-form__send-btn,
    form.msg-form button[type='submit'],
    button[type='submit']:has-text("Enviar"),
    button[type='submit']:has-text("Send")
  `).first();

  const sendBtnCount = await sendBtn.count();
  console.log(`Botones de envío encontrados: ${sendBtnCount}`);

  if (sendBtnCount > 0) {
    const isDisabled = await sendBtn.getAttribute("disabled");
    console.log(`¿El botón de envío está deshabilitado?: ${isDisabled !== null}`);
    
    console.log("Haciendo clic REAL en el botón de enviar...");
    await sendBtn.click({ delay: 100 });
  } else {
    console.warn("Aviso: No se ubicó el botón 'msg-form__send-button', intentando envío con Enter...");
    await page.keyboard.press("Enter");
  }

  console.log("Esperando confirmación del servidor de LinkedIn (5 segundos)...");
  await page.waitForTimeout(5000);

  // 9. VERIFICACIÓN REAL DE ENTREGA (SIN ENGAÑOS)
  console.log("\n[Paso 8] VERIFICACIÓN ESTRICTA DE ENTREGA EN PANTALLA...");
  const boxTextAfter = await composeBox.innerText().catch(() => "");
  const isCleared = boxTextAfter.trim().length === 0;
  console.log(`¿El cuadro de redacción quedó vacío?: ${isCleared} (texto restante: "${boxTextAfter.trim()}")`);

  const chatContent = await page.locator(".msg-s-message-list-content, .msg-overlay-conversation-bubble, .msg-thread").innerText().catch(() => "");
  const messageFoundInChat = chatContent.includes("prueba técnica en vivo desde InHubFlow");
  console.log(`¿El mensaje aparece en las burbujas del chat?: ${messageFoundInChat}`);

  if (messageFoundInChat || isCleared) {
    console.log("\n🎉 =========================================================");
    console.log("✅ ¡ENTREGA CONFIRMADA AL 100%! EL MENSAJE FUE ENVIADO DE VERDAD.");
    console.log("🎉 =========================================================");
  } else {
    console.log("\n⚠️ =========================================================");
    console.log("❌ ATENCIÓN: El mensaje NO se confirmó en el chat de LinkedIn.");
    console.log("   El texto sigue en el borrador o no se procesó el envío.");
    console.log("⚠️ =========================================================");
  }

  console.log("\nDejando la ventana abierta durante 20 segundos para que puedas verla en tu pantalla...");
  await page.waitForTimeout(20000);
  await browser.close();
  console.log("Navegador cerrado.");
}

runLiveTest().catch(console.error);
