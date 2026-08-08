import * as THREE from 'three';

/* ============================================================================
   导演。

   这里的过场动画是一台*摄像机*，而不是一段预制动画：世界在底下继续模拟，
   飞船继续飞行，交通继续移动，而导演只是把摄像机拿走几秒，放到某个更好的
   地方。这正是这些片段从不失同步、也从不需要退出状态的原因——把摄像机交还，
   游戏便恰好停在原地。

   每个镜头都是归一化时间的函数，返回绝对的视点位置、绝对的注视点与焦距。
   锚点每帧都对着某个对象*实时*解析，因此围绕一艘货船构图的镜头，
   即便那艘货船正以每秒三十公里的速度飞驰，依然成立。

   三条规则，全都从素材中学来：

   **要么移动摄像机，要么移动对象，极少同时移动。** 两个同时发生的运动读作漂移。

   **绝不切到一个你无法预判构图的镜头。** 每个镜头的起止都锚定在位置已知的东西上。

   **一切都要缓动。** 线性推轨是最明显不过的破绽，它暴露摄像机是一组矩阵，
   而不是一个有质量的物体。
   ========================================================================== */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const ease = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  // 一次漫长而缓慢的落定——摄像机正在抵达，而不是停下
  settle: (t) => 1 - Math.pow(1 - t, 3.2),
};

/**
 * 锚点。每个都返回实时的绝对位置。
 *   subject    镜头所围绕的对象
 *   offset     在对象自身坐标系中（若有），否则为世界坐标轴
 */
function anchor(subject, off, out) {
  out.set(off[0], off[1], off[2]);
  if (subject.quat) out.applyQuaternion(subject.quat);
  return out.add(subject.absPos);
}

export class Director {
  constructor(game) {
    this.game = game;
    this.seq = null;
    this.t = 0;
    this.shotIdx = 0;
    this.eye = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 46;
    this.roll = 0;
    this.letterbox = 0;
    this.up = new THREE.Vector3(0, 1, 0);
  }

  get active() { return !!this.seq; }

  /**
   * @param {string} name    for logging and for suppressing repeats
   * @param {object[]} shots [{dur, fov, eye:[..], look:[..], subject, ease, on}]
   * @param {object} o       {title, sub, skippable}
   */
  play(name, shots, o = {}) {
    if (this.seq && this.seq.name === name) return;
    this.seq = { name, shots, ...o };
    this.t = 0;
    this.shotIdx = 0;
    this.game.hud?.cinematic?.(true, o.title, o.sub);
    if (shots[0]?.on) shots[0].on(this.game);
  }

  stop() {
    if (!this.seq) return;
    this.seq = null;
    this.game.hud?.cinematic?.(false);
  }

