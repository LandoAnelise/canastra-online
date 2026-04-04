// Gera ícones e splash screens PWA a partir do SVG
// Uso: node scripts/generate-icons.js
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const SRC   = path.join(__dirname, '../public/icons/icon.svg');
const DEST  = path.join(__dirname, '../public/icons');

const icons = [
  // Apple touch icons
  { file: 'apple-touch-icon.png',        size: 180 },
  { file: 'icon-192.png',                size: 192 },
  { file: 'icon-512.png',                size: 512 },
  { file: 'favicon-32.png',              size: 32  },
  { file: 'favicon-16.png',              size: 16  },
];

// Splash screens iOS (portrait) — fundo feltro + ícone centralizado
const splashes = [
  { file: 'splash-2048x2732.png', w: 2048, h: 2732 }, // 12.9" iPad Pro
  { file: 'splash-1668x2388.png', w: 1668, h: 2388 }, // 11" iPad Pro
  { file: 'splash-1290x2796.png', w: 1290, h: 2796 }, // iPhone 14 Pro Max
  { file: 'splash-1179x2556.png', w: 1179, h: 2556 }, // iPhone 14 Pro
  { file: 'splash-1170x2532.png', w: 1170, h: 2532 }, // iPhone 14
  { file: 'splash-750x1334.png',  w: 750,  h: 1334 }, // iPhone SE
];

const BG = '#114d28'; // feltro escuro

async function run() {
  fs.mkdirSync(DEST, { recursive: true });

  // Ícones simples
  for (const { file, size } of icons) {
    await sharp(SRC)
      .resize(size, size)
      .png()
      .toFile(path.join(DEST, file));
    console.log(`✓ ${file}`);
  }

  // Splash screens: fundo colorido + ícone centralizado
  const iconSize = 256;
  const iconBuf  = await sharp(SRC).resize(iconSize, iconSize).png().toBuffer();

  for (const { file, w, h } of splashes) {
    const left = Math.round((w - iconSize) / 2);
    const top  = Math.round((h - iconSize) / 2);

    await sharp({ create: { width: w, height: h, channels: 4,
                             background: { r: 17, g: 77, b: 40, alpha: 1 } } })
      .composite([{ input: iconBuf, left, top }])
      .png()
      .toFile(path.join(DEST, file));
    console.log(`✓ ${file}`);
  }

  console.log('\nTodos os ícones gerados em public/icons/');
}

run().catch(err => { console.error(err); process.exit(1); });
