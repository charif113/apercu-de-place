// Plan 2D de la salle (SVG) : zoom au doigt, déplacement, rangées repérées,
// toucher sur une place → callback. Les rangées restent en mètres (vue de dessus).

import { wallXAt } from './layout.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

const MIN_TAP_PX = 26; // taille minimale d'une place à l'écran pour la sélectionner

export class SeatPlan {
  constructor(root, { onSeatTap, onZoom, onTapZoom }) {
    this.root = root;
    this.onSeatTap = onSeatTap;
    this.onZoom = onZoom;
    this.onTapZoom = onTapZoom;
    this.mobile = matchMedia('(max-width: 760px)');
    this.svg = el('svg', { class: 'plan-svg', role: 'img' }, root);
    this.world = el('g', {}, this.svg);
    this.rowRail = document.createElement('div');
    this.rowRail.className = 'row-rail';
    this.rowRail.setAttribute('aria-hidden', 'true');
    root.appendChild(this.rowRail);
    this.view = { s: 1, tx: 0, ty: 0 };
    this.pointers = new Map();
    this.seatNodes = new Map();
    this.anim = null;
    this._bind();
    new ResizeObserver(() => this._onResize()).observe(root);
  }

  // ----- construction -----------------------------------------------------
  setHall(layout, { taken, selected, compare, view }) {
    cancelAnimationFrame(this.anim);
    this.layout = layout;
    this.world.textContent = '';
    this.seatNodes.clear();
    const m = layout.model;
    // Murs et sol
    this.floorPath = el('path', { class: 'p-floor' }, this.world);
    this.screenPath = el('path', { class: 'p-screen' }, this.world);
    this.sidePaths = m.sides ? [-1, 1].map(() => el('path', { class: 'p-side', fill: 'none' }, this.world)) : [];
    this._drawFront();

    // Rangées
    const seatW = m.seat.width;
    const sw2 = seatW * 0.88;
    const sd = Math.min(0.68, m.rowPitch * 0.61);
    for (const row of layout.rows) {
      const labelY = row.z + 0.08;
      const edge = row.width / 2;
      // Les deux repères ScreenX restent entre les fauteuils et leur mur latéral.
      const labelX = m.sides ? (edge + wallXAt(layout, labelY)) / 2 : edge + 0.45;
      for (const sgn of [-1, 1]) {
        const t = el('text', { x: sgn * labelX, y: labelY, class: 'p-row-label' }, this.world);
        t.textContent = row.label;
      }
      for (const s of row.seats) {
        const g = el('g', { transform: `translate(${s.x} ${s.z}) rotate(${(-s.yaw * 180) / Math.PI})`, 'data-seat': s.id }, this.world);
        if (s.pmr) {
          el('circle', { r: sd * 0.5, class: 'p-pmr' }, g);
          const t = el('text', { y: 0.11, class: 'p-pmr-glyph' }, g);
          t.textContent = '♿';
        } else {
          const x = sw2 / 2, y = sd / 2, arm = x * 0.22;
          el('path', { d: `M ${-x} ${-y * 0.6} H ${-x + arm} V ${-y} H ${x - arm} V ${-y * 0.6}
            H ${x} V ${y * 0.67} Q ${x} ${y} ${x * 0.65} ${y}
            H ${-x * 0.65} Q ${-x} ${y} ${-x} ${y * 0.67} Z`, class: 'p-seat' }, g);
          el('path', { d: `M ${-x * 0.62} ${y * 0.42} Q 0 ${y * 0.66} ${x * 0.62} ${y * 0.42}`, class: 'p-back' }, g);
          el('path', { d: `M 0 ${-y} L ${x} 0 L 0 ${y} L ${-x} 0 Z`, class: 'p-diamond' }, g);
          el('path', { d: `M ${-sw2 * 0.22} ${-sd * 0.22} L ${sw2 * 0.22} ${sd * 0.22} M ${sw2 * 0.22} ${-sd * 0.22} L ${-sw2 * 0.22} ${sd * 0.22}`, class: 'p-x' }, g);
          el('path', { d: `M ${-sw2 * 0.24} 0 L ${-sw2 * 0.06} ${sd * 0.2} L ${sw2 * 0.26} ${-sd * 0.2}`, class: 'p-check' }, g);
          const b = el('text', { y: 0.1, class: 'p-b' }, g);
          b.textContent = 'B';
        }
        el('title', {}, g);
        this.seatNodes.set(s.id, g);
      }
    }
    this.svg.setAttribute('aria-label', `Plan de la salle ${layout.hall.fullName}`);
    this.setStates({ taken, selected, compare });
    this._buildRail();
    if (view && !view.fitted) this.view = this._clamp({ s: view.s, tx: view.tx, ty: view.ty });
    else this.fit();
    this._apply();
  }

