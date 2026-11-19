// Genera los PNG de icons/ a partir de icons/logo.svg (requiere Playwright: `npm i -D playwright`).
// Uso: node tools/make_icons.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const svg = fs.readFileSync(path.join(__dirname, '../icons/logo.svg'), 'utf8');
// Versión "maskable": el dibujo se reduce al 78 % para quedar dentro de la zona segura
const maskable = svg.replace('<g id="art">', '<g id="art" transform="translate(256 256) scale(.78) translate(-256 -256)">');

const jobs = [
  ['icon-180.png', 180, svg], ['apple-touch-icon.png', 180, svg], ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg], ['icon-maskable-512.png', 512, maskable], ['logo-1024.png', 1024, svg]
];

(async () => {
  const browser = await chromium.launch();
  for (const [name, size, src] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
    await page.screenshot({ path: path.join(__dirname, '../icons', name), clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  await browser.close();
})();
