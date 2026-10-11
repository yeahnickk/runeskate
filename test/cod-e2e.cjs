// needs playwright (e.g. npm i playwright in a scratch dir and run with NODE_PATH pointing at its node_modules)
// CODScape end to end, through the real page and real inputs (keyboard, mouse, gamepad, touch).
// node e2e.js [base]   -> PASS/FAIL lines, screenshots in ./e2e-*.png
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8199';
process.chdir(require('os').tmpdir());   // (screenshots land in the temp dir)
let fails = 0; const results = [];
const check = (ok, name, info = '') => { const l = (ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : ''); console.log(l); results.push(l); if (!ok) fails++; };
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

(async () => {
  const b = await chromium.launch({ args: ARGS });
  const errors = [];
  const watch = p => { p.on('pageerror', e => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n')[1])); p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); }); };
  // ---------------------------------------------------------------- the picker
  {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage(); watch(p);
    await p.goto(BASE + '/');
    await p.waitForSelector('#pick', { state: 'visible', timeout: 30000 }).catch(() => {});
    check(await p.isVisible('#pick'), 'home page opens on the game picker');
    await p.screenshot({ path: 'e2e-picker.png' });
    await p.click('#pick-skate'); await p.waitForTimeout(300);
    check(!(await p.isVisible('#pick')), 'RUNESKATE card goes on to the skate game');
    await p.goto(BASE + '/?name=Tester'); await p.waitForTimeout(500);
    check(!(await p.isVisible('#pick')), 'a skate join link skips the picker');
    await p.goto(BASE + '/'); await p.waitForSelector('#pick', { state: 'visible' });
    await Promise.all([p.waitForNavigation(), p.click('#pick-cod')]);
    check(/cod\.html/.test(p.url()), 'CODSCAPE card opens CODScape', p.url());
    await p.close();
  }
  // ---------------------------------------------------------------- desktop: keyboard + mouse
  const ctx = await b.newContext({ viewport: { width: 800, height: 450 } });   // (software GL: a small window keeps the frame rate usable)
  const p = await ctx.newPage(); watch(p);
  await p.goto(BASE + '/cod.html');
  await p.waitForFunction(() => document.title === 'CODScape', null, { timeout: 180000 });
  check(await p.isVisible('#menubox'), 'CODScape main menu shows');
  // create-a-class: make class 1 an AK + Deagle, check it sticks
  await p.click('#m-class'); await p.waitForTimeout(100);
  await p.click('[data-cls="1"]'); await p.click('[data-slot="primary"][data-v="ak47"]'); await p.click('[data-slot="secondary"][data-v="deagle"]');
  const cls1 = await p.evaluate(() => COD.classes[1]);
  check(cls1.primary === 'ak47' && cls1.secondary === 'deagle', 'create-a-class edits a class', JSON.stringify(cls1));
  await p.click('#m-back');
  // settings: sensitivity slider persists
  await p.click('#m-settings');
  await p.$eval('input[data-k="sens"]', el => { el.value = '1.4'; el.dispatchEvent(new Event('input')); });
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('codscape.settings')).sens === 1.4), 'settings save');
  await p.click('#m-back');
  // play: TDM, regular, 4v4, class 0 (M4)
  await p.click('#m-play');
  await p.click('[data-k="MODE"][data-v="tdm"]'); await p.click('[data-k="BOTS"][data-v="regular"]'); await p.click('[data-k="SIZE"][data-v="4"]'); await p.click('[data-k="CLASS"][data-v="0"]');
  await p.click('#m-go');
  await p.waitForFunction(() => COD.game && COD.me && COD.me.alive, null, { timeout: 120000 });
  check(true, 'DEPLOY starts a match');
  check(await p.evaluate(() => COD.game.fighters.length === 8 && COD.game.mode.short === 'TDM'), '4v4 TDM with bots');
  // a quiet test range: freeze the bots' brains, put the player in the open Saradomin field
  const freeze = () => p.evaluate(() => { for (const f of COD.game.fighters) if (f.brain) { f.brain._think = f.brain._think || f.brain.think; f.brain.think = () => ({ move: {}, gun: {} }); } });
  const unfreeze = () => p.evaluate(() => { for (const f of COD.game.fighters) if (f.brain && f.brain._think) f.brain.think = f.brain._think; });
  // stand somewhere and face the most open direction (a clear lane for running and shooting)
  const place = (wx, wz) => p.evaluate(([wx, wz]) => { const A = COD.arena, me = COD.me, q = A.at(wx, wz); me.body.pos.set(q.x, A.floor(q.x, 12, q.z, 0, 20), q.z); me.body.vel.set(0, 0, 0); me.body.pitch = 0; me.hp = 100;
    let best = 0, bd = -1; const o = me.body.pos.clone(), d = o.clone();
    for (let k = 0; k < 24; k++) { const yaw = k / 24 * Math.PI * 2; d.set(-Math.sin(yaw), 0, -Math.cos(yaw)); let m = 40; for (const h of [0.5, 1.4]) { o.copy(me.body.pos); o.y += h; const r = A.ray(o, d, 40); if (r) m = Math.min(m, r.distance); } if (m > bd) { bd = m; best = yaw; } }
    me.body.yaw = best; me.body.prevPlace = bd; COD.input.mouse.dx = COD.input.mouse.dy = 0; return bd; }, [wx, wz]);
  const state = () => p.evaluate(() => JSON.stringify({ t: +COD.game.t.toFixed(2), paused: COD.paused, locked: COD.input.locked, device: COD.input.device, alive: COD.me.alive, phase: COD.me.gunner.phase, over: COD.game.over }));
  await freeze();
  await p.evaluate(() => { const A = COD.arena; COD.game.fighters.filter(f => f !== COD.me).forEach((f, i) => { const q = A.at(2372 + i, 3132); f.body.pos.set(q.x, A.floor(q.x, 12, q.z, 0, 20), q.z); }); });
  await place(2420, 3098);
  // pointer lock by clicking the game
  await p.mouse.click(400, 225); await p.waitForTimeout(300);
  const locked = await p.evaluate(() => COD.input.locked);
  check(locked, 'clicking the game locks the mouse');
  const pos = () => p.evaluate(() => ({ x: COD.me.body.pos.x, y: COD.me.body.pos.y, z: COD.me.body.pos.z, vy: COD.me.body.vel.y, sp: Math.hypot(COD.me.body.vel.x, COD.me.body.vel.z), ground: COD.me.body.onGround, sprint: COD.me.body.sprinting, crouch: COD.me.body.crouch, slide: COD.me.body.slide, yaw: COD.me.body.yaw, pitch: COD.me.body.pitch }));
  const gt = () => p.evaluate(() => COD.game.t);
  const waitGame = async s => { const t0 = await gt(); await p.waitForFunction(([t0, s]) => COD.game.t >= t0 + s, [t0, s], { timeout: 400000 }); };
  // ---- movement
  let a = await pos(); await p.keyboard.down('KeyW'); await waitGame(0.8); let b1 = await pos();
  check(Math.hypot(b1.x - a.x, b1.z - a.z) > 2 && b1.sp > 4, 'W walks forward', `moved ${Math.hypot(b1.x - a.x, b1.z - a.z).toFixed(2)}, speed ${b1.sp.toFixed(1)} ${await state()}`);
  await p.keyboard.down('ShiftLeft'); await waitGame(0.6); let c1 = await pos();
  check(c1.sprint && c1.sp > 8, 'SHIFT sprints', `speed ${c1.sp.toFixed(1)} ${await state()}`);
  await p.keyboard.press('KeyC'); await waitGame(0.12); let d1 = await pos();
  check(d1.slide > 0, 'C out of a sprint slides', `slide ${d1.slide.toFixed(2)} speed ${d1.sp.toFixed(1)}`);
  await p.keyboard.up('ShiftLeft'); await p.keyboard.up('KeyW'); await waitGame(1.2);
  await place(2420, 3098);
  await p.evaluate(() => { const me = COD.me; window.J = { y0: me.body.pos.y, max: me.body.pos.y, ev: [] }; const orig = COD.game.emit.bind(COD.game); COD.game.emit = e => { if (e.t === 'move' && e.f === me) window.J.ev.push(e.e); orig(e); };
    const tick = () => { window.J.max = Math.max(window.J.max, me.body.pos.y); requestAnimationFrame(tick); }; tick(); });
  await p.keyboard.press('Space'); await waitGame(1.2);
  const J = await p.evaluate(() => ({ rise: window.J.max - window.J.y0, ev: window.J.ev, ground: COD.me.body.onGround }));
  check(J.ev.includes('jump') && J.ev.includes('land') && J.rise > 0.6 && J.ground, 'SPACE jumps and lands', `rose ${J.rise.toFixed(2)}, ${J.ev.join(',')}`);
  await p.keyboard.down('KeyC'); await waitGame(0.4); let cr = await pos(); await p.keyboard.up('KeyC');
  check(cr.crouch > 0.8, 'C crouches', `crouch ${cr.crouch.toFixed(2)}`);
  // mouse look
  await p.waitForTimeout(250);
  const y0 = (await pos()).yaw; await p.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: 40, movementY: 0 })); }); await waitGame(0.1); const y1 = (await pos()).yaw;
  check(Math.abs(y1 - y0) > 0.05, 'the mouse turns you', `${(y1 - y0).toFixed(3)} rad`);
  // stairs, for real: walk the Saradomin castle's flight from the yard to the wall walk with W
  {
    const r = await p.evaluate(async () => {
      const A = COD.arena, me = COD.me, N = A.nav.nodes;
      const s = A.nearestNode(...(() => { const q = A.at(2418.3, 3077.3); return [q.x, 3.2, q.z]; })()), g = A.nearestNode(...(() => { const q = A.at(2420.3, 3083.8); return [q.x, 5.75, q.z]; })());
      me.body.pos.set(N[s].x, N[s].y, N[s].z); me.body.vel.set(0, 0, 0); A._e2ePi = 0;
      return { s, g, path: A.path(s, g) };
    });
    // steer along the path by turning the player each frame while W is held (like a player with the mouse)
    await p.keyboard.down('KeyW');
    let ok = false;
    for (let i = 0; i < 160; i++) {
      const st = await p.evaluate(({ path, g }) => {
        const A = COD.arena, me = COD.me, N = A.nav.nodes, b = me.body;
        let pi = A._e2ePi || 0; const k = A.lookahead(path, pi, b.pos), n = N[path[k]];
        if (Math.hypot(n.x - b.pos.x, n.z - b.pos.z) < 0.6 && Math.abs(n.y - b.pos.y) < 0.45) A._e2ePi = k + 1;
        b.yaw = Math.atan2(-(n.x - b.pos.x), -(n.z - b.pos.z));
        return { y: b.pos.y, d: Math.hypot(N[g].x - b.pos.x, N[g].z - b.pos.z), dy: Math.abs(N[g].y - b.pos.y) };
      }, r);
      if (st.d < 1 && st.dy < 0.4) { ok = true; break; }
      await waitGame(0.05);
    }
    await p.keyboard.up('KeyW');
    check(ok, 'walk up the castle stairs to the wall walk', `now y ${(await pos()).y.toFixed(2)} ${await state()}`);
  }
  // ---- the gun: a target 10 units ahead
  await place(2420, 3098);
  const target = await p.evaluate(() => { const g = COD.game, me = COD.me, e = g.enemies(me)[0], d = me.body.look(me.body.pos.clone()); e.body.pos.set(me.body.pos.x + d.x * 10, me.body.pos.y, me.body.pos.z + d.z * 10); e.body.vel.set(0, 0, 0); e.hp = 100; return e.id; });
  const aimAt = () => p.evaluate(id => { const g = COD.game, me = COD.me, e = g.fighters.find(f => f.id === id); const eye = me.eye(e.body.pos.clone()), t = e.body.pos.clone(); t.y += 1.28; const d = t.sub(eye).normalize(); me.body.yaw = Math.atan2(-d.x, -d.z); me.body.pitch = Math.asin(d.y); }, target);
  await aimAt(); await waitGame(0.3); await aimAt();
  const ammo0 = await p.evaluate(() => COD.me.gunner.g.ammo);
  const evs = await p.evaluate(() => { COD._ev = []; const h = COD.game.events; const orig = COD.game.emit.bind(COD.game); COD.game.emit = e => { COD._ev.push({ t: e.t, what: e.what, zone: e.zone, kill: e.kill, f: e.f?.id, v: e.v?.id, tags: e.tags }); orig(e); }; return true; });
  await p.mouse.down({ button: 'left' }); for (let i = 0; i < 10; i++) { await waitGame(0.1); await aimAt(); } await p.mouse.up({ button: 'left' });   // hold it on target, like a player fighting the kick
  const after = await p.evaluate(id => ({ ammo: COD.me.gunner.g.ammo, hp: COD.game.fighters.find(f => f.id === id).hp, alive: COD.game.fighters.find(f => f.id === id).alive, ev: COD._ev.filter(e => e.t === 'hit' || e.t === 'kill' || e.t === 'shot').length }), target);
  check(after.ammo < ammo0, 'LMB fires (ammo goes down)', `${ammo0} -> ${after.ammo}`);
  check(!after.alive || after.hp < 100, 'bullets hit the enemy', `hp ${Math.round(after.hp)} alive ${after.alive}`);
  check(await p.evaluate(() => COD._ev.some(e => e.t === 'kill')), 'the M4 kills (killfeed event)');
  check(await p.evaluate(() => COD.game.feed.length > 0 && COD.me.kills >= 1 && COD.game.score.sara + COD.game.score.zam >= 1), 'kill counts on the scoreboard + killfeed');
  await p.screenshot({ path: 'e2e-fire.png' });
  // ADS
  await p.mouse.down({ button: 'right' }); await waitGame(0.5);
  check(await p.evaluate(() => COD.me.gunner.ads > 0.95), 'RMB aims down sights');
  await p.screenshot({ path: 'e2e-ads.png' });
  await p.mouse.up({ button: 'right' }); await waitGame(0.4);
  // reload
  await p.evaluate(() => { COD.me.gunner.g.ammo = 5; });
  await p.keyboard.press('KeyR'); await waitGame(0.2);
  check(await p.evaluate(() => COD.me.gunner.phase === 'reload'), 'R reloads');
  await waitGame(1.0); await p.screenshot({ path: 'e2e-reload.png' });
  await waitGame(1.4);
  check(await p.evaluate(() => COD.me.gunner.g.ammo === 30 && COD.me.gunner.phase === 'idle'), 'the reload finishes with a full mag', await p.evaluate(() => `${COD.me.gunner.g.ammo}/${COD.me.gunner.g.reserve} ${COD.me.gunner.phase}`));
  // empty mag reloads itself when you pull the trigger
  await p.evaluate(() => { COD.me.gunner.g.ammo = 0; });
  await p.mouse.down({ button: 'left' }); await waitGame(0.2); await p.mouse.up({ button: 'left' });
  check(await p.evaluate(() => COD.me.gunner.phase === 'reload' && COD.me.gunner.empty), 'an empty mag reloads itself (empty reload)');
  await waitGame(2.8);
  // swap
  await p.keyboard.press('Digit2'); await waitGame(0.8);
  check(await p.evaluate(() => COD.me.gunner.cur === 1 && COD.me.gunner.w.name === 'M1911 .45'), '2 swaps to the sidearm');
  await p.keyboard.press('KeyQ'); await waitGame(0.8);
  check(await p.evaluate(() => COD.me.gunner.cur === 0), 'Q swaps back');
  // knife an enemy right in front
  const t2 = await p.evaluate(() => { const g = COD.game, me = COD.me, e = g.enemies(me)[0], d = me.body.look(me.body.pos.clone()); d.y = 0; d.normalize(); e.body.pos.set(me.body.pos.x + d.x * 1.4, me.body.pos.y, me.body.pos.z + d.z * 1.4); e.hp = 100; return e.id; });
  await p.keyboard.press('KeyV'); await waitGame(0.3);
  check(await p.evaluate(id => !COD.game.fighters.find(f => f.id === id).alive, t2), 'V knifes (one hit kill up close)');
  // grenade: hold to cook, release, it goes off
  await p.evaluate(() => { COD._ev = []; });
  await p.keyboard.down('KeyG'); await waitGame(0.6); await p.keyboard.up('KeyG'); await waitGame(3.6);
  check(await p.evaluate(() => COD._ev.some(e => e.t === 'nade') && COD._ev.some(e => e.t === 'boom')), 'G cooks and throws a grenade that explodes');
  // scoreboard + pause
  await p.keyboard.down('Tab'); await waitGame(0.1); await p.screenshot({ path: 'e2e-board.png' }); await p.keyboard.up('Tab');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check(await p.evaluate(() => COD.paused) && await p.isVisible('#pause'), 'ESC pauses');
  const tp = await gt(); await p.waitForTimeout(500);
  check(Math.abs((await gt()) - tp) < 1e-6, 'the match stops while paused');
  await p.click('#p-resume'); await p.waitForTimeout(300);
  check(!(await p.evaluate(() => COD.paused)), 'RESUME carries on');
  // change class from the pause menu
  await p.keyboard.press('Escape'); await p.waitForTimeout(200); await p.click('#p-class'); await p.click('[data-cls="2"]'); await p.click('#m-back'); await p.waitForTimeout(200);
  check(await p.evaluate(() => COD.me.loadout.primary === 'intervention'), 'pause -> change class applies next spawn', await p.evaluate(() => COD.me.loadout.primary));
  if (await p.isVisible('#p-resume')) await p.click('#p-resume');
  await p.mouse.click(400, 225); await p.waitForTimeout(200);
  // die, respawn (with the new class), the death screen
  await p.evaluate(() => { const g = COD.game, me = COD.me; g.damage(me, 500, g.enemies(me)[0], g.enemies(me)[0].gunner.w, 'chest', me.body.look(me.body.pos.clone())); });
  await waitGame(0.5);
  check(await p.evaluate(() => !COD.me.alive), 'you can die');
  await p.screenshot({ path: 'e2e-dead.png' });
  await waitGame(3.2); await p.keyboard.press('Space'); await waitGame(0.3);
  check(await p.evaluate(() => COD.me.alive && COD.me.hp === 100), 'SPACE respawns you after the timer');
  check(await p.evaluate(() => COD.me.gunner.w.name === 'Intervention'), 'respawned with the new class');
  // sniper: scope and a quickscope kill
  await place(2420, 3098);
  const t3 = await p.evaluate(() => { const g = COD.game, me = COD.me, e = g.enemies(me).find(f => f.alive), d = me.body.look(me.body.pos.clone()); e.body.pos.set(me.body.pos.x + d.x * 14, me.body.pos.y, me.body.pos.z + d.z * 14); e.hp = 100; return e.id; });
  const aim3 = () => p.evaluate(id => { const g = COD.game, me = COD.me, e = g.fighters.find(f => f.id === id); const eye = me.eye(e.body.pos.clone()), t = e.body.pos.clone(); t.y += 1.28; const d = t.sub(eye).normalize(); me.body.yaw = Math.atan2(-d.x, -d.z); me.body.pitch = Math.asin(d.y); }, t3);
  await waitGame(0.5); await aim3();
  await p.evaluate(() => { COD._ev = []; });
  await p.mouse.down({ button: 'right' }); await waitGame(0.42); await aim3(); await p.screenshot({ path: 'e2e-scope.png' });
  await p.mouse.down({ button: 'left' }); await waitGame(0.05); await p.mouse.up({ button: 'left' }); await p.mouse.up({ button: 'right' }); await waitGame(0.2);
  const qs = await p.evaluate(id => ({ dead: !COD.game.fighters.find(f => f.id === id).alive, tags: (COD._ev.find(e => e.t === 'kill') || {}).tags }), t3);
  check(qs.dead, 'the Intervention drops them in one shot', JSON.stringify(qs.tags) + ' ' + await state());
  check((qs.tags || []).includes('QUICKSCOPE'), 'a quick ADS kill counts as a QUICKSCOPE');
  // a 360 noscope: spin a full turn with the mouse, then fire from the hip
  await waitGame(1.3);
  const t4 = await p.evaluate(() => { const g = COD.game, me = COD.me, e = g.enemies(me).find(f => f.alive), d = me.body.look(me.body.pos.clone()); e.body.pos.set(me.body.pos.x + d.x * 3, me.body.pos.y, me.body.pos.z + d.z * 3); e.hp = 100; return e.id; });
  await p.evaluate(() => { COD._ev = []; COD.me.gunner.slots[0].w = { ...COD.me.gunner.slots[0].w, noscope: 0.01 }; });   // (a dead-on noscope, so the test is about the spin, not luck)
  const spin = await p.evaluate(() => COD.settings.sens);
  const px360 = Math.round(Math.PI * 2 / (0.0022 * spin)); let moved = 0; let mx = 640;
  for (let i = 0; i < 20; i++) { await p.evaluate(dx => window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0 })), Math.round(px360 / 20)); await waitGame(0.02); }
  await p.evaluate(id => { const g = COD.game, me = COD.me, e = g.fighters.find(f => f.id === id); const eye = me.eye(e.body.pos.clone()), t = e.body.pos.clone(); t.y += 1.28; const d = t.sub(eye).normalize(); const want = Math.atan2(-d.x, -d.z); let dy = want - me.body.yaw; dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; me.body.yaw += dy; me.body.pitch = Math.asin(d.y); }, t4);
  await p.mouse.down({ button: 'left' }); await waitGame(0.05); await p.mouse.up({ button: 'left' }); await waitGame(0.2);
  const ns = await p.evaluate(() => (COD._ev.find(e => e.t === 'kill') || {}).tags || []);
  check(ns.includes('360') && ns.includes('NOSCOPE'), 'spin 360 and noscope: 360 NOSCOPE', JSON.stringify(ns));
  // ---- bots: let them loose, they fight and score
  await unfreeze();
  const k0 = await p.evaluate(() => COD.game.fighters.reduce((a, f) => a + f.kills, 0));
  await place(2400, 3104);
  const t0b = await gt(); await p.waitForFunction(([t0, k0]) => COD.game.t > t0 + 30 || COD.game.fighters.reduce((a, f) => a + f.kills, 0) > k0, [t0b, k0], { timeout: 400000 });
  const k1 = await p.evaluate(() => COD.game.fighters.reduce((a, f) => a + f.kills, 0));
  check(k1 > k0, 'the bots fight', `${k1 - k0} kill(s) after ${((await gt()) - t0b).toFixed(1)} s of game time`);
  // ---- the end of a match, play again, main menu
  await p.evaluate(() => { COD.game.timeLeft = 0.05; });
  await p.waitForSelector('#endbox', { state: 'visible', timeout: 30000 }).catch(() => {});
  check(await p.isVisible('#endbox'), 'time up: match over screen');
  await p.screenshot({ path: 'e2e-end.png' });
  await p.click('#e-again'); await p.waitForFunction(() => COD.game && !COD.game.over && COD.me.alive, null, { timeout: 60000 });
  check(true, 'PLAY AGAIN starts a fresh match');
  // ---- CTF: take their flag, bring it home
  await p.keyboard.press('Escape'); await p.waitForTimeout(200); await p.click('#p-quit'); await p.waitForTimeout(300);
  check(await p.isVisible('#menubox'), 'QUIT MATCH goes back to the menu');
  await p.click('#m-play'); await p.click('[data-k="MODE"][data-v="ctf"]'); await p.click('[data-k="SIZE"][data-v="2"]'); await p.click('#m-go');
  await p.waitForFunction(() => COD.game && COD.game.modeId === 'ctf' && COD.me.alive, null, { timeout: 120000 });
  await freeze();
  await p.evaluate(() => { const g = COD.game, me = COD.me, fl = g.flags[me.team === 'sara' ? 'zam' : 'sara']; me.body.pos.copy(fl.home); me.body.pos.x += 0.4; me.body.vel.set(0, 0, 0); });
  await waitGame(0.3);
  check(await p.evaluate(() => !!COD.me.carrying), 'CTF: touching their standard takes it');
  await p.evaluate(() => { const g = COD.game, me = COD.me, fl = g.flags[me.team]; me.body.pos.copy(fl.home); me.body.pos.x += 0.4; me.body.vel.set(0, 0, 0); });
  await waitGame(0.3);
  check(await p.evaluate(() => COD.game.score[COD.me.team] === 1 && !COD.me.carrying && COD.game.flags.sara.state === 'home' && COD.game.flags.zam.state === 'home'), 'CTF: bringing it home captures (+1)', await p.evaluate(() => JSON.stringify(COD.game.score)));
  // a dropped flag: carrier dies, it drops, a defender returns it
  await p.evaluate(() => { const g = COD.game, me = COD.me, fl = g.flags[me.team === 'sara' ? 'zam' : 'sara']; me.body.pos.copy(fl.home); me.body.pos.x += 0.4; });
  await waitGame(0.3);
  await p.evaluate(() => { const g = COD.game, me = COD.me; g.damage(me, 500, g.enemies(me)[0], g.enemies(me)[0].gunner.w, 'chest', me.body.look(me.body.pos.clone())); });
  await waitGame(0.1);
  check(await p.evaluate(() => COD.game.flags[COD.me.team === 'sara' ? 'zam' : 'sara'].state === 'dropped'), 'CTF: the carrier dies, the flag drops');
  await p.evaluate(() => { const g = COD.game, me = COD.me, fl = g.flags[me.team === 'sara' ? 'zam' : 'sara'], d = g.fighters.find(f => f.team === fl.team); d.body.pos.copy(fl.pos); d.alive = true; });
  await waitGame(0.3);
  check(await p.evaluate(() => COD.game.flags[COD.me.team === 'sara' ? 'zam' : 'sara'].state === 'home'), 'CTF: a defender touching it returns it');
  await p.screenshot({ path: 'e2e-ctf.png' });
  // ---- gamepad: a fake pad, RT fires, the left stick moves
  await p.evaluate(() => { COD.game.timeLeft = 9999; });
  await p.waitForFunction(() => COD.me.respawnT <= 0 || COD.me.alive, null, { timeout: 400000 }); await p.keyboard.press('Space'); await waitGame(0.3);   // (CTF respawn is 5 s)
  await p.evaluate(() => {
    const pad = { connected: true, axes: [0, -1, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad; navigator.getGamepads = () => [pad];
  });
  await place(2420, 3098);
  const g0 = await pos(); await waitGame(0.6); const g1 = await pos();
  check(Math.hypot(g1.x - g0.x, g1.z - g0.z) > 1.5 && await p.evaluate(() => COD.input.device === 'pad'), 'gamepad: the left stick moves you', `${Math.hypot(g1.x - g0.x, g1.z - g0.z).toFixed(2)} ${await state()}`);
  await p.evaluate(() => { window.__pad.axes = [0, 0, 0.8, 0]; });
  const gy0 = (await pos()).yaw; await waitGame(0.3); const gy1 = (await pos()).yaw;
  check(Math.abs(gy1 - gy0) > 0.2, 'gamepad: the right stick turns you', `${(gy1 - gy0).toFixed(2)} rad`);
  await p.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; window.__pad.buttons[7] = { pressed: true, value: 1 }; });
  const pa0 = await p.evaluate(() => COD.me.gunner.g.ammo + COD.me.gunner.g.reserve); await waitGame(0.6);
  const pa1 = await p.evaluate(() => COD.me.gunner.g.ammo + COD.me.gunner.g.reserve);
  check(pa1 < pa0, 'gamepad: RT fires', `${pa0} -> ${pa1}`);
  await p.evaluate(() => { window.__pad.buttons[7] = { pressed: false, value: 0 }; window.__pad.buttons[6] = { pressed: true, value: 1 }; });
  await waitGame(0.6);
  check(await p.evaluate(() => COD.me.gunner.ads > 0.9), 'gamepad: LT aims');
  // aim assist: an enemy just off the crosshair, ADS snaps toward it
  await p.evaluate(() => { window.__pad.buttons[6] = { pressed: false, value: 0 }; });
  await waitGame(0.5);
  const off0 = await p.evaluate(() => { const g = COD.game, me = COD.me, e = g.enemies(me)[0], d = me.body.look(me.body.pos.clone()); d.y = 0; d.normalize(); e.alive = true; e.hp = 999; e.body.pos.set(me.body.pos.x + d.x * 12 + d.z * 1.2, me.body.pos.y, me.body.pos.z + d.z * 12 - d.x * 1.2); const t = e.body.pos.clone(), eye = me.eye(t.clone()); t.y += 1.1; const dd = t.sub(eye).normalize(); const want = Math.atan2(-dd.x, -dd.z); COD._aaE = e.id; return Math.abs(((want - me.body.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI); });
  await p.evaluate(() => { window.__pad.buttons[6] = { pressed: true, value: 1 }; }); await waitGame(0.4);
  const off1 = await p.evaluate(() => { const g = COD.game, me = COD.me, e = g.fighters.find(f => f.id === COD._aaE); const t = e.body.pos.clone(), eye = me.eye(t.clone()); t.y += 1.1; const dd = t.sub(eye).normalize(); const want = Math.atan2(-dd.x, -dd.z); return Math.abs(((want - me.body.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI); });
  check(off1 < off0 * 0.5, 'gamepad aim assist: ADS snaps onto a nearby enemy', `${(off0 * 57.3).toFixed(1)}° -> ${(off1 * 57.3).toFixed(1)}°`);
  await p.evaluate(() => { window.__pad.buttons[6] = { pressed: false, value: 0 }; window.__pad.connected = false; navigator.getGamepads = () => []; });
  await p.close();
  // ---------------------------------------------------------------- phone: touch controls
  {
    const m = await (await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage(); watch(m);
    await m.goto(BASE + '/cod.html');
    await m.waitForFunction(() => document.title === 'CODScape', null, { timeout: 180000 });
    await m.screenshot({ path: 'e2e-phone-menu.png' });
    await m.tap('#m-play'); await m.tap('[data-k="SIZE"][data-v="2"]'); await m.tap('#m-go');
    await m.waitForFunction(() => COD.game && COD.me && COD.me.alive, null, { timeout: 120000 });
    check(await m.isVisible('#ctouch .fire'), 'phone: touch controls show');
    await m.evaluate(() => { for (const f of COD.game.fighters) if (f.brain) f.brain.think = () => ({ move: {}, gun: {} }); const A = COD.arena, me = COD.me, q = A.at(2420, 3098); me.body.pos.set(q.x, A.floor(q.x, 12, q.z, 0, 20), q.z); me.body.yaw = Math.PI / 2; });
    const mgt = () => m.evaluate(() => COD.game.t), mwait = async s => { const t0 = await mgt(); await m.waitForFunction(([t0, s]) => COD.game.t >= t0 + s, [t0, s], { timeout: 400000 }); };
    // the move stick: press in the left zone and drag up (pointer events, like a finger)
    const tpos = () => m.evaluate(() => ({ x: COD.me.body.pos.x, z: COD.me.body.pos.z, yaw: COD.me.body.yaw }));
    const drag = async (sel, x0, y0, x1, y1, hold) => m.evaluate(async ([sel, x0, y0, x1, y1, hold]) => {
      const el = document.querySelector(sel), id = 7 + Math.floor(Math.random() * 100), o = { pointerId: id, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x0, clientY: y0 }));
      for (let i = 1; i <= 8; i++) { el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x0 + (x1 - x0) * i / 8, clientY: y0 + (y1 - y0) * i / 8 })); await new Promise(r => setTimeout(r, 16)); }
      const t0 = COD.game.t; while (COD.game.t < t0 + hold) await new Promise(r => setTimeout(r, 30));
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x1, clientY: y1 }));
    }, [sel, x0, y0, x1, y1, hold]);
    const s0 = await tpos(); await drag('#ctouch .move', 120, 300, 120, 250, 0.7); const s1 = await tpos();
    check(Math.hypot(s1.x - s0.x, s1.z - s0.z) > 1.5, 'phone: the left thumb moves you', Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(2));
    await drag('#ctouch .look', 600, 200, 680, 200, 0.1); const s2 = await tpos();
    check(Math.abs(s2.yaw - s1.yaw) > 0.1, 'phone: dragging the right side aims', (s2.yaw - s1.yaw).toFixed(2));
    const ta0 = await m.evaluate(() => COD.me.gunner.g.ammo);
    await drag('#ctouch .fire', 780, 230, 782, 230, 0.4);
    check(await m.evaluate(() => COD.me.gunner.g.ammo) < ta0, 'phone: FIRE shoots');
    await m.tap('#ctouch .ads'); await mwait(0.5);
    check(await m.evaluate(() => COD.me.gunner.ads > 0.9), 'phone: AIM toggles sights');
    await m.tap('#ctouch .ads'); await m.evaluate(() => { COD.me.gunner.g.ammo = 3; }); await m.tap('#ctouch .reload'); await mwait(0.2);
    check(await m.evaluate(() => COD.me.gunner.phase === 'reload'), 'phone: RELOAD');
    await m.screenshot({ path: 'e2e-phone-play.png' });
    await m.close();
  }
  await b.close();
  const real = errors.filter(e => !/favicon|WebGL|GPU stall|Autoplay|AudioContext/i.test(e));
  check(real.length === 0, 'no errors in the console', real.slice(0, 5).join(' || '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('E2E CRASH', e.message, e.stack); process.exit(2); });
