// Plan interactif (canvas 2D) : vue de dessus de la salle, dans les mêmes
// coordonnées (mètres) que la scène 3D. Pincement, glissement, molette, boutons,
// clavier. Repère « Scène » toujours visible (flèche au bord quand elle sort du cadre).

import { CATEGORIES } from './concert.js';
import { ZONES } from './venue.js';

const MIN_TAP_PX = 22; // pas de siège minimal à l'écran pour viser au doigt
const SEAT = 0.5; // pas latéral des sièges (m), mesuré sur le plan
const BLOCK_ZOOM = 1.24;
const ZONE_TONES = ['#ffa69a', '#bb9bff', '#93a9ff', '#77cbf5', '#8cd9bb'];

function footprint(seats) {
  const points = seats.map(({ x, z }) => ({ x, z })).sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (sorted) => {
    const chain = [];
    for (const p of sorted) {
      while (chain.length >= 2 && cross(chain.at(-2), chain.at(-1), p) <= 0) chain.pop();
      chain.push(p);
    }
    return chain.slice(0, -1);
  };
  const hull = [...half(points), ...half(points.slice().reverse())];
  const path = new Path2D();
  const x0 = points[0].x, x1 = points.at(-1).x;
  const z0 = Math.min(...points.map(({ z }) => z)), z1 = Math.max(...points.map(({ z }) => z));
  if (hull.length < 3) path.rect(x0 - 0.2, z0 - 0.2, x1 - x0 + 0.4, z1 - z0 + 0.4);
  else {
    path.moveTo(hull[0].x, hull[0].z);
    for (const p of hull.slice(1)) path.lineTo(p.x, p.z);
    path.closePath();
  }
  return { path, x0, x1, z0, z1 };
}

function splitFootprints(seats) {
  const parts = [];
  for (const seat of seats.slice().sort((a, b) => a.x - b.x)) {
    const part = parts.at(-1);
    if (!part || seat.x - part.at(-1).x > 1.2) parts.push([seat]);
    else part.push(seat);
  }
  return parts;
}

