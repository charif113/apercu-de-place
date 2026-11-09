// Modèle unique de la salle. Le plan 2D, la vue 3D, la vue fixe de secours et
// les mesures lisent tous ces coordonnées (mètres) :
//   x : latéral, comme sur le plan officiel (x < 0 à gauche quand la scène est en haut)
//   z : distance au nez de scène (z = 0), positive vers le public, négative sur scène
//   y : hauteur au-dessus du sol de la fosse
// Origine des données : voir data/nikaia.json (champ source) et README.

export const ZONES = [
  { id: 'parterre', label: 'Parterre', short: 'Parterre', blocks: ['V', 'X'] },
  { id: 'tribune', label: 'Tribunes', short: 'Tribunes', blocks: ['U', 'W', 'Y'] },
  { id: 'gradin1', label: 'Gradin 1 · rangs 21 à 33', short: 'Gradin 1', blocks: ['A', 'B', 'D', 'F', 'G', 'I', 'K', 'L', 'N', 'P'] },
  { id: 'gradin2', label: 'Gradin 2 · rangs 34 à 52', short: 'Gradin 2', blocks: ['A', 'B', 'D', 'G', 'I', 'L', 'N', 'P'] },
  { id: 'gradin3', label: 'Gradin 3 · rangs 53 à 63', short: 'Gradin 3', blocks: ['C', 'E', 'H', 'J', 'M', 'O'] },
];

const ZONE_CODE = { p: 'parterre', t: 'tribune', g: 'gradin', m: 'pmr', c: 'pmr' };

export const EYE_SEATED = 1.15; // œil d'un adulte assis au-dessus du sol du rang (estimation usuelle)
export const EYE_WHEELCHAIR = 1.22;
export const EYE_BACK = 0.12; // l'œil est un peu en arrière du centre du siège

function tierOf(zone, row) {
  if (zone !== 'gradin') return zone === 'pmr' ? 'gradin1' : zone;
  return row <= 33 ? 'gradin1' : row <= 52 ? 'gradin2' : 'gradin3';
}

export function seatLabel(s) {
  if (s.pmr) return `Bloc ${s.block} · Emplacement fauteuil roulant ${s.num}`;
  if (s.companion) return `Bloc ${s.block} · Accompagnateur ${s.num}`;
  return `Bloc ${s.block} · Rang ${s.row} · Place ${s.num}`;
}

export function zoneLabel(s) {
  return ZONES.find((z) => z.id === s.tier)?.short ?? '';
}

