// Plan interactif (canvas 2D) : vue de dessus de la salle, dans les mêmes
// coordonnées (mètres) que la scène 3D. Pincement, glissement, molette, boutons,
// clavier. Repère « Scène » toujours visible (flèche au bord quand elle sort du cadre).

import { CATEGORIES } from './concert.js';

const MIN_TAP_PX = 22; // pas de siège minimal à l'écran pour viser au doigt
const SEAT = 0.5; // pas latéral des sièges (m), mesuré sur le plan

export class SeatPlan {
  constructor(root, venue, { onSeat, onFocusSeat, onViewChange, categoryOf, categories = CATEGORIES }) {
    this.root = root;
    this.venue = venue;
    this.onSeat = onSeat;
    this.onFocusSeat = onFocusSeat;
    this.onViewChange = onViewChange;
    this.categories = categories;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-roledescription', 'plan de salle');
    this.canvas.setAttribute('aria-label', 'Plan du Palais Nikaïa. Flèches pour parcourir les places, Entrée pour voir depuis la place, plus et moins pour zoomer.');
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.view = { s: 1, tx: 0, ty: 0 };
    this.state = { taken: new Set(), selected: null, compare: null, focus: null, category: null };
    this.pointers = new Map();
    this.cat = new Map(venue.seats.map((s) => [s.id, categoryOf(s)]));
    this._neighbours();
    this._bind();
    this._raf = 0;
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(root);
    this._resize();
    this.fit(false);
  }

  // ----- état ---------------------------------------------------------------
  setState(patch) {
    Object.assign(this.state, patch);
    this.draw();
  }

