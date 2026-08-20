/**
 * Rasterises public/icon.svg into the PNG sizes a PWA install needs.
 * Run with `npm run icons` after changing the artwork.
 */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url));

const targets = [
  { file: 'pwa-192.png', size: 192 },
  { file: 'pwa-512.png', size: 512 },
  // Maskable icons need padding so Android's circle crop does not clip the art.
  { file: 'pwa-maskable-512.png', size: 512, pad: 0.12 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
];

for (const target of targets) {
  const inner = Math.round(target.size * (1 - (target.pad ?? 0) * 2));
  const margin = Math.round((target.size - inner) / 2);
  const image = sharp(svg, { density: 512 }).resize(inner, inner);
  const buffer = target.pad
    ? await sharp({
        create: {
          width: target.size,
          height: target.size,
          channels: 4,
          background: '#16553e',
        },
      })
        .composite([{ input: await image.png().toBuffer(), top: margin, left: margin }])
        .png()
        .toBuffer()
    : await image.png().toBuffer();
  await writeFile(new URL(`../public/${target.file}`, import.meta.url), buffer);
  console.log(`wrote public/${target.file}`);
}