  update(dt) {
    if (!this.seq) {
      this.letterbox = Math.max(0, this.letterbox - dt * 2.2);
      return false;
    }
    this.letterbox = Math.min(1, this.letterbox + dt * 2.2);

    const shot = this.seq.shots[this.shotIdx];
    this.t += dt;
    /* 一个镜头可以拒绝结束。
     *
     * 降落与起飞各有一个节拍，其职责是掩盖耗时未知的工作——建造一片景观、
     * 让驱动完成四十个着色器的编译。按钟表计时意味着挑选一个数字：在慢机器上
     * 要么太短（停顿暴露无遗），在快机器上要么太长（片段拖沓）。因此镜头可以
     * 保持：它停在结束姿态上等待，下面的缓动会钳制住，于是观众看到的是
     * 一台已经抵达、只是静静持住画面的摄像机。 */
    if (this.t >= shot.dur && !(shot.hold && shot.hold(this.game))) {
      this.t -= shot.dur;
      this.shotIdx++;
      if (this.shotIdx >= this.seq.shots.length) { this.stop(); return false; }
      const next = this.seq.shots[this.shotIdx];
      if (next.on) next.on(this.game);
    }

    const s = this.seq.shots[this.shotIdx];
    const u = THREE.MathUtils.clamp(this.t / s.dur, 0, 1);
    const e = (ease[s.ease] || ease.inOut)(u);
    const subj = typeof s.subject === 'function' ? s.subject(this.game) : s.subject;
    if (!subj) { this.stop(); return false; }
    /* 一个镜头可以把视点挂在一个东西上、把视线挂在另一个东西上——降落正是原因。
       摄像机必须贴着飞船抵达——这正是云层下的场景切换不露痕迹的原因——然后
       落到地面上看着它落定，这是唯一能让最后两百米读作一次下降的构图。
       单个锚点无法两者兼得，因此视点搭载一个从飞船缓动到地面的对象，
       而视线全程留在飞船上。 */
    const lsubj = s.lookSubject
      ? (typeof s.lookSubject === 'function' ? s.lookSubject(this.game) : s.lookSubject)
      : subj;
    if (!lsubj) { this.stop(); return false; }

    // eye and look-at, each lerped between a start and an end offset
    anchor(subj, s.eye[0], _a);
    anchor(subj, s.eye[1] || s.eye[0], _b);
    this.eye.copy(_a).lerp(_b, e);

    anchor(lsubj, s.look[0], _a);
    anchor(lsubj, s.look[1] || s.look[0], _b);
    this.look.copy(_a).lerp(_b, e);

    /* 竖直。见 applyCamera：锚定在带旋转的对象上的镜头可以借用它，
       而行星上的一切都必须如此。 */
    if (s.up === 'subject' && subj.quat) this.up.set(0, 1, 0).applyQuaternion(subj.quat);
    else if (s.up === 'look' && lsubj.quat) this.up.set(0, 1, 0).applyQuaternion(lsubj.quat);
    else this.up.set(0, 1, 0);

    this.fov = THREE.MathUtils.lerp(s.fov ? s.fov[0] : 44, s.fov ? (s.fov[1] ?? s.fov[0]) : 44, e);
    this.roll = THREE.MathUtils.lerp(s.roll ? s.roll[0] : 0, s.roll ? (s.roll[1] ?? s.roll[0]) : 0, e);
    return true;
  }

  /** 将当前镜头写入游戏摄像机。
   *
   * 上向量正是降落看起来像飞船仰面翻滚的全部原因。它曾是世界 +Y，而世界 +Y
   * 在行星上毫无意义：降落点是球面上的一个点，起源星系给你的那个点偏离世界
   * 轴 87 度。于是摄像机坚持世界的“竖直”，飞船却坚持行星的“竖直”，地平线
   * 垂直切入画面，船壳读作倒置——每次如此，在大多数世界上，而且是摄像机
   * 干的，不是飞船。
   *
   * 声明了 `up: 'subject'` 的镜头改从它所指向的对象借用竖直。对下降来说那
   * 就是船壳，恰好是观众判断镜头朝向的依据；在地面上，锚点不携带旋转，
   * 于是回落到 +Y，而在那里 +Y 本来就是局部竖直方向。 */
  applyCamera(camera, origin) {
    camera.position.copy(this.eye).sub(origin);
    _a.copy(this.look).sub(origin);
    const m = new THREE.Matrix4().lookAt(camera.position, _a, this.up);
    camera.quaternion.setFromRotationMatrix(m);
    if (this.roll) {
      camera.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    }
  }
}

/* ============================================================== sequences */

/**
 * 每个片段都基于对象自身尺寸构建，因此同一套代码既能框住一艘 90 米的
 * 信使船，也能框住一座 4 公里的巨碑，而无需任何魔法数字。
 */
