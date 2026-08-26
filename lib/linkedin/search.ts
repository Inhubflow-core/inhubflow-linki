import type { BrowserContext, Page } from "playwright";
import type DatabaseType from "better-sqlite3";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionPage, markNeedsReauth } from "@/lib/linkedin/session";

type DB = DatabaseType.Database;

export interface SearchLead {
  linkedinUrl: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  profileImageUrl: string | null;
  degree: number | null;
  summary: string | null;
}

export interface SearchFilters {
  title?: string;
  location?: string;
  company?: string;
  keywords?: string;
}

export interface SearchOptions {
  accountId: string;
  filters: SearchFilters;
  limit?: number;
  listName?: string;
}

export interface SearchProgressEvent {
  phase: "starting" | "navigating" | "scrolling" | "extracting" | "saving" | "completed" | "error";
  page: number;
  totalPages: number;
  totalFound: number;
  currentLead?: SearchLead;
  message?: string;
}

export type SearchProgressCallback = (event: SearchProgressEvent) => void;

/**
 * Builds an optimized LinkedIn search query string from structured filters.
 */
export function buildSearchQuery(filters: SearchFilters): string {
  const parts: string[] = [];

  if (filters.title && filters.title.trim()) {
    const cleanTitle = filters.title.trim();
    // Wrap multi-word titles in quotes for exact phrase matching if not already quoted
    parts.push(cleanTitle.includes(" ") && !cleanTitle.startsWith('"') ? `"${cleanTitle}"` : cleanTitle);
  }

  if (filters.location && filters.location.trim()) {
    const cleanLoc = filters.location.trim();
    parts.push(cleanLoc);
  }

  if (filters.company && filters.company.trim()) {
    const cleanComp = filters.company.trim();
    parts.push(cleanComp.includes(" ") && !cleanComp.startsWith('"') ? `"${cleanComp}"` : cleanComp);
  }

  if (filters.keywords && filters.keywords.trim()) {
    parts.push(filters.keywords.trim());
  }

  return parts.join(" ");
}

/**
 * Clean & normalize LinkedIn profile URL.
 */
