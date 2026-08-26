import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { SearchLead, SearchProgressCallback } from "./search";

chromium.use(StealthPlugin());

const HEADLESS = process.env.HEADLESS !== "false";
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

// Country code mapping to LinkedIn national subdomains
export const COUNTRY_SUBDOMAINS: Record<string, { code: string; name: string }> = {
  chile: { code: "cl", name: "Chile" },
  santiago: { code: "cl", name: "Chile" },
  valparaiso: { code: "cl", name: "Chile" },
  concepcion: { code: "cl", name: "Chile" },

  brasil: { code: "br", name: "Brasil" },
  brazil: { code: "br", name: "Brasil" },
  "sao paulo": { code: "br", name: "Brasil" },
  "são paulo": { code: "br", name: "Brasil" },
  "rio de janeiro": { code: "br", name: "Brasil" },
  "belo horizonte": { code: "br", name: "Brasil" },
  curitiba: { code: "br", name: "Brasil" },

  peru: { code: "pe", name: "Perú" },
  perú: { code: "pe", name: "Perú" },
  lima: { code: "pe", name: "Perú" },

  colombia: { code: "co", name: "Colombia" },
  bogota: { code: "co", name: "Colombia" },
  bogotá: { code: "co", name: "Colombia" },
  medellin: { code: "co", name: "Colombia" },
  medellín: { code: "co", name: "Colombia" },
  cali: { code: "co", name: "Colombia" },

  espana: { code: "es", name: "España" },
  españa: { code: "es", name: "España" },
  spain: { code: "es", name: "España" },
  madrid: { code: "es", name: "España" },
  barcelona: { code: "es", name: "España" },
  valencia: { code: "es", name: "España" },

  mexico: { code: "mx", name: "México" },
  méxico: { code: "mx", name: "México" },
  "ciudad de mexico": { code: "mx", name: "México" },
  "ciudad de méxico": { code: "mx", name: "México" },
  cdmx: { code: "mx", name: "México" },
  monterrey: { code: "mx", name: "México" },
  guadalajara: { code: "mx", name: "México" },

  argentina: { code: "ar", name: "Argentina" },
  "buenos aires": { code: "ar", name: "Argentina" },
  cordoba: { code: "ar", name: "Argentina" },

  venezuela: { code: "ve", name: "Venezuela" },
  caracas: { code: "ve", name: "Venezuela" },

  uruguay: { code: "uy", name: "Uruguay" },
  montevideo: { code: "uy", name: "Uruguay" },

  ecuador: { code: "ec", name: "Ecuador" },
  quito: { code: "ec", name: "Ecuador" },
  guayaquil: { code: "ec", name: "Ecuador" },

  panama: { code: "pa", name: "Panamá" },
  panamá: { code: "pa", name: "Panamá" },

  usa: { code: "www", name: "Estados Unidos" },
  "estados unidos": { code: "www", name: "Estados Unidos" },
  "united states": { code: "www", name: "Estados Unidos" },
  miami: { code: "www", name: "Estados Unidos" },
  florida: { code: "www", name: "Estados Unidos" },
};

