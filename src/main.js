import './ui/style.css';
import { Game } from './game/Game.js';
import { INTRO_LINES } from './game/lore.js';

const bootEl = document.getElementById('boot');
const fill = document.getElementById('bootFill');
const status = document.getElementById('bootStatus');
const startBtn = document.getElementById('bootStart');

function progress(p, text) {
  fill.style.right = `${Math.max(0, (1 - p) * 100)}%`;
  if (text) status.textContent = text;
}

function fatal(msg, err) {
  status.innerHTML = `<span style="color:#ff6b5e">${msg}</span>`;
  if (err) console.error(err);
}

/*
 * 手机用户会在门口被礼貌劝退，而不是得到一个阉割版。
 *
 * 这款游戏把全部预算都花在一件事上：在独立 GPU 上满分辨率时看起来如何。
 * 一切让它值得一看的东西——光线步进大气、体量云层、地形自阴影、二十道后期链路——
 * 恰恰都是手机负担不起的。诚实的选择只有两种：为所有人砍掉这些特性，
 * 或者交付一个曲解这款游戏的手机版。两者都不值得，
 * 因此一台手持设备会收到一段简短而明确的讯息，而不是糟糕的第一印象。
 */
function isHandset() {
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const small = Math.min(window.screen.width, window.screen.height) < 820;
  return coarse && small;
}

function desktopOnly() {
  bootEl.innerHTML = `
    <div class="boot-inner">
      <h1 class="boot-title">漫长沉默</h1>
      <div class="boot-sub">深空勘测船 &middot; <span class="accent">苍白探寻者</span></div>
      <p class="boot-gate">
        这款游戏需要真正的屏幕和真正的 GPU。<br>
        请在台式机或笔记本电脑上打开。
      </p>
      <div class="boot-legal">需要 WebGL2 &middot; 建议佩戴耳机</div>
    </div>`;
  bootEl.classList.add('gate');
}

(async () => {
  const canvas = document.getElementById('scene');

  if (isHandset()) { desktopOnly(); return; }

  // WebGL2 gate
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) { fatal('此设备不支持 WebGL2'); return; }

  let game;
  try {
    game = new Game(canvas, progress);
    window.__game = game;
    await game.boot();
  } catch (e) {
    fatal('初始化失败——详见控制台', e);
    return;
  }

  status.textContent = '系统正常';
  startBtn.hidden = false;

  const begin = async () => {
    startBtn.hidden = true;
    bootEl.classList.add('out');
    setTimeout(() => bootEl.style.display = 'none', 1000);
    game.hud.show();
    game.started = true;
    try { await game.audio.resume(); } catch { /* autoplay policy */ }

    // opening beats
    INTRO_LINES.forEach((l, i) => {
      setTimeout(() => game.hud.narrate(l.text, l.who), 1200 + i * 5200);
    });
    setTimeout(() => {
      game.hud.log('扫描仪在线', 'ok');
      game.hud.log(`星系 · ${game.system.star.name.toUpperCase()}`);
    }, 900);
  };

  startBtn.addEventListener('click', begin);
  window.addEventListener('keydown', (e) => {
    if (!game.started && (e.code === 'Enter' || e.code === 'Space')) begin();
  });

  /* ---------------------------------------------------------------- 主循环
     ?record=N 以固定的 1/N 秒步进方式手动驱动循环，而非依据墙钟。录制远慢于
     实时，因此以自由循环为采样源的录制器会得到不均匀、抖动的运动；每张捕获图像
     推进一帧，意味着无论抓取耗时多久，素材都以精确的预期速度回放。 */
  const RECORD = +(new URLSearchParams(location.search).get('record') || 0);
  let last = performance.now();
  const MAX_DT = 1 / 15;

  function step(dt) {
    try {
      if (game.started) game.update(dt);
      else game.updateIdle?.(dt);
      game.engine.time = game.time;
      game.engine.dt = dt;
      // 舱内是带有自己相机的第二趟渲染；见 Engine.render
      game.engine.render(
        game.interiorRig && game.interiorRig.visible ? game.interiorScene : null,
        game.interiorCam);
      if (!RECORD) game.engine.adapt(dt);
    } catch (e) {
      console.error(e);
      fatal('运行时错误——详见控制台', e);
      throw e;
    }
  }

  function tick(now) {
    requestAnimationFrame(tick);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_DT) dt = MAX_DT;
    if (document.hidden) return;
    step(dt);
  }

  if (RECORD) {
    // 每次调用一帧，因此捕获工具能精确控制时间
    window.__step = (n = 1) => { for (let i = 0; i < n; i++) step(1 / RECORD); };
    step(1 / RECORD);
  } else {
    requestAnimationFrame(tick);
  }
})();
