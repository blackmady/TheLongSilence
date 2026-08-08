/* 落地场景的钉住墙钟，取吊臂轨道的 worst 姿态。
 *
 * “落地场景以 N fps 运行”本身毫无意义：帧在轨道上从 18.2 摆动到 13.2 ms，
 * 而 `landed.t` 同时驱动太阳与相机，因此未钉住的运行每次测量的是不同姿态。
 * 本脚本在每个停点钉住时钟走完轨道，在 ~1.1 s 窗口内采样 rAF 间隔，
 * 取窗口内中位数与十个窗口的最小值，并引用最差的停点。
 *
 * Dynamic resolution is pinned and `adapt` stubbed, vsync is off, and the
 * comparison is only meaningful against another run on the same machine at the
 * same load — check `ps` first and say so.
 *
 *   node tools/gndperf.mjs [--dpr 2 --w 1512 --h 945] [--stops 8] [--trials 8]
 */
import { chromium } from 'playwright';
import { bootGame } from './boot.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? +args[i + 1] : d; };
const W = opt('w', 1512), H = opt('h', 945), DPR = opt('dpr', 2);
const STOPS = opt('stops', 8), TRIALS = opt('trials', 8);
const KIND = (args.indexOf('--kind') >= 0 ? args[args.indexOf('--kind') + 1] : 'terran');

const browser = await chromium.launch({
  headless: false,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await bootGame(page);
await page.waitForTimeout(4000);

const setup = async () => {
  await bootGame(page, { settle: 2500 });
  await page.evaluate(SETUP);
  await page.waitForTimeout(2500);
};
const SETUP = `(()=>{ const g = window.__game;
  g.director.stop(); g.inspect({off:true}); if (g.landed) g.liftOff({now:true});
  g.mode='exterior';
  g.pose({kind:${JSON.stringify(KIND)}, dist:1.6, phase:70, elev:8});
  g.land(g.target, {now:true}); g.director.stop();
  // Pin the render scale: a dynamic one turns a slow frame into a small one and
  // the number stops meaning anything.
  const e = g.engine;
  e.prFloor = e.prCeil = e.maxPixelRatio = ${DPR};
  e.adapt = () => {};
  return 1; })()`;
await page.evaluate(SETUP);
await page.waitForTimeout(3000);

const sample = async () => page.evaluate(() => new Promise((res) => {
  const t = []; let last = performance.now();
  const step = () => {
    const n = performance.now(); t.push(n - last); last = n;
    if (n - t0 < 1100) requestAnimationFrame(step);
    else { t.sort((a, b) => a - b); res(t[t.length >> 1]); }
  };
  const t0 = performance.now();
  requestAnimationFrame(step);
}));

console.log(`${W}x${H} @${DPR}x = ${((W * DPR * H * DPR) / 1e6).toFixed(2)} MP, `
  + `${STOPS} stops x ${TRIALS} trials, vsync off`);
let worst = { ms: 0, stop: -1 };
for (let i = 0; i < STOPS; i++) {
  // Walk the crane orbit by setting the clock, then hold it so the sun and the
  // camera cannot drift between trials.
  let info;
  try { info = await page.evaluate(`(()=>{ const g = window.__game;
    try { delete g.landed.t; } catch(e){}
    g.landed.t = ${i} * 42.0;
    g.updateSurface(0.001);
    const T = g.landed.t;
    Object.defineProperty(g.landed, 't', { get:()=>T, set:()=>{}, configurable:true });
    return { sunY:+g.surface.skyMat.uniforms.uSunDir.value.y.toFixed(4) }; })()`); }
  catch (e) { await setup(); i--; continue; }
  await page.waitForTimeout(900);
  let best = 1e9;
  // Another agent editing src/ throws away the JS context mid-window. Re-set up
  // and carry on rather than losing the sweep.
  for (let k = 0; k < TRIALS; k++) {
    try { best = Math.min(best, await sample()); }
    catch (e) { await setup(); k--; }
  }
  const st = await page.evaluate(() => ({ calls: window.__game.engine.drawCalls }));
  console.log(`  stop ${i}  sunY=${String(info.sunY).padStart(7)}  `
    + `${best.toFixed(2)} ms  (${(1000 / best).toFixed(0)} fps)  ${st.calls} draws`);
  if (best > worst.ms) worst = { ms: best, stop: i, sunY: info.sunY };
}
console.log(`\nWORST POSE: stop ${worst.stop}, sunY ${worst.sunY} — `
  + `${worst.ms.toFixed(2)} ms (${(1000 / worst.ms).toFixed(0)} fps)`);
await browser.close();
