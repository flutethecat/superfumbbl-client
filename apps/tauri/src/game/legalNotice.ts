/**
 * Legal acknowledgement copy shown before the normal client mounts.
 *
 * Keep the upstream notice byte-for-byte aligned with the Christer license in
 * the repository LICENSE and Settings > About surfaces. A new legal text must
 * increment LEGAL_ACCEPTANCE_VERSION so every install sees that revision once.
 */
export const LEGAL_ACCEPTANCE_VERSION = 1;

const MIT_GRANT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export function mitLicense(copyright: string): string {
  return `MIT License\n\n${copyright}\n\n${MIT_GRANT}`;
}

/** Exact owner-confirmed client notice. */
export const CLIENT_MIT_LICENSE = mitLicense('Copyright (c) 2026 Super FUMBBL contributors');

/** Exact upstream FFB notice already shipped in Settings > About. */
export const CHRISTER_MIT_LICENSE = mitLicense('Copyright (c) 2024 Christer Kaivo-oja');

/** Exact code-contribution wording mirrored in ATTRIBUTION.md / Settings > About. */
export const FUMBBL_CONTRIBUTION_CODE_NOTICE = 'Any code contributed to the open parts of the FUMBBL codebase are licensed under the MIT License. Contributions should only be made if you agree to this license.';

/** A malformed or absent value has never acknowledged any legal revision. */
export function normalizeLegalAcceptanceVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

export function needsLegalAcknowledgement(value: unknown): boolean {
  return normalizeLegalAcceptanceVersion(value) < LEGAL_ACCEPTANCE_VERSION;
}