export const SEQUENCES = {

  /** 从一次跃迁中脱离，进入一个新星系。 */
  arrival(game) {
    const ship = game.ship;
    const shipSubj = { absPos: ship.absPos, quat: ship.quat };
    const star = game.star;
    const R = ship.length;
    return {
      title: game.system.stub.name,
      sub: `${game.system.star.desc} · ${game.system.planets.length} 颗行星`,
      shots: [
        // 1. the ship arrives out of nothing, seen broadside and very close
        {
          dur: 3.2, ease: 'out', subject: shipSubj,
          eye: [[R * 5.5, R * 1.2, R * 0.4], [R * 3.0, R * 0.8, R * 1.6]],
          look: [[0, 0, 0], [0, 0, 0]],
          fov: [28, 38],
        },
        // 2. drift back over the dorsal spine and let the system open out
        {
          dur: 4.0, ease: 'inOut', subject: shipSubj,
          eye: [[R * 0.4, R * 1.1, R * 3.4], [R * 0.1, R * 2.6, R * 9.0]],
          look: [[0, 0, -R * 2], [0, 0, -R * 18]],
          fov: [46, 58], roll: [0.02, -0.015],
        },
        // 3. hold on the star
        {
          dur: 3.4, ease: 'settle',
          subject: { absPos: star.absPos },
          eye: [
            [star.radius * 9, star.radius * 2.2, star.radius * 9],
            [star.radius * 7, star.radius * 1.6, star.radius * 7.4],
          ],
          look: [[0, 0, 0]],
          fov: [30, 26],
        },
      ],
    };
  },

  /** 调谐共鸣器：合唱团回应的唯一时刻。 */
  attune(game, body) {
    const R = body.radius;
    const subj = { absPos: body.absPos };
    return {
      title: body.name,
      sub: '共鸣已建立',
      shots: [
        // rise up the outside of the colonnade
        {
          dur: 4.6, ease: 'inOut', subject: subj,
          eye: [[R * 1.5, -R * 0.9, R * 1.5], [R * 1.15, R * 0.75, R * 1.15]],
          look: [[0, -R * 0.4, 0], [0, 0, 0]],
          fov: [40, 34],
        },
        // then a slow arc through the ring, looking at the core
        {
          dur: 5.4, ease: 'linear', subject: subj,
          eye: [[R * 0.95, R * 0.30, -R * 0.95], [-R * 0.95, R * 0.22, -R * 0.75]],
          look: [[0, 0, 0]],
          fov: [44, 50], roll: [-0.02, 0.03],
        },
      ],
    };
  },

  /**
   * 向下走，而整段只有这一个镜头。
   *
   * 过去这边是两个、另一边还有三个：船的一舷侧面，切到从行星*自身大气壳*
   * *内部*看到的星球边缘——那个壳是按从外部观看而制作的，从里面看会画成
   * 一片棕色的涂抹——闪白，然后是三段不同构图的、已经降落的船。
   * 五个镜头只为了让一艘船从轨道移动到沙丘，其中四个是切换，而观感恰恰
   * 如此：一场关于降落的蒙太奇，而不是一场降落。
   *
   * 所以：一台摄像机，把船固定在船自身坐标系中的一个偏移上，随着世界在它
   * 身后升起而缓动收拢。它从不离开船。场景切换发生在云层内部（见
   * Game.beginEntry），地面片段在精确到这一个镜头结束时的偏移上接住摄像机，
   * 画幅已经拉平到与之匹配——因此切换后继续的仍是这个镜头，前面是天气，
   * 后面是风景。
   *
   * 保持机制与之前相同：景观正在建造、着色器正在云层之后编译，
   * 需要多久就等多久。
   */
  descent(game, body) {
    const ship = game.ship;
    const shipSubj = { absPos: ship.absPos, quat: ship.quat };
    const R = ship.length;
    return {
      title: body.name,
      sub: '下降 · 姿态正常',
      shots: [
        {
          dur: 6.4, ease: 'inOut', subject: shipSubj, up: 'subject',
          hold: (g) => !!g.transition,
          /* Rear three-quarter, high side, closing. The world is behind and
             below the hull the whole way down and grows on its own — the ship
             is the thing that is moving, so the camera does not have to be. */
          eye: [[R * 2.15, R * 0.78, R * 3.30], [R * 1.28, R * 0.34, R * 1.92]],
          look: [[0, R * 0.06, 0], [0, -R * 0.04, 0]],
          fov: [38, 50], roll: [0.014, -0.006],
        },
      ],
    };
  },

  /**
   * 向上走：降落倒放，依然只有一个镜头。
   *
   * 摄像机从地面开始，低矮而贴近船腹之下，船壳离开了它。随后视点锚点爬上
   * 飞船——这一侧的 `groundCamAnchor` 向另一方向缓动——于是当云层合拢、
   * 遮住画面时，摄像机正随飞行器一同移动，这是它下方的场景切换不被察觉的
   * 唯一方式。视线从不离开飞船。
   */
  ascent(game, body) {
    const R = game.ship.length * 1000;      // the ground scene is in metres
    return {
      title: body.name,
      sub: '上升 · 引擎点火',
      shots: [
        {
          dur: 6.2, ease: 'inOut',
          subject: (g) => ({ absPos: g.groundCamAnchor }),
          lookSubject: (g) => ({ absPos: g.groundShipAnchor }),
          hold: (g) => !!g.transition,
          eye: [[R * 0.92, R * 0.055, R * 0.78], [R * 1.24, R * 0.30, R * 1.86]],
          look: [[0, R * 0.10, 0], [0, 0, 0]],
          fov: [52, 46], roll: [0, 0.012],
        },
      ],
    };
  },

  /** 同一镜头另一侧：钻出云层，世界在下方远去。它从地面半程结束时的偏移
   *  开始，位于船自身坐标系中，并以足够宽的画幅收尾，让摄像机交还给追击
   *  支架成为一次移动，而非一次跳跃。 */
  ascentSpace(game, body) {
    const R = game.ship.length;
    const shipSubj = { absPos: game.ship.absPos, quat: game.ship.quat };
    return {
      title: body.name,
      sub: '轨道 · 已脱离重力井',
      shots: [
        {
          dur: 6.0, ease: 'settle', subject: shipSubj, up: 'subject',
          eye: [[R * 1.24, R * 0.30, R * 1.86], [R * 0.62, R * 0.24, R * 1.28]],
          look: [[0, 0, 0], [0, R * 0.02, 0]],
          fov: [46, 54], roll: [0.012, 0],
        },
      ],
    };
  },

  /**
   * 同一镜头的下半段，在云层的另一侧。
   *
   * 这里没有任何切换。视点从下降结束时所在的偏移开始，其测量对象仍是那艘
   * 船——此刻 `groundCamAnchor` 正粘在船壳上——因此观众正看着的画幅，在它
   * 之下的世界改变时纹丝不动。接下来几秒内，那个锚点缓降到着陆点，视线则
   * 始终留在船上，摄像机从一架并飞的视角，变成站在地面上看着船朝自己降下
   * 的视角。一次移动，零切换，并在落地吊臂开始的地方停下，于是交还也不是
   * 一次切换。
   */
  touchdown(game, body) {
    const R = game.ship.length * 1000;    // the ground scene is in metres
    return {
      title: body.name,
      sub: '地表 · 大气正常',
      shots: [
        {
          dur: 7.6, ease: 'inOut',
          subject: (g) => ({ absPos: g.groundCamAnchor }),
          lookSubject: (g) => ({ absPos: g.groundShipAnchor }),
          /* Both offsets are in the hull's own frame at the crossing, which is
             why the numbers match the descent's last ones — and the far end is
             where updateCamera's crane starts, at 1.55 out and 0.22 up looking
             at 0.28 of a hull-length. */
          eye: [[R * 1.28, R * 0.34, R * 1.92], [R * 0.95, R * 0.252, R * 1.434]],
          look: [[0, 0, 0], [0, R * 0.28, 0]],
          fov: [50, 44], roll: [-0.006, 0],
        },
      ],
    };
  },

  /** 驶向一座空间站。 */
  approach(game, body) {
    const R = body.radius;
    const subj = { absPos: body.absPos };
    const ship = { absPos: game.ship.absPos, quat: game.ship.quat };
    return {
      title: body.name,
      sub: '接近 · 保持位置',
      shots: [
        // the station passes overhead
        {
          dur: 4.2, ease: 'inOut', subject: subj,
          eye: [[R * 2.6, -R * 0.85, R * 2.2], [R * 0.7, -R * 0.55, R * 0.5]],
          look: [[0, 0, 0]],
          fov: [36, 52],
        },
        // and the ship slides in under it
        {
          dur: 3.6, ease: 'settle', subject: ship,
          eye: [[game.ship.length * 3.0, game.ship.length * 0.6, game.ship.length * 2.6],
            [game.ship.length * 1.6, game.ship.length * 0.35, game.ship.length * 1.5]],
          look: [[0, 0, 0]],
          fov: [40, 34],
        },
      ],
    };
  },
};
