import * as THREE from 'three';

/* ============================================================================
   遭遇。

   无论你是否与它们交谈，交通都照常存在——这正是关键：本模块不新增任何实体，
   也不移动任何东西。它只是观察距离，当苍白探寻者靠近某艘有人驾驶的船只时，
   对方会说出它的行业会对一艘意料之外的勘测船说的话。

   两条规则让它不至于变成噪音：

   **每次只打招呼一次，仅此一次。** 一艘每次路过都要问候你的船，会把星系中
   唯一有居民的东西变成一台自动售货机。每段接触只有一句台词，一旦说完，
   这艘船便永远归于沉默。

   **只说只有它们才说得出口的话。** 货船谈论质量与利润空间，巡逻船谈论你的
   注册信息，打捞船谈论它正在切割的东西。合唱团的尘埃粒子则完全不说话——
   沉默本身就是内容，给它们配台词只会让这份内容更快被挥霍殆尽。
   ========================================================================== */

const _v = new THREE.Vector3();

/** 接触对象需要多近（以船长为单位）才会注意到你。 */
const HAIL_RANGE = 900;

const LINES = {
  freighter: [
    ['勘测船，你在我减速锥里面。我停不下来。你可以。', '散装货船'],
    ['研究院的标记。对制图人来说可够远的。', '散装货船'],
    ['九百吨没人需要的东西。和上次那趟一样。', '散装货船'],
    ['航道是我们照亮的。没人保证它们安全。当心点。', '散装货船'],
  ],
  courier: [
    ['信使按时刻表航行。别跟着我，我船上没有值得抢的东西。', '信使'],
    ['你是苍白探寻者。在星门那儿他们常提起你。', '信使'],
    ['无论你在这外面找什么——它在我们到这儿之前就已经不在了。', '信使'],
  ],
  tug: [
    ['工作中。别让尾流碰到我的缆绳。', '船坞勤务'],
    ['上个月找到一具船壳，杯子里的咖啡还在。四万年了。', '船坞勤务'],
    ['要是你要靠近共鸣器，别碰任何东西。去问问上一个碰过的人。', '船坞勤务'],
  ],
  patrol: [
    ['苍白探寻者，这里是研究院守望。注册信息已确认。继续航行。', '研究院巡逻'],
    ['本星系内一切移动物体我们都会记录。今天是你和四艘货船。', '研究院巡逻'],
    ['测绘它、扫描它，但先报告再调谐。', '研究院巡逻'],
  ],
  drone: [
    ['<自动勘测无人机——仅载波音调>', '联络'],
    ['<遥测数据流 · 4.2 Mb · 未加密 · 一份矿物勘测报告>', '联络'],
  ],
  station: [
    ['苍白探寻者，外港泊位归你。注意勤务船交通。', '交通管制'],
    ['欢迎入港，探寻者。船上有一万一千个灵魂，每一个都想知道新消息。', '交通管制'],
  ],
};

export class Encounters {
  constructor(game) {
    this.game = game;
    this.spoken = new Set();
    this._cool = 0;
  }

  onSystemChange() { this.spoken.clear(); this._cool = 3; }

  update(dt) {
    const g = this.game;
    if (!g.fleet || g.landed) return;
    // one hail at a time, with a long beat after each
    this._cool = Math.max(0, this._cool - dt);
    if (this._cool > 0) return;

    const shipPos = g.ship.absPos;

    for (const c of g.fleet.craft) {
      if (c.hailed || c.faction === 'choir') continue;
      const range = c.length * HAIL_RANGE;
      if (_v.copy(c.absPos).sub(shipPos).lengthSq() > range * range) continue;
      c.hailed = true;
      this._speak(LINES[c.kind], c.name);
      return;
    }

    for (const st of g.stations || []) {
      if (st.hailed) continue;
      const range = st.built.radius * 5.0;
      if (_v.copy(st.absPos).sub(shipPos).lengthSq() > range * range) continue;
      st.hailed = true;
      this._speak(LINES.station, st.name);
      return;
    }

    // 合唱团的回应与众不同，而且每个星系只有一次。
    const mote = g.fleet.craft.find((c) => c.faction === 'choir' && !c.hailed);
    if (mote && _v.copy(mote.absPos).sub(shipPos).lengthSq() < (mote.length * 600) ** 2) {
      mote.hailed = true;
      g.hud.narrate('它不回答。它略微改变了航向，好让你始终能看见它。',
        '未解联络');
      g.audio.ping('resonate');
      this._cool = 14;
    }
  }

  _speak(pool, who) {
    if (!pool || !pool.length) return;
    const g = this.game;
    // 按星系确定性地选择，因此某段固定的接触永远说同一句话
    const i = Math.abs(hash(who + g.currentSystemId)) % pool.length;
    const [line, tag] = pool[i];
    g.hud.narrate(line, tag);
    g.hud.log(`联络 · ${who}`, 'ok');
    g.audio.ping('ui');
    this._cool = 12;
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}
