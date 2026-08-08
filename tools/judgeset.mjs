// 重建独立评审者观看的评审集。
//
// 巡检用于捕捉回归；这份则用于被*评审*。它运行相同的定式场景，然后加入
// 巡检无法在单次启动中编排的两个——站在行星上，以及同一行星在不同时刻——
// 并把一切复制进 shots/judge/，让评审者只有一个目录可读。
//
//   node tools/judgeset.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = 'shots/judge';

// Clear the survey directory, and do it *before* creating the output directory
// inside it. A shot the current system cannot stage does not overwrite its PNG,
// so anything left from an earlier run gets copied into the review set as if it
// were current — a frame of a different system, at a different revision,
// presented for judging beside the real ones.
console.log('— survey —');
fs.rmSync('shots', { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execFileSync('node', ['tools/survey.mjs', '--w', '1600', '--h', '900'], { stdio: 'inherit' });

const FROM_SURVEY = [
  'a-spawn', 'b-terran', 'c-terran-crescent', 'x-orbit', 'd-gas', 'i-rings',
  'e-barren', 'f-ice', 'g-hot', 'h-dry', 'j-star', 'k-ship', 'u-shipclose',
  'v-station', 'm-derelict', 'l-resonator', 'w-traffic', 't-belt', 'q-jump', 'p-fold',
];
for (const n of FROM_SURVEY) {
  const src = `shots/${n}.png`;
  if (fs.existsSync(src)) fs.copyFileSync(src, `${OUT}/${n}.png`);
}

// Landing has to be shot separately: it swaps the whole scene, so the survey
// cannot follow it with anything else from the same boot.
const LANDINGS = [
  ['y-landed', `g.pose({kind:'terran', dist:1.6, phase:70, elev:8}); g.land(g.target, {now:true}); g.director.stop();`],
  // Dusk, not midnight. The sun climbs at 0.012 rad/s, so t=260 is 180 degrees
  // of rotation — a full night. Search for the moment it sits just above the
  // horizon instead of guessing a number.
  ['z-landed-dusk', `g.pose({kind:'terran', dist:1.6, phase:70, elev:8}); g.land(g.target, {now:true}); g.director.stop();
     for(let t=0;t<520;t+=2){ g.landed.t=t; g.updateSurface(0.001);
       const y = g.surface.skyMat.uniforms.uSunDir.value.y; if(y < 0.10 && y > 0.03) break; }`],
];
console.log('— landings —');
for (const [name, js] of LANDINGS) {
  execFileSync('node', ['tools/probe.mjs',
    `(()=>{g.mode='exterior'; ${js} g.setLayer('hud',false); return null;})()`,
    '--shot', `${OUT}/${name}.png`, '--settle', '3200', '--w', '1600', '--h', '900'],
  { stdio: 'inherit' });
}

console.log('\n— tone —');
execFileSync('node', ['tools/levels.mjs', ...fs.readdirSync(OUT).map((f) => `${OUT}/${f}`)],
  { stdio: 'inherit' });
console.log(`\n${fs.readdirSync(OUT).length} frames in ${OUT}`);