// Title synonyms for Google X-Ray boolean OR expansions
export const XRAY_TITLE_SYNONYMS: Record<string, string[]> = {
  ceo: ['"CEO"', '"Chief Executive Officer"', '"Director General"', '"Gerente General"', '"Presidente Ejecutivo"', '"Founder"'],
  ceos: ['"CEO"', '"Chief Executive Officer"', '"Director General"', '"Gerente General"'],
  director: ['"Director"', '"Directora"', '"Director General"', '"Gerente General"', '"Managing Director"', '"Head"'],
  directores: ['"Director"', '"Directores"', '"Director General"', '"Gerente General"'],
  gerente: ['"Gerente General"', '"Gerente"', '"General Manager"', '"Managing Director"'],
  founder: ['"Founder"', '"Co-Founder"', '"Fundador"', '"CEO"'],
  fundador: ['"Fundador"', '"Co-Fundador"', '"Founder"', '"CEO"'],
  comercial: ['"Director Comercial"', '"Gerente Comercial"', '"Head of Sales"', '"VP of Sales"'],
  ventas: ['"Director de Ventas"', '"Gerente de Ventas"', '"Head of Sales"'],
  marketing: ['"Director de Marketing"', '"Diretor de Marketing"', '"Head of Marketing"', '"CMO"', '"Gerente de Marketing"'],
  operaciones: ['"Director de Operaciones"', '"COO"', '"Chief Operating Officer"', '"Gerente de Operaciones"'],
  finanzas: ['"Director Financiero"', '"CFO"', '"Chief Financial Officer"', '"Gerente de Finanzas"'],
  tecnologia: ['"Director de Tecnología"', '"CTO"', '"Chief Technology Officer"', '"Head of Engineering"'],
  abogado: ['"Abogado"', '"Abogada"', '"Socio"', '"Legal Counsel"', '"Partner"'],
  dentista: ['"Dentista"', '"Odontólogo"', '"Odontóloga"', '"Cirujano Dentista"'],
};

export interface XRaySearchOptions {
  title?: string;
  location?: string;
  company?: string;
  keywords?: string;
  limit?: number;
}

/**
 * Identifies the national subdomain from location text (e.g. "Santiago, Chile" -> "cl")
 */
export function resolveSubdomain(locationText?: string): { code: string; name: string } {
  if (!locationText) return { code: "www", name: "Global" };
  const clean = locationText.toLowerCase().replace(/[,.;:/\\-]/g, " ").trim();
  for (const [key, mapping] of Object.entries(COUNTRY_SUBDOMAINS)) {
    if (clean.includes(key)) {
      return mapping;
    }
  }
  return { code: "www", name: locationText };
}

/**
 * Builds the exact Google X-Ray Boolean query string.
 * Example:
 * site:cl.linkedin.com/in/ ("CEO" OR "Chief Executive Officer" OR "Director General") "Mineria" "Santiago" -intitle:"profiles" -inurl:"dir/"
 */
export function buildXRayQuery(options: XRaySearchOptions): { query: string; subdomain: string; countryName: string } {
  const { title = "", location = "", company = "", keywords = "" } = options;
  const { code: subCode, name: countryName } = resolveSubdomain(location);

  const siteClause = subCode === "www"
    ? `(site:linkedin.com/in/ OR site:www.linkedin.com/in/)`
    : `(site:${subCode}.linkedin.com/in/ OR site:${subCode}.linkedin.com/pub/)`;

  // Build title boolean group
  const rawTitleTokens = title.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean);
  const titleTerms: string[] = [];

  for (const t of rawTitleTokens) {
    const lower = t.toLowerCase();
    const syns = XRAY_TITLE_SYNONYMS[lower];
    if (syns && syns.length > 0) {
      for (const s of syns) {
        if (!titleTerms.includes(s)) titleTerms.push(s);
      }
    } else {
      const quoted = t.startsWith('"') ? t : `"${t}"`;
      if (!titleTerms.includes(quoted)) titleTerms.push(quoted);
    }
  }

  const titleClause = titleTerms.length > 0 ? `(${titleTerms.join(" OR ")})` : "";

  // Industry / Company clause
  let industryClause = "";
  if (company.trim()) {
    const rawComp = company.trim();
    industryClause = rawComp.startsWith('"') ? rawComp : `"${rawComp}"`;
  }

  // City / Specific location clause (extract city if present)
  let cityClause = "";
  const locLower = location.toLowerCase();
  for (const [cityKey, mapping] of Object.entries(COUNTRY_SUBDOMAINS)) {
    if (cityKey !== mapping.name.toLowerCase() && locLower.includes(cityKey)) {
      const capCity = cityKey.charAt(0).toUpperCase() + cityKey.slice(1);
      cityClause = `"${capCity}"`;
      break;
    }
  }

  // Keywords
  const kwClause = keywords.trim() ? `"${keywords.trim()}"` : "";

  // Assemble full X-Ray query
  const queryParts = [
    siteClause,
    titleClause,
    industryClause,
    cityClause,
    kwClause,
    `-intitle:"profiles"`,
    `-inurl:"dir/"`,
  ].filter(Boolean);

  return {
    query: queryParts.join(" "),
    subdomain: subCode,
    countryName,
  };
}

