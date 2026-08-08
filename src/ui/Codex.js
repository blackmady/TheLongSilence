import { CANTOS, LOGS, TYPE_INFO, STAR_INFO, ANOMALY_INFO } from '../game/lore.js';
import { fmtDist } from './HUD.js';

/* 档案：你扫描到的一切，加上合唱团留下的一切。 */

export class Codex {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('codex');
    this.nav = document.getElementById('codexNav');
    this.main = document.getElementById('codexMain');
    this.open = false;
    this.sel = 'overview';
    this.dirty = true;
  }

  markDirty() { this.dirty = true; if (this.open) this.render(); }

  toggle() { this.open ? this.close() : this.show(); }

  show(section) {
    if (section) this.sel = section;
    this.open = true;
    clearTimeout(this._closeT);
    this.root.classList.remove('hidden', 'closing');
    this.render();
  }

  /* 淡出期间保留在 DOM 中。收起动画是 UI 唯一一处“切”而非“移动”的地方，而且肉眼可见。 */
  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('closing');
    clearTimeout(this._closeT);
    this._closeT = setTimeout(() => {
      this.root.classList.remove('closing');
      this.root.classList.add('hidden');
    }, 220);
  }

  /** 立即隐藏，无过渡——用于需要瞬移的场景布置。 */
  hide() {
    this.open = false;
    clearTimeout(this._closeT);
    this.root.classList.remove('closing');
    this.root.classList.add('hidden');
  }

  render() {
    const g = this.game;
    const scanned = g.bodies.filter((b) => b.scanned);

    const groups = [
      {
        title: '勘测', items: [
          { id: 'overview', label: '远征概览' },
          ...scanned.map((b) => ({ id: 'body:' + b.id, label: b.name })),
        ],
      },
      {
        title: '圣歌', items: CANTOS.map((c, i) => ({
          id: 'canto:' + c.id, label: c.title,
          locked: !g.cantos.includes(c.id),
        })),
      },
      {
        title: '记录', items: LOGS.map((l) => ({
          id: 'log:' + l.id, label: l.title, locked: !g.logsFound.has(l.id),
        })),
      },
    ];

    this.nav.innerHTML = groups.map((gr) =>
      `<div class="cx-grp">${gr.title}</div>` + gr.items.map((it) =>
        `<button class="cx-item${it.id === this.sel ? ' on' : ''}${it.locked ? ' locked' : ''}"
           data-id="${it.id}">${it.locked ? '— 已封存 —' : it.label}</button>`).join('')
    ).join('');

    this.nav.querySelectorAll('.cx-item').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.classList.contains('locked')) return;
        this.sel = b.dataset.id;
        this.render();
      });
    });

    this.main.innerHTML = this.renderEntry(this.sel);
    this.dirty = false;
  }

  renderEntry(id) {
    const g = this.game;

    if (id === 'overview') {
      const total = g.galaxy.length;
      const visited = g.galaxy.filter((s) => s.visited).length;
      return `
        <h1 class="cx-title">漫长沉默</h1>
        <div class="cx-sub">深空勘测船 苍白探寻者 · 第 1101 次委任</div>
        <div class="cx-stats">
          ${stat('已测绘星系', `${visited} / ${total}`)}
          ${stat('已编目天体', g.discoveries.size)}
          ${stat('共鸣', `${g.state.resonance} / 7`)}
          ${stat('当前星系', g.system.star.name)}
          ${stat('恒星', `${g.system.star.cls} · ${Math.round(g.system.star.temp)} K`)}
          ${stat('船壳', `${Math.round(g.ship.hull * 100)} %`)}
        </div>
        <div class="cx-text">
          <p>四万年前，九百个有居民的世界，在横跨八十光年的空间内归于沉寂。没有残骸。没有辐射特征。
         在我们能测量的任何尺度上，都没有暴力的迹象。</p>
          <p>合唱团让城市灯火通明、轨道井井有条，并留下了七件乐器——共鸣器——立于七个星系之中。</p>
          <p class="q">测绘你能测绘的。扫描你找到的。调谐愿意接纳你的。</p>
        </div>`;
    }

    if (id.startsWith('canto:')) {
      const c = CANTOS.find((x) => 'canto:' + x.id === id);
      if (!c) return '';
      return `<h1 class="cx-title">${c.title.toUpperCase()}</h1>
        <div class="cx-sub">${c.sub}</div>
        <div class="cx-text">${c.body.map((p) => `<p>${p}</p>`).join('')}
        <p class="q">${c.q}</p></div>`;
    }

    if (id.startsWith('log:')) {
      const l = LOGS.find((x) => 'log:' + x.id === id);
      if (!l) return '';
      return `<h1 class="cx-title">${l.title.toUpperCase()}</h1>
        <div class="cx-sub">${l.sub}</div>
        <div class="cx-text">${l.body.map((p) => `<p>${p}</p>`).join('')}</div>`;
    }

    if (id.startsWith('body:')) {
      const b = g.bodies.find((x) => 'body:' + x.id === id);
      if (!b) return '<div class="cx-empty">no record</div>';
      const d = b.absPos.distanceTo(g.ship.absPos);

      if (b.kind === 'star') {
        const s = b.spec;
        return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
          <div class="cx-sub">${s.desc} · ${s.cls} 型</div>
          <div class="cx-stats">
            ${stat('有效温度', `${Math.round(s.temp)} K`)}
            ${stat('半径', `${(s.radius / 1000).toFixed(0)} Mm`)}
            ${stat('光度', `${s.luminosity.toFixed(2)} L☉`)}
            ${stat('距离', fmtDist(d))}
          </div>
          <div class="cx-text"><p>${STAR_INFO[s.cls] || ''}</p></div>`;
      }

      if (b.kind === 'anomaly') {
        const info = ANOMALY_INFO[b.anomalyType];
        return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
          <div class="cx-sub">${info.label} · 非自然成因</div>
          <div class="cx-stats">
            ${stat('分类', info.label)}
            ${stat('距离', fmtDist(d))}
            ${stat('星系', g.system.star.name)}
          </div>
          <div class="cx-text"><p>${info.text}</p></div>`;
      }

      const s = b.spec;
      const info = TYPE_INFO[s.type];
      const g0 = (s.radius / 6371) * 1.0;
      return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
        <div class="cx-sub">${info.label}${b.kind === 'moon' ? ' · 卫星' : ''}</div>
        <div class="cx-stats">
          ${stat('半径', `${Math.round(s.radius)} km`)}
          ${stat('表面重力', `${g0.toFixed(2)} g`)}
          ${stat('轨道半径', fmtDist(s.orbitR))}
          ${stat('轴倾角', `${(s.tilt * 57.3).toFixed(1)}°`)}
          ${stat('自转周期', `${(6.283 / Math.abs(s.spinRate) / 3600).toFixed(1)} 小时`)}
          ${stat('大气', s.atmo ? '存在' : '可忽略')}
          ${stat('水圈', (s.type === 'terran' || s.type === 'ocean') ? `${Math.round(s.sea * 100)} %` : '无')}
          ${stat('环系统', s.rings ? '有' : '无')}
        </div>
        <div class="cx-text">
          <p>${info.text}</p>
          ${s.night ? '<p class="q">夜半球光度测量显示海岸沿线存在结构化的发光。有人曾住在这里。灯火至今未熄。</p>' : ''}
        </div>`;
    }

    return '<div class="cx-empty">无记录</div>';
  }
}

function stat(label, value) {
  return `<div class="cx-stat"><label>${label}</label><b>${value}</b></div>`;
}
