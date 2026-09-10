# Super FUMBBL client
This is a fork of Christerk/FFB-Client built on Pixi/Vue in a Rust wrapper. The client has been rebuilt from the ground up to generate the same shapes back to FFB-Server (another ChristerK fork) and permit play on upstream FUMBBL.com and any FFB-Server fork that carries the same command shape.  This client is a personal project but could not have been built without the contributions of the giants who've come before us such as Christer, Candlejack, Garcangel, and the entire FFB crew. Nor could it have been completed without the assistance of the trusty TABBL crew: hype261, WillShoebox, UnderTheGlow, Torokokill. Neither should I forget to mention the contributions of folks like TheArtemisBlack, PurpleChest, and others, who've given feedback on the project.

## AI Notice:
This, however, is a project that was created with heavy use of AI. If you're ethically opposed to that (and there are good reasons to be) then this is likely not the project for you. One of our long-term goals is to replace the art with art created by real live humans, the way it ought to be, but the labor cost to do so was outside the realm of what I alone could contribute. I'll leave this up to the community to complete. The project in its current iteration is functional and works without any additional modifications. Should you want to modify the project though then please do so.

## What's new?

### Skill icons, sprites, and more have all been added.
<img width="556" height="334" alt="image" src="https://github.com/user-attachments/assets/7471c053-6b67-4929-a2c2-6444af06469f" />

### On-pitch toasts and markings:
<img width="515" height="354" alt="image" src="https://github.com/user-attachments/assets/683f0427-e9ac-4fd8-a771-7f837a6401f5" />
<img width="345" height="310" alt="image" src="https://github.com/user-attachments/assets/4fd2d38a-b4dc-41c0-9ce4-105e8456e432" />

### Classic FUMBBL functionality for Skill Markings:
<img width="537" height="419" alt="image" src="https://github.com/user-attachments/assets/a6029232-b45f-4174-8e5f-396f88a5eb19" />

### An East-West mode to support the psychos who like that:
<img width="738" height="418" alt="image" src="https://github.com/user-attachments/assets/42bdf896-f9f0-45ff-b33c-48f2d4fc6b0c" />


## If you want to build it yourself:
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
