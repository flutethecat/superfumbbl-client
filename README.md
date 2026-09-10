# Super FUMBBL client

A fork of FFB-Client built on Pixi/Vue in a Rust wrapper.

Public export of the private working repository (branch `order-66` @ `a5097235973e0032dbf67c370481925e21a25e76`, 2026-09-10).
The tree holds what building the client needs; development history, tests and internal notes stay in the private repository.

## Build

```bash
pnpm install
pnpm --filter @fumbbl40k/app build
```

Requires Node, pnpm and the Tauri v2 toolchain (Rust). `pnpm --filter @fumbbl40k/app dev` runs the desktop app in development.

## Not in this tree

Installer-only licensed content ships inside the installer under its licence and is not redistributed here:
- `apps/tauri/public/fumbbl-assets/`
- `apps/tauri/src/assets/block_skull.png`
- `apps/tauri/src/assets/coin_skull.png`
- `apps/tauri/src/assets/sounds/`
- `packages/ffb-pitch/assets/textures/`
- `packages/ffb-pitch/assets/acasas-weather/`
- `packages/ffb-pitch/assets/acasas-weather-fx/`

A build from this tree therefore has no bundled sound effects and falls back to the built-in pitch art.

## Licences

MIT — see `LICENSE` (upstream FFB by Christer Kaivo-oja, also MIT). Third-party asset licences and provenance:
`docs/licenses/`, `ATTRIBUTION.md`, and the in-app Credits pane.

<sub>Export check: 1789 files; no excluded path, env file or secret-shaped string; 1487 media files hash-checked against the upstream FFB resource tree (no match).</sub>