function normalizeProfileUrl(raw: string): string | null {
  if (!raw || !raw.includes("linkedin.com/in/")) return null;
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname.startsWith("/in/") || pathname === "/in/unavailable" || pathname === "/in/") {
      return null;
    }
    return `https://www.linkedin.com${pathname}/`;
  } catch {
    const match = raw.match(/(https?:\/\/[a-z]{2,3}\.linkedin\.com\/in\/[^/?#]+)/i);
    return match ? `${match[1].replace(/\/+$/, "")}/` : null;
  }
}

/**
 * Parses full name into first and last name components.
 */
function parseName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * Try to extract company name from headline string if not present as a separate field.
 * e.g., "CEO at InHubFlow", "Director de Marketing en Acme Inc", "Software Engineer @ Google"
 */
function extractCompanyFromHeadline(headline: string | null): string | null {
  if (!headline) return null;
  const match = headline.match(/(?:at|en|@|\|)\s+([^,|•\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Executes a LinkedIn people search using the account's stealth browser context,
 * progressively scrolling each page, extracting candidate cards, and yielding progress.
 */
export async function searchLinkedInProfiles(
  options: SearchOptions,
  onProgress?: SearchProgressCallback
): Promise<SearchLead[]> {
  const { accountId, filters, limit = 25 } = options;
  const query = buildSearchQuery(filters);

  if (!query) {
    throw new Error("Debes proporcionar al menos un filtro de búsqueda (Cargo, Ubicación o Palabras Clave).");
  }

  const db = getDb();
  const account = db.prepare("SELECT id, name, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; name: string; is_authenticated: number }
    | undefined;

  if (!account) {
    throw new Error(`Cuenta con ID ${accountId} no encontrada.`);
  }

  if (!account.is_authenticated) {
    throw new Error(`La cuenta ${account.name} no está autenticada. Inicia sesión en Ajustes primero.`);
  }

  // Calculate approximate total pages needed (LinkedIn returns ~10 results per page)
  const estimatedPages = Math.min(Math.ceil(limit / 10), 10);
  const collectedLeads: SearchLead[] = [];
  const seenUrls = new Set<string>();

  onProgress?.({
    phase: "starting",
    page: 1,
    totalPages: estimatedPages,
    totalFound: 0,
    message: `Iniciando búsqueda para: "${query}"...`,
  });

  const page = await getSessionPage(accountId);

  try {
    for (let pageNum = 1; pageNum <= estimatedPages; pageNum++) {
      if (collectedLeads.length >= limit) break;

      const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
        query
      )}&origin=GLOBAL_SEARCH_HEADER&page=${pageNum}`;

      onProgress?.({
        phase: "navigating",
        page: pageNum,
        totalPages: estimatedPages,
        totalFound: collectedLeads.length,
        message: `Explorando página ${pageNum} de ${estimatedPages}...`,
      });

      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 35000,
      });

      // Randomized human delay
      await page.waitForTimeout(2000 + Math.random() * 1500);

      // Check for authwall / checkpoint / login redirect
      const currentUrl = page.url();
      if (/\/login|\/authwall|\/checkpoint|\/uas\//.test(currentUrl)) {
        await markNeedsReauth(accountId);
        throw new Error(
          `La sesión de LinkedIn se ha cerrado o requiere verificación (${currentUrl}). Por favor re-autentica tu cuenta en Ajustes.`
        );
      }

      // Check if no results found on page
      const noResults = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        return (
          bodyText.includes("No matching results found") ||
          bodyText.includes("No se encontraron resultados") ||
          bodyText.includes("Nenhum resultado encontrado")
        );
      });

      if (noResults) {
        onProgress?.({
          phase: "extracting",
          page: pageNum,
          totalPages: estimatedPages,
          totalFound: collectedLeads.length,
          message: `No se encontraron más resultados en la página ${pageNum}.`,
        });
        break;
      }

      onProgress?.({
        phase: "scrolling",
        page: pageNum,
        totalPages: estimatedPages,
        totalFound: collectedLeads.length,
        message: `Desplazando página ${pageNum} para cargar avatares e información...`,
      });

      // Smooth human-like scroll down the page to trigger dynamic card & avatar loading
      await page.evaluate(async () => {
        const totalHeight = document.body.scrollHeight;
        const step = 450;
        let pos = 0;
        while (pos < totalHeight) {
          window.scrollBy(0, step);
          pos += step;
          await new Promise((r) => setTimeout(r, 200 + Math.random() * 100));
        }
      });

      await page.waitForTimeout(1000 + Math.random() * 500);

      onProgress?.({
        phase: "extracting",
        page: pageNum,
        totalPages: estimatedPages,
        totalFound: collectedLeads.length,
        message: `Extrayendo perfiles de la página ${pageNum}...`,
      });

      // Extract raw data from the DOM
      const extractedRaw = await page.evaluate(() => {
        const items: Array<{
          rawUrl: string | null;
          rawName: string | null;
          rawHeadline: string | null;
          rawLocation: string | null;
          rawImage: string | null;
          rawDegree: string | null;
          rawSummary: string | null;
        }> = [];

        // Universal selectors matching LinkedIn's various search container formats
        const selectors = [
          "li.reusable-search__result-container",
          "div[data-view-name='search-entity-result-universal-template']",
          "div.entity-result",
          "ul.reusable-search__entity-result-list > li",
        ];

        let elements: Element[] = [];
        for (const sel of selectors) {
          const found = Array.from(document.querySelectorAll(sel));
          if (found.length > 0) {
            elements = found;
            break;
          }
        }

        // Fallback: search by link containing /in/
        if (elements.length === 0) {
          const links = Array.from(document.querySelectorAll("a[href*='/in/']"));
          const parentContainers = new Set<Element>();
          for (const a of links) {
            const card = a.closest("li") || a.closest("div.entity-result") || a.closest("div.mb1");
            if (card) parentContainers.add(card);
          }
          elements = Array.from(parentContainers);
        }

        for (const el of elements) {
          // Link
          const linkEl = el.querySelector("a[href*='/in/']") as HTMLAnchorElement | null;
          const rawUrl = linkEl ? linkEl.href : null;

          // Name
          let rawName: string | null = null;
          const titleSpan =
            el.querySelector("span.entity-result__title-text a span[aria-hidden='true']") ||
            el.querySelector("a[href*='/in/'] span[aria-hidden='true']") ||
            el.querySelector(".entity-result__title-text a") ||
            el.querySelector("a[href*='/in/']");

          if (titleSpan) {
            rawName = titleSpan.textContent?.trim() || null;
          }

          // Subtitle / Headline
          const headlineEl =
            el.querySelector(".entity-result__primary-subtitle") ||
            el.querySelector("div[data-view-name='search-entity-result-universal-template'] .entity-result__primary-subtitle") ||
            el.querySelector("div.t-14.t-black.t-normal");
          const rawHeadline = headlineEl ? headlineEl.textContent?.trim() || null : null;

          // Secondary Subtitle / Location
          const locEl =
            el.querySelector(".entity-result__secondary-subtitle") ||
            el.querySelector("div[data-view-name='search-entity-result-universal-template'] .entity-result__secondary-subtitle") ||
            el.querySelector("div.t-12.t-normal");
          const rawLocation = locEl ? locEl.textContent?.trim() || null : null;

          // Image / Avatar
          const imgEl =
            (el.querySelector("img.presence-entity__image") as HTMLImageElement | null) ||
            (el.querySelector("img.evi-image") as HTMLImageElement | null) ||
            (el.querySelector("img[src*='licdn.com']") as HTMLImageElement | null) ||
            (el.querySelector("img[alt*='profile']") as HTMLImageElement | null);
          const rawImage = imgEl ? imgEl.src : null;

          // Degree badge
          const badgeEl = el.querySelector(".entity-result__badge-text") || el.querySelector("span.dist-value");
          const rawDegree = badgeEl ? badgeEl.textContent?.trim() || null : null;

          // Summary / snippet
          const summaryEl = el.querySelector(".entity-result__summary") || el.querySelector(".entity-result__simple-insight");
          const rawSummary = summaryEl ? summaryEl.textContent?.trim() || null : null;

          if (rawUrl) {
            items.push({
              rawUrl,
              rawName,
              rawHeadline,
              rawLocation,
              rawImage,
              rawDegree,
              rawSummary,
            });
          }
        }

        return items;
      });

      let pageAddedCount = 0;

      for (const item of extractedRaw) {
        if (collectedLeads.length >= limit) break;
        if (!item.rawUrl) continue;

        const cleanUrl = normalizeProfileUrl(item.rawUrl);
        if (!cleanUrl || seenUrls.has(cleanUrl)) continue;

        seenUrls.add(cleanUrl);

        // Clean name (strip "• 1st", "• 2nd", "• 3rd+", "• 1.º", "• 2.º", "• 3.º", etc.)
        let cleanName = item.rawName ? item.rawName.replace(/\s*•\s*(1st|2nd|3rd\+?|1\.º|2\.º|3\.º).*$/i, "").trim() : null;
        if (cleanName && (cleanName.toLowerCase().includes("linkedin member") || cleanName.toLowerCase().includes("usuario de linkedin"))) {
          // Out of network profile
          cleanName = "Miembro de LinkedIn";
        }

        const { firstName, lastName } = parseName(cleanName);

        // Parse degree
        let degree: number | null = null;
        if (item.rawDegree) {
          if (/1st|1\.º/i.test(item.rawDegree)) degree = 1;
          else if (/2nd|2\.º/i.test(item.rawDegree)) degree = 2;
          else if (/3rd|3\.º/i.test(item.rawDegree)) degree = 3;
        }

        // Company resolution
        const detectedCompany = filters.company?.trim() || extractCompanyFromHeadline(item.rawHeadline);

        // Image validation (ignore SVGs or data uris unless valid)
        let finalImage: string | null = null;
        if (item.rawImage && item.rawImage.startsWith("http") && item.rawImage.includes("licdn.com")) {
          finalImage = item.rawImage;
        }

        const lead: SearchLead = {
          linkedinUrl: cleanUrl,
          fullName: cleanName || "Prospecto de LinkedIn",
          firstName,
          lastName,
          title: item.rawHeadline,
          company: detectedCompany,
          location: item.rawLocation,
          profileImageUrl: finalImage,
          degree,
          summary: item.rawSummary,
        };

        collectedLeads.push(lead);
        pageAddedCount++;

        onProgress?.({
          phase: "extracting",
          page: pageNum,
          totalPages: estimatedPages,
          totalFound: collectedLeads.length,
          currentLead: lead,
          message: `Prospecto captado: ${lead.fullName} (${lead.title || "Sin cargo"})`,
        });
      }

      // If no new leads were added from this page, we might have reached the end of search
      if (pageAddedCount === 0 && extractedRaw.length === 0) {
        break;
      }

      // Gentle pause before next page
      if (pageNum < estimatedPages && collectedLeads.length < limit) {
        await page.waitForTimeout(1500 + Math.random() * 1500);
      }
    }

    onProgress?.({
      phase: "completed",
      page: estimatedPages,
      totalPages: estimatedPages,
      totalFound: collectedLeads.length,
      message: `Búsqueda finalizada con éxito. Se encontraron ${collectedLeads.length} prospectos.`,
    });

    return collectedLeads;
  } finally {
    try {
      await page.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Saves extracted leads into a new or existing list in SQLite,
 * populating `lists`, `targets`, and `list_targets`.
 */
export function saveProfilesToList(
  db: DB,
  options: {
    listName: string;
    description?: string;
    profiles: SearchLead[];
  }
): { listId: string; listName: string; importedCount: number; updatedCount: number } {
  const { listName, description, profiles } = options;
  const listId = randomUUID();

  let importedCount = 0;
  let updatedCount = 0;

  const insertList = db.prepare(`
    INSERT INTO lists (id, name, description, purpose, created_at)
    VALUES (?, ?, ?, 'linkedin', datetime('now'))
  `);

  const findByLinkedin = db.prepare("SELECT id FROM targets WHERE linkedin_url = ?");

  const insertTarget = db.prepare(`
    INSERT INTO targets (
      id, linkedin_url, full_name, first_name, last_name,
      title, company, location, profile_image_url, degree, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const updateTarget = db.prepare(`
    UPDATE targets SET
      full_name = COALESCE(?, full_name),
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      title = COALESCE(?, title),
      company = COALESCE(?, company),
      location = COALESCE(?, location),
      profile_image_url = COALESCE(?, profile_image_url),
      degree = COALESCE(?, degree)
    WHERE id = ?
  `);

  const linkToList = db.prepare(`
    INSERT OR IGNORE INTO list_targets (list_id, target_id)
    VALUES (?, ?)
  `);

  db.transaction(() => {
    insertList.run(
      listId,
      listName.trim() || `Búsqueda LinkedIn - ${new Date().toLocaleDateString()}`,
      description || `Captados mediante Lead Finder (${profiles.length} prospectos)`
    );

    for (const lead of profiles) {
      const existing = findByLinkedin.get(lead.linkedinUrl) as { id: string } | undefined;
      let targetId: string;

      if (existing) {
        targetId = existing.id;
        updateTarget.run(
          lead.fullName,
          lead.firstName,
          lead.lastName,
          lead.title,
          lead.company,
          lead.location,
          lead.profileImageUrl,
          lead.degree,
          targetId
        );
        updatedCount++;
      } else {
        targetId = randomUUID();
        insertTarget.run(
          targetId,
          lead.linkedinUrl,
          lead.fullName,
          lead.firstName,
          lead.lastName,
          lead.title,
          lead.company,
          lead.location,
          lead.profileImageUrl,
          lead.degree
        );
        importedCount++;
      }

      linkToList.run(listId, targetId);
    }
  })();

  return {
    listId,
    listName,
    importedCount,
    updatedCount,
  };
}
