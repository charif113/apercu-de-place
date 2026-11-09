import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CUTS = {
  buzz: { nape: 0.29, brow: 0.72, lift: 0.004, fullness: 0.003 },
  fade: { nape: 0.27, brow: 0.74, lift: 0.012, fullness: 0.008, sweep: 0.009 },
  curls: { nape: 0.23, brow: 0.69, lift: 0.020, fullness: 0.016, texture: 0.007 },
  waves: { nape: 0.19, brow: 0.72, lift: 0.014, fullness: 0.012, texture: 0.004 },
  tied: { nape: 0.23, brow: 0.75, lift: 0.008, fullness: 0.008 },
};

const POSES = [
  { until: 2, build: 1.02, lean: 0.052, side: -0.016, head: 0.98, turn: 0.12, cut: 'fade', hair: 0x463224, coat: 0x555342, skin: 0xb98466, clothes: 'overshirt', gesture: 'up' },
  { until: 5, build: 0.91, lean: 0.097, side: 0.014, head: 0.95, turn: -0.14, cut: 'tied', hair: 0x3d2b25, coat: 0x373948, skin: 0xc09478, clothes: 'tee', gesture: 'phone' },
  { until: 12, build: 1.13, lean: 0.016, side: 0.012, head: 1.02, turn: 0.17, cut: 'buzz', hair: 0x5c4943, coat: 0x534951, skin: 0xa47c68, clothes: 'overshirt' },
  { until: 37, build: 1.00, lean: 0.036, side: -0.025, head: 0.99, turn: -0.17, cut: 'fade', hair: 0x4c3b2d, coat: 0x354353, skin: 0xb89b85, clothes: 'hoodie' },
  { until: 60, build: 1.07, lean: 0.105, side: 0.024, head: 0.95, turn: 0.16, cut: 'curls', hair: 0x3b2927, coat: 0x594450, skin: 0x916650, clothes: 'tee' },
  { until: 83, build: 0.90, lean: 0.061, side: -0.021, head: 0.94, turn: -0.11, cut: 'waves', hair: 0x745035, coat: 0x524639, skin: 0xd1a992, clothes: 'overshirt' },
  { until: 100, build: 0.96, lean: 0.083, side: 0.019, head: 0.97, turn: 0.09, cut: 'tied', hair: 0x584333, coat: 0x3a5050, skin: 0xb69078, clothes: 'sweater' },
];
const TINTS = [0xe0c8b8, 0xb5c5d5, 0xcab6ac, 0xaab2c0, 0xd6d4c2, 0xc3a8a0];

// Les profils sont en mètres, dans le repère du fauteuil, le dos vers +Z.
const HEAD = [
  // t, demi-largeur, profondeur arrière, profondeur avant, axe Z
  [0.00, 0.047, 0.039, 0.043, 0.008],
  [0.18, 0.043, 0.041, 0.043, 0.002],
  [0.30, 0.060, 0.059, 0.075, -0.006],
  [0.43, 0.069, 0.068, 0.086, -0.008],
  [0.57, 0.076, 0.079, 0.090, -0.003],
  [0.71, 0.073, 0.082, 0.081, 0.003],
  [0.84, 0.061, 0.069, 0.065, 0.006],
  [0.94, 0.041, 0.044, 0.044, 0.006],
  [1.00, 0.001, 0.002, 0.002, 0.004],
];

