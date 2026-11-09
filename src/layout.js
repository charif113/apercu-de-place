// Calcule la géométrie d'une salle (en mètres) à partir de son modèle de données.
// Le plan 2D et la scène 3D utilisent exactement ces coordonnées : le plan est
// littéralement la vue de dessus de la salle, ce qui rend la transition cohérente.

import { chairProfile } from './seats.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function expandRows(spec) {
  const [a, b] = spec.split('-');
  const i0 = LETTERS.indexOf(a);
  const i1 = b ? LETTERS.indexOf(b) : i0;
  const out = [];
  for (let i = i0; i <= i1; i++) out.push(LETTERS[i]);
  return out;
}

const cache = new Map();

// Les murs du ScreenX partent des bords du frontal puis s'écartent vers les gradins.
export function wallXAt(layout, z) {
  const { halfWidth, depth, model } = layout;
  if (!model.sides) return halfWidth;
  const front = model.screen.width / 2;
  return front + (halfWidth - front) * z / depth;
}

export function computeLayout(hall) {
  if (cache.has(hall.id)) return cache.get(hall.id);
  const m = hall.model;
  const seatW = m.seat.width;
  const rows = [];
  const seats = [];
  let rowIndex = 0;
  let maxHalf = 0;

  for (const group of m.rows) {
    for (const label of expandRows(group.rows)) {
      const blocks = group.blocks;
      const total = blocks.reduce((s, n) => s + n, 0);
      const width = total * seatW + (blocks.length - 1) * m.aisle;
      const z0 = m.firstRow + rowIndex * m.rowPitch;
      const floor = rowIndex < m.flatRows ? 0 : (rowIndex - m.flatRows + 1) * m.riser;
      const row = { label, index: rowIndex, z: z0, floor, seats: [], width, aisles: [] };
      let x = -width / 2;
      let num = 1;
      blocks.forEach((count, bi) => {
        for (let k = 0; k < count; k++) {
          const cx = x + seatW / 2;
          const R = m.rowCurve || 0;
          const dz = R ? -(R - Math.sqrt(R * R - cx * cx)) : 0;
          const seat = {
            id: `${label}${num}`,
            row: label,
            rowIndex,
            num,
            block: bi,
            x: cx,
            z: z0 + dz,
            floor,
            yaw: R ? Math.atan2(cx, R + z0) : 0,
            pmr: !!(group.pmr && group.pmr.includes(num - 1)),
          };
          row.seats.push(seat);
          seats.push(seat);
          x += seatW;
          num++;
        }
        if (bi < blocks.length - 1) {
          row.aisles.push(x + m.aisle / 2);
          x += m.aisle;
        }
      });
      maxHalf = Math.max(maxHalf, width / 2);
      rows.push(row);
      rowIndex++;
    }
  }

  const last = rows[rows.length - 1];
  const halfWidth = Math.max(maxHalf + m.sideAisle, m.screen.width / 2 + 1.2);
  const layout = {
    hall,
    model: m,
    chair: chairProfile(m.seat),
    rows,
    seats,
    byId: new Map(seats.map((s) => [s.id, s])),
    halfWidth,
    depth: last.z + m.rowPitch + 1.6, // mur du fond
    backFloor: last.floor,
  };
  cache.set(hall.id, layout);
  return layout;
}

// Le repère de l'œil est fixé à l'assise, y compris si le fauteuil est orienté.
export function eyeOf(seat, layout) {
  const { y, z } = seat.pmr ? { y: 1.15, z: 0 } : layout.chair.eye;
  return { x: seat.x + Math.sin(seat.yaw) * z, y: seat.floor + y, z: seat.z + Math.cos(seat.yaw) * z };
}

function screenPoint(layout, x, height) {
  const { curve, bottom } = layout.model.screen;
  return { x, y: bottom + height, z: curve ? curve - Math.sqrt(curve ** 2 - x ** 2) : 0 };
}

export function screenCenter(layout) {
  return screenPoint(layout, 0, layout.model.screen.height / 2);
}

const deg = (r) => (r * 180) / Math.PI;

// Intervalle du rayon où sa projection au sol traverse le dossier.
function slab(start, delta, center, halfSize) {
  if (Math.abs(delta) < 1e-9) return Math.abs(start - center) <= halfSize ? [0, 1] : [1, 0];
  const a = (center - halfSize - start) / delta;
  const b = (center + halfSize - start) / delta;
  return [Math.min(a, b), Math.max(a, b)];
}

function backClearance(eye, target, seat, part) {
  const cosYaw = Math.cos(seat.yaw), sinYaw = Math.sin(seat.yaw);
  const x = eye.x - seat.x, z = eye.z - seat.z;
  const dx = target.x - eye.x, dz = target.z - eye.z;
  const localX = cosYaw * x - sinYaw * z, localDx = cosYaw * dx - sinYaw * dz;
  const localZ = sinYaw * x + cosYaw * z, localDz = sinYaw * dx + cosYaw * dz;
  const [width, height, depth] = part.size;
  const [cx, cy, cz] = part.at;
  const [xa, xb] = slab(localX, localDx, cx, width / 2);
  const cosTilt = Math.cos(part.tilt), sinTilt = Math.sin(part.tilt);
  const [za, zb] = slab(localZ, localDz, cz, (height * Math.abs(sinTilt) + depth * cosTilt) / 2);
  const from = Math.max(0, xa, za), to = Math.min(1, xb, zb);
  if (from > to) return Infinity;

  // Enveloppe haute du dossier incliné, avant arrondi des coins. Ses deux faces
  // sont planes : la garde minimale est à une extrémité ou à leur arête.
  const ridgeZ = (height * sinTilt - Math.sign(sinTilt) * depth * cosTilt) / 2;
  const ridgeT = localDz ? (cz + ridgeZ - localZ) / localDz : from;
  const clearance = (t) => {
    const offsetZ = localZ + t * localDz - cz;
    const top = (height / 2 - offsetZ * sinTilt) / cosTilt;
    const slope = sinTilt ? (depth / 2 + Math.sign(sinTilt) * offsetZ * cosTilt) / Math.abs(sinTilt) : Infinity;
    const rayY = eye.y + t * (target.y - eye.y);
    return rayY - seat.floor - cy - Math.min(top, slope);
  };
  return Math.min(clearance(from), clearance(to), clearance(Math.max(from, Math.min(to, ridgeT))));
}

