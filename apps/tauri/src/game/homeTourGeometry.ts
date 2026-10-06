/**
 * Owner 2026-10-06: Home pane walkthrough geometry - now in tourGeometry.ts (shared with the client walkthrough).
 *
 *
 * The site overlay (src-tauri/src/home_tour_runtime.js) cannot import modules and carries a line-for-line copy of
 * arrowBetween / placeCard; test/homeTour.test.ts checks both copies agree, so edit both together.
 */
export * from './tourGeometry';
