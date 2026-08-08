import * as THREE from 'three';

/* ============================================================================
   屏幕空间图层。

   过去住在这里的几乎所有东西，如今都住到了仪表盘上——存在于世界之中，
   飞行员真正会去读它的地方。剩下的是那些不是物理对象的东西：你在看什么、
   你刚刚被告知什么、以及你能触碰到什么。

   指引是最后一个顽固分子。它曾是一张悬浮在座舱盖横梁上的居中卡片——
   一个遮挡着它本该安装在其后的结构的覆盖层——如今它变成了遮光板上的一条
   指示条，结构反而能遮挡它。这里不该有任何东西成为仪表。
   ========================================================================== */

const _v = new THREE.Vector3();

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.el = {
      reticle: document.getElementById('reticle'),
      rArc: document.getElementById('rArc'),
      markers: document.getElementById('markers'),
      log: document.getElementById('log'),
      narr: document.getElementById('narrText'),
      prompt: document.getElementById('prompt'),
      promptKey: document.getElementById('promptKey'),
      promptLabel: document.getElementById('promptLabel'),
      promptHint: document.getElementById('promptHint'),
      hints: document.getElementById('hints'),
      fold: document.getElementById('foldOverlay'),
      foldSub: document.getElementById('foldSub'),
      perf: document.getElementById('perf'),
      touchUI: document.getElementById('touchUI'),
    };

    this.markerPool = new Map();
    this.logs = [];
    this._narrTimer = 0;
    this._lastMode = null;

    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.close;
        if (id === 'codex') game.codex.close();
        if (id === 'starmap') game.starmap.close();
      });
    });

    if (game.input.hasTouch) this.el.touchUI.classList.remove('hidden');
  }

  show() { this.root.classList.remove('hidden'); requestAnimationFrame(() => this.root.classList.add('on')); }

  onSystemChange() {
    for (const [, m] of this.markerPool) m.el.remove();
    this.markerPool.clear();
  }

  refreshTargets() { }

  log(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'lg ' + cls;
    d.textContent = text;
    this.el.log.appendChild(d);
    this.logs.push({ el: d, t: 0 });
    while (this.logs.length > 4) { const o = this.logs.shift(); o.el.remove(); }
    setTimeout(() => d.classList.add('out'), 6000);
  }

  narrate(text, who) {
    this.el.narr.innerHTML = (who ? `<span class="who">${who}</span>` : '') + text;
    this.el.narr.classList.add('on');
    this._narrTimer = 7.5;
  }

  /**
   * 电影化模式。上下黑边与标题卡片，所有叙事层内的覆盖层全部隐藏——
   * 在过场动画中，画面属于镜头，而不属于仪表。
   */
  cinematic(on, title, sub) {
    if (!this._cine) {
      const d = document.createElement('div');
      d.id = 'cine';
      d.innerHTML = '<div class="bar top"></div><div class="bar bot"></div>'
        + '<div class="card"><div class="ttl"></div><div class="sub"></div></div>';
      document.body.appendChild(d);
      this._cine = d;
    }
    this._cine.classList.toggle('on', !!on);
    this.root.classList.toggle('cine', !!on);
    if (on) {
      this._cine.querySelector('.ttl').textContent = title || '';
      this._cine.querySelector('.sub').textContent = sub || '';
      this._cine.querySelector('.card').classList.remove('on');
      requestAnimationFrame(() => this._cine.querySelector('.card').classList.add('on'));
    }
  }

  setFold(on) { this.el.fold.classList.toggle('on', on); }
  setFlash(v) { this.game.setFlash(v); }

  /* ------------------------------------------------------------- frame */

  update(dt) {
    const g = this.game;
    const piloting = g.mode === 'pilot' || g.mode === 'exterior';
    const uiOpen = g.starmap.open || g.codex.open;

    // ---- 只有真正在驾驶时才显示准星
    this.el.reticle.classList.toggle('hidden', !piloting || uiOpen);
    const p = g.scanProgress || 0;
    this.el.rArc.setAttribute('d', p > 0.001 ? arcPath(60, 60, 21, -90, -90 + p * 360) : '');

    // ---- 交互提示
    const st = g.mode === 'walk' ? g.player.station : null;
    const showPrompt = !uiOpen && (st || g.mode === 'pilot');
    this.el.prompt.classList.toggle('hidden', !showPrompt);
    if (showPrompt) {
      const key = g.input.hasTouch ? 'USE' : 'E';
      this.el.promptKey.textContent = key;
      if (g.mode === 'pilot') {
        this.el.promptLabel.textContent = '离开驾驶席';
        this.el.promptHint.textContent = '';
      } else {
        this.el.promptLabel.textContent = st.label;
        this.el.promptHint.textContent = st.hint || '';
      }
    }

    // ---- contextual control hints
    /* 上下文按键提示。

       它过去只根据 `mode` 判断，而打开面板并不会改变 mode——因此星图可以占满画面、
       屏蔽所有移动按键，而这行提示仍停留在“WASD 移动”。星图是可以退出的：
       Escape 一直能关闭它。但屏幕上没有任何地方说明这一点，而一个找不到的
       控制键等同于一个不存在的控制键。某位测试者曾报告被困在其中。

       降落曾有过镜像般的问题。L 键可以降落，而 L 从未出现在这里——它也是条件触发的，
       因为 `canLand` 要求 2.6 倍半径内存在固态世界，所以玩家在错误的位置逐个试按键
       时会得出“不可能降落”的结论。它只在真正可用时出现，并说明将执行降落还是起飞。 */
    const canLand = !!(!g.landed && g.canLand && g.canLand());
    const hintKey = `${g.mode}|${uiOpen ? 1 : 0}|${canLand ? 1 : 0}`
      + `|${g.landed ? (g.landed.onFoot ? 2 : 1) : 0}`;
    if (this._hintKey !== hintKey) {
      const wasLand = this._canLand;
      this._hintKey = hintKey;
      this._lastMode = g.mode;
      this._canLand = canLand;
      let keys;
      if (uiOpen) {
        keys = [['ESC', '关闭'], ['J', '跃迁至目标']];
      } else if (g.landed) {
        /* 地面有自己的操作，过去它借用飞行那一行，向站在行星上的人
           展示油门、扫描仪和自动驾驶。 */
        keys = g.landed.onFoot
          ? [['WASD', '行走'], ['鼠标', '视角'], ['SHIFT', '奔跑'], ['E', '登船'], ['L', '起飞']]
          : [['E', '出舱'], ['L', '起飞'], ['TAB', '档案']];
      } else if (g.mode === 'walk') {
        keys = [['WASD', '移动'], ['鼠标', '视角'], ['E', '使用'], ['SHIFT', '奔跑'],
          ['V', '外部视角']];
      } else {
        /* V 键一直存在，却从未出现在这一行——这正是视角“自行改变”的大部分原因：
           唯二能让它改变的是坐下和站起。自由视角的说明把鼠标键写在前面：
           Alt 是窗口管理器可能吞掉的修饰键，右键不会，而两者都一直绑定着它。 */
        keys = [['鼠标', '飞行'], ['W/S', '油门'], ['F', '扫描'], ['G', '自动驾驶'],
          ['J', '跃迁'], ['右键', '自由视角'], ['V', g.mode === 'exterior' ? '驾驶舱' : '追击视角'],
          ['E', '起身']];
        if (canLand) keys.push(['L', '降落']);
      }
      this.el.hints.innerHTML = keys.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('');
      this._syncTouchLabels();
      // 这一行很小，位于底部边缘。进入一颗确实可以降落的星球范围
      // 是值得开口说一声的事，只说一次。
      if (canLand && !wasLand && g.target) {
        this.log(`可降落 · ${g.target.name.toUpperCase()} · L`, 'ok');
      }
    }

    // ---- fold banner
    if (g.ship.foldMode) {
      const t = g.target;
      this.el.foldSub.textContent = t
        ? `${t.name.toUpperCase()}  ·  ${fmtDist(t.absPos.distanceTo(g.ship.absPos))}` : '';
    }

    // ---- timers
    if (this._narrTimer > 0) {
      this._narrTimer -= dt;
      if (this._narrTimer <= 0) this.el.narr.classList.remove('on');
    }
    this._updateMarkers(piloting && !uiOpen);

    if (this.el.perf.classList.contains('on')) {
      this.el.perf.textContent =
        `${g.engine.fps.toFixed(0)} fps  ${g.engine.pixelRatio.toFixed(2)}x  q=${g.quality}  ${g.mode}\n` +
        `draws ${g.engine.drawCalls}  tris ${(g.engine.triangles / 1000).toFixed(0)}k`;
    }
  }

  _syncTouchLabels() {
    const walk = this.game.mode === 'walk';
    const map = walk
      ? { use: '使用', boost: '奔跑', scan: '地图', auto: '档案', fold: '视角' }
      : { use: '起身', boost: '加速', scan: '扫描', auto: '自动', fold: '跃迁' };
    document.querySelectorAll('#touchBtns .tb').forEach((b) => {
      const t = map[b.dataset.act];
      if (t) b.textContent = t;
    });
    const thr = document.getElementById('touchThr');
    if (thr) thr.style.display = walk ? 'none' : '';
  }

  _updateMarkers(active) {
    const g = this.game;
    if (!active) {
      for (const [, m] of this.markerPool) m.el.style.display = 'none';
      return;
    }
    const cam = g.camera;
    const seen = new Set();
    const bodies = g.bodies.slice()
      .sort((a, b) => a.absPos.distanceToSquared(g.ship.absPos) - b.absPos.distanceToSquared(g.ship.absPos))
      .slice(0, 10);

    // Screen-space declutter. Bodies arrive sorted near-to-far, so the first
    // one to claim a patch of canopy keeps it and anything landing on top of it
    // is dropped — two labels overlapping is worse than one label missing.
    const placed = [];
    const MIN_SEP = 46;
    /* The cabin is drawn over the world in its own pass, so a marker composited
       on top of the frame sits on top of the *room* as well — the review caught
       one label lying across the centre MFD, interleaved with the MFD's own
       type, and another over the left MFD and the throttle. Ask the cabin
       whether the ray actually leaves through the glazing. Only in the cockpit:
       in exterior view there is no room in the way. */
    const cabin = (g.mode !== 'exterior' && g.interior && g.interior.seesSky)
      ? g.interior : null;

    for (const b of bodies) {
      _v.copy(b.absPos).sub(g.origin);
      const dist = _v.distanceTo(cam.position);
      _v.project(cam);
      const onScreen = _v.z < 1 && Math.abs(_v.x) < 0.98 && Math.abs(_v.y) < 0.92;
      const angular = 2 * Math.atan((b.radius || 1) / Math.max(dist, 1));
      if (!onScreen || angular > 0.5) continue;
      if (cabin && !cabin.seesSky(_v.x, _v.y, g.interiorCam)) continue;

      const sx = (_v.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_v.y * 0.5 + 0.5) * innerHeight;
      let crowded = false;
      for (const q of placed) {
        if (Math.abs(q.x - sx) < MIN_SEP && Math.abs(q.y - sy) < MIN_SEP) { crowded = true; break; }
      }
      if (crowded && b !== g.target) continue;
      placed.push({ x: sx, y: sy });

      seen.add(b.id);
      let m = this.markerPool.get(b.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'mk';
        el.innerHTML = `<svg viewBox="0 0 28 28">
            <path class="mk-br" d="M4 10V4h6M18 4h6v6M24 18v6h-6M10 24H4v-6"/>
            <circle cx="14" cy="14" r="1.5" class="mk-dot"/>
          </svg>
          <div class="mk-lbl"><span></span><em></em></div>`;
        this.el.markers.appendChild(el);
        m = { el, name: el.querySelector('span'), sub: el.querySelector('em') };
        this.markerPool.set(b.id, m);
      }
      m.el.style.display = '';
      m.el.style.transform = `translate(${sx}px, ${sy}px)`;
      m.el.className = 'mk'
        + (b.kind === 'anomaly' ? ' anom' : '')
        + (b.scanned ? ' scanned' : '')
        + (b === g.target ? ' sel' : '');
      if (m._n !== b.name) { m.name.textContent = b.name; m._n = b.name; }
      m.sub.textContent = fmtDist(dist);
    }
    for (const [id, m] of this.markerPool) if (!seen.has(id)) m.el.style.display = 'none';
  }
}

export function fmtDist(d) {
  if (d < 1) return `${Math.round(d * 1000)} m`;
  if (d < 1000) return `${d.toFixed(1)} km`;
  if (d < 1e6) return `${(d / 1000).toFixed(1)} Mm`;
  return `${(d / 149597870).toFixed(4)} AU`;
}

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}
