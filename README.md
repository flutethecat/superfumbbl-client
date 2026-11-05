<img width="725" height="248" alt="image" src="https://github.com/user-attachments/assets/0f6bf103-9d54-486f-a122-ec70cf60fb7a" />

# Client
This is a fork of [Christerk/FFBClient](https://github.com/christerk/ffbclient) built on Pixi/Vue in a Rust wrapper. The client has been rebuilt from the ground up to generate the same shapes back to FFB-Server (another ChristerK fork) and permit play on upstream FUMBBL.com and any FFB-Server fork that carries the same command shape.  This client is a personal project but could not have been built without the contributions of the giants who've come before us such as Christer, Candlejack, Garcangel, and the entire FFB crew. This was made as a separate side project and they were not directly involved with it. It also could not have been completed without the assistance of the trusty TABBL crew: hype261, WillShoebox, UnderTheGlow, Torokokill. Neither should I forget to mention the contributions of folks like TheArtemisBlack, PurpleChest, Warpstone, and MrCushtie and others, who've given feedback, time, and play tested for me.

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
We recommend the bundled release below for most users. It contains all assets and is configured to function as designed. We also offer self build routes for those who would like to do so, however not all assets are contained within as we do not have the rights to include them as individual files where they may be redistributed.

Bundled release:
https://github.com/flutethecat/superfumbbl-client/releases/latest

Windows: run the `_Windows_x64-setup.exe`. macOS: open the `.dmg` for your chip (`aarch64` = Apple Silicon, `x64` = Intel).

### macOS: "Super FUMBBL is damaged" or "cannot be opened"

The macOS build is not notarized by Apple yet, so macOS blocks it the first time. After dragging Super FUMBBL into Applications, open Terminal and run:

```bash
xattr -dr com.apple.quarantine "/Applications/Super FUMBBL.app"
```

Then open Super FUMBBL as normal. You only need to do this once per installer; in-app updates keep working afterwards. If you put the app somewhere other than Applications, use that path instead.

## Linux and Steam Deck (SteamOS)

Every release carries two Linux downloads for each of amd64 and arm64:

- `SuperFUMBBL_<version>_Linux_<arch>.AppImage` — runs on any distribution with no install, and is the one to use on a Steam Deck. It bundles its own WebKit and GTK, so it does not depend on your system packages.
- `SuperFUMBBL_<version>_Linux_<arch>.deb` — for Debian 12+ and Ubuntu 22.04+ (and derivatives). It needs `libwebkit2gtk-4.1-0` and `libgtk-3-0`, which apt pulls in.

A Steam Deck is amd64. Raspberry Pi 4/5 and other ARM boards are arm64.

### Steam Deck / SteamOS

SteamOS is Arch-based with a read-only system partition, so the `.deb` does not apply. Use the AppImage:

1. Switch to Desktop Mode (Steam button > Power > Switch to Desktop).
2. In the browser, open https://github.com/flutethecat/superfumbbl-client/releases/latest and download `SuperFUMBBL_<version>_Linux_amd64.AppImage`. Keep it in your home folder, e.g. `~/Applications`.
3. Make it executable: in Dolphin, right-click the file > Properties > Permissions > tick "Is executable". Or in Konsole:
   ```bash
   chmod +x ~/Applications/SuperFUMBBL_*_Linux_amd64.AppImage
   ```
4. Double-click it to run. The first launch downloads the art pack (about 180 MB) and runs the setup wizard.
5. Optional, to launch from Gaming Mode: in Steam, Games > Add a Non-Steam Game to My Library > Browse, pick the AppImage, then set its controller layout to a mouse template (the client is mouse-driven; the right trackpad works well as the pointer).
6. Updates: the client checks on launch and hourly. In-app patches install on their own; when a new shell is released the client offers it and replaces the AppImage in place, so leave the file where it is.

If the AppImage does not start, run it from Konsole with the extract flag (needed on systems without FUSE):

```bash
~/Applications/SuperFUMBBL_*_Linux_amd64.AppImage --appimage-extract-and-run
```

### Debian / Ubuntu

```bash
sudo apt install ./SuperFUMBBL_<version>_Linux_amd64.deb
```

Launch "Super FUMBBL" from the application menu. In-app patches install on their own; for a new shell release, download the newer `.deb` and install it the same way.

### Other distributions (Arch, Fedora, openSUSE, …)

Use the AppImage with the Steam Deck steps above from step 2.

### Troubleshooting: freezes, a blank window or graphics glitches

On Linux the client draws through WebKitGTK. On some combinations of graphics driver and desktop, most often NVIDIA on a Wayland session, WebKitGTK and the driver disagree. The client can then freeze (often once a game or a spectated game is on screen), show a blank or white window, or flicker. Messages in the terminal such as `GLib-GObject-CRITICAL` or `Error 71 (Protocol error)` usually come from this layer.

Try these one at a time, launching from a terminal so you can see the result. Replace the path with wherever your AppImage lives.

1. Turn off WebKit's DMA-BUF renderer. This fixes most freezes and blank windows, at a small cost in drawing speed:
   ```bash
   WEBKIT_DISABLE_DMABUF_RENDERER=1 ~/Applications/SuperFUMBBL_*_Linux_amd64.AppImage
   ```
2. NVIDIA on Wayland only: turn off explicit sync instead:
   ```bash
   __NV_DISABLE_EXPLICIT_SYNC=1 ~/Applications/SuperFUMBBL_*_Linux_amd64.AppImage
   ```
3. Last resort, if neither helps: turn off accelerated compositing. Drawing is slower with this one:
   ```bash
   WEBKIT_DISABLE_COMPOSITING_MODE=1 ~/Applications/SuperFUMBBL_*_Linux_amd64.AppImage
   ```

When one of them works, make it permanent. For a menu entry, edit its `.desktop` file (copy it to `~/.local/share/applications/` first) and put `env WEBKIT_DISABLE_DMABUF_RENDERER=1` (or the variable that worked) at the start of the `Exec=` line. For a Steam shortcut, put `WEBKIT_DISABLE_DMABUF_RENDERER=1 %command%` in its Launch Options.

If none of them helps, send a report with the Report button in the client (it attaches the client's logs), and include:
- your GPU and driver version, and the output of `echo $XDG_SESSION_TYPE`;
- whether it happens in your own games, when spectating, in replays, or everywhere;
- what the terminal printed when it froze.

The AppImage bundles its own WebKit, so your system's WebKitGTK version only matters for the `.deb`.

### Troubleshooting: black first-open intro

If the intro video stays black, it gives up by itself after a few seconds, and Esc, Enter, Space or a click skips it. To skip it from the start, launch with `--skip-intro` or set `SUPER_FUMBBL_SKIP_INTRO=1` (installer 1.0.206 or later).


```bash
pnpm install
pnpm --filter @fumbbl40k/app build
```
Requires Node, pnpm and the Tauri v2 toolchain (Rust). `pnpm --filter @fumbbl40k/app dev` runs the desktop app in development.

## Licenses

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
the assets or putting them on merchandise, credit FUMBBL with a link and indicate changes. Please also include contribution notes for the Super FUMBBL team. While this is not a requirement under the MFML, it is an ask. The code itself for these and their integration is covered under the MIT license.

## Licences

**Code:** MIT — see `LICENSE`. Upstream FFB client/server by Christer Kaivo-oja, also MIT.

**Third-party assets** (full records in `docs/licenses/`, `ATTRIBUTION.md` and the in-app Credits pane):

- **CC0 1.0** — referee whistle by SpliceSound, "Drifting into Dreamland" by Breviceps, "Videogame Menu Button Click"
  by Christopherderp (all freesound.org). No attribution required; credited anyway. Ship in the installer.
- **CC BY 4.0** — "Boxing Bell 1" by Benboncan, "Dramatic Organ A" by InspectorJ, "Chainsaw" by ItsTheGoodstuff
  (freesound.org). Ship in the installer.
- **SIL Open Font License 1.1** — Nuffle by Neale Davidson (Pixel Sagas) and Graduate by Eduardo Tunni (used
  unmodified); each licence text ships beside its font.
- **Flaticon licence (attribution)** — American football helmet icon by justicon.
- **Licensed purchases, use in the product only** — SakPix "Football Championship Megapack" (stadium props, in this
  tree as derivative crops); Acasas / unTied pitch textures via GameDev Market; The Sound Guild, Gamemaster Audio and
  Khron Studio sound libraries; "Retro SFX" by Andrea Baroni (Cyberleaf Studio), used unmodified. The textures and
  library-derived sounds ship in the installer only.
- **FUMBBL logo** — used under FUMBBL's branding guidelines.
- **KrisB block dice faces** — © Kristofer Bengtsson (KrisB), used with permission; not under the Super FUMBBL Media
  License (`packages/ffb-pitch/assets/blockdice-krisb/`, `apps/tauri/src/assets/blockdice-log-krisb/`).
- **FUMBBL block dice** — by WhatBall, used with permission (credit required); not under the Super FUMBBL Media
  License (`packages/ffb-pitch/assets/blockdice-fumbbl/`, `apps/tauri/src/assets/blockdice-log-fumbbl/`).

**Super FUMBBL original art — Super FUMBBL Media License.** Everything else (sprites, star players, crests, skill badges,
decorations, pitches, banners, the default block dice, the wordmark) is original Super FUMBBL art, produced with PixelLab and the OpenAI,
Codex and Gemini image models from Super FUMBBL prompts. It is licensed under the Super FUMBBL Media License
(`docs/licenses/super-fumbbl-media-license.md`): free to use, modify and distribute for non-commercial purposes, no selling
the assets or putting them on merchandise, credit Super FUMBBL with a link and indicate changes. The code is MIT.
