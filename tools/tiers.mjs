// 每个引擎实际挑选了哪个画质档位，它又渲染在什么分辨率？
//
// 它存在是因为档位曾由 navigator.deviceMemory 决定，而它只有 Chromium
// 实现——于是 Safari 在任何硬件上都悄悄运行更低的档位，在 2x 显示屏上
// 只有 1.5x。只在一种浏览器里出现的 Bug，需要一种在不止一种浏览器里
// 运行的检查。
//
//   node tools/tiers.mjs [url]
import { chromium, webkit } from 'playwright';

const URL = process.argv[2] || 'http://localhost:4173/';
const engines = [['chromium', chromium], ['webkit', webkit]];

for (const [name, launcher] of engines) {
  let b;
  try {
    b = await launcher.launch({ headless: true });
    const ctx = await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__game, { timeout: 120000 });
    await p.waitForTimeout(2500);
    const s = await p.evaluate(() => {
      const e = window.__game.engine;
      const gl = e.renderer.getContext();
      return {
        dm: navigator.deviceMemory, cores: navigator.hardwareConcurrency,
        dpr: window.devicePixelRatio, q: window.__game.quality,
        pr: e.pixelRatio, canvas: `${e.renderer.domElement.width}x${e.renderer.domElement.height}`,
        webgl2: gl instanceof WebGL2RenderingContext,
        samples: e.post.hdr?.samples,
      };
    });
    console.log(`${name.padEnd(9)} deviceMemory=${s.dm} cores=${s.cores} dpr=${s.dpr}`);
    console.log(`          quality=${s.q} pixelRatio=${s.pr} canvas=${s.canvas} msaa=${s.samples} webgl2=${s.webgl2}`);
    console.log(`          errors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}\n`);
  } catch (e) {
    console.log(`${name.padEnd(9)} FAILED: ${e.message.split('\n')[0]}\n`);
  } finally { await b?.close(); }
}
