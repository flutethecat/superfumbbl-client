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

Licence: the SakPix profile (https://sakpix.itch.io/, read 2026-09-05) states "All of my asset packs are free for
commercial use once purchased, with no additional restrictions!" The pack page adds "Commercial Use Friendly" and
declares "AI Disclosure: AI Assisted, Graphics". No licence file ships in the pack; attribution not required.

Owner ruling 2026-09-05: no restrictions once purchased, so the derived files may ship in the public source tree.
`stadium/` is OFF `public-export.exclude`. Tier D (licensed, redistributable).