  destroy() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this._anim);
    cancelAnimationFrame(this._raf);
  }

  // voisins pour le clavier : même rang (numéro ±), rang devant/derrière
  _neighbours() {
    const rows = new Map();
    for (const s of this.venue.seats) {
      const k = `${s.block}|${s.row}|${s.zone}|${s.zone === 'tribune' ? Math.sign(s.x) : 0}`;
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(s);
    }
    this.rowOf = new Map();
    this.rows = [...rows.values()];
    for (const list of this.rows) {
      list.sort((a, b) => a.x - b.x);
      list.forEach((s) => this.rowOf.set(s.id, list));
    }
  }

  // ----- vue ----------------------------------------------------------------
  get size() { return { w: this.root.clientWidth, h: this.root.clientHeight }; }

  worldBox() {
    const b = this.venue.bounds;
    return { x0: b.x0 - 1, x1: b.x1 + 1, z0: -this.venue.stage.depth - 1.2, z1: b.z1 + 1.5 };
  }

  fitScale() {
    const { w, h } = this.size, B = this.worldBox();
    return Math.min((w - 16) / (B.x1 - B.x0), (h - 16) / (B.z1 - B.z0));
  }

  fitView() {
    const { w, h } = this.size, B = this.worldBox(), s = this.fitScale();
    return { s, tx: w / 2 - ((B.x0 + B.x1) / 2) * s, ty: h / 2 - ((B.z0 + B.z1) / 2) * s };
  }

  fit(animate = true) { this._go(this.fitView(), animate); }

  zoomLevel() { return this.view.s / this.fitScale(); }

  _clamp(v) {
    const { w, h } = this.size, B = this.worldBox();
    const fs = this.fitScale();
    v.s = Math.min(Math.max(v.s, fs * 0.95), 70);
    const minX = w - B.x1 * v.s - w * 0.4, maxX = -B.x0 * v.s + w * 0.4;
    const minY = h - B.z1 * v.s - h * 0.4, maxY = -B.z0 * v.s + h * 0.4;
    v.tx = Math.min(maxX, Math.max(minX, v.tx));
    v.ty = Math.min(maxY, Math.max(minY, v.ty));
    return v;
  }

  zoomAt(px, py, f, animate = true) {
    const v = this.view;
    this._go(this._clamp({ s: v.s * f, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f }), animate);
  }

  zoomBy(f) { const { w, h } = this.size; this.zoomAt(w / 2, h / 2, f); }

  // cadre une zone (liste de sièges), avec la scène gardée en vue si possible
  frameSeats(list, animate = true) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of list) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const { w, h } = this.size;
    const pad = 2.5;
    const s = Math.min(this.fitScale() * 6, Math.min(w / (x1 - x0 + pad * 2), h / (z1 - z0 + pad * 2)));
    this._go(this._clamp({ s, tx: w / 2 - ((x0 + x1) / 2) * s, ty: h / 2 - ((z0 + z1) / 2) * s }), animate);
  }

  centerOn(seat, minPitch = 26) {
    const { w, h } = this.size;
    const s = Math.max(this.view.s, minPitch / SEAT);
    this._go(this._clamp({ s, tx: w / 2 - seat.x * s, ty: h / 2 - seat.z * s }), true);
  }

  getView() { return { ...this.view }; }
  setView(v) {
    cancelAnimationFrame(this._anim);
    this.view = this._clamp({ ...v });
    this.draw();
  }

  _go(target, animate) {
    cancelAnimationFrame(this._anim);
    const still = !animate || document.documentElement.classList.contains('no-motion');
    if (still) { this.view = target; this.draw(); return; }
    const from = { ...this.view }, t0 = performance.now(), ms = 320;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      const s = from.s * (target.s / from.s) ** e;
      this.view = { s, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e };
      this.draw();
      if (k < 1) this._anim = requestAnimationFrame(step);
    };
    this._anim = requestAnimationFrame(step);
  }

  _resize() {
    const { w, h } = this.size;
    if (!w || !h) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    if (!this._fittedOnce || this._wasFit) { this.view = this.fitView(); this._fittedOnce = true; }
    else this._clamp(this.view);
    // Modifier les dimensions efface le canvas. Repeindre dans la même tâche
    // évite un plan vide quand la fiche de place change sa hauteur.
    cancelAnimationFrame(this._raf);
    this._draw();
  }

  toWorld(px, py) { const v = this.view; return { x: (px - v.tx) / v.s, z: (py - v.ty) / v.s }; }
  toScreen(x, z) { const v = this.view; return { x: x * v.s + v.tx, y: z * v.s + v.ty }; }

  // ----- dessin ---------------------------------------------------------------
  draw() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this._draw());
  }

  _draw() {
    const { ctx, venue, view: v } = this;
    const { w, h } = this.size;
    if (!w) return;
    this._wasFit = Math.abs(v.s - this.fitScale()) < 1e-6;
    const css = getComputedStyle(this.root);
    const col = (n, d) => css.getPropertyValue(n).trim() || d;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(v.tx, v.ty);
    ctx.scale(v.s, v.s);
    const px = 1 / v.s;

    // murs (plan de jauge D6, 1/500)
    ctx.strokeStyle = col('--plan-wall', '#3a3f4b');
    ctx.lineWidth = Math.max(px * 1.2, 0.12);
    ctx.beginPath();
    for (const [ax, az, bx, bz] of venue.walls) { ctx.moveTo(ax, az); ctx.lineTo(bx, bz); }
    ctx.stroke();

    // scène standard du lieu
    const st = venue.stage;
    const grd = ctx.createLinearGradient(0, -st.depth, 0, 0);
    grd.addColorStop(0, col('--plan-stage-a', '#2b1f3d'));
    grd.addColorStop(1, col('--plan-stage-b', '#5b2a6e'));
    ctx.fillStyle = grd;
    ctx.fillRect(-st.width / 2, -st.depth, st.width, st.depth);
    ctx.strokeStyle = col('--plan-stage-edge', '#d58cff');
    ctx.lineWidth = Math.max(px * 2, 0.2);
    ctx.beginPath(); ctx.moveTo(-st.width / 2, 0); ctx.lineTo(st.width / 2, 0); ctx.stroke();

    // régie (emplacement fixe)
    ctx.fillStyle = col('--plan-regie', 'rgba(140,150,170,.22)');
    for (const p of venue.regie.parts) ctx.fillRect(p.x0, p.z0, p.x1 - p.x0, p.z1 - p.z0);

    // garde-corps
    ctx.strokeStyle = col('--plan-rail', '#9aa3b5');
    ctx.lineWidth = Math.max(px * 1, 0.08);
    ctx.beginPath();
    for (const r of venue.rails) { ctx.moveTo(...r.pts[0]); for (const p of r.pts.slice(1)) ctx.lineTo(...p); }
    ctx.stroke();

    // sièges
    const pitch = SEAT * v.s;
    const detailed = pitch >= 9;
    const numbered = pitch >= MIN_TAP_PX ? [] : null;
    const { taken, selected, compare, focus, category } = this.state;
    const r = detailed ? 0.2 : 0.23;
    const vis = this.toWorld(0, 0), vis2 = this.toWorld(w, h);
    const takenCol = col('--plan-taken', '#454b57');
    for (const s of venue.seats) {
      if (s.x < vis.x - 1 || s.x > vis2.x + 1 || s.z < vis.z - 1 || s.z > vis2.z + 1) continue;
      const cat = this.cat.get(s.id);
      const isTaken = taken.has(s.id);
      const dim = category && cat !== category;
      if (numbered && s.id !== selected && s.id !== compare && !dim) numbered.push(s);
      ctx.globalAlpha = dim ? 0.18 : 1;
      if (isTaken) {
        ctx.fillStyle = takenCol;
        if (detailed) { ctx.beginPath(); ctx.arc(s.x, s.z, r * 0.62, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(s.x - 0.14, s.z - 0.14, 0.28, 0.28);
        continue;
      }
      ctx.fillStyle = (s.pmr || s.companion) ? '#3d8bff' : this.categories[cat]?.color || '#9a9ba8';
      if (detailed) {
        // assise + dossier orientés vers la scène
        ctx.save();
        ctx.translate(s.x, s.z);
        ctx.rotate(Math.atan2(s.fz, s.fx) - Math.PI / 2 + Math.PI);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-0.2, -0.16, 0.4, 0.34, 0.07) : ctx.rect(-0.2, -0.16, 0.4, 0.34);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillRect(s.x - 0.2, s.z - 0.2, 0.4, 0.4);
      }
    }
    ctx.globalAlpha = 1;

    // repères : choisie (A), comparée (B), focus clavier
    const mark = (id, label, color) => {
      const s = venue.byId.get(id);
      if (!s) return;
      const rr = Math.max(0.42, 9 * px);
      ctx.lineWidth = Math.max(0.09, 2.5 * px);
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = color;
      ctx.beginPath();
      if (label === 'B') { ctx.moveTo(s.x, s.z - rr); ctx.lineTo(s.x + rr, s.z); ctx.lineTo(s.x, s.z + rr); ctx.lineTo(s.x - rr, s.z); ctx.closePath(); }
      else ctx.arc(s.x, s.z, rr, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = `700 ${rr * 1.1}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, s.x, s.z + rr * 0.06);
    };
    if (compare) mark(compare, 'B', '#7ee0ff');
    if (selected) mark(selected, 'A', '#ffd34d');
    if (focus && focus !== selected && focus !== compare) {
      const s = venue.byId.get(focus);
      if (s) {
        ctx.strokeStyle = col('--focus', '#fff');
        ctx.lineWidth = Math.max(0.07, 2 * px);
        ctx.setLineDash([3 * px, 2 * px]);
        ctx.beginPath(); ctx.arc(s.x, s.z, Math.max(0.45, 8 * px), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();

    // libellés en pixels écran (taille constante)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = (n) => `${n}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    // blocs
    if (v.s < 15) {
      ctx.font = `800 ${fs(Math.max(12, Math.min(16, v.s * 2.4)))}`;
      for (const b of venue.blocks) {
        if (b.seats.length < 12) continue;
        const p = this.toScreen(b.cx, b.cz);
        if (p.x < 8 || p.x > w - 8 || p.y < 8 || p.y > h - 8) continue;
        ctx.fillStyle = '#111321';
        const tw = ctx.measureText(b.block).width + 9;
        ctx.beginPath();
        ctx.roundRect(p.x - tw / 2, p.y - 9, tw, 18, 4);
        ctx.fill();
        ctx.strokeStyle = '#515c7c';
        ctx.lineWidth = 0.85;
        ctx.stroke();
        ctx.fillStyle = '#f3f4f8';
        ctx.fillText(b.block, p.x, p.y + 0.5);
      }
    }
    if (v.s >= 11) {
      // numéros de rang au bout des rangées
      ctx.font = `700 ${fs(11)}`;
      const stride = Math.max(1, Math.ceil(12 / (v.s * 0.78)));
      for (const list of this.rows) {
        const a = list[0];
        if (a.pmr || a.companion || a.row % stride !== 0) continue;
        const first = this.toScreen(a.x - 0.62, a.z);
        const last = list.at(-1);
        const p = first.x >= 6 ? first : this.toScreen(last.x + 0.62, last.z);
        if (p.x < 6 || p.x > w - 6 || p.y < 5 || p.y > h - 5) continue;
        ctx.strokeStyle = '#111321';
        ctx.lineWidth = 3;
        ctx.strokeText(String(a.row), p.x, p.y);
        ctx.fillStyle = col('--plan-row', '#c9cfdb');
        ctx.fillText(String(a.row), p.x, p.y);
      }
    }
    if (numbered) {
      ctx.font = `750 ${fs(Math.min(12, Math.round(pitch * 0.39)))}`;
      for (const s of numbered) {
        const p = this.toScreen(s.x, s.z);
        ctx.fillStyle = taken.has(s.id) ? '#d8deec' : '#101321';
        ctx.fillText(String(s.num), p.x, p.y);
      }
    }
    // « SCÈNE » : au centre de la scène, ou flèche au bord si hors cadre
    const c = this.toScreen(0, -st.depth / 2);
    const inView = c.x > 30 && c.x < w - 30 && c.y > 18 && c.y < h - 18;
    this.stageBadge = null;
    ctx.font = `800 ${fs(14)}`;
    if (inView) {
      ctx.fillStyle = '#fff';
      ctx.fillText('SCÈNE', c.x, c.y);
    } else {
      const cx = Math.min(w - 54, Math.max(54, c.x)), cy = Math.min(h - 18, Math.max(18, c.y));
      const ang = Math.atan2(c.y - cy, c.x - cx);
      ctx.fillStyle = col('--plan-stage-edge', '#ff8879');
      const bw = 92, bh = 28;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 14) : ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.fill();
      ctx.fillStyle = '#1a0f24';
      ctx.save(); ctx.translate(cx - 30, cy); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = `800 ${fs(13)}`;
      ctx.fillText('Scène', cx + 8, cy + 0.5);
      this.stageBadge = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    }
    this.root.classList.toggle('plan-zoomed', pitch >= MIN_TAP_PX);
    this.onViewChange?.(this.zoomLevel());
  }

  // ----- sélection ----------------------------------------------------------
  seatAt(px, py) {
    const p = this.toWorld(px, py);
    const reach = Math.max(0.35, 14 / this.view.s);
    let best = null, bd = Infinity;
    for (const s of this.venue.seats) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) { bd = d; best = s; }
    }
    return bd <= reach ? best : null;
  }

  _tap(p, pointerType) {
    const b = this.stageBadge;
    if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { this.fit(); return; }
    const pitch = SEAT * this.view.s;
    const touch = pointerType !== 'mouse';
    if (touch && pitch < MIN_TAP_PX) {
      // trop petit pour viser au doigt : on zoome là où l'on a touché
      this.zoomAt(p.x, p.y, Math.max(1.6, (MIN_TAP_PX * 1.25) / pitch));
      return;
    }
    const s = this.seatAt(p.x, p.y);
    if (s) this.onSeat(s);
  }

  // ----- gestes -------------------------------------------------------------
  _bind() {
    const c = this.canvas;
    const local = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* déjà relâché */ }
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      cancelAnimationFrame(this._anim);
      if (this.pointers.size === 1) this.g = { tap: true, start: p, t: performance.now(), view: { ...this.view } };
      else {
        const [a, b] = [...this.pointers.values()];
        this.g = { pinch: { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...this.view } } };
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      const g = this.g;
      if (!g) return;
      if (g.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const v0 = g.pinch.view, s = v0.s * d / g.pinch.d;
        this.view = this._clamp({ s, tx: mid.x - (g.pinch.mid.x - v0.tx) * (s / v0.s), ty: mid.y - (g.pinch.mid.y - v0.ty) * (s / v0.s) });
        this.draw();
      } else if (!g.pinch) {
        const dx = p.x - g.start.x, dy = p.y - g.start.y;
        if (Math.hypot(dx, dy) > 8) g.tap = false;
        if (!g.tap) { this.view = this._clamp({ s: g.view.s, tx: g.view.tx + dx, ty: g.view.ty + dy }); this.draw(); }
      }
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.g;
      if (!this.pointers.size) {
        if (e.type === 'pointerup' && g?.tap && performance.now() - g.t < 600) this._tap(g.start, e.pointerType);
        this.g = null;
      } else if (this.pointers.size === 1) {
        const p = [...this.pointers.values()][0];
        this.g = { tap: false, start: p, t: 0, view: { ...this.view } };
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016), false);
    }, { passive: false });
    c.addEventListener('keydown', (e) => this._key(e));
  }

  _key(e) {
    const k = e.key;
    if (k === '+' || k === '=') { this.zoomBy(1.4); e.preventDefault(); return; }
    if (k === '-' || k === '_') { this.zoomBy(1 / 1.4); e.preventDefault(); return; }
    if (k === '0') { this.fit(); e.preventDefault(); return; }
    const cur = this.venue.byId.get(this.state.focus || this.state.selected) || this._defaultFocus();
    let next = null;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const row = this.rowOf.get(cur.id), i = row.indexOf(cur);
      next = row[i + (k === 'ArrowRight' ? 1 : -1)] || this._jumpBlock(cur, k === 'ArrowRight' ? 1 : -1);
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      next = this._nextRow(cur, k === 'ArrowUp' ? -1 : 1);
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (cur) this.onSeat(cur, { keyboard: true });
      return;
    } else return;
    e.preventDefault();
    if (!next) return;
    this.state.focus = next.id;
    const p = this.toScreen(next.x, next.z), { w, h } = this.size;
    if (p.x < 40 || p.x > w - 40 || p.y < 40 || p.y > h - 40 || SEAT * this.view.s < 10) this.centerOn(next, 14);
    else this.draw();
    this.onFocusSeat?.(next);
  }

  _defaultFocus() {
    return this.venue.seats.find((s) => s.zone === 'parterre' && s.row === 1);
  }

  _jumpBlock(cur, dir) {
    // place la plus proche dans la direction donnée, même niveau
    let best = null, bd = Infinity;
    for (const s of this.venue.seats) {
      if (s.tier !== cur.tier || s.block === cur.block && s.row === cur.row) continue;
      const dx = (s.x - cur.x) * dir;
      if (dx <= 0.2) continue;
      const d = dx + Math.abs(s.z - cur.z) * 3;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  _nextRow(cur, dir) {
    let best = null, bd = Infinity;
    for (const s of this.venue.seats) {
      const dz = (s.z - cur.z) * dir;
      if (dz < 0.35) continue;
      const d = dz * 1.2 + Math.abs(s.x - cur.x) * 1.6;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
}
