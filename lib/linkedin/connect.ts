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
  await page.waitForTimeout(3000 + Math.random() * 1500);

  // Check degree from page text
  const mainText = await page.locator("main").innerText().catch(() => "");
  const isExplicit2ndOr3rd = /\b[23][ºªndrdth°\.]/i.test(mainText) || /•\s*[23]º/i.test(mainText);
  const isExplicit1st = (/\b1[ºªster°\.]/i.test(mainText) || /•\s*1º/i.test(mainText)) && !isExplicit2ndOr3rd;
  if (isExplicit1st) throw new AlreadyConnectedError("Already connected (1st degree)");

  // Check if invitation is already pending (strictly check actual button/badge)
  const pendingBtn = page.locator(`
    main button.artdeco-button:has-text("Pendente"):visible,
    main button.artdeco-button:has-text("Pending"):visible,
    main button.artdeco-button:has-text("Pendiente"):visible,
    main button[aria-label*="Convite pendente"]:visible,
    main button[aria-label*="Invitation pending"]:visible,
    main button[aria-label*="Invitación pendiente"]:visible
  `).first();
  if ((await pendingBtn.count()) > 0) {
    throw new PendingInviteError("Invitation already pending");
  }

  let clickedConnect = false;

  // ── Strategy 1: Direct Connect button on profile ──
  const directConnect = page.locator(`
    main button:has-text("Conectar"):visible,
    main button:has-text("Connect"):visible,
    main button:has-text("Se connecter"):visible,
    main button:has-text("Vernetzen"):visible,
    main button[aria-label*="Conectar"]:visible,
    main button[aria-label*="Connect"]:visible,
    main button[aria-label*="Convidar"]:visible,
    main button[aria-label*="Invitar"]:visible,
    main a[aria-label*="Conectar"]:visible,
    main a[aria-label*="Connect"]:visible,
    main a[aria-label*="Convidar"]:visible,
    main a[aria-label*="Invitar"]:visible,
    main a[aria-label*="Invite"][aria-label*="to connect"]:visible,
    main a[href*="custom-invite"]:visible
  `).first();

  if ((await directConnect.count()) > 0) {
    const href = await directConnect.getAttribute("href").catch(() => null);
    if (href && href.includes("custom-invite")) {
      const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
      clickedConnect = true;
    } else {
      await directConnect.click({ force: true });
      await page.waitForTimeout(1000);
      clickedConnect = true;
    }
  }

  // ── Strategy 2: More/Mais ("...") dropdown button ──
  if (!clickedConnect) {
    const moreBtn = page.locator(`
      main button.artdeco-dropdown__trigger:visible,
      main div.pvs-profile-actions button:has(svg):visible,
      main button[aria-label*="Mais"]:visible,
      main button[aria-label*="Más"]:visible,
      main button[aria-label*="More"]:visible,
      main button[aria-label*="ações"]:visible,
      main button[aria-label*="acciones"]:visible,
      main button[aria-label*="actions"]:visible,
      main button[aria-label*="opções"]:visible,
      main button[aria-label*="opciones"]:visible,
      main button[aria-label*="options"]:visible,
      main button:has-text("Mais"):visible,
      main button:has-text("Más"):visible,
      main button:has-text("More"):visible
    `).first();

    if ((await moreBtn.count()) > 0) {
      await moreBtn.click({ force: true });
      await page.waitForTimeout(1000);

      // Check for Pending in dropdown
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
        div.artdeco-dropdown__item:has-text("Connect"):visible,
        a[href*="custom-invite"]:visible
      `).first();

      if ((await connectOption.count()) > 0) {
        const href = (await connectOption.getAttribute("href").catch(() => null)) ||
          (await connectOption.locator("a").getAttribute("href").catch(() => null));

        if (href && href.includes("custom-invite")) {
          const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
          await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(1500);
          clickedConnect = true;
        } else {
          await connectOption.click({ force: true });
          await page.waitForTimeout(1200);
          clickedConnect = true;
        }
      }
    }
  }

  // ── Strategy 3: Full in-page evaluate fallback ──
  if (!clickedConnect) {
    const evaluated = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("main button, main a"));
      for (const btn of buttons) {
        const txt = (btn.textContent || "").trim();
        const aria = btn.getAttribute("aria-label") || "";
        const href = btn.getAttribute("href") || "";
        if (
          txt.match(/^(Conectar|Connect|Se connecter|Vernetzen)$/i) ||
          aria.match(/(conectar|connect|convidar|invitar)/i) ||
          href.includes("custom-invite")
        ) {
          (btn as HTMLElement).click();
          return "clicked_direct";
        }
      }

      for (const btn of buttons) {
        const aria = btn.getAttribute("aria-label") || "";
        const cls = btn.className || "";
        if (
          aria.match(/(mais|más|more|ações|acciones|actions)/i) ||
          cls.includes("artdeco-dropdown__trigger")
        ) {
          (btn as HTMLElement).click();
          return "clicked_more";
        }
      }

      return "none";
    });

    if (evaluated === "clicked_more") {
      await page.waitForTimeout(1000);
      const connectOption = page.locator(`
        [role="menuitem"]:has-text("Conectar"):visible,
        [role="menuitem"]:has-text("Connect"):visible,
        div.artdeco-dropdown__item:has-text("Conectar"):visible,
        div.artdeco-dropdown__item:has-text("Connect"):visible,
        a[href*="custom-invite"]:visible
      `).first();
      if ((await connectOption.count()) > 0) {
        const href = (await connectOption.getAttribute("href").catch(() => null)) ||
          (await connectOption.locator("a").getAttribute("href").catch(() => null));
        if (href && href.includes("custom-invite")) {
          const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
          await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(1500);
        } else {
          await connectOption.click({ force: true });
          await page.waitForTimeout(1200);
        }
        clickedConnect = true;
      }
    } else if (evaluated === "clicked_direct") {
      clickedConnect = true;
      await page.waitForTimeout(1200);
    }
  }

  if (!clickedConnect) {
    throw new Error("No Connect button or More menu found on profile");
  }

  // ── Step 3: Handle invitation modal (Send without note / Enviar sem nota / Enviar agora) ──
  // Wait up to 6 seconds for dialog modal to appear
  const modal = page.locator('div[role="dialog"], .artdeco-modal, div[data-test-modal]').first();
  const modalVisible = await modal.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);

  if (modalVisible) {
    // Step 4: Check if email prompt appeared inside modal ("Para conectar, digite o e-mail")
    const emailPrompt = modal.locator('input[type="email"]:visible, input#email:visible');
    if ((await emailPrompt.count()) > 0) {
      const closeBtn = modal.locator('button[aria-label*="Dismiss"]:visible, button[aria-label*="Fechar"]:visible, button[aria-label*="Cerrar"]:visible').first();
      if ((await closeBtn.count()) > 0) await closeBtn.click().catch(() => {});
      throw new Error("LinkedIn requires email address to connect with this target");
    }

    const sendBtn = modal.locator(`
      button:has-text("Enviar sem nota"):visible,
      button:has-text("Enviar agora"):visible,
      button:has-text("Send without a note"):visible,
      button:has-text("Send now"):visible,
      button:has-text("Enviar"):visible,
      button:has-text("Send"):visible,
      button[aria-label*="Enviar sem nota"]:visible,
      button[aria-label*="Send without a note"]:visible,
      button[aria-label*="Enviar agora"]:visible,
      button[aria-label*="Send now"]:visible,
      button.artdeco-button--primary:visible
    `).first();

    if ((await sendBtn.count()) > 0) {
      await sendBtn.click({ force: true });
      await page.waitForTimeout(2000);
    } else {
      // DOM fallback for modal send button
      await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"], .artdeco-modal, div[data-test-modal]');
        if (dialog) {
          const btns = Array.from(dialog.querySelectorAll("button"));
          for (const btn of btns) {
            const txt = (btn.textContent || "").trim().toLowerCase();
            const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
            if (
              txt.includes("sem nota") ||
              txt.includes("without a note") ||
              txt.includes("enviar agora") ||
              txt.includes("send now") ||
              txt === "enviar" ||
              txt === "send" ||
              aria.includes("sem nota") ||
              aria.includes("without")
            ) {
              (btn as HTMLElement).click();
              return;
            }
          }
          const primary = dialog.querySelector("button.artdeco-button--primary") as HTMLElement;
          if (primary) primary.click();
        }
      });
      await page.waitForTimeout(2000);
    }
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
