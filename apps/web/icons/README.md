# App icons

Two sources, rendered to the files in `../public`, which are committed so the build needs no image tool:

| Source         | Files                                                                                        | Drawing         |
| -------------- | -------------------------------------------------------------------------------------------- | --------------- |
| `app-icon.svg` | `pwa-192x192.png`, `pwa-512x512.png`, `maskable-512x512.png`, `apple-touch-icon-180x180.png` | 70% of the size |
| `favicon.svg`  | `favicon.svg` (a copy), for the browser tab                                                  | full size       |

**Every app icon has room around the drawing**, because launchers crop icons to their own shape:

- Android shows only the central circle of an adaptive (maskable) icon: 66 of 108 dp, about 61% of the size. Some launchers zoom in further. The W3C safe zone (80%) is not enough.
- A browser that makes a shortcut instead of an installed app (Brave, on Android) uses the `any` icon, and the launcher crops that one too.

At full size, the roof and the P were cut on a real phone in both cases. At 70%, the drawing stays inside a circle of radius 156 px (of 512) with room to spare. The tab icon is tiny and never cropped, so it keeps the full size.

To render again after changing `app-icon.svg`, with sharp in a scratch folder outside the repo:

```js
for (const [name, size] of [
  ["pwa-192x192.png", 192],
  ["pwa-512x512.png", 512],
  ["maskable-512x512.png", 512],
  ["apple-touch-icon-180x180.png", 180],
]) {
  await sharp("app-icon.svg", { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`../public/${name}`);
}
```
