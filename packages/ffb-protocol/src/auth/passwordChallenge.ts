import { md5 } from 'js-md5';

/**
 * Mirror of ffb-common com.fumbbl.ffb.PasswordChallenge.
 *
 * Auth scheme (HMAC-MD5 style):
 *   PWD  = MD5(clear-text password)
 *   OPAD = PWD XOR 0x5c..5c, IPAD = PWD XOR 0x36..36
 *   R    = MD5(OPAD + MD5(IPAD + CHALLENGE_BYTES)), hex-encoded
 * With an empty challenge the response is just hex(PWD).
 */

export function fromHexString(hex: string): Uint8Array {
  const data = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < data.length; i++) {
    data[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return data;
}

export function toHexString(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

export function md5Bytes(input: string | Uint8Array): Uint8Array {
  return new Uint8Array(md5.arrayBuffer(input));
}

function xor(bytes: Uint8Array, mask: number): Uint8Array {
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i]! ^ mask;
  }
  return result;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

export function createChallengeResponse(challenge: string, md5Password: Uint8Array): string {
  if (!challenge) {
    return toHexString(md5Password);
  }
  const challengeBytes = fromHexString(challenge);
  const opad = xor(md5Password, 0x5c);
  const ipad = xor(md5Password, 0x36);
  const inner = md5Bytes(concat(ipad, challengeBytes));
  return toHexString(md5Bytes(concat(opad, inner)));
}

/** Convenience: response straight from the clear-text password. */
export function respondToChallenge(challenge: string, password: string): string {
  return createChallengeResponse(challenge, md5Bytes(password));
}

/**
 * hex(md5(password)) — the exact form the fork stores in `ffb_coaches.password`, and the
 * exact form upstream's own client puts on the join wire when the server issues no
 * challenge (`PasswordChallenge.createResponse` returns `toHexString(md5Password)` for an
 * empty challenge; the fork runs standalone, which sends a null challenge).
 *
 * This is the pre-hashing seam for the owner's 08-17 ruling: config-web calls send this
 * instead of the clear text, so a coach's password stops appearing in JSON bodies, query
 * strings, proxy logs and downloaded JNLP files.
 *
 * ⚠ Be honest about what this is: the digest is a BEARER-EQUIVALENT credential. Anyone who
 * captures it can authenticate as that coach. What pre-hashing buys is that the coach's
 * actual secret — the one they have almost certainly reused on other sites — is no longer
 * the thing being handed around. It does NOT defend against on-path capture or replay;
 * that is TLS's job, and both config-web (http) and the fork socket (ws) are plain today.
 */
export function md5Hex(password: string): string {
  return toHexString(md5Bytes(password));
}

/** True for a well-formed 32-char hex md5 digest — guards "digest or clear text?" branches. */
export function isMd5Hex(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value);
}