  _drawFront() {
    const { layout } = this;
    const { model, halfWidth, depth } = layout;
    this.compact = this.mobile.matches;
    // Le dessin resserre la zone vide. Les coordonnées des fauteuils restent
    // celles de la salle pour le zoom, la sélection et la transition 3D.
    const cut = model.firstRow - model.rowPitch / 2;
    this.frontInset = this.compact ? cut / 2 : 0;
    const frontY = (z) => this.compact && z < cut ? this.frontInset + z / 2 : z;
    const near = wallXAt(layout, 0);
    const atCut = wallXAt(layout, cut);
    const rightBend = this.compact ? ` L ${atCut} ${cut}` : '';
    const leftBend = this.compact ? ` L ${-atCut} ${cut}` : '';
    this.floorPath.setAttribute('d', `M ${-near} ${frontY(-0.5)} H ${near}${rightBend} L ${halfWidth} ${depth} H ${-halfWidth}${leftBend} Z`);

    const sw = model.screen.width / 2;
    const radius = model.screen.curve;
    const bow = radius ? radius - Math.sqrt(radius ** 2 - sw ** 2) : 0;
    this.screenPath.setAttribute('d', `M ${-sw} ${frontY(bow)} Q 0 ${frontY(-bow)} ${sw} ${frontY(bow)}`);

    if (model.sides) {
      const { from, to } = model.sides;
      this.sidePaths.forEach((path, i) => {
        const sign = i === 0 ? -1 : 1;
        const point = (z) => `${sign * wallXAt(layout, z)} ${frontY(z)}`;
        const bend = this.compact && from < cut && cut < to ? ` L ${point(cut)}` : '';
        path.setAttribute('d', `M ${point(from)}${bend} L ${point(to)}`);
      });
    }
  }

  setStates({ taken, selected, compare }) {
    this.taken = taken;
    for (const [id, g] of this.seatNodes) {
      const s = this.layout.byId.get(id);
      let st = 'free';
      if (id === selected) st = 'sel';
      else if (id === compare) st = 'cmp';
      else if (s.pmr) st = 'pmr';
      else if (taken.has(id)) st = 'taken';
      g.setAttribute('class', `p-g st-${st}${s.pmr ? ' pmr-seat' : ''}`);
      const status = { free: 'libre', taken: 'prise', sel: 'choisie', cmp: 'comparée', pmr: 'emplacement PMR' };
      g.querySelector('title').textContent = `Rang ${s.row} · Place ${s.num} · ${status[st]}`;
    }
  }

  _buildRail() {
    this.rowRail.textContent = '';
    this.railItems = this.layout.rows.map((r) => {
      const d = document.createElement('span');
      d.textContent = r.label;
      this.rowRail.appendChild(d);
      return { d, z: r.z };
    });
  }

  // ----- vue ----------------------------------------------------------------
  get size() {
    return { w: this.root.clientWidth, h: this.root.clientHeight };
  }

  fitScale() {
    const { w, h } = this.size;
    const L = this.layout;
    return Math.max(0.1, Math.min((w - 32) / (2 * L.halfWidth), (h - 57) / (L.depth - this.frontInset + 0.8)));
  }

  _fittedView() {
    const { w, h } = this.size;
    const s = this.fitScale();
    const front = this.compact ? 43 : Math.max(43, (h - this.layout.depth * s) / 2 + 12);
    const ty = front - this.frontInset * s;
    return { s, tx: w / 2, ty };
  }

  fit() {
    this.view = this._fittedView();
  }

  maxScale() {
    return 90 / this.layout.model.seat.width;
  }

  _clamp(v) {
    const { w, h } = this.size;
    const L = this.layout;
    v.s = Math.max(this.fitScale() * 0.9, Math.min(this.maxScale(), v.s));
    // Garder la salle dans le cadre
    const minX = w - L.halfWidth * v.s - 40, maxX = L.halfWidth * v.s + 40;
    v.tx = minX > maxX ? w / 2 : Math.min(maxX, Math.max(minX, v.tx));
    const top = (1.2 - this.frontInset) * v.s + 40, bottom = h - (L.depth + 0.4) * v.s - 40;
    v.ty = bottom > top ? (top + bottom) / 2 : Math.min(top, Math.max(bottom, v.ty));
    return v;
  }

