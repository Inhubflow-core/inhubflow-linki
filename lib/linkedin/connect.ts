import type { Page } from "playwright";

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}

/**
 * Sends a LinkedIn connection request without a note.
 * Handles all UI languages (Portuguese, Spanish, English, etc.)
 * Supports direct Connect buttons and "..." More/Mais dropdown menus.
 */
export async function sendConnectionRequest(page: Page, linkedinUrl: string): Promise<void> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(2500 + Math.random() * 1500);

  // Identify top card containing person's name <h1>
  const topCard = page.locator("main section").filter({ has: page.locator("h1") }).first();
  const pageText = await topCard.innerText().catch(() => "");

  // Check degree: 1st vs 2nd / 3rd
  const isExplicit2ndOr3rd = /\b[23][ºªndrdth°\.]/i.test(pageText) || /•\s*[23]º/i.test(pageText);
  const isExplicit1st = (/\b1[ºªster°\.]/i.test(pageText) || /•\s*1º/i.test(pageText)) && !isExplicit2ndOr3rd;
  if (isExplicit1st) throw new AlreadyConnectedError("Already connected (1st degree)");

  // Check if invitation is already pending
  const isPendingText = /Pending|Pendente|Pendiente|Aguardando|En attente/i.test(pageText);
  const pendingBtn = topCard.locator(
    'button[aria-label*="Pending"]:visible, button[aria-label*="Pendente"]:visible, button[aria-label*="Pendiente"]:visible, button[aria-label*="Aguardando"]:visible, button:has-text("Pendente"):visible, button:has-text("Pending"):visible, button:has-text("Pendiente"):visible'
  );
  if (isPendingText || (await pendingBtn.count()) > 0) {
    throw new PendingInviteError("Invitation already pending");
  }

  // Strategy 1: Look for direct Connect button/link in top card
  const directConnect = topCard.locator(`
    button:has-text("Conectar"):visible,
    button:has-text("Connect"):visible,
    button:has-text("Se connecter"):visible,
    button:has-text("Vernetzen"):visible,
    a[aria-label*="Conectar"]:visible,
    a[aria-label*="Connect"]:visible,
    a[aria-label*="Convidar"]:visible,
    a[aria-label*="Invitar"]:visible,
    a[aria-label*="Invite"][aria-label*="to connect"]:visible,
    a[href*="custom-invite"]:visible
  `).first();

  let clickedConnect = false;

  if ((await directConnect.count()) > 0) {
    const tagName = await directConnect.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    const href = await directConnect.getAttribute("href").catch(() => null);

    if (tagName === "a" && href && href.includes("custom-invite")) {
      const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1200);
      clickedConnect = true;
    } else {
      await directConnect.click({ force: true });
      await page.waitForTimeout(1000);
      clickedConnect = true;
    }
  }

  // Strategy 2: If no direct Connect button, open "..." (Mais / Más / More) dropdown
  if (!clickedConnect) {
    const moreBtn = topCard.locator(`
      button[aria-label*="Mais"]:visible,
      button[aria-label*="Más"]:visible,
      button[aria-label*="More"]:visible,
      button[aria-label*="ações"]:visible,
      button[aria-label*="acciones"]:visible,
      button[aria-label*="actions"]:visible,
      button:has-text("Mais"):visible,
      button:has-text("Más"):visible,
      button:has-text("More"):visible,
      div.artdeco-dropdown button:visible
    `).first();

    if ((await moreBtn.count()) === 0) {
      throw new Error("No Connect button or More menu found on profile");
    }

    await moreBtn.click({ force: true });
    await page.waitForTimeout(1000);

    // Check for Pending in the opened dropdown menu
    const pendingMenuItem = page.locator(
      '[role="menuitem"]:has-text("Pending"):visible, [role="menuitem"]:has-text("Pendente"):visible, [role="menuitem"]:has-text("Pendiente"):visible, div.artdeco-dropdown__item:has-text("Pendente"):visible'
    );
    if ((await pendingMenuItem.count()) > 0) {
      throw new PendingInviteError("Invitation already pending (found in More menu)");
    }

    // Click "Conectar" / "Connect" from dropdown
    const connectOption = page.locator(`
      [role="menuitem"]:has-text("Conectar"):visible,
      [role="menuitem"]:has-text("Connect"):visible,
      [role="menuitem"]:has-text("Se connecter"):visible,
      [role="menuitem"]:has-text("Vernetzen"):visible,
      div.artdeco-dropdown__item:has-text("Conectar"):visible,
      div.artdeco-dropdown__item:has-text("Connect"):visible
    `).first();

    if ((await connectOption.count()) === 0) {
      throw new Error("Connect option not found in More/Mais menu");
    }

    await connectOption.click({ force: true });
    await page.waitForTimeout(1200);
  }

  // Step 3: Handle invitation modal (Send without note / Enviar sem nota / Enviar agora)
  const sendBtn = page.locator(`
    div[role="dialog"] button:has-text("Enviar agora"):visible,
    div[role="dialog"] button:has-text("Enviar sem nota"):visible,
    div[role="dialog"] button:has-text("Send now"):visible,
    div[role="dialog"] button:has-text("Send without a note"):visible,
    div[role="dialog"] button:has-text("Enviar"):visible,
    div[role="dialog"] button:has-text("Send"):visible,
    button[aria-label*="Enviar sem"]:visible,
    button[aria-label*="Send without"]:visible,
    button[aria-label*="Enviar agora"]:visible,
    button[aria-label*="Send now"]:visible,
    button[aria-label*="Enviar convite"]:visible,
    button[aria-label*="Send invitation"]:not([aria-label*="note"]):not([aria-label*="nota"]):visible
  `).first();

  try {
    if ((await sendBtn.count()) > 0) {
      await sendBtn.click({ force: true });
      await page.waitForTimeout(2000);
    }
  } catch (err) {
    console.warn("[connect] Warning while clicking send modal button:", err);
  }

  // Step 4: Check if email prompt appeared ("Para conectar, digite o e-mail")
  const emailPrompt = page.locator('input[type="email"]:visible, input#email:visible');
  if ((await emailPrompt.count()) > 0) {
    const closeBtn = page.locator('button[aria-label*="Dismiss"]:visible, button[aria-label*="Fechar"]:visible, button[aria-label*="Cerrar"]:visible').first();
    if ((await closeBtn.count()) > 0) await closeBtn.click().catch(() => {});
    throw new Error("LinkedIn requires email address to connect with this target");
  }

  // Step 5: Check for weekly limit popup
  const limitPopup = page.locator('div[class*="ip-fuse-limit-alert__warning"], div:has-text("weekly limit"), div:has-text("limite semanal")');
  if ((await limitPopup.count()) > 0) {
    throw new WeeklyLimitError("Weekly connection limit reached");
  }

  // Step 6: Check for error toast
  const errorToast = page.locator('div[data-test-artdeco-toast-item-type="error"]:visible');
  if ((await errorToast.count()) > 0) {
    const msg = await errorToast.innerText();
    throw new Error(`Connection error: ${msg.trim()}`);
  }
}
