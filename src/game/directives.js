/* ============================================================================
   行动指引。

   沙盒世界“无聊”的抱怨，几乎总是“没人告诉你下一个有趣的事是什么”的抱怨。
   因此这里始终且只存在一条激活中的指引：它指明一个具体的下一步行动，
   显示在仪表盘上，完成它会带来看得见的回报——一段圣歌、一份回收的日志，
   或一项可感知的舰船升级。

   这条指引链同时兼任新手教程——前四步恰好教会你坐下、瞄准、扫描与跃迁，
   而全程不会说出“教程”二字。
   ========================================================================== */

export const UPGRADES = {
  scanner: { label: '扫描增益', apply: (g) => { g.ship.scanRate *= 1.35; } },
  drive: { label: '跃迁再充能', apply: (g) => { g.ship.foldRegen *= 1.6; } },
  thrust: { label: '推力', apply: (g) => { g.ship.maxSpeed *= 1.22; } },
  hull: { label: '船壳装甲', apply: (g) => { g.ship.hullMax = 1.0; g.ship.hull = 1.0; } },
  range: { label: '传感器距离', apply: (g) => { g.scanRangeMul *= 1.4; } },
};

function bodiesScannedHere(g) {
  return g.bodies.filter((b) => b.scanned && b.kind !== 'anomaly').length;
}

export const CHAIN = [
  {
    id: 'helm',
    short: '坐上驾驶席',
    full: '接管驾驶席',
    hint: '驾驶席在前方，穿过走廊即是。',
    check: (g) => g.mode === 'pilot',
    onDone: (g) => {
      g.hud.narrate('引擎已暖机。扫描仪归你使用。为我找到些什么吧，探寻者。',
        '研究院中继');
    },
  },
  {
    id: 'firstScan',
    short: '扫描任意天体',
    full: '勘测一颗星球',
    hint: '将目标放入准星并按住 F。',
    check: (g) => bodiesScannedHere(g) >= 1,
    onDone: (g) => {
      g.hud.narrate('已记录。你每编目一颗天体，合唱团的去向就被缩小一分。',
        '研究院中继');
      g.grantUpgrade('scanner');
    },
  },
  {
    id: 'survey3',
    short: '在本星系勘测 3 颗天体',
    full: '勘测三颗天体',
    hint: '用 T 锁定目标，用 G 飞行，用 F 扫描。',
    total: 3,
    progress: (g) => bodiesScannedHere(g),
    check: (g) => bodiesScannedHere(g) >= 3,
    onDone: (g) => {
      g.revealResonator();
      g.hud.narrate('三角定位成立。本星系中有一座共鸣器——方位已标记。',
        '研究院中继');
      g.grantUpgrade('range');
    },
  },
  {
    id: 'resonator',
    short: '抵达共鸣器',
    full: '调查共鸣',
    hint: '它已标记在战术板上。扫描它。',
    check: (g) => g.cantos.length >= 1,
    onDone: (g) => { g.grantUpgrade('drive'); },
  },
  {
    id: 'chamber',
    short: '将圣歌安置进共鸣室',
    full: '返回共鸣室',
    hint: '离开驾驶席，向船尾走去。',
    check: (g) => g.chamberVisits >= 1,
    onDone: (g) => {
      g.hud.narrate('七分之一。共鸣室记住了其余的形状。',
        '苍白探寻者');
      g.grantUpgrade('thrust');
    },
  },
  {
    id: 'fold',
    short: '跃迁到另一个星系',
    full: '测绘新星系',
    hint: '使用生活区中的导航台。',
    check: (g) => g.galaxy.filter((s) => s.visited).length >= 2,
    onDone: (g) => {
      g.hud.narrate('沉默中的每个星系都保存着记录的一部分。继续前进。',
        '研究院中继');
    },
  },
];

/** 脚本化指引链结束后，指引由世界状态动态生成。 */
function proceduralDirective(g) {
  const res = g.anomalies.find((a) => a.anomalyType === 'resonator' && !a.scanned);
  if (res && g.resonatorRevealed) {
    return { id: 'res:' + res.id, short: `调谐 ${res.name}`, full: '调谐共鸣器', hint: '扫描它。' };
  }
  const unscanned = g.bodies.filter((b) => !b.scanned && b.kind !== 'anomaly').length;
  if (unscanned > 0 && bodiesScannedHere(g) < 3) {
    return {
      id: 'survey:' + g.currentSystemId,
      short: `勘测此星系`,
      full: '继续勘测',
      hint: '勘测三颗天体即可揭示此处的共鸣器。',
      total: 3, done: bodiesScannedHere(g),
    };
  }
  const sig = g.anomalies.find((a) => !a.scanned);
  if (sig) {
    return { id: 'sig:' + sig.id, short: `调查 ${sig.name}`, full: '未解信号', hint: '扫描它。' };
  }
  const next = g.galaxy.find((s) => !s.visited);
  if (next) {
    return {
      id: 'jump:' + next.id,
      short: `跃迁至 ${next.designation}`,
      full: '测绘新星系',
      hint: '使用导航台。',
    };
  }
  return { id: 'done', short: '调谐全部七座共鸣器', full: '孔洞', hint: '' };
}

export class Directives {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.current = null;
    this._announced = null;
  }

  update() {
    const g = this.game;
    let step = CHAIN[this.index];

    if (step && step.check(g)) {
      this.index++;
      step.onDone?.(g);
      g.hud.log(`指引完成 · ${step.full}`, 'ok');
      g.audio.ping('objective');
      step = CHAIN[this.index];
    }

    const src = step || proceduralDirective(g);
    const done = step
      ? (step.progress ? step.progress(g) : 0)
      : (src.done || 0);

    this.current = {
      id: src.id,
      short: src.short,
      full: src.full,
      hint: src.hint,
      total: src.total || 1,
      done: Math.min(done, src.total || 1),
    };
    g.directive = this.current;

    if (this._announced !== this.current.id) {
      this._announced = this.current.id;
      g.hud.log(`指引 · ${this.current.short}`, 'hi');
    }
  }
}
