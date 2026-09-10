/**
 * Owner 08-18: plain-language reasons for the spectate connect-error modal (App.vue).
 * Pure/testable seam — maps a raw transport error string to a short, actionable
 * sentence. Fail-open: an error this function doesn't recognize is returned
 * VERBATIM (never suppressed to nothing) so an unmapped failure still tells the
 * user something rather than showing a blank/generic message.
 */
export function friendlySpectateError(raw: string): string {
  const text = raw.trim();
  if (/WebSocket connection to .* failed/i.test(text)) {
    return "Couldn't reach the server — check your internet connection, or the server may be offline.";
  }
  if (/not connected/i.test(text)) {
    return 'Connection dropped before the game could be reached.';
  }
  if (!text) return 'The connection failed for an unknown reason.';
  return text;
}

/** Preserve the server's authoritative pre-game rejection instead of letting the
 * following normal WebSocket close (usually code 1000) replace it. */
export function spectateServerStatusError(
  serverStatus: string | null | undefined,
  message: string | null | undefined,
): { message: string; detail: string } {
  const status = serverStatus?.trim() ?? '';
  const authoritative = message?.trim() || status || 'The server rejected the spectator join.';
  if (/wrong password/i.test(status) || /wrong password/i.test(authoritative)) {
    return {
      message: 'FUMBBL rejected the spectator login. Check your FUMBBL coach name and password, then try again.',
      detail: `FUMBBL server status: ${authoritative}`,
    };
  }
  return {
    message: authoritative,
    detail: status && status !== authoritative
      ? `FUMBBL server status: ${status} — ${authoritative}`
      : `FUMBBL server status: ${authoritative}`,
  };
}
