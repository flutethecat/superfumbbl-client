# Pitch texture licences (`packages/ffb-pitch/assets/textures/`)

Source: GameDev Market order GDM-20260702-61654 (2 Jul 2026; bundles: 2D Starter, Audio Starter, Fantasy RPG Asset Bundle).
Invoice held privately by the owner (asset-purchase-records/, outside every repo). Hash-matched to the pack files 2026-09-05.

| repo file | pack | artist | pack file |
| --- | --- | --- | --- |
| grass.png | 50 Pixel Art Textures | Anibal Casas (Acasas) | PNG/grass 1.png |
| stone.png | 50 Pixel Art Textures | Anibal Casas (Acasas) | PNG/rocks 1.png |
| grass_a.png | 16x16 Pixel Art Collection | Anibal Casas (Acasas) | PNG/grass 01.png |
| grass_b.png | 16x16 Pixel Art Collection | Anibal Casas (Acasas) | PNG/grass 02.png |
| grass2_a.png | World Map - Pixel Art | Will (unTied Games) | pieces/terrain/grass_center_A_f2.png |
| grass2_b.png | World Map - Pixel Art | Will (unTied Games) | pieces/terrain/grass_center_A_f3.png |

Licence: GameDev Market Marketplace Terms, Licence (A), purchases after 15 Jan 2019
(https://gamedevmarket.net/terms-conditions/#pro-licence). Neither pack ships its own licence file.

- 4.1: non-exclusive perpetual licence to create derivative works and use them in monetized or non-monetized
  media products, unlimited projects, distributable for any fee.
- 4.2(b): may not share, give away or redistribute the asset or derivatives "other than as part of the relevant
  Media Product". 4.2(c): may not let users extract them for use outside the product.
- Attribution: not required. unTied asks for a shout-out (@untiedgames); Acasas asks nothing.

Consequence: shipping these inside a built client is licensed use. Publishing the raw PNGs in the public source
tree is redistribution outside the media product, so `textures/` stays on `public-export.exclude`. The public
fork gets no default turf from this folder; `default-weather/` (Codex-generated, Tier D) is the shipped default.

## Addendum 2026-09-05 — `packages/ffb-pitch/assets/acasas-weather/` (derivative family)

Five 782x452 weather pitches built from `grass.png` (Acasas, 50 Pixel Art Textures): `nice.png` is the tile
quilted directly (min-cut seams, one-square mow bands); `sunny`/`rain`/`heat`/`blizzard` were generated with
PixelLab using the tile as subject + style reference, then quilted the same way. Derivative works are licensed
(4.1) but carry the same no-redistribution clause (4.2b), so the folder is on `public-export.exclude` and ships
only inside the installer. The renderer globs the folder and offers "Acasas - Weather pack" only when present.
Build script: sprite repo `pitch/build_acasas.py`; owner picks nice = direct quilt, sunny 1, rain 1, heat 2, blizzard 1.

## Addendum 2026-09-07 — `packages/ffb-pitch/assets/acasas-weather-fx/` (strong variant, same derivative family)

Second installer-only family, "Acasas - Weather pack (strong)": `nice`/`rain` identical to `acasas-weather/`;
`sunny` (tile mapped onto the sunny yellow palette, PixelLab dry patches), `heat` (PixelLab cracked earth) and
`blizzard` (PixelLab snow drifts) generated against the Acasas-derived tiles and quilted whole-pitch. Same Licence A
position (derivative, 4.2b no redistribution), so the folder is on `public-export.exclude`. Sprite repo builders:
`pitch/build_acasas_sunny.py`, `pitch/build_acasas_fx_pl.py`; owner picks sunny ypl0, heat pl0, blizzard pl2.
