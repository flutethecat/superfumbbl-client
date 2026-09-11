# Super FUMBBL client
This is a fork of Christerk/FFB-Client built on Pixi/Vue in a Rust wrapper. The client has been rebuilt from the ground up to generate the same shapes back to FFB-Server (another ChristerK fork) and permit play on upstream FUMBBL.com and any FFB-Server fork that carries the same command shape.  This client is a personal project but could not have been built without the contributions of the giants who've come before us such as Christer, Candlejack, Garcangel, and the entire FFB crew. Nor could it have been completed without the assistance of the trusty TABBL crew: hype261, WillShoebox, UnderTheGlow, Torokokill. Neither should I forget to mention the contributions of folks like TheArtemisBlack, PurpleChest, and others, who've given feedback on the project.

## AI Notice:
This, however, is a project that was created with heavy use of AI. If you're ethically opposed to that (and there are good reasons to be) then this is likely not the project for you. One of our long-term goals is to replace the sprites with art created by real live humans, the way it ought to be, but the labor cost to do so was outside the realm of what I alone could contribute. The project in its current iteration is functional and works without any additional modifications, all skills and star player actions should work as expected.

## What's new?

### Skill icons, sprites, and more have all been added.
<img width="556" height="334" alt="image" src="https://github.com/user-attachments/assets/7471c053-6b67-4929-a2c2-6444af06469f" />

### On-pitch toasts and markings:
<img width="515" height="354" alt="image" src="https://github.com/user-attachments/assets/683f0427-e9ac-4fd8-a771-7f837a6401f5" />
<img width="345" height="310" alt="image" src="https://github.com/user-attachments/assets/4fd2d38a-b4dc-41c0-9ce4-105e8456e432" />

### Classic FUMBBL functionality for Skill Markings:
<img width="320" height="485" alt="image" src="https://github.com/user-attachments/assets/2bd63271-046e-4b44-bc8f-52b3236506f8" />


### An East-West mode to support the psychos who like that:
<img width="558" height="446" alt="image" src="https://github.com/user-attachments/assets/321e381b-dbb7-4be4-8cd6-5008309e5925" />



### Classic UI Functionality:
<img width="636" height="129" alt="image" src="https://github.com/user-attachments/assets/20af3f64-bb70-416d-b744-28beeb6c9c9e" />
<img width="638" height="183" alt="image" src="https://github.com/user-attachments/assets/6d90d81f-57b4-4916-87cb-cb972f7e296f" />




## How to install?:
Bundled release:
https://github.com/flutethecat/superfumbbl-client/releases/tag/v1.0.0

```bash
pnpm install
pnpm --filter @fumbbl40k/app build
```
Requires Node, pnpm and the Tauri v2 toolchain (Rust). `pnpm --filter @fumbbl40k/app dev` runs the desktop app in development.
-# NOTE: Some artifacts are missing from the self built installer as we do not have the license to distribute.

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

**Super FUMBBL original art — Super FUMBBL Media License.** Everything else (sprites, star players, crests, skill badges,
decorations, pitches, banners, block dice, the wordmark) is original Super FUMBBL art, produced with PixelLab, Claude Code, and OpenAI
Codex support. In addition, Gemini image models were used for the creation of some Super FUMBBL assets. All of these assets are licensed under the Modern FUMBBL Media License.(https://fumbbl.com/p/attribution): free to use, modify and distribute for non-commercial purposes, no selling
the assets or putting them on merchandise, credit Super FUMBBL with a link and indicate changes. The code itself for these and their integration is covered under the MIT license.
