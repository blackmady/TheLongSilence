// 一组画面的客观色调测量。
//
// “看起来平”不是可执行的反馈；“0.00% 的像素溢出、99 百分位是 123”才是。
// 本脚本按镜头报告：均值、1/50/99 百分位、达到显示白光的像素比例、
// 以及被压到纯黑的像素比例——这两个数字决定一张图像
// has range or sits in a fog band.
//
//   node tools/levels.mjs shots/judge/*.png
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2).filter((f) => !f.startsWith('--'));
if (!files.length) { console.error('usage: node tools/levels.mjs <png...>'); process.exit(1); }

const TMP = '/tmp/_levels.rgb';
console.log('shot                    mean    p1   p50   p99   clip%   black%');
let sumClip = 0, sumBlack = 0, sumP99 = 0;

for (const f of files) {
  // decode to raw 8-bit grey at a reduced size; the statistics are unchanged
  // and a full-res decode of twenty 1600x900 frames is pointlessly slow
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f,
    '-vf', 'scale=400:225,format=gray', '-f', 'rawvideo', TMP]);
  const buf = fs.readFileSync(TMP);
  const hist = new Uint32Array(256);
  for (let i = 0; i < buf.length; i++) hist[buf[i]]++;
  const n = buf.length;

  let acc = 0, mean = 0;
  const pct = (p) => {
    let c = 0;
    for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= n * p) return v; }
    return 255;
  };
  for (let v = 0; v < 256; v++) mean += v * hist[v];
  mean /= n;
  let clip = 0; for (let v = 250; v < 256; v++) clip += hist[v];
  let black = 0; for (let v = 0; v < 8; v++) black += hist[v];

  const p99 = pct(0.99);
  sumClip += clip / n; sumBlack += black / n; sumP99 += p99;
  console.log(
    `${path.basename(f, '.png').padEnd(20)} ${mean.toFixed(1).padStart(6)}`
    + ` ${String(pct(0.01)).padStart(5)} ${String(pct(0.5)).padStart(5)} ${String(p99).padStart(5)}`
    + ` ${(100 * clip / n).toFixed(3).padStart(7)} ${(100 * black / n).toFixed(1).padStart(8)}`);
}
const k = files.length;
console.log('-'.repeat(64));
console.log(`${'AVERAGE'.padEnd(20)} ${' '.repeat(6)} ${' '.repeat(5)} ${' '.repeat(5)}`
  + ` ${(sumP99 / k).toFixed(0).padStart(5)} ${(100 * sumClip / k).toFixed(3).padStart(7)}`
  + ` ${(100 * sumBlack / k).toFixed(1).padStart(8)}`);
fs.rmSync(TMP, { force: true });
