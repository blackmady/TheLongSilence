// 把图标 SVG 渲染成平台实际要求的 PNG 尺寸。
//
// 主屏图标会被操作系统裁剪，因此它们获得满出血的方形背景，而非浏览器标签
// 所用的圆角矩形——OS 裁剪框内的圆角图标最终会带上一圈可见的深色边框。
//
//   node tools/icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const svg = fs.readFileSync('public/favicon.svg', 'utf8');
const square = svg.replace('rx="14"', 'rx="0"');

const TARGETS = [
  { file: 'public/favicon-96.png', size: 96, src: svg },
  { file: 'public/apple-touch-icon.png', size: 180, src: square },
  { file: 'public/icon-192.png', size: 192, src: square },
  { file: 'public/icon-512.png', size: 512, src: square },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const t of TARGETS) {
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}
      svg{display:block;width:${t.size}px;height:${t.size}px}</style>${t.src}`;
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: t.file, omitBackground: true });
  console.log(`${t.file.padEnd(30)} ${t.size}x${t.size}  ${fs.statSync(t.file).size} B`);
}
await browser.close();
