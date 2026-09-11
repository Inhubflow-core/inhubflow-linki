const Database = require('better-sqlite3');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createCipheriv, hkdfSync, randomBytes } = require('crypto');

chromium.use(StealthPlugin());

const secret = process.env.NEXTAUTH_SECRET || "b7e199f1d8c7e909a32c2560ef718e8749a2a91283e74c10";
function deriveKey(info = "inhubflow-secret-encryption") {
  return Buffer.from(hkdfSync("sha256", secret, "", info, 32));
}

function encryptSecret(plaintext) {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

async function loginAndSave() {
  console.log("==================================================================");
  console.log("🔑 INICIANDO VENTANA DE AUTENTICACIÓN VISIBLE DE LINKEDIN");
  console.log("==================================================================");

  const path = require('path');
  const dbPath = path.join(__dirname, '../linki.db');
  const db = new Database(dbPath);
  const acc = db.prepare("SELECT * FROM accounts LIMIT 1").get();
  if (!acc) {
    console.error("❌ No se encontró ninguna cuenta en linki.db");
    return;
  }

  console.log(`\nCuenta objetivo: ${acc.email} (ID: ${acc.id})`);
  console.log("Abriendo navegador visible en tu pantalla...");
  console.log("👉 Por favor inicia sesión normalmente en la ventana que se abrirá.");
  console.log("👉 Si te pide código de verificación o 2FA, introdúcelo con calma.");
  console.log("👉 El script detectará automáticamente cuando llegues al Feed de LinkedIn.\n");

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
    viewport: { width: 1400, height: 900 },
    locale: "es-ES",
    timezoneId: "America/Sao_Paulo"
  });

  const page = await ctx.newPage();
  await page.goto("https://www.linkedin.com/login");

  // Intentar pre-rellenar el email para ahorrar un paso
  try {
    const userInput = page.locator("input#username");
    if (await userInput.isVisible({ timeout: 4000 })) {
      await userInput.fill(acc.email);
      console.log(`Email (${acc.email}) pre-rellenado en el formulario.`);
    }
  } catch {
    // Si no está visible, el usuario lo escribe
  }

  console.log("\nEsperando a que completes el inicio de sesión (tienes hasta 4 minutos)...");

  // Esperar a que la URL sea /feed/ o cualquier página interna autenticada
  await page.waitForURL(url => {
    const u = url.toString();
    return u.includes("/feed") || u.includes("/mynetwork") || u.includes("/messaging");
  }, { timeout: 240_000 });

  console.log("\n🎉 ¡INICIO DE SESIÓN DETECTADO CON ÉXITO!");
  console.log(`URL alcanzada: ${page.url()}`);
  console.log("Estabilizando cookies y sesión...");
  await page.waitForTimeout(4000);

  // Extraer estado del almacenamiento y User-Agent real
  const storageState = await ctx.storageState();
  const realUserAgent = await page.evaluate(() => navigator.userAgent);
  console.log(`User-Agent detectado: ${realUserAgent}`);

  // SANEAMIENTO Y NORMALIZACIÓN CRÍTICA DE COOKIES:
  // Forzar todas las cookies de LinkedIn a dominio raíz ".linkedin.com" y eliminar duplicados
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
  storageState.userAgent = realUserAgent;

  const liAt = cleanCookies.find(c => c.name === 'li_at');
  console.log(`Cookies capturadas y normalizadas: ${cleanCookies.length}`);
  console.log(`li_at presente: ${Boolean(liAt)} (longitud: ${liAt?.value?.length})`);

  // Guardar en la base de datos y marcar como autenticado
  const encrypted = encryptSecret(JSON.stringify(storageState));
  db.prepare("UPDATE accounts SET cookies_json = ?, is_authenticated = 1 WHERE id = ?").run(
    encrypted,
    acc.id
  );

  console.log("\n💾 ¡GUARDADO EN BASE DE DATOS LOCAL CON ÉXITO!");
  console.log("Estado de la cuenta: is_authenticated = 1");

  await page.waitForTimeout(2000);
  await browser.close();
  console.log("Ventana cerrada. La sesión está 100% fresca y lista.");
}

loginAndSave().catch(err => {
  console.error("❌ Error durante el inicio de sesión:", err.message);
});