export async function loadVenue(url = new URL('../data/nikaia.json', import.meta.url)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Données de salle introuvables (${res.status})`);
  return buildVenue(await res.json());
}

export function buildVenue(raw) {
  const seats = raw.seats.map(([block, row, num, code, x, z, y, fx, fz]) => {
    const zone = ZONE_CODE[code];
    const s = {
      id: `${block}-${row}-${num}`, block, row, num, zone, x, z, y, fx, fz,
      pmr: code === 'm', companion: code === 'c',
    };
    s.tier = tierOf(zone, typeof row === 'number' ? row : 21);
    s.yaw = Math.atan2(-fx, -fz); // rotation autour de y pour un objet qui regarde vers -z
    return s;
  });
  levelPmrPlatforms(seats);
  const byId = new Map(seats.map((s) => [s.id, s]));
  const venue = {
    name: 'Palais Nikaïa',
    city: 'Nice',
    config: 'Concert frontal tout assis',
    source: raw.source,
    fixes: raw.fixes,
    stage: raw.stage,
    walls: raw.walls,
    seats,
    byId,
  };
  venue.bounds = bounds(seats, raw.walls);
  venue.blocks = groupBlocks(seats);
  venue.rails = buildRails(venue);
  venue.regie = buildRegie(seats);
  return venue;
}

// Emplacements PMR F et K (quatre rangées de fauteuils + accompagnateurs) : posés en
// gradins, chacun au niveau du rang de même rayon (estimation, aucune coupe publiée).
export const ARC_CENTER = { x: 0, z: -13.45 }; // centre des rangées courbes (plan de numérotation)
function levelPmrPlatforms(seats) {
  const R = (s) => Math.hypot(s.x - ARC_CENTER.x, s.z - ARC_CENTER.z);
  const rows = new Map();
  for (const s of seats) if (s.zone === 'gradin') { const r = rows.get(s.row) || { R: 0, n: 0, y: s.y, row: s.row }; r.R += R(s); r.n++; rows.set(s.row, r); }
  const table = [...rows.values()].map((r) => ({ R: r.R / r.n, y: r.y, row: r.row })).sort((a, b) => a.R - b.R);
  const at = (rad) => table.reduce((best, t) => (Math.abs(t.R - rad) < Math.abs(best.R - rad) ? t : best), table[0]);
  for (const s of seats) if (s.zone === 'pmr') { const t = at(R(s)); s.y = t.y; s.stepRow = t.row; }
}

function bounds(seats, walls) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [ax, az, bx, bz] of walls) {
    x0 = Math.min(x0, ax, bx); x1 = Math.max(x1, ax, bx);
    z0 = Math.min(z0, az, bz); z1 = Math.max(z1, az, bz);
  }
  for (const s of seats) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z1 = Math.max(z1, s.z); }
  return { x0, x1, z0, z1 };
}

// Blocs = (lettre, niveau). Sert aux étiquettes du plan et aux accès rapides.
function groupBlocks(seats) {
  const map = new Map();
  for (const s of seats) {
    const key = `${s.block}|${s.tier}`;
    if (!map.has(key)) map.set(key, { key, block: s.block, tier: s.tier, seats: [] });
    map.get(key).seats.push(s);
  }
  for (const b of map.values()) {
    const n = b.seats.length;
    b.cx = b.seats.reduce((a, s) => a + s.x, 0) / n;
    b.cz = b.seats.reduce((a, s) => a + s.z, 0) / n;
    const rows = b.seats.map((s) => s.row).filter((r) => typeof r === 'number');
    b.rowMin = Math.min(...rows); b.rowMax = Math.max(...rows);
  }
  return [...map.values()];
}

// Garde-corps fixes du lieu (positions dérivées des sièges, hauteurs estimées) :
//  - devant le premier rang de chaque bloc du gradin 1 (chute vers la fosse) ;
//  - devant les rangs 34 et 49 (allées transversales relevées sur le plan) ;
//  - devant les plateformes PMR F et K.
function buildRails(venue) {
  const rails = [];
  const groups = new Map();
  for (const s of venue.seats) {
    if (s.zone === 'parterre' || s.zone === 'tribune') continue;
    let key = null;
    if (s.zone === 'pmr') key = s.pmr && isFrontPmr(venue.seats, s) ? `${s.block}|pmr` : null;
    else if (s.row === 34 || s.row === 49) key = `${s.block}|${s.row}|${Math.sign(s.x)}`;
    if (key) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
  }
  // façade du gradin 1 : pour chaque numéro de place, le premier rang qui le contient
  const g1 = new Map();
  for (const s of venue.seats) {
    if (s.zone !== 'gradin' || s.tier !== 'gradin1') continue;
    // colonne = numéro de place : le premier rang qui contient ce numéro est en façade
    const key = `${s.block}|${s.num}`;
    if (!g1.has(key) || g1.get(key).row > s.row) g1.set(key, s);
  }
  const fronts = new Map();
  for (const s of g1.values()) {
    // une façade = sièges consécutifs d'un même rang de tête dans un bloc
    const k = `${s.block}|${s.row}|${Math.sign(s.x)}`;
    if (!fronts.has(k)) fronts.set(k, []);
    fronts.get(k).push(s);
  }
  const add = (list, height, kind) => {
    const sorted = splitRuns(list);
    for (const run of sorted) {
      if (run.length < 2) continue;
      const pts = run.map((s) => [s.x + s.fx * 0.62, s.z + s.fz * 0.62]);
      const [a, b] = [pts[0], pts[1]];
      const [c, d] = [pts[pts.length - 1], pts[pts.length - 2]];
      const ext = (p, q) => { const dx = p[0] - q[0], dz = p[1] - q[1], n = Math.hypot(dx, dz) || 1; return [p[0] + dx / n * 0.3, p[1] + dz / n * 0.3]; };
      pts.unshift(ext(a, b)); pts.push(ext(c, d));
      rails.push({ kind, pts, y: run[0].y, h: height });
    }
  };
  for (const list of fronts.values()) add(list, 0.95, 'façade gradin 1');
  for (const [k, list] of groups) add(list, k.endsWith('pmr') ? 0.8 : 0.85, k.endsWith('pmr') ? 'plateforme PMR' : 'allée transversale');
  return rails;
}

// Garde-corps PMR : seulement devant la première rangée d'emplacements fauteuil.
function isFrontPmr(seats, s) {
  const R = (p) => Math.hypot(p.x - ARC_CENTER.x, p.z - ARC_CENTER.z);
  const front = Math.min(...seats.filter((p) => p.pmr && p.block === s.block).map(R));
  return R(s) < front + 0.9;
}

// Sièges consécutifs (numéros qui se suivent et proches) → tronçons de garde-corps.
function splitRuns(list) {
  const s = [...list].sort((a, b) => a.num - b.num);
  const runs = [];
  let cur = [];
  for (const p of s) {
    const last = cur[cur.length - 1];
    if (last && (p.num - last.num > 2 || Math.hypot(p.x - last.x, p.z - last.z) > 1.4)) { runs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

// Emplacement régie (lieu) : la zone sans sièges au centre des rangs 27 à 39,
// reliée au plateau par une galerie dans l'axe (fiche technique).
function buildRegie(seats) {
  const gap = (r) => {
    const row = seats.filter((s) => s.row === r && s.zone === 'gradin' && Math.abs(s.x) < 9);
    if (!row.length) return null;
    const neg = row.filter((s) => s.x < 0).map((s) => s.x), pos = row.filter((s) => s.x > 0).map((s) => s.x);
    return { r, half: Math.min(-Math.max(...neg), Math.min(...pos)) - 0.35, z: row.reduce((a, s) => a + s.z, 0) / row.length, y: row[0].y };
  };
  const g27 = gap(27), g34 = gap(34), g39 = gap(39), g40 = gap(40);
  return {
    // deux paliers suivant le gradin (estimation)
    parts: [
      { x0: -g27.half, x1: g27.half, z0: g27.z - 0.45, z1: g34.z - 0.5, y: 3.0 },
      { x0: -g34.half, x1: g34.half, z0: g34.z - 0.5, z1: g40.z - 0.5, y: g34.y },
    ],
    // équipement de la tournée (exemple) : consoles, racks, opérateurs
    desk: { x0: -3.2, x1: 3.2, z0: g27.z + 1.2, z1: g27.z + 2.4, y: 3.0, h: 1.15 },
  };
}

// ----- géométrie de vue ---------------------------------------------------------

export function eyeOf(s) {
  const h = s.pmr ? EYE_WHEELCHAIR : EYE_SEATED;
  return { x: s.x - s.fx * EYE_BACK, y: s.y + h, z: s.z - s.fz * EYE_BACK };
}

export const ARTIST = { x: 0, z: -2.6, height: 1.78 }; // silhouette au centre, 2,6 m derrière le nez de scène

export function seatMetrics(venue, s) {
  const e = eyeOf(s);
  const stageY = venue.stage.height;
  const a = { x: ARTIST.x, y: stageY + 1.6, z: ARTIST.z };
  const dist = Math.hypot(a.x - e.x, a.y - e.y, a.z - e.z);
  const horiz = Math.hypot(a.x - e.x, a.z - e.z);
  const angleDown = Math.atan2(e.y - a.y, horiz) * 180 / Math.PI;
  // angle entre l'axe du siège et la direction de l'artiste
  const dirA = Math.atan2(a.x - e.x, -(a.z - e.z));
  const dirSeat = Math.atan2(s.fx, -s.fz);
  let turn = (dirA - dirSeat) * 180 / Math.PI;
  turn = ((turn + 540) % 360) - 180;
  // largeur apparente de la scène (bords du nez de scène)
  const w = venue.stage.width / 2;
  const angL = Math.atan2(-w - e.x, e.z), angR = Math.atan2(w - e.x, e.z);
  const stageSpan = Math.abs(angR - angL) * 180 / Math.PI;
  // hauteur apparente de l'artiste (degrés) : utile pour comparer
  const artistDeg = (Math.atan2(stageY + ARTIST.height - e.y, horiz) - Math.atan2(stageY - e.y, horiz)) * 180 / Math.PI;
  return { eye: e, dist, horiz, angleDown, turn, stageSpan, artistDeg, eyeAboveStage: e.y - stageY };
}

// Masquages fixes : rayons de l'œil vers des points de la scène, testés contre
// les garde-corps et la régie (pas contre les têtes des spectateurs).
export function obstructions(venue, s, { tourGear = true } = {}) {
  const e = eyeOf(s);
  const Y = venue.stage.height;
  const samples = [];
  for (let x = -10; x <= 10.01; x += 2.5) for (const z of [-0.6, -3, -6, -9, -12]) samples.push({ x, y: Y + 0.02, z, kind: 'plateau' });
  for (const h of [0.05, 0.4, 0.9, 1.4, 1.75]) samples.push({ x: ARTIST.x, y: Y + h, z: ARTIST.z, kind: 'artiste' });
  const blockers = [];
  venue.rails.forEach((r, idx) => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      blockers.push({ kind: 'garde-corps', idx, a: r.pts[i], b: r.pts[i + 1], y0: r.y, y1: r.y + r.h });
    }
  });
  const rails = new Set();
  const boxes = [];
  if (tourGear) boxes.push({ kind: 'régie', ...venue.regie.desk, y0: venue.regie.desk.y, y1: venue.regie.desk.y + venue.regie.desk.h });
  const hit = { 'garde-corps': 0, 'régie': 0 };
  let stageMasked = 0, stageTotal = 0, artistMasked = 0, artistTotal = 0;
  const maskedArtist = [];
  let margin = Infinity, marginRail = null;
  for (const p of samples) {
    let by = null;
    for (const b of blockers) {
      const y = crossing(e, p, b);
      if (y == null) continue;
      if (y >= b.y0 && y <= b.y1) { by = b.kind; rails.add(b.idx); break; }
      // le rayon passe au-dessus : marge sous la ligne de vue (pieds de l'artiste, nez de scène)
      if (y > b.y1 && (p.kind === 'artiste' || p.z > -1) && y - b.y1 < margin) { margin = y - b.y1; marginRail = b.idx; }
    }
    if (!by) for (const b of boxes) if (segHitsBox(e, p, b)) { by = b.kind; break; }
    if (p.kind === 'plateau') { stageTotal++; if (by) stageMasked++; } else { artistTotal++; if (by) { artistMasked++; maskedArtist.push(p.y - Y); } }
    if (by) hit[by]++;
  }
  return {
    stage: stageMasked / stageTotal,
    artist: artistMasked / artistTotal,
    artistMaskedBelow: maskedArtist.length ? Math.max(...maskedArtist) : 0,
    by: Object.entries(hit).filter(([, n]) => n).map(([k]) => k),
    rails: [...rails],
    // garde-corps visible juste sous la ligne de vue (sans masquer) : marge en mètres
    nearMiss: !rails.size && margin < 0.3 ? { margin, rail: marginRail } : null,
  };
}

function crossing(e, p, w) {
  // hauteur du rayon œil→point à l'endroit où il croise le garde-corps (en plan), sinon null
  const [ax, az] = w.a, [bx, bz] = w.b;
  const rx = p.x - e.x, rz = p.z - e.z, sx = bx - ax, sz = bz - az;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - e.x) * sz - (az - e.z) * sx) / den;
  const u = ((ax - e.x) * rz - (az - e.z) * rx) / den;
  if (t <= 0.02 || t >= 1 || u < 0 || u > 1) return null;
  return e.y + t * (p.y - e.y);
}

function segHitsBox(e, p, b) {
  let t0 = 0, t1 = 1;
  for (const [o, d, lo, hi] of [[e.x, p.x - e.x, b.x0, b.x1], [e.y, p.y - e.y, b.y0, b.y1], [e.z, p.z - e.z, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}
