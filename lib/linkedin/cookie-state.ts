export type LinkedInSessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  expires?: number;
};

const COOKIE_NAME_RE = /^[-!#$%&'*+.^_`|~0-9A-Za-z]+$/;
const LINKEDIN_HOST_RE = /(^|\.)linkedin\.com$/i;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function normalizeLinkedInSameSite(value: unknown): LinkedInSessionCookie["sameSite"] {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "none" || normalized === "no_restriction") return "None";
  if (normalized === "strict") return "Strict";
  return "Lax";
}

export function normalizeLinkedInCookie(
  input: unknown,
  defaults: { domain?: string; httpOnly?: boolean } = {}
): LinkedInSessionCookie | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const value = typeof raw.value === "string" ? raw.value : "";
  const domainValue = typeof raw.domain === "string" && raw.domain.trim()
    ? raw.domain.trim().toLowerCase()
    : (defaults.domain ?? ".linkedin.com");
  const path = typeof raw.path === "string" && raw.path ? raw.path : "/";
  if (!COOKIE_NAME_RE.test(name) || hasControlCharacters(value)) return null;
  if (!LINKEDIN_HOST_RE.test(domainValue.replace(/^\./, "")) || !path.startsWith("/") || hasControlCharacters(path)) return null;

  const expiryValue = raw.expires ?? raw.expirationDate;
  const expires = typeof expiryValue === "number" && Number.isFinite(expiryValue) && expiryValue > 0
    ? Math.round(expiryValue)
    : undefined;
  return {
    name,
    value,
    domain: domainValue,
    path,
    httpOnly: typeof raw.httpOnly === "boolean" ? raw.httpOnly : (defaults.httpOnly ?? false),
    secure: typeof raw.secure === "boolean" ? raw.secure : true,
    sameSite: normalizeLinkedInSameSite(raw.sameSite),
    ...(expires === undefined ? {} : { expires }),
  };
}

export function normalizeLinkedInCookieList(
  input: unknown,
  defaults: { domain?: string; httpOnly?: boolean } = {}
): LinkedInSessionCookie[] | null {
  if (!Array.isArray(input)) return null;
  const cookies: LinkedInSessionCookie[] = [];
  for (const item of input) {
    const cookie = normalizeLinkedInCookie(item, defaults);
    if (!cookie) return null;
    cookies.push(cookie);
  }
  return cookies;
}

export function hasValidLinkedInLiAt(cookies: readonly Pick<LinkedInSessionCookie, "name" | "value">[]): boolean {
  return cookies.some((cookie) => cookie.name === "li_at" && cookie.value.length > 20);
}

export function dedupeLinkedInCookies(cookies: readonly LinkedInSessionCookie[]): LinkedInSessionCookie[] {
  const byKey = new Map<string, LinkedInSessionCookie>();
  for (const cookie of cookies) {
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (!byKey.has(key)) byKey.set(key, cookie);
  }
  return [...byKey.values()];
}

export function linkedinCsrfFromCookies(cookies: readonly Pick<LinkedInSessionCookie, "name" | "value">[]): string | null {
  const csrf = (cookies.find((cookie) => cookie.name === "JSESSIONID")?.value || "").replace(/"/g, "");
  return csrf || null;
}
