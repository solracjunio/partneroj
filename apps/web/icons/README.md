# App icons

`icon.svg` and `maskable.svg` are the sources. The PNGs in `../public` are rendered from them and committed, so the build needs no image tool:

| File                           | Size | Use                                                    |
| ------------------------------ | ---- | ------------------------------------------------------ |
| `pwa-192x192.png`              | 192  | Home screen and app list                               |
| `pwa-512x512.png`              | 512  | Splash screen                                          |
| `maskable-512x512.png`         | 512  | From `maskable.svg`: Android crops it to its own shape |
| `apple-touch-icon-180x180.png` | 180  | iOS home screen                                        |
| `favicon.svg`                  | any  | Browser tab (a copy of `icon.svg`)                     |

**The maskable icon has its own source.** Android shows only the central circle of an adaptive icon (66 of 108 dp, about 61% of the size), and some launchers zoom in further. The W3C safe zone (80%) is not enough: at that size the roof and the P were cut on a real phone. `maskable.svg` is the same drawing at 70% around the center, which keeps it inside a circle of radius 156 px (of 512) with room to spare.

To render again after changing `icon.svg`, with sharp in a scratch folder outside the repo:

```js
for (const [source, name, size] of [
  ["icon.svg", "pwa-192x192.png", 192],
  ["icon.svg", "pwa-512x512.png", 512],
  ["maskable.svg", "maskable-512x512.png", 512],
  ["icon.svg", "apple-touch-icon-180x180.png", 180],
]) {
  await sharp(source, { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`../public/${name}`);
}
```
