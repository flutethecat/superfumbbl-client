/**
 * Owner 09-10: the build EDITION. 'fork' (the private tree) carries the Super FUMBBL fork server, fork accounts, Discord
 * SSO, the Team / Tournaments / Statistics blades and tournament notifications. 'public' (the exported repo,
 * github.com/flutethecat/superfumbbl-client) keeps only the Official FUMBBL play path: JNLP intake, FUMBBL login,
 * spectate, replay — plus bug reports. Compile-time via vite define; vitest (no define) sees the fork edition.
 */
export const FORK_EDITION: boolean = typeof __FORK_EDITION__ === 'boolean' ? __FORK_EDITION__ : true;