  _apply() {
    const v = this.view;
    this.world.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.s})`);
    const { h } = this.size;
    const initial = this._fittedView();
    this.fitted = ['s', 'tx', 'ty'].every((key) => Math.abs(v[key] - initial[key]) < 1e-4);
    const pitch = this.layout.model.seat.width * v.s;
    this.root.classList.toggle('zoomed', pitch >= MIN_TAP_PX);
    for (const it of this.railItems || []) {
      const y = it.z * v.s + v.ty;
      it.d.style.transform = `translateY(${y}px)`;
      it.d.style.opacity = y < 30 || y > h - 4 ? 0 : 1;
    }
    this.onZoom && this.onZoom(this.zoomLevel());
  }

  zoomLevel() {
    return this.view.s / this.fitScale();
  }

  getView() {
    return { ...this.view, fitted: this.fitted };
  }

  toWorld(px, py) {
    const v = this.view;
    return { x: (px - v.tx) / v.s, z: (py - v.ty) / v.s };
  }

  // Rectangle du monde visible (pour caler la caméra 3D sur le plan)
  visibleWorld() {
    const { w, h } = this.size;
    const a = this.toWorld(0, 0), b = this.toWorld(w, h);
    return { x0: a.x, z0: a.z, x1: b.x, z1: b.z, w, h };
  }

  zoomAt(px, py, factor, animate = true) {
    const v = this.view;
    const target = this._clamp({ s: v.s * factor, tx: px - (px - v.tx) * factor, ty: py - (py - v.ty) * factor });
    if (!animate) { this.view = target; this._apply(); return; }
    this._animateTo(target);
  }

  zoomBy(factor) {
    const { w, h } = this.size;
    this.zoomAt(w / 2, h / 2, factor);
  }

  centerOn(seat, minPitch = 34) {
    const { w, h } = this.size;
    const s = Math.max(this.view.s, minPitch / this.layout.model.seat.width);
    this._animateTo(this._clamp({ s, tx: w / 2 - seat.x * s, ty: h / 2 - seat.z * s }));
  }

  reset() {
    cancelAnimationFrame(this.anim);
    this.fit();
    this._apply();
  }

  _animateTo(target, ms = 280) {
    if (document.body.classList.contains('no-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cancelAnimationFrame(this.anim);
      this.view = target;
      this._apply();
      return;
    }
    const from = { ...this.view };
    const t0 = performance.now();
    cancelAnimationFrame(this.anim);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      // interpolation log de l'échelle, puis point fixe cohérent
      const s = from.s * Math.pow(target.s / from.s, e);
      this.view = { s, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e };
      this._apply();
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  _onResize() {
    if (!this.layout || !this.root.clientWidth) return;
    if (this.compact !== this.mobile.matches) this._drawFront();
    if (this.fitted) this.fit();
    else this._clamp(this.view);
    this._apply();
  }

  // ----- gestes -------------------------------------------------------------
  _bind() {
    const r = this.root;
    const local = (e) => {
      const b = r.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      try { r.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      cancelAnimationFrame(this.anim);
      if (this.pointers.size === 1) this.gesture = { tap: true, start: p, t: performance.now(), view: { ...this.view } };
      else this._startPinch();
    });
    r.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      if (!g) return;
      if (this.pointers.size >= 2 && g.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const f = d / g.pinch.d;
        const v0 = g.pinch.view;
        const s = v0.s * f;
        this.view = this._clamp({
          s,
          tx: mid.x - (g.pinch.mid.x - v0.tx) * (s / v0.s),
          ty: mid.y - (g.pinch.mid.y - v0.ty) * (s / v0.s),
        });
        this._apply();
      } else if (this.pointers.size === 1) {
        const dx = p.x - g.start.x, dy = p.y - g.start.y;
        if (Math.hypot(dx, dy) > 8) g.tap = false;
        if (!g.tap) {
          this.view = this._clamp({ s: g.view.s, tx: g.view.tx + dx, ty: g.view.ty + dy });
          this._apply();
        }
      }
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (this.pointers.size === 0) {
        if (e.type === 'pointerup' && g?.tap && !g.pinched && performance.now() - g.t < 500) {
          this._tap(g.start, e.pointerType);
        }
        this.gesture = null;
      } else if (this.pointers.size === 1 && g) {
        const p = [...this.pointers.values()][0];
        this.gesture = { tap: false, pinched: true, start: p, t: 0, view: { ...this.view } };
      }
    };
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', end);
    r.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015), false);
    }, { passive: false });
  }

  _startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.gesture = {
      tap: false,
      pinched: true,
      pinch: { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...this.view } },
    };
  }

  seatAtScreen(px, py) {
    const w = this.toWorld(px, py);
    const L = this.layout;
    const reach = Math.max(L.model.seat.width * 0.75, 20 / this.view.s);
    let best = null, bd = Infinity;
    for (const s of L.seats) {
      const d = Math.hypot(s.x - w.x, (s.z - w.z) * 1.15);
      if (d < bd) { bd = d; best = s; }
    }
    return bd <= reach ? best : null;
  }

  screenOf(seat) {
    const v = this.view;
    const b = this.root.getBoundingClientRect();
    return { x: b.left + seat.x * v.s + v.tx, y: b.top + seat.z * v.s + v.ty };
  }

  _tap(p, pointerType) {
    const pitch = this.layout.model.seat.width * this.view.s;
    const coarseMobile = this.mobile.matches && matchMedia('(pointer: coarse)').matches;
    const touch = pointerType === 'touch' || (coarseMobile && pointerType !== 'pen');
    const fittedOnMobile = touch && this.mobile.matches && this.zoomLevel() <= 1.001;
    const seatTooSmall = (touch || pointerType !== 'mouse') && pitch < MIN_TAP_PX;
    if (fittedOnMobile || seatTooSmall) {
      // Trop petit pour viser au doigt : on zoome d'abord à l'endroit touché.
      this.zoomAt(p.x, p.y, Math.max(1.35, (MIN_TAP_PX * 1.35) / pitch));
      if (touch) this.onTapZoom?.();
      return;
    }
    const seat = this.seatAtScreen(p.x, p.y);
    if (seat) this.onSeatTap(seat);
  }
}