function containsBox(box, x, y) {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

export class SeatPlan {
  constructor(root, venue, { onSeat, onZone, onFocusSeat, onViewChange, categoryOf, categories = CATEGORIES }) {
    this.root = root;
    this.venue = venue;
    this.onSeat = onSeat;
    this.onZone = onZone;
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
    this._layoutAreas();
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

  _layoutAreas() {
    this.zones = ZONES.map((zone, index) => {
      const seats = this.venue.seats.filter((seat) => seat.tier === zone.id);
      const middle = seats.filter(({ x }) => Math.abs(x) < 8);
      const anchor = middle.length ? middle : seats;
      const z = anchor.reduce((sum, seat) => sum + seat.z, 0) / anchor.length;
      return { ...zone, seats, z, tone: ZONE_TONES[index], index };
    }).filter(({ seats }) => seats.length);
    const byTier = new Map(this.zones.map((zone) => [zone.id, zone]));
    this.areas = this.venue.blocks.flatMap((block) => {
      const zone = byTier.get(block.tier);
      if (!zone) return [];
      const repeated = this.venue.blocks.some((other) => other.block === block.block && other.tier !== block.tier);
      const label = repeated ? `${block.block} · G${zone.index - 1}` : block.block;
      return splitFootprints(block.seats).sort((a, b) => b.length - a.length).map((seats, index) => {
        const groups = new Map();
        for (const seat of seats) {
          const category = this.cat.get(seat.id);
          if (!groups.has(category)) groups.set(category, []);
          groups.get(category).push(seat);
        }
        return {
          ...footprint(seats), zone, seats, label,
          labelKey: block.tier === 'parterre' && block.block === 'V' ? `${block.key}|${index}` : block.key,
          labelX: seats.reduce((sum, seat) => sum + seat.x, 0) / seats.length,
          labelZ: seats.reduce((sum, seat) => sum + seat.z, 0) / seats.length,
          colors: [...groups].map(([category, seats]) => ({ category, path: footprint(seats).path })),
        };
      });
    });
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
    return Math.max(0.1, Math.min((w - 16) / (B.x1 - B.x0), (h - 16) / (B.z1 - B.z0)));
  }

  fitView() {
    const { w, h } = this.size, B = this.worldBox(), s = this.fitScale();
    return { s, tx: w / 2 - ((B.x0 + B.x1) / 2) * s, ty: h / 2 - ((B.z0 + B.z1) / 2) * s };
  }

  fit(animate = true) { this._go(this.fitView(), animate); }

  zoomLevel() { return this.view.s / this.fitScale(); }

  _seatScale() { return Math.max(16, this.fitScale() * 1.55); }

  _detail() {
    if (this.view.s >= this._seatScale()) return 'seats';
    return this.zoomLevel() >= BLOCK_ZOOM ? 'blocks' : 'zones';
  }

  _clampScale(s) { return Math.min(Math.max(s, this.fitScale() * 0.95), 70); }

  _clamp(v) {
    const { w, h } = this.size, B = this.worldBox();
    v.s = this._clampScale(v.s);
    const minX = w - B.x1 * v.s - w * 0.4, maxX = -B.x0 * v.s + w * 0.4;
    const minY = h - B.z1 * v.s - h * 0.4, maxY = -B.z0 * v.s + h * 0.4;
    v.tx = Math.min(maxX, Math.max(minX, v.tx));
    v.ty = Math.min(maxY, Math.max(minY, v.ty));
    return v;
  }

  zoomAt(px, py, f, animate = true) {
    const v = this.view;
    const s = this._clampScale(v.s * f), ratio = s / v.s;
    this._go(this._clamp({ s, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio }), animate);
  }

  zoomBy(f) { const { w, h } = this.size; this.zoomAt(w / 2, h / 2, f); }

  // cadre une zone (liste de sièges), avec la scène gardée en vue si possible
  frameSeats(list, animate = true, detail = 'blocks') {
    if (!list.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of list) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const { w, h } = this.size;
    const pad = 2.5;
    const ideal = Math.min(w / (x1 - x0 + pad * 2), h / (z1 - z0 + pad * 2));
    const seatScale = this._seatScale();
    const s = detail === 'seats'
      ? Math.min(Math.max(seatScale, ideal), 70)
      : Math.min(Math.max(this.fitScale() * (BLOCK_ZOOM + 0.02), ideal), seatScale * 0.94);
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
    this.hover = null;
    this.canvas.style.cursor = '';
    this.view = this._clamp({ ...v });
    this.draw();
  }

  _go(target, animate) {
    cancelAnimationFrame(this._anim);
    this.hover = null;
    this.canvas.style.cursor = '';
    const still = !animate || this._reducedMotion();
    if (still) { this.view = target; this.draw(); return; }
    const from = { ...this.view }, t0 = performance.now(), ms = 270;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      const s = from.s * (target.s / from.s) ** e;
      const pan = target.s === from.s ? e : (s - from.s) / (target.s - from.s);
      this.view = { s, tx: from.tx + (target.tx - from.tx) * pan, ty: from.ty + (target.ty - from.ty) * pan };
      this.draw();
      if (k < 1) this._anim = requestAnimationFrame(step);
    };
    this._anim = requestAnimationFrame(step);
  }

  _reducedMotion() {
    return document.documentElement.classList.contains('no-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    if (!w || !h) return;
    this._wasFit = Math.abs(v.s - this.fitScale()) < 1e-6;
    const detail = this._detail();
    this.canvas.dataset.planLevel = detail;
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

    if (detail !== 'seats') this._drawAreas(detail, px);

    this._drawRegie(px, col('--plan-regie', 'rgba(140,150,170,.22)'));

    // garde-corps
    ctx.globalAlpha = detail === 'zones' ? 0.26 : 1;
    ctx.strokeStyle = col('--plan-rail', '#9aa3b5');
    ctx.lineWidth = Math.max(px * 1, 0.08);
    ctx.beginPath();
    for (const r of venue.rails) { ctx.moveTo(...r.pts[0]); for (const p of r.pts.slice(1)) ctx.lineTo(...p); }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // sièges
    const pitch = SEAT * v.s;
    const { taken, selected, compare, focus } = this.state;
    const numbered = detail === 'seats' && pitch >= MIN_TAP_PX ? [] : null;
    if (detail === 'seats') this._drawSeats(w, h, col('--plan-taken', '#454b57'), numbered);

    // repères : choisie (A), comparée (B), focus clavier
    const mark = (id, label, color) => {
      const s = venue.byId.get(id);
      if (!s) return;
      const rr = Math.max(0.42, 9 * px);
      ctx.lineWidth = Math.max(0.04, 1.4 * px);
      ctx.strokeStyle = '#f9faff';
      ctx.fillStyle = color;
      ctx.beginPath();
      if (label === 'B') { ctx.moveTo(s.x, s.z - rr); ctx.lineTo(s.x + rr, s.z); ctx.lineTo(s.x, s.z + rr); ctx.lineTo(s.x - rr, s.z); ctx.closePath(); }
      else ctx.arc(s.x, s.z, rr, 0, Math.PI * 2);
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * this.dpr;
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#111';
      ctx.font = `700 ${rr * 1.1}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, s.x, s.z + rr * 0.06);
    };
    if (compare) mark(compare, 'B', '#7ee0ff');
    if (selected) mark(selected, 'A', col('--plan-selection-a', '#ffd34d'));
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
    this.labelHits = [];
    if (detail !== 'seats') this._drawAreaLabels(detail, w, h);
    if (detail === 'seats') this._drawRowLabels(w, h, col('--plan-row', '#c9cfdb'));
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
    if (detail !== 'zones') this._drawRegieLabel(w, h);
    this.root.classList.toggle('plan-zoomed', pitch >= MIN_TAP_PX);
    this.onViewChange?.(this.zoomLevel());
  }

  _drawRegie(px, fill) {
    const { ctx } = this;
    const outline = new Path2D();
    const spacing = 9 * px;
    ctx.save();
    for (const { x0, z0, x1, z1 } of this.venue.regie.parts) outline.rect(x0, z0, x1 - x0, z1 - z0);
    ctx.fillStyle = fill;
    ctx.fill(outline);
    ctx.clip(outline);
    ctx.strokeStyle = '#a9b6d3';
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = px;
    ctx.beginPath();
    for (const { x0, z0, x1, z1 } of this.venue.regie.parts) {
      const depth = z1 - z0;
      // Une même grille diagonale traverse les deux paliers.
      for (let offset = Math.ceil((x0 + z0) / spacing) * spacing; offset < x1 + z1; offset += spacing) {
        ctx.moveTo(offset - z0, z0);
        ctx.lineTo(offset - z0 - depth, z1);
      }
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#8390ad';
    ctx.lineWidth = px;
    ctx.stroke(outline);
  }

  _drawRegieLabel(w, h) {
    const { ctx, stageBadge } = this;
    ctx.font = '750 12px system-ui, sans-serif';
    const width = ctx.measureText('Régie').width + 18, height = 22;
    let best;
    for (const { x0, z0, x1, z1 } of this.venue.regie.parts) {
      const a = this.toScreen(x0, z0), b = this.toScreen(x1, z1);
      const left = Math.max(4, a.x), right = Math.min(w - 4, b.x);
      const sharesStageColumn = stageBadge && left < stageBadge.x + stageBadge.w && right > stageBadge.x;
      const top = Math.max(a.y, sharesStageColumn ? stageBadge.y + stageBadge.h + 4 : 4);
      const bottom = Math.min(h - 4, b.y);
      if (right - left < width || bottom - top < height) continue;
      const area = (right - left) * (bottom - top);
      if (!best || area > best.area) best = { x: (left + right) / 2, y: (top + bottom) / 2, area };
    }
    if (!best) return;
    ctx.beginPath();
    ctx.roundRect(best.x - width / 2, best.y - height / 2, width, height, 5);
    ctx.fillStyle = '#1e2438';
    ctx.fill();
    ctx.strokeStyle = '#8390ad';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e5eafa';
    ctx.fillText('Régie', best.x, best.y);
  }

  _drawRowLabels(w, h, color) {
    const { ctx, view: { s } } = this;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.strokeStyle = '#111321';
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    const stride = Math.max(1, Math.ceil(12 / (s * 0.78)));
    const drawn = [];
    for (const list of this.rows) {
      const first = list[0], last = list.at(-1);
      const { row } = first;
      if (first.pmr || first.companion || row % stride !== 0) continue;
      const label = String(row), radius = ctx.measureText(label).width / 2 + 3;
      const visible = ({ x, y }) => x >= radius && x <= w - radius && y >= 7 && y <= h - 7;
      const p = [this.toScreen(first.x - 0.62, first.z), this.toScreen(last.x + 0.62, last.z)].find(visible);
      if (!p) continue;
      // Les deux blocs d'une même allée peuvent présenter le même numéro à ses bords.
      const crowded = drawn.some(({ x, y, row: other, radius: otherRadius }) => {
        const dx = Math.abs(p.x - x), dy = Math.abs(p.y - y);
        return (dx < radius + otherRadius && dy < 13) || (row === other && dx < s * 0.9 && dy < s * 0.35);
      });
      if (crowded) continue;
      drawn.push({ ...p, row, radius });
      ctx.strokeText(label, p.x, p.y);
      ctx.fillText(label, p.x, p.y);
    }
  }

  _drawAreas(detail, px) {
    const { ctx } = this;
    const filter = this.state.category;
    ctx.lineJoin = 'round';
    for (const area of this.areas) {
      const active = this.hover === area || this.hover === area.zone;
      ctx.fillStyle = ctx.strokeStyle = area.zone.tone;
      ctx.globalAlpha = active ? 0.35 : filter ? 0.11 : 0.21;
      ctx.fill(area.path);
      if (detail === 'blocks' || filter) {
        for (const { category, path } of area.colors) {
          if (filter && category !== filter) continue;
          ctx.fillStyle = this.categories[category]?.color || area.zone.tone;
          ctx.globalAlpha = filter ? 0.64 : 0.32;
          ctx.fill(path);
        }
      }
      ctx.globalAlpha = active ? 0.85 : 0.48;
      ctx.lineWidth = px;
      ctx.stroke(area.path);
    }
    ctx.globalAlpha = 1;
  }

  _drawAreaLabels(detail, w, h) {
    const { ctx, labelHits } = this;
    const isOverview = detail === 'zones';
    const size = isOverview ? 13 : 11;
    const height = isOverview ? 25 : 19;
    ctx.font = `750 ${size}px system-ui, sans-serif`;
    const labels = isOverview ? this.zones : this.areas;
    const labeled = new Set();
    for (const item of labels) {
      const key = isOverview ? item.id : item.labelKey;
      if (labeled.has(key)) continue;
      const label = isOverview ? item.short : item.label;
      const p = isOverview ? this.toScreen(0, item.z) : this.toScreen(item.labelX, item.labelZ);
      const width = ctx.measureText(label).width + (isOverview ? 19 : 10);
      const y = p.y - height / 2;
      if (y < 1 || y + height > h - 1) continue;
      // Les étiquettes de zones restent lisibles même sur un plan mobile très bas.
      const offsets = isOverview ? [0, (item.index % 2 ? 1 : -1) * width * 0.64, (item.index % 2 ? -1 : 1) * width * 0.64] : [0];
      let box;
      for (const offset of offsets) {
        const x = p.x + offset - width / 2;
        if (x < 1 || x + width > w - 1) continue;
        if (labelHits.some((hit) => x < hit.x + hit.w + 3 && x + width + 3 > hit.x && y < hit.y + hit.h + 2 && y + height + 2 > hit.y)) continue;
        box = { x, y, w: width, h: height, item };
        break;
      }
      if (!box) continue;
      labelHits.push(box);
      labeled.add(key);
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, isOverview ? 10 : 5);
      ctx.fillStyle = this.hover === item ? '#29213c' : '#15162b';
      ctx.fill();
      ctx.strokeStyle = isOverview ? item.tone : item.zone.tone;
      ctx.lineWidth = this.hover === item ? 1.8 : 1;
      ctx.stroke();
      ctx.fillStyle = '#faf5ff';
      ctx.fillText(label, box.x + box.w / 2, p.y + 0.5);
    }
  }

  _drawSeats(w, h, takenCol, numbered) {
    const { ctx, view: v } = this;
    const { taken, selected, compare, category } = this.state;
    const vis = this.toWorld(0, 0), vis2 = this.toWorld(w, h);
    for (const seat of this.venue.seats) {
      if (seat.x < vis.x - 1 || seat.x > vis2.x + 1 || seat.z < vis.z - 1 || seat.z > vis2.z + 1) continue;
      const cat = this.cat.get(seat.id);
      const isTaken = taken.has(seat.id);
      const dim = category && cat !== category;
      if (numbered && seat.id !== selected && seat.id !== compare && !dim) numbered.push(seat);
      ctx.save();
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.translate(seat.x, seat.z);
      ctx.rotate(-(seat.yaw ?? 0));
      const pmr = seat.pmr || seat.companion;
      const tone = pmr ? '#70c8ff' : this.categories[cat]?.color || '#9a9ba8';
      if (this.hover === seat) {
        const eased = this._reducedMotion() ? 1 : Math.min(1, (performance.now() - this.hoverAt) / 150);
        const scale = 1 + 0.23 * (1 - (1 - eased) ** 2);
        ctx.scale(scale, scale);
        ctx.shadowColor = tone;
        ctx.shadowBlur = 8 * eased * this.dpr;
        if (eased < 1) this.draw();
      }
      ctx.beginPath();
      if (pmr) {
        ctx.moveTo(0, -0.22); ctx.lineTo(0.22, 0); ctx.lineTo(0, 0.22); ctx.lineTo(-0.22, 0); ctx.closePath();
      } else ctx.roundRect(-0.202, -0.165, 0.404, 0.355, 0.075);
      ctx.fillStyle = isTaken ? takenCol : tone;
      ctx.fill();
      if (this.hover === seat || isTaken) {
        ctx.strokeStyle = this.hover === seat ? '#fff' : pmr ? '#70c8ff' : '#929bb4';
        ctx.lineWidth = 1 / v.s;
        ctx.stroke();
      }
      if (!pmr && !isTaken && !numbered) {
        ctx.fillStyle = 'rgba(255,255,255,.38)';
        ctx.fillRect(-0.12, 0.095, 0.24, 0.035);
      }
      ctx.restore();
    }
  }

  // ----- sélection ----------------------------------------------------------
  seatAt(px, py, reachPx = 14) {
    const p = this.toWorld(px, py);
    const reach = Math.max(0.26, reachPx / this.view.s);
    let best = null, bd = reach ** 2;
    for (const s of this.venue.seats) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  _areaAt(p, detail) {
    const label = this.labelHits?.find((box) => containsBox(box, p.x, p.y));
    if (label) return label.item;
    const { x, z } = this.toWorld(p.x, p.y);
    const { ctx } = this;
    ctx.save();
    ctx.resetTransform();
    const area = this.areas.find((a) => x >= a.x0 - 0.2 && x <= a.x1 + 0.2 && z >= a.z0 - 0.2 && z <= a.z1 + 0.2 && ctx.isPointInPath(a.path, x, z));
    ctx.restore();
    return detail === 'zones' ? area?.zone : area;
  }

  _hover(p) {
    const detail = this._detail();
    const target = p && (detail === 'seats' ? this.seatAt(p.x, p.y, 9) : this._areaAt(p, detail));
    const stage = p && this.stageBadge && containsBox(this.stageBadge, p.x, p.y);
    this.canvas.style.cursor = target || stage ? 'pointer' : '';
    if (this.hover === target) return;
    this.hover = target;
    this.hoverAt = performance.now();
    this.draw();
  }

  _tap(p, pointerType) {
    const b = this.stageBadge;
    if (b && containsBox(b, p.x, p.y)) { this.fit(); return; }
    const detail = this._detail();
    if (detail !== 'seats') {
      const area = this._areaAt(p, detail);
      if (area) {
        if (detail === 'zones' && this.onZone) this.onZone(area.id);
        else this.frameSeats(area.seats, true, detail === 'zones' ? 'blocks' : 'seats');
      }
      return;
    }
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
      this._hover(null);
      if (this.pointers.size === 1) this.g = { tap: true, start: p, t: performance.now(), view: { ...this.view } };
      else {
        const [a, b] = [...this.pointers.values()];
        this.g = { pinch: { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...this.view } } };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (!this.pointers.has(e.pointerId)) {
        if (!this.pointers.size && e.pointerType === 'mouse') this._hover(p);
        return;
      }
      this.pointers.set(e.pointerId, p);
      const g = this.g;
      if (!g) return;
      if (g.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const v0 = g.pinch.view, s = this._clampScale(v0.s * d / g.pinch.d);
        this.view = this._clamp({ s, tx: mid.x - (g.pinch.mid.x - v0.tx) * (s / v0.s), ty: mid.y - (g.pinch.mid.y - v0.ty) * (s / v0.s) });
        this.draw();
      } else if (!g.pinch) {
        const dx = p.x - g.start.x, dy = p.y - g.start.y;
        if (Math.hypot(dx, dy) > 8) g.tap = false;
        if (!g.tap) {
          if (e.pointerType === 'mouse') c.style.cursor = 'grabbing';
          this.view = this._clamp({ s: g.view.s, tx: g.view.tx + dx, ty: g.view.ty + dy });
          this.draw();
        }
      }
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.g;
      if (!this.pointers.size) {
        if (e.type === 'pointerup' && g?.tap && performance.now() - g.t < 600) this._tap(g.start, e.pointerType);
        this.g = null;
        c.style.cursor = '';
      } else if (this.pointers.size === 1) {
        const p = [...this.pointers.values()][0];
        this.g = { tap: false, start: p, t: 0, view: { ...this.view } };
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    c.addEventListener('pointerleave', () => { if (!this.pointers.size) this._hover(null); });
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