// Rayons vers le bord haut, le milieu et le bord bas (axe + 8 points en largeur).
// clearance décrit l'axe, blocked indique une obstruction sur au moins un rayon.
export function sightlines(seat, layout) {
  const eye = eyeOf(seat, layout);
  const { width, height } = layout.model.screen;
  const inFront = layout.seats.filter((s) => s.rowIndex < seat.rowIndex && !s.pmr);
  const backs = [...layout.chair.upholstery, ...layout.chair.structure].filter((part) => part.back);
  const atHeight = (h) => {
    const center = screenPoint(layout, 0, h);
    const angle = deg(Math.atan2(center.y - eye.y, Math.hypot(center.x - eye.x, center.z - eye.z)));
    let clearance = null, blocker = null, blocked = false;
    for (let i = -4; i <= 4; i++) {
      const target = screenPoint(layout, i * width / 8, h);
      let nearest = Infinity, nearestSeat = null;
      for (const frontSeat of inFront) {
        for (const back of backs) {
          const gap = backClearance(eye, target, frontSeat, back);
          if (gap < nearest) { nearest = gap; nearestSeat = frontSeat.id; }
        }
      }
      if (i === 0 && Number.isFinite(nearest)) clearance = nearest;
      if (nearest < 0) {
        blocked = true;
        if (i === 0 || !blocker) blocker = nearestSeat;
      }
    }
    return { angle, clearance, blocked, blocker };
  };
  const top = atHeight(height), middle = atHeight(height / 2), bottom = atHeight(0);
  return { top, middle, bottom, blocked: top.blocked || middle.blocked || bottom.blocked };
}

function frontalAngle(e, layout) {
  const half = layout.model.screen.width / 2;
  const left = screenPoint(layout, -half, 0), right = screenPoint(layout, half, 0);
  return deg(Math.atan2(right.x - e.x, e.z - right.z) - Math.atan2(left.x - e.x, e.z - left.z));
}

// Mesures affichées dans la fiche de la place.
export function seatMetrics(seat, layout) {
  const m = layout.model;
  const e = eyeOf(seat, layout);
  const c = screenCenter(layout);
  const dist = Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z);
  const rays = sightlines(seat, layout);
  const out = {
    dist,
    hfov: frontalAngle(e, layout),
    offset: seat.x,
    tilt: rays.top.angle,
    sightlines: rays,
    depthRank: seat.rowIndex / Math.max(1, layout.rows.length - 1),
  };
  if (m.sides) {
    // Couverture totale avec les deux surfaces latérales : du fond du panneau
    // gauche au fond du panneau droit, vu depuis l'œil.
    const w = layout.halfWidth;
    const angTo = (x, z) => Math.atan2(x - e.x, e.z - z); // 0 = droit devant
    const left = angTo(-w, m.sides.to);
    const right = angTo(w, m.sides.to);
    out.leftSide = deg(-left);
    out.rightSide = deg(right);
    out.total = Math.min(270, deg(right - left));
  }
  return out;
}

export function describeSeat(metrics, layout) {
  const tags = [];
  const off = Math.abs(metrics.offset);
  if (off < 1.2) tags.push('Axe central');
  else if (off > layout.halfWidth * 0.55) tags.push('Côté');
  else tags.push('Légèrement décalé');
  if (metrics.depthRank < 0.25) tags.push('Très proche');
  else if (metrics.depthRank > 0.8) tags.push('Fond de salle');
  if (metrics.hfov > 70) tags.push('Écran très enveloppant');
  if (metrics.tilt > 32) tags.push('Tête relevée');
  return tags;
}

// Suggestion d'une place centrale libre pour la comparaison.
export function suggestCentral(layout, isTaken, avoidId) {
  const targetFov = layout.model.kind === 'imax' ? 62 : 48;
  let best = null;
  let bestScore = Infinity;
  for (const s of layout.seats) {
    if (s.pmr || isTaken(s.id) || s.id === avoidId) continue;
    const hfov = frontalAngle(eyeOf(s, layout), layout);
    const score = Math.abs(hfov - targetFov) * 0.35 + Math.abs(s.x) * 2;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// Places prises : déterministes par salle + séance (données de démonstration).
export function demoTaken(layout, showtime) {
  let h = 2166136261;
  for (const ch of layout.hall.id + showtime) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
  const taken = new Set();
  const n = layout.rows.length;
  for (const s of layout.seats) {
    if (s.pmr) continue;
    const centrality = 1 - Math.min(1, Math.abs(s.x) / layout.halfWidth);
    const mid = 1 - Math.abs(s.rowIndex / (n - 1) - 0.6) * 1.6;
    const p = 0.12 + 0.3 * centrality * Math.max(0, mid);
    if (rnd() < p) taken.add(s.id);
  }
  return taken;
}
