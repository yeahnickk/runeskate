// MineScape 2b2t, the browser's side (the server is netserver.js): your game runs here as ever, survival; what you
// change goes up a cell at a time, what everyone else changes comes down and is set straight into the world (no flow
// woken: their game runs what follows from it). Other players are RS bodies with MC name tags, hit like mobs (the hit
// goes to them). Lit TNT shows up as a ghost fuse; its blast shakes you here and the holes come as edits.
import * as THREE from 'three'
import { buildOutfitModel } from '../rsanim.js'
import { outfitOf, playerClip } from './bodies.js'
import { text, width } from './font.js'

const turnTo = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * Math.min(1, k) }
// flags in a state: what the body is doing, for its clip
const F = { ground: 1, sneak: 2, sprint: 4, fly: 8, dead: 16, swing: 32, dig: 64, eat: 128, bow: 256, hurt: 512, water: 1024 }

export class Net2b {
  constructor() { this.peers = new Map(); this.q = new Set(); this.applying = false; this.sentChest = new Map(); this.n = 0; this.onLost = null; this.onChat = null }
  /** connect and say hello: resolves with the server's welcome + the world's edits and chests */
  connect(name) {
    return new Promise((ok, no) => {
      const ws = this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/mine-ws')
      ws.binaryType = 'arraybuffer'
      let hi = null, done = false
      const fail = (m) => { if (!done) { done = true; no(new Error(m)) } else if (this.onLost) this.onLost(m) }
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hi', name }))
      ws.onerror = () => fail('Could not connect to 2b2t')
      ws.onclose = () => fail(done ? 'Connection lost' : 'Could not connect to 2b2t')
      ws.onmessage = async (ev) => {
        if (ev.data instanceof ArrayBuffer) {           // (the world: gzipped JSON)
          const txt = await new Response(new Blob([ev.data]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
          if (!done && hi) { done = true; ok({ ...hi, world: JSON.parse(txt) }) }
          return
        }
        const m = JSON.parse(ev.data)
        if (!done) { if (m.t === 'hi') { hi = m; this.id = m.id; this.name = m.name; for (const p of m.ps) this.peer(p.id, p.name) } else if (m.t === 'full') fail('2b2t is full (' + m.max + ' players). Try again soon.'); return }
        this.recv(m)
      }
    })
  }
  close() { this.onLost = null; try { this.ws && this.ws.close() } catch (e) {} this.ws = null; this.drop() }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)) }
  /** start playing in this game/world/view: watch the world for our own edits */
  attach(game, world, view, sfx) {
    Object.assign(this, { game, world, view, sfx })
    world.listeners.push((x, y, z) => { if (!this.applying) this.q.add(x + ',' + y + ',' + z) })
    for (const [k, s] of game.chests) this.sentChest.set(k, JSON.stringify(s))
    for (const p of this.peers.values()) this.ent(p)
  }
  drop() { for (const p of this.peers.values()) this.unpeer(p); this.peers.clear() }

  // ------------------------------------------------------------------ in
  recv(m) {
    const G = this.game
    if (m.t === 'ps') { const a = m.p; for (let i = 0; i < a.length; i += 12) { if (a[i] === this.id) continue; const p = this.peers.get(a[i]); if (p) { p.st = a.slice(i + 1, i + 12); p.at = performance.now() } } }
    else if (m.t === 'ed') {
      if (!this.world) return
      this.applying = true
      try { const e = m.e; for (let i = 0; i < e.length; i += 4) this.world.set(e[i], e[i + 1], e[i + 2], e[i + 3] & 255, e[i + 3] >> 8) }
      finally { this.applying = false }
    }
    else if (m.t === 'chest') { if (!G) return; if (m.s) { G.chests.set(m.k, m.s); this.sentChest.set(m.k, JSON.stringify(m.s)) } else { G.chests.delete(m.k); this.sentChest.delete(m.k) } }
    else if (m.t === 'c') this.onChat && this.onChat(m.m)
    else if (m.t === 'join') this.peer(m.id, m.name)
    else if (m.t === 'bye') { const p = this.peers.get(m.id); if (p) { this.unpeer(p); this.peers.delete(m.id) } }
    else if (m.t === 'tm') { if (G) G.time = m.v }
    else if (m.t === 'hurt') { if (G && !G.player.dead) { G.hurtPlayer(m.d, { x: m.x, z: m.z, pn: m.by, pid: m.bid }, 'pvp'); const P = G.player; if (m.kb !== 0.5 && !P.dead) { P.vx *= m.kb / 0.5 * 0.8; P.vz *= m.kb / 0.5 * 0.8 } } }
    else if (m.t === 'loot') { if (!G) return; const P = G.player, far = Math.hypot(m.x - P.x, m.z - P.z) > 64; for (const s of m.s) G.dropItem(s, far ? P.x : m.x, far ? P.y + 1 : m.y, far ? P.z : m.z) }
    else if (m.t === 'fx') {
      if (!G) return
      const P = G.player; if (Math.abs(m.x - P.x) > 96 || Math.abs(m.z - P.z) > 96) return
      if (m.k === 'prime') { G.ents.push({ e: 'tnt', ghost: true, x: m.x, y: m.y, z: m.z, vx: 0, vy: 0.2, vz: 0, w: 0.98, h: 0.98, fuse: m.f }); G.emit({ t: 'snd', s: 'fuse', x: m.x, y: m.y, z: m.z }) }
      else if (m.k === 'boom') {
        for (const e of G.ents) if (e.ghost && e.fuse > 0 && Math.hypot(e.x - m.x, e.z - m.z) < 3 && e.fuse < 20) { e.gone = true; break }   // (its ghost goes with it)
        G.remoteBoom(m.x, m.y, m.z, m.r)
      }
    }
  }
  peer(id, name) { if (id === this.id || this.peers.has(id)) return; const p = { id, name, st: null, key: null, m: null, at: 0 }; this.peers.set(id, p); if (this.game) this.ent(p) }
  ent(p) { if (!p.e) p.e = { e: 'peer', id: p.id, name: p.name, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, w: 0.6, h: 1.8, yaw: 0, hurt: 0 }; if (!this.game.ents.includes(p.e)) this.game.ents.push(p.e) }
  unpeer(p) {
    if (p.g && p.g.parent) p.g.parent.remove(p.g)
    if (p.tag) { p.tag.material.map.dispose(); p.tag.material.dispose() }
    if (p.e) p.e.gone = true
  }

  // ------------------------------------------------------------------ out (each game tick)
  event(e) {
    if (e.t === 'pvp') this.send({ t: 'hit', id: e.id, d: Math.round(e.dmg * 100) / 100, kb: e.kb })
    else if (e.t === 'prime') this.send({ t: 'fx', k: 'prime', x: e.x, y: e.y, z: e.z, f: e.fuse })
    else if (e.t === 'boom' && !e.remote) this.send({ t: 'fx', k: 'boom', x: e.x, y: e.y, z: e.z, r: e.r })
    else if (e.t === 'death') this.send({ t: 'die', m: e.msg })
    else if (e.t === 'loot' && e.to) this.send({ t: 'loot', to: e.to, s: e.s, x: e.x, y: e.y, z: e.z })
  }
  tick() {
    const G = this.game, W = this.world, P = G.player; this.n++
    if (this.q.size) {     // the cells we changed, as they are now
      const e = []
      for (const k of this.q) { const [x, y, z] = k.split(',').map(Number); e.push(x, y, z, W.get(x, y, z) | (W.meta(x, y, z) << 8)) }
      this.q.clear()
      for (let i = 0; i < e.length; i += 4096 * 4) this.send({ t: 'ed', e: e.slice(i, i + 4096 * 4) })
    }
    if (this.n % 2 === 0) {
      const h = P.inv[P.sel], a = P.armor.map(s => s ? s.id : 0)
      const fl = (P.onGround ? F.ground : 0) | (P.sneak ? F.sneak : 0) | (P.sprint ? F.sprint : 0) | (P.flying ? F.fly : 0) | (P.dead ? F.dead : 0) | (P.swing > 0 ? F.swing : 0) |
        (P.dig ? F.dig : 0) | (P.eat ? F.eat : 0) | (P.bowT ? F.bow : 0) | (P.hurtT > 0 ? F.hurt : 0) | (P.inWater ? F.water : 0)
      this.send({ t: 'p', s: [P.x, P.y, P.z, P.face ?? P.yaw, P.pitch, fl, h ? h.id : 0, ...a] })
    }
    if (this.n % 20 === 0) {   // the chests we've changed (and those we broke)
      for (const [k, s] of G.chests) { const j = JSON.stringify(s); if (this.sentChest.get(k) !== j) { this.sentChest.set(k, j); this.send({ t: 'chest', k, s }) } }
      for (const k of [...this.sentChest.keys()]) if (!G.chests.has(k)) { this.sentChest.delete(k); this.send({ t: 'chest', k, s: null }) }
    }
    for (const p of this.peers.values()) if (p.e && p.e.hurt > 0) p.e.hurt--
  }
  list() { return [this.name, ...[...this.peers.values()].map(p => p.name)] }

  // ------------------------------------------------------------------ drawing (each frame)
  frame(dt) {
    const V = this.view; if (!V) return
    for (const p of this.peers.values()) {
      const s = p.st, e = p.e; if (!s || !e) continue
      const [x, y, z, yaw, , fl, held, a0, a1, a2, a3] = s
      if (e.y < -900 || Math.hypot(x - e.x, y - e.y, z - e.z) > 8) { e.x = x; e.y = y; e.z = z; e.yaw = yaw }   // (first sight, or a teleport: no sliding there)
      const k = Math.min(1, dt * 12), px = e.x, pz = e.z
      e.x += (x - e.x) * k; e.y += (y - e.y) * k; e.z += (z - e.z) * k; e.yaw = turnTo(e.yaw, yaw, k)
      const sp = Math.hypot(e.x - px, e.z - pz) / Math.max(dt, 1e-3) / 20       // (blocks a tick, as playerClip wants)
      const pseudo = { inv: [held ? { id: held } : null], sel: 0, armor: [a0, a1, a2, a3].map(id => id ? { id } : null) }
      const out = outfitOf(pseudo), key = JSON.stringify(out.items)
      if (!p.g) {
        p.g = new THREE.Group(); p.o = {}
        const c = document.createElement('canvas'), w = width(p.name) + 4; c.width = w; c.height = 10
        const X = c.getContext('2d'); X.fillStyle = 'rgba(0,0,0,0.25)'; X.fillRect(0, 0, w, 10); text(X, p.name, 2, 1, '#ffffff', false)
        const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.LinearSRGBColorSpace
        p.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, fog: false })); p.tag.scale.set(w / 40, 10 / 40, 1); p.tag.position.y = 2.25; p.tag.renderOrder = 10
        p.g.add(p.tag)
      }
      if (p.g.parent !== V.scene) V.scene.add(p.g)
      if (key !== p.key) {
        p.key = key
        buildOutfitModel(out).then(m => { if (p.key !== key || !p.g) return; if (p.m) p.g.remove(p.m.group); p.m = m; p.g.add(m.group); m.mesh.material.fog = true; m.clip = null }).catch(() => {})
      }
      const G = this.game, P = G.player, near = Math.abs(e.x - P.x) < 96 && Math.abs(e.z - P.z) < 96
      p.g.visible = near
      if (!near) continue
      p.g.position.set(e.x, V.drawY({ onGround: !!(fl & F.ground), e: 'peer' }, e.x, e.y, e.z, p.o), e.z)
      e.drawDy = p.o.dy
      p.g.rotation.y = e.yaw + Math.PI
      p.tag.visible = !(fl & F.sneak) && !(fl & F.dead)
      if (p.m) {
        const st = { dead: fl & F.dead, eat: fl & F.eat, bowT: fl & F.bow, dig: fl & F.dig, swing: fl & F.swing ? 1 : 0, onGround: fl & F.ground, inWater: fl & F.water, flying: fl & F.fly, vy: (y - (p.ly ?? y)) || 0, sprint: fl & F.sprint }
        p.ly = y
        const [clip, loop] = playerClip(st, pseudo.inv[0], sp)
        if ((fl & F.swing) && !p.sw && !(fl & F.dig)) p.m.play(clip, loop, true)
        p.sw = fl & F.swing
        if (p.m.clip !== clip && !(p.m.clip === 'slash' || p.m.clip === 'pound') || (p.m.done && p.m.clip !== clip)) p.m.play(clip, loop)
        p.m.update(dt)
        const L = V.lightK(e.x, e.y + 1.2, e.z), hurt = (fl & F.hurt) || e.hurt > 0
        p.m.mesh.material.color.setRGB(hurt ? L * 1.4 : L, hurt ? L * 0.5 : L, hurt ? L * 0.5 : L)
      }
    }
  }
}