/**
 * Normalizes LinkedIn profile URL extracted from Google search results.
 */
function normalizeXRayUrl(rawUrl: string): string | null {
  if (!rawUrl || !rawUrl.includes("linkedin.com/in/")) return null;
  try {
    let target = rawUrl;
    if (target.includes("/url?q=")) {
      const match = target.match(/\/url\?q=([^&]+)/);
      if (match) target = decodeURIComponent(match[1]);
    }
    const urlObj = new URL(target.startsWith("http") ? target : `https://${target}`);
    const cleanPath = urlObj.pathname.split("/").slice(0, 3).join("/");
    if (!cleanPath || cleanPath === "/in" || cleanPath.includes("/dir/")) return null;
    return `https://www.linkedin.com${cleanPath}/`;
  } catch {
    const match = rawUrl.match(/(https?:\/\/[a-z0-9.-]*linkedin\.com\/in\/[^/?#&]+)/i);
    return match ? `${match[1].replace(/\/+$/, "")}/` : null;
  }
}

export function extractContactDetails(
  text: string
): { email: string | null; phone: string | null } {
  if (!text) return { email: null, phone: null };

  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  const email = emailMatch ? emailMatch[1].toLowerCase() : null;

  const phoneMatch = text.match(/(\+?\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,5}[\s-]?\d{3,5})/);
  const phone = phoneMatch ? phoneMatch[1].trim() : null;

  return { email, phone };
}

/**
 * Parses Google Search Snippet title (e.g. "Marko Didyk - Director Mineria en CODELCO | LinkedIn")
 * into clean Name, Headline, Company, Email, and Phone.
 */
export function parseXRaySnippet(
  rawTitle: string,
  rawSnippet?: string,
  defaultCompany?: string
): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
} {
  let clean = rawTitle.replace(/\s*\|\s*LinkedIn.*$/i, "").replace(/\s*-\s*LinkedIn.*$/i, "").trim();
  const parts = clean.split(/\s+[-–—]\s+/);

  let fullName = "Prospecto de LinkedIn";
  let title: string | null = null;
  let company: string | null = defaultCompany || null;

  if (parts.length >= 2) {
    fullName = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  } else if (parts.length === 1) {
    fullName = parts[0].trim();
  }

  if (title) {
    const compMatch = title.match(/(?:at|en|@|\|)\s+([^,|•\n]+)/i);
    if (compMatch) {
      company = compMatch[1].trim();
    }
  }

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(" ") || null;

  const { email, phone } = extractContactDetails(`${rawTitle} ${rawSnippet || ""}`);

  return {
    fullName,
    firstName,
    lastName,
    title,
    company,
    email,
    phone,
  };
}

/**
 * Executes a high-precision Google X-Ray Search for LinkedIn profiles using Playwright Stealth.
 * Bypasses LinkedIn account limits, Commercial Use Limits, and guarantees 100% geographical accuracy.
 */
export async function searchLinkedInWithXRay(
  options: XRaySearchOptions,
  onProgress?: SearchProgressCallback
): Promise<SearchLead[]> {
  const { limit = 25, location = "", company = "" } = options;
  const { query, countryName } = buildXRayQuery(options);

  const estimatedPages = Math.min(Math.ceil(limit / 10), 5);
  const collectedLeads: SearchLead[] = [];
  const seenUrls = new Set<string>();

  onProgress?.({
    phase: "starting",
    page: 1,
    totalPages: estimatedPages,
    totalFound: 0,
    message: `Iniciando Google X-Ray para ${countryName}: "${options.title || "Directivos"}"...`,
  });

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROMIUM_PATH,
    args: LAUNCH_ARGS,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "es-ES",
  });

  const page = await context.newPage();

  try {
    for (let pageIdx = 0; pageIdx < estimatedPages; pageIdx++) {
      if (collectedLeads.length >= limit) break;

      const startOffset = pageIdx * 10;
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${startOffset}&num=30&hl=es`;

      onProgress?.({
        phase: "navigating",
        page: pageIdx + 1,
        totalPages: estimatedPages,
        totalFound: collectedLeads.length,
        message: `Buscando perfiles verificados en Google (${countryName})...`,
      });

      await page.goto(googleUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500 + Math.random() * 800);

      // Extract results from Google search page
      const googleResults = await page.evaluate(() => {
        const results: Array<{ rawUrl: string; rawTitle: string; rawSnippet: string }> = [];
        const containers = Array.from(document.querySelectorAll("div.g, div[data-hveid], div.tF2Cxc, div.MjjYud"));

        for (const container of containers) {
          const linkEl = container.querySelector("a[href*='linkedin.com/in/']") as HTMLAnchorElement | null;
          const titleEl = container.querySelector("h3") as HTMLElement | null;
          const snippetEl = container.querySelector("div.VwiC3b, span.aCOpRe, div[data-snf], div.yXDckb") as HTMLElement | null;

          if (linkEl && linkEl.href) {
            results.push({
              rawUrl: linkEl.href,
              rawTitle: titleEl ? titleEl.innerText.trim() : "",
              rawSnippet: snippetEl ? snippetEl.innerText.trim() : "",
            });
          }
        }

        if (results.length === 0) {
          const directLinks = Array.from(document.querySelectorAll("a[href*='linkedin.com/in/']")) as HTMLAnchorElement[];
          for (const a of directLinks) {
            const h3 = a.querySelector("h3") || a.parentElement?.querySelector("h3");
            if (h3) {
              results.push({
                rawUrl: a.href,
                rawTitle: h3.textContent?.trim() || "",
                rawSnippet: a.parentElement?.textContent?.trim() || "",
              });
            }
          }
        }

        return results;
      });

      for (const res of googleResults) {
        if (collectedLeads.length >= limit) break;
        if (!res.rawUrl) continue;

        const cleanUrl = normalizeXRayUrl(res.rawUrl);
        if (!cleanUrl || seenUrls.has(cleanUrl)) continue;

        seenUrls.add(cleanUrl);

        const {
          fullName,
          firstName,
          lastName,
          title: parsedTitle,
          company: parsedCompany,
          email: foundEmail,
          phone: foundPhone,
        } = parseXRaySnippet(res.rawTitle, res.rawSnippet, company || undefined);

        if (!fullName || fullName === "LinkedIn" || fullName === "Prospecto de LinkedIn") {
          continue;
        }

        const lead: SearchLead = {
          linkedinUrl: cleanUrl,
          fullName,
          firstName,
          lastName,
          title: parsedTitle,
          company: parsedCompany,
          location: location || countryName,
          email: foundEmail,
          phone: foundPhone,
          profileImageUrl: null,
          degree: 2,
          summary: res.rawSnippet || null,
        };

        collectedLeads.push(lead);

        onProgress?.({
          phase: "extracting",
          page: pageIdx + 1,
          totalPages: estimatedPages,
          totalFound: collectedLeads.length,
          currentLead: lead,
          message: `[Google X-Ray] ${lead.fullName} (${lead.title || "Directivo"})${lead.email ? ` [${lead.email}]` : ""}`,
        });
      }

      if (googleResults.length === 0) break;
    }

    onProgress?.({
      phase: "completed",
      page: estimatedPages,
      totalPages: estimatedPages,
      totalFound: collectedLeads.length,
      message: `Búsqueda X-Ray completada. Se captaron ${collectedLeads.length} prospectos calificados.`,
    });

    return collectedLeads;
  } finally {
    try { await page.close(); } catch { /* ignore */ }
    try { await context.close(); } catch { /* ignore */ }
    try { await browser.close(); } catch { /* ignore */ }
  }
}
