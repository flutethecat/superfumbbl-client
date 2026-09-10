# Super FUMBBL client

A fork of FFB-Client built on Pixi/Vue in a Rust wrapper.

Public export of the private working repository (branch `order-66` @ `f8d3922d7d3e88bb648cae44fa10a4b2bf765b71`, 2026-09-10).
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

Some sounds will be missing and not available in the client. As well as the default textures which ship inside the installer bundle that we distribute. For full functionality, please use the attached installer. If you're OK with the ones we've included (they work) then you're good to go!

## Licences

**Code:** MIT — see `LICENSE`. Upstream FFB client/server by Christer Kaivo-oja, also MIT.

**Third-party assets** (full records in `docs/licenses/`, `ATTRIBUTION.md` and the in-app Credits pane):

- **CC0 1.0** — referee whistle by SpliceSound, "Drifting into Dreamland" by Breviceps, "Videogame Menu Button Click"
  by Christopherderp (all freesound.org). No attribution required; credited anyway. Ship in the installer.
- **CC BY 4.0** — "Boxing Bell 1" by Benboncan, "Dramatic Organ A" by InspectorJ, "Chainsaw" by ItsTheGoodstuff
  (freesound.org). Ship in the installer.
- **SIL Open Font License 1.1** — Nuffle by Neale Davidson (Pixel Sagas); the licence text ships beside the font.
- **Flaticon licence (attribution)** — American football helmet icon by justicon.
- **Licensed purchases, use in the product only** — SakPix "Football Championship Megapack" (stadium props, in this
  tree as derivative crops); Acasas / unTied pitch textures via GameDev Market; The Sound Guild, Gamemaster Audio and
  Khron Studio sound libraries. The textures and library-derived sounds ship in the installer only.
- **FUMBBL logo** — used under FUMBBL's branding guidelines.

**Super FUMBBL original art — MIT.** Everything else (sprites, star players, crests, skill badges, decorations, pitches,
banners, block dice, kickoff banners, the wordmark) is original Super FUMBBL art, produced with PixelLab and the OpenAI,
Codex and Gemini image models from Super FUMBBL prompts, and is released under the same MIT licence as the code (`LICENSE`).

<sub>Export check: 1789 files; no excluded path, env file or secret-shaped string; 1487 media files hash-checked against the upstream FFB resource tree (no match).</sub>
