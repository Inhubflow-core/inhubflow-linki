const AUTH_WALL_PATTERN = /\/login|\/authwall|\/checkpoint|\/uas\//i;

export class LinkedInAuthenticationError extends Error {
  constructor(
    message = "LinkedIn authentication is no longer valid",
    readonly submissionAttempted = false
  ) {
    super(message);
    this.name = "LinkedInAuthenticationError";
  }
}

export function isLinkedInAuthenticationWall(url: string): boolean {
  return AUTH_WALL_PATTERN.test(url);
}
