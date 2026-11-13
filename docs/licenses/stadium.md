# Stadium asset licence (`packages/ffb-pitch/assets/stadium/`)

Source pack: "Football Championship Megapack - Top-Down Pixel Art Sports Collection" by SakPix, itch.io
(https://sakpix.itch.io/football-championship-megapack-top-down-pixel-art-sports-collection). Purchase confirmed by the owner
2026-09-05 in their itch.io purchases (bought 2 Jul 2026).

Identified 2026-09-05 from the NTFS Zone.Identifier stream on every extracted sheet in `Sprites/Stadium/`
(ReferrerUrl = the pack zip). The 20 numbered sheets match the pack's 20 categories one-for-one.

| repo file | pack sheet |
| --- | --- |
| camera.png | 17. Broadcast Equipment.png — one cell (196x197) cropped 09-10; the full sheet no longer ships |
| light_tower.png | 16. Stadium Lights.png — one cell (153x361) cropped 09-10; the full sheet no longer ships |
| bunting_*, corner_flag_*, crowd_1-4, fan_*, stand_* (18) | crops/recolours from 5. Corner Flags, 10. Stadium Seating Modules, 15. Team Decorations, 19. Crowd Decorations (derivatives, no byte match) |
| seat_single_{blue,red,yellow,green}.png, stand_wall_stone.png, stand_stairs.png | 10. Stadium Seating Modules.png - single-seat cells, one stone wall strip and one stair strip, cropped unchanged 2026-11-06 (3D seat trial; 2D baked stadium 2026-11-12) |
| bench_shelter_{blue,red}.png | 6. Team Benches.png - the first blue and red covered bench shelters, cropped unchanged 2026-11-06 (3D seat trial; 2D baked stadium 2026-11-12) |

Licence: the SakPix profile (https://sakpix.itch.io/, read 2026-09-05) states "All of my asset packs are free for
commercial use once purchased, with no additional restrictions!" The pack page adds "Commercial Use Friendly" and
declares "AI Disclosure: AI Assisted, Graphics". No licence file ships in the pack; attribution not required.

Owner ruling 2026-09-05: no restrictions once purchased, so the derived files may ship in the public source tree.
`stadium/` is OFF `public-export.exclude`. Tier D (licensed, redistributable).

## 3D stadium model (`packages/ffb-pitch/assets/stadium3d/`)

`stadium1.registered-26x15.glb` (sha256 06fed89e...014d) is the owner's Free3D purchase "Stadium Low-Poly"
(https://free3d.com/3d-model/stadium-low-poly-2026.html, invoice #F3D0203894, 2026-08-29, USD 5, Free3D Royalty Free
License), registered to the 26 x 15 pitch on 2026-08-29. `stadium-pack.json` carries its registration, the Modern 3D fit
and the hidden field meshes. The licence restricts distribution in open formats (the .glb is one); the owner cleared
public builds anyway: 2026-11-06 (Modern 3D) and 2026-11-09 (the 2D client's baked backdrop, "ship the .glb"). Record
and invoice: `asset-purchase-records/free3d-stadium-low-poly-2026.txt` in the owner's workspace.

Owner ruling 2026-11-12: the model is NOT distributed in the public source export. The .glb is on
`public-export.exclude` (installer-only, like `textures/`); installer builds from the private tree bundle it. A source
tree without it builds and runs: the "3D stadium" choice stays selectable and the client keeps the classic 2D stands.
The seat, stair, wall, shelter and crowd art above are SakPix crops (Tier D, public-OK); the cobble is the owner-original PixelLab tile in
`assets/ground/`.