function coloredRings(rows, sides, sample) {
  const positions = [], colors = [], indices = [];
  for (let row = 0; row < rows; row++) {
    for (let side = 0; side < sides; side++) {
      const { x, y, z, color, shade = 1 } = sample(row, side * Math.PI * 2 / sides);
      positions.push(x, y, z);
      colors.push(color.r * shade, color.g * shade, color.b * shade);
      if (row === 0) continue;
      const a = (row - 1) * sides + side;
      const b = (row - 1) * sides + (side + 1) % sides;
      indices.push(a, b, b + sides, a, b + sides, a + sides);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tint(geometry, hex) {
  const c = new THREE.Color(hex);
  const colors = new Float32Array(3 * geometry.attributes.position.count);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  geometry.deleteAttribute('uv');
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function oval(x, y, z, width, height, depth, color, sides = 8, rings = 5) {
  const g = new THREE.SphereGeometry(1, sides, rings);
  return tint(g.scale(width, height, depth).translate(x, y, z), color);
}

function sectionAt(rings, t) {
  const index = rings.findIndex(([limit]) => limit >= t);
  if (index <= 0) return rings[index === 0 ? 0 : rings.length - 1].slice(1);
  const a = rings[index - 1], b = rings[index];
  const f = (t - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((value, i) => THREE.MathUtils.lerp(value, b[i + 1], f));
}

// La chevelure fait partie du même maillage que le crâne, avec des normales
// continues sur la ligne d'implantation. La partie frontale distingue menton,
// pommettes et front jusque dans une vue trois quarts.
function headParts(pose, close, neckX, neckZ) {
  const cut = CUTS[pose.cut];
  const skin = new THREE.Color(pose.skin);
  const hair = new THREE.Color(pose.hair ?? pose.skin);
  const bands = close ? [0, 0.22, 0.48, 0.72, 0.96, 1.035, 1.26, 1.53, 1.78, 2] : [0, 0.78, 1.11, 1.58, 2];
  const color = new THREE.Color();
  const head = coloredRings(bands.length, close ? 18 : 6, (row, a) => {
    const s = Math.sin(a), c = Math.cos(a);
    const front = (1 - c) * 0.5;
    const band = bands[row];
    const hairline = THREE.MathUtils.lerp(cut.nape, cut.brow, front ** 1.20) +
      Math.sin(3 * a) * 0.016 + Math.sin(a) * 0.014 + Math.max(c, 0) * 0.02 * Math.cos(4 * a);
    const top = Math.max(0, band - 1);
    const t = top > 0 ? THREE.MathUtils.lerp(hairline, 1, top) : band * hairline;
    const [width, back, face, axis] = sectionAt(HEAD, t);
    const wave = Math.sin(a * 7 + top * 9) * (cut.texture || 0);
    const volume = (cut.fullness + wave) * Math.sin(top * Math.PI);
    const crown = Math.sin(top * Math.PI / 2);
    // Au loin, la coiffure liée se lit comme un relief du crâne lui-même.
    const knot = !close && pose.cut === 'tied' && c > 0 ? Math.max(0, 1 - Math.abs(top - 0.58) * 4) * 0.031 * c : 0;
    const drape = !close && pose.cut === 'waves' && c > 0 && row === 2 ? 0.021 * c : 0;
    const depth = c >= 0 ? back + knot + drape : face;
    const hairCover = THREE.MathUtils.smoothstep(band, pose.cut === 'buzz' ? 0.76 : 0.965, 1.035);
    color.copy(skin).lerp(hair, hairCover);
    const grain = close ? Math.cos(a * 9 + top * 12) * hairCover * 0.085 : 0;
    const eyeSocket = close && c < -0.6 && t > 0.48 && t < 0.72 ? 0.07 : 0;
    const collarShadow = Math.max(c, 0) * (1 - THREE.MathUtils.smoothstep(t, 0.03, 0.33)) * 0.23;
    return {
      x: ((width + volume) * s + (cut.sweep || 0) * crown) * pose.head,
      y: (t * 0.251 + cut.lift * crown) * pose.head,
      z: (axis + (depth + volume) * c) * pose.head,
      color,
      shade: 0.97 + grain - eyeSocket - collarShadow,
    };
  });
  const details = [head];
  if (close) {
    for (const side of [-1, 1]) {
      const earTone = skin.clone().multiplyScalar(0.75).getHex();
      const ear = oval(side * 0.073, 0.137, 0.003, 0.010, 0.021, 0.016, earTone, 8, 5);
      ear.rotateY(side * 0.035);
      details.push(ear);
    }
    const nose = oval(0, 0.129, -0.095, 0.012, 0.019, 0.012, pose.skin, 7, 5);
    details.push(nose);
  }
  if (close && pose.cut === 'waves') {
    // Panneau de cheveux qui s'élargit en descendant vers les épaules.
    const hair = new THREE.Color(pose.hair);
    const locks = [[-0.004, 0.052, 0.009, 0.051], [0.045, 0.072, 0.018, 0.053],
      [0.118, 0.074, 0.022, 0.053], [0.173, 0.055, 0.014, 0.056]];
    details.push(coloredRings(locks.length, 12, (row, a) => {
      const [y, w, d, z] = locks[row];
      return { x: w * Math.sin(a) - 0.009, y: y + Math.sin(a + row) * 0.009, z: z + d * Math.cos(a),
        color: hair, shade: 1 + Math.sin(5 * a + row) * 0.12 };
    }));
  }
  if (close && pose.cut === 'tied') {
    details.push(oval(0.012, 0.157, 0.083, 0.029, 0.027, 0.028, pose.hair, 12, 6));
  }
  const rotation = new THREE.Euler(pose.lean * -0.52, pose.turn, pose.side * 2, 'YXZ');
  for (const part of details) {
    part.rotateX(rotation.x).rotateZ(rotation.z).rotateY(rotation.y).translate(neckX, 1.004, neckZ);
  }
  return details;
}

// Volumes continus de manche et pantalon, avec un contour au coude ou au
// genou plutôt qu'une articulation rapportée.
function garmentLimb(points, sides) {
  const centers = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const rings = centers.map((center, i) => {
    const tangent = centers[Math.min(i + 1, centers.length - 1)].clone().sub(centers[Math.max(i - 1, 0)]).normalize();
    const u = new THREE.Vector3(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
    const v = tangent.clone().cross(u);
    const [, , , width, depth, hex] = points[i];
    return { center, u: u.multiplyScalar(width), v: v.multiplyScalar(depth), color: new THREE.Color(hex) };
  });
  return coloredRings(rings.length, sides, (i, a) => {
    const { center, u, v, color } = rings[i];
    const c = Math.cos(a), s = Math.sin(a);
    return { x: center.x + u.x * c + v.x * s, y: center.y + u.y * c + v.y * s, z: center.z + u.z * c + v.z * s,
      color, shade: 0.95 + 0.07 * Math.sin(a + i * 0.65) };
  });
}

const PHONE_POS = [0.175, 1.145, -0.188];
const PHONE_TILT = -0.19;

function arms(pose, close, side) {
  const { lean, build, coat, skin, clothes } = pose;
  const x = pose.side;
  const inner = [side * 0.108 * build + x, 0.956, -lean * 0.84 + 0.024, 0.037, 0.039, coat];
  const shoulder = [side * 0.149 * build + x, 0.920, -lean * 0.82 + 0.023, 0.054, 0.054, coat];
  const bicep = [side * 0.177 * build + x, 0.837, -lean * 0.65 + 0.012, 0.051, 0.050, coat];
  if (side > 0 && pose.gesture) {
    const phone = pose.gesture === 'phone';
    const wrist = phone ? [0.179, 1.088, -0.182] : [0.209, 1.283, -0.174];
    const points = [
      inner, shoulder, bicep,
      [phone ? 0.185 : 0.203, phone ? 0.789 : 0.929, -0.140, 0.046, 0.039, coat],
      [phone ? 0.178 : 0.201, phone ? 0.911 : 1.096, -0.172, 0.035, 0.028, skin],
      [...wrist, 0.023, 0.018, skin],
      [wrist[0] - 0.004, wrist[1] + 0.038, wrist[2] + 0.003, 0.027, 0.015, skin],
      [wrist[0] - 0.007, wrist[1] + 0.065, wrist[2] + 0.007, 0.011, 0.010, skin],
    ];
    const arm = garmentLimb(close ? points : [points[0], points[3], points[5], points[7]], close ? 9 : 5);
    const parts = [arm];
    if (close) parts.push(oval(wrist[0] - 0.023, wrist[1] + 0.025, wrist[2] - 0.007, 0.013, 0.023, 0.011, skin, 6, 3));
    if (phone) {
      const device = new THREE.BoxGeometry(0.048, 0.087, 0.012);
      parts.push(tint(device.rotateX(PHONE_TILT).translate(...PHONE_POS), 0x20232c));
    }
    return parts;
  }
  if (!close) return [];
  const sleeve = clothes === 'tee' ? skin : coat;
  const rest = pose.side * side > 0 ? 0.025 : 0;
  return [garmentLimb([
    inner, shoulder, bicep,
    [side * 0.168 + x, 0.743 + rest, -lean - 0.061, 0.044, 0.041, sleeve],
    [side * 0.163 + x, 0.686 + rest, -lean - 0.114, 0.041, 0.036, sleeve],
    [side * 0.124 + x, 0.624, -0.246 - rest, 0.029, 0.027, sleeve],
    [side * 0.108 + x, 0.595, -0.290 - rest, 0.026, 0.019, skin],
    [side * 0.091 + x, 0.572, -0.325 - rest, 0.010, 0.010, skin],
  ], 8)];
}

function poseGeometry(pose, close) {
  const { build, lean, side, coat, clothes } = pose;
  const cloth = new THREE.Color(coat);
  const neckX = side * 0.86, neckZ = 0.018 - lean;
  const collar = clothes === 'tee' ? 1.053 : clothes === 'hoodie' ? 1.086 : 1.076;
  const torso = [
    [0.429, 0.097, 0.076, 0, 0.030, 0.83],
    [0.486, 0.148, 0.104, 0, 0.042, 0.89],
    [0.596, 0.142, 0.102, side * 0.23, 0.043, 0.94],
    [0.718, 0.140, 0.113, side * 0.46, 0.028 - lean * 0.23, 1.00],
    [0.854, 0.169 * build, 0.110, side * 0.69, 0.018 - lean * 0.58, 0.95],
    [0.952, 0.167 * build, 0.099, side, 0.021 - lean * 0.84, 1.01],
    [1.001, 0.125 * build, 0.073, side, neckZ, 0.97],
    [1.023, 0.076, 0.060, neckX, neckZ, 0.93],
    [collar - 0.014, 0.058, 0.053, neckX, neckZ + 0.005, 0.81],
    [collar, 0.046, 0.044, neckX, neckZ + 0.006, 1.08],
  ];
  const bodyRings = close ? torso : [torso[0], torso[3], torso[5], torso.at(-1)];
  const body = coloredRings(bodyRings.length, close ? 14 : 6, (i, a) => {
    const [y, width, depth, x, z, shade] = bodyRings[i];
    const curve = Math.cos(a);
    const shoulder = i >= bodyRings.length - 4 && i < bodyRings.length - 1;
    const fold = close ? Math.sin(a * 5 + i * 0.72) * 0.003 : 0;
    const yoke = clothes === 'overshirt' && shoulder ? 0.08 : 0;
    return {
      x: x + (width + fold) * Math.sin(a),
      y: y - (shoulder ? (1 - curve * curve) * 0.023 : 0),
      z: z + (depth + fold + (curve > 0 && i === 4 ? 0.010 : 0)) * curve,
      color: cloth,
      shade: shade + yoke + (close ? Math.cos(a * 4 + i * 0.8) * 0.038 : 0),
    };
  });
  const parts = [body, ...headParts(pose, close, neckX, neckZ)];
  if (close && clothes === 'hoodie') {
    const hood = [[0.856, 0.033, 0.007, 0.130], [0.894, 0.085, 0.024, 0.126], [0.944, 0.112, 0.031, 0.102],
      [0.994, 0.080, 0.028, 0.071], [1.018, 0.049, 0.011, 0.052]];
    parts.push(coloredRings(hood.length, 10, (i, a) => {
      const [y, w, d, z] = hood[i];
      return { x: neckX + w * Math.sin(a), y, z: neckZ + z + d * Math.cos(a), color: cloth, shade: i === 4 ? 0.75 : 1.09 };
    }));
  }
  for (const sign of [-1, 1]) {
    parts.push(...arms(pose, close, sign));
    if (!close) continue;
    const pant = clothes === 'overshirt' ? 0x3d3c3f : 0x2e3440;
    const shoe = 0x272b31, x = sign * (0.102 + (build - 1) * 0.06);
    const spread = sign * (pose.side > 0 ? 0.026 : 0.012);
    parts.push(garmentLimb([
      [x, 0.477, 0.077, 0.075, 0.073, pant],
      [x + spread * 0.3, 0.465, -0.112, 0.078, 0.071, pant],
      [x + spread, 0.453, -0.277, 0.067, 0.061, pant],
      [x + spread, 0.391, -0.330, 0.060, 0.052, pant],
      [x + spread, 0.105, -0.343, 0.041, 0.036, pant],
      [x + spread, 0.054, -0.360, 0.045, 0.033, shoe],
      [x + spread, 0.031, -0.439, 0.035, 0.019, shoe],
      [x + spread, 0.026, -0.465, 0.012, 0.009, shoe],
    ], 7));
  }
  const merged = mergeGeometries(parts);
  parts.forEach((geometry) => geometry.dispose());
  return merged;
}

function seatSeed(seat) {
  let n = 2166136261;
  for (const ch of seat.id) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return (n ^ n >>> 16) >>> 0;
}

function instances(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export class AudienceModel {
  constructor(venue, scene) {
    this.root = new THREE.Group();
    this.root.name = 'public-simule';
    this.root.visible = false;
    scene.add(this.root);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 });
    const seats = POSES.map(() => []);
    for (const seat of venue.seats) {
      if (seat.pmr) continue;
      const seed = seatSeed(seat);
      // Les mains levées et les téléphones restent minoritaires (≈ 2 % et 3 %).
      const pct = seed % 100;
      const variant = POSES.findIndex((pose) => pct < pose.until);
      seats[variant].push({ seat, seed });
    }
    this.buckets = POSES.map((pose, index) => {
      const capacity = seats[index].length;
      const close = instances(poseGeometry(pose, true), material, capacity);
      const far = instances(poseGeometry(pose, false), material, capacity);
      this.root.add(close, far);
      return { close, far, seats: seats[index], phone: pose.gesture === 'phone' };
    });
    const screen = new THREE.PlaneGeometry(0.041, 0.071);
    screen.rotateX(PHONE_TILT);
    screen.translate(PHONE_POS[0], PHONE_POS[1], PHONE_POS[2] + 0.008);
    const phoneBucket = this.buckets.find((bucket) => bucket.phone);
    this.phones = instances(screen, new THREE.MeshBasicMaterial({ color: 0xc3dded, toneMapped: false }), phoneBucket.seats.length);
    this.root.add(this.phones);
    this.taken = new Set();
  }

  setAudience(taken, on) {
    const changed = taken !== this.taken || this.root.visible !== on;
    this.taken = taken;
    this.root.visible = on;
    if (on && changed) this.rebuild();
  }

  setObserver(seat) {
    if (this.observer?.id === seat?.id) return;
    this.observer = seat;
    if (this.root.visible) this.rebuild();
  }

  rebuild() {
    const observer = this.observer;
    const detailedRadius = matchMedia('(max-width: 760px)').matches ? 8 : 12;
    const p = new THREE.Vector3(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4();
    const e = new THREE.Euler(), q = new THREE.Quaternion(), color = new THREE.Color();
    this.phones.count = 0;
    for (const { close, far, seats, phone } of this.buckets) {
      close.count = far.count = 0;
      for (const { seat, seed } of seats) {
        if (!this.taken.has(seat.id) || seat.id === observer?.id) continue;
        const detail = observer && Math.hypot(seat.x - observer.x, seat.z - observer.z) <= detailedRadius;
        const mesh = detail ? close : far;
        p.set(seat.x + ((seed % 11) - 5) * 0.004, seat.y, seat.z + ((seed % 7) - 3) * 0.009);
        // Les chaises du parterre regardent vers -Z, comme les silhouettes.
        q.setFromEuler(e.set(0, seat.yaw + ((seed % 15) - 7) * 0.014, 0));
        scale.set(0.94 + (seed % 9) * 0.014, 0.95 + (seed % 13) * 0.009, 1);
        matrix.compose(p, q, scale);
        mesh.setMatrixAt(mesh.count, matrix);
        mesh.setColorAt(mesh.count++, color.set(TINTS[(seed >>> 16) % TINTS.length]));
        if (phone) this.phones.setMatrixAt(this.phones.count++, matrix);
      }
    }
    for (const mesh of this.root.children) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (mesh.count) mesh.computeBoundingSphere();
    }
  }
}
