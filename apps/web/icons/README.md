# App icons

`icon.svg` is the source. The PNGs in `../public` are rendered from it and committed, so the build needs no image tool:

| File                           | Size | Use                                                  |
| ------------------------------ | ---- | ---------------------------------------------------- |
| `pwa-192x192.png`              | 192  | Home screen and app list                             |
| `pwa-512x512.png`              | 512  | Splash screen                                        |
| `maskable-512x512.png`         | 512  | Android crops it to its own shape (circle, squircle) |
| `apple-touch-icon-180x180.png` | 180  | iOS home screen                                      |
| `favicon.svg`                  | any  | Browser tab (a copy of `icon.svg`)                   |

The drawing stays inside the safe circle of maskable icons: radius 40% of the size, from the center.

To render again after changing `icon.svg`, with sharp in a scratch folder outside the repo:

```js
for (const [name, size] of [
  ["pwa-192x192.png", 192],
  ["pwa-512x512.png", 512],
  ["maskable-512x512.png", 512],
  ["apple-touch-icon-180x180.png", 180],
]) {
  await sharp("icon.svg", { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`../public/${name}`);
}
```
