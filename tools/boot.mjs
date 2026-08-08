// 让页面从“刚加载完”进入“游戏在运行”，并停留在那里。
//
// 开发服务器会在任何源码编辑时热重载，这会丢弃 JS 上下文并把标题卡重新
// 立起来。在重载前开始的捕获会愉快地完成并截下标题画面——每一条断言依然
// 通过，唯一的线索是图片是错的。因此：通过 DOM 点击而非 Playwright 的
// 可操作性检查（覆盖层会动画它的不透明度，落在过渡中途的点击会被悄悄丢弃），
// 然后验证覆盖层确实消失，若没有则重新开始。
export async function bootGame(page, { setup = null, settle = 0, after = null, tries = 4 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    let out, reason = 'game never came up';
    try {
      /* Already running? Then there is no overlay to wait for.
         The wait below is for the boot overlay to become *visible*, which only
         happens once — so calling this a second time on a live page waits the
         full timeout and deadlocks. Anything that wants several shots from one
         browser has to be able to call it per shot. */
      const alreadyLive = await page.evaluate(() => !!(window.__game && window.__game.started)
        && document.getElementById('boot').style.display === 'none').catch(() => false);
      if (alreadyLive) {
        if (setup) out = await page.evaluate(`(()=>{ const g = window.__game; return (${setup}); })()`);
        if (settle) await page.waitForTimeout(settle);
        const still = await page.evaluate(() => !!(window.__game && window.__game.started)
          && document.getElementById('boot').style.display === 'none').catch(() => false);
        if (still) {
          if (after) out = await page.evaluate(`(()=>{ const g = window.__game; return (${after}); })()`);
          return out;
        }
        // fell through: the page reloaded under us, so boot it properly below
      }
      await page.waitForFunction(
        () => { const b = document.getElementById('bootStart'); return b && !b.hidden; },
        { timeout: 90000 });
      await page.evaluate(() => document.getElementById('bootStart').click());
            // Generous on purpose: boot bakes cubemaps, warms shaders and now loads
      // model assets, and a slow cold start is not a failure.
      await page.waitForFunction(() => window.__game && window.__game.started, { timeout: 120000 });
      await page.waitForTimeout(1500);
      if (setup) out = await page.evaluate(`(()=>{ const g = window.__game; return (${setup}); })()`);
      if (settle) await page.waitForTimeout(settle);
      const live = await page.evaluate(() =>
        !!(window.__game && window.__game.started)
        && document.getElementById('boot').style.display === 'none');
      // The post-settle read has to be inside the retry, not after it. A reload
      // during a long settle leaves the game booted but back at spawn — not
      // landed, not posed — so an expression written against the set-up state
      // throws on a null, which reads as a code bug rather than as churn.
      if (live && after) out = await page.evaluate(`(()=>{ const g = window.__game; return (${after}); })()`);
      if (live) return out;
      reason = 'overlay came back after settle';
    } catch (e) {
      /* Both a reload and a broken expression land here, and reporting every
         failure as a reload is worse than saying nothing: it sends the reader
         hunting for a hot reload that never happened while the real fault is a
         typo in their own setup string. That cost time once already — a bad
         `bodyRef` printed "reload detected mid-capture" four times and looked
         exactly like the dev server churning.

         So ask the page. If the game is still up, the expression threw on its
         own account, and retrying it three more times will only produce the
         same exception with the true one buried above it. Fail immediately and
         hand back the real error. */
      const stillLive = await page.evaluate(() => !!(window.__game && window.__game.started)
        && document.getElementById('boot').style.display === 'none').catch(() => false);
      if (stillLive) throw e;
      if (attempt === tries) throw e;
      reason = `page went away (${String(e.message || e).split('\n')[0]})`;
    }
    if (attempt < tries) console.log(`[boot] ${reason}, retry ${attempt + 1}/${tries}`);
  }
  throw new Error('game never stayed booted — is something rewriting src/ during the run?');
}
