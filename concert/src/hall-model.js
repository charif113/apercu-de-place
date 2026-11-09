import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function meshGroup(parent, geometry, material, name) {
  const mesh = new THREE.Mesh(mergeGeometries(geometry), material);
  mesh.name = name;
  parent.add(mesh);
}

function tube(a, b, radius, sides = 5) {
  const axis = new THREE.Vector3().subVectors(b, a);
  const cylinder = new THREE.CylinderGeometry(radius, radius, axis.length(), sides, 1, true);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  cylinder.applyQuaternion(rotation);
  const center = a.clone().lerp(b, 0.5);
  cylinder.translate(center.x, center.y, center.z);
  return cylinder;
}

function addRoof(parent, mat) {
  const overhead = new THREE.Group();
  overhead.name = 'charpente et toiture';
  parent.add(overhead);
  const ribs = [];
  const arch = (x) => 19.5 + 5.5 * Math.cos((x / 42) * Math.PI / 2);
  for (let z = -16; z <= 58; z += 6.2) {
    const nodes = Array.from({ length: 15 }, (_, i) => {
      const x = -42 + i * 6;
      return new THREE.Vector3(x, arch(x), z);
    });
    const lower = nodes.map((p) => p.clone().add(new THREE.Vector3(0, -1.35, 0)));
    ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(nodes), 28, 0.19, 5));
    ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lower), 28, 0.12, 5));
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = i % 2 ? lower[i] : nodes[i];
      const b = i % 2 ? nodes[i + 1] : lower[i + 1];
      ribs.push(tube(a, b, 0.085));
    }
  }
  for (let x = -36; x <= 36; x += 9) {
    const y = arch(x) - 1.35;
    ribs.push(tube(new THREE.Vector3(x, y, -16), new THREE.Vector3(x, y, 58), 0.095));
  }
  const steel = mat(0x38444e, { roughness: 0.63, metalness: 0.22, emissive: 0x101b2c, emissiveIntensity: 0.11 });
  meshGroup(overhead, ribs, steel, 'arcs triangulés');
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(120, 110), mat(0x11151b, { side: THREE.DoubleSide }));
  roof.rotation.x = Math.PI / 2;
  roof.position.set(0, 26, 21);
  overhead.add(roof);
  return {
    overhead,
    setConcertLighting(on) {
      // Un bleu ardoise discret laisse les faisceaux de scène au premier plan.
      steel.color.setHex(on ? 0x26323f : 0x38444e);
      steel.emissiveIntensity = on ? 0.065 : 0.11;
    },
  };
}

// Travées et rideaux déduits des deux vues officielles. Ces cotes restent illustratives.
function addSideGallery(parent, mat) {
  const decks = [], cabinets = [], seams = [], drapes = [], doors = [];
  const nearStage = [[22.50, -15.54], [41.32, 21.84]];
  const nearStands = [[41.9, 22], [36.2, 48.2]];
  for (const side of [-1, 1]) {
    for (const [section, [[x0, z0], [x1, z1]]] of [nearStage, nearStands].entries()) {
      const dx = (x1 - x0) * side, dz = z1 - z0;
      const length = Math.hypot(dx, dz), yaw = -Math.atan2(dz, dx);
      const box = (width, height, depth, along, y, offset) => {
        const g = new THREE.BoxGeometry(width, height, depth);
        g.rotateY(yaw);
        g.translate(0.25 + side * x0 + (dx * along - side * dz * offset) / length, y, z0 + (dz * along + side * dx * offset) / length);
        return g;
      };
      const y = section === 0 ? 6.85 : 14.5;
      const projection = section === 0 ? 0.86 : 0.19;
      decks.push(box(length, 0.54, projection, length / 2, y, projection / 2));
      decks.push(box(length, 0.25, 0.24, length / 2, y + 2.95, 0.18));
      for (let along = 1.6; along < length - 1.4; along += 2.55) {
        cabinets.push(box(1.32, 1.2, 0.18, along, y + 1.68, 0.13));
        cabinets.push(box(0.56, 1.55, 0.20, along + 0.97, y + 1.78, 0.15));
        seams.push(box(2.24, 0.045, 0.08, along, y + 2.56, 0.25));
      }
      if (section !== 0) continue;
      seams.push(box(length, 0.058, 0.055, length / 2, y + 1.05, 0.87));
      for (let along = 0.5; along < length; along += 1.2) seams.push(box(0.038, 0.92, 0.047, along, y + 0.62, 0.87));
      for (const along of [6.1, 17.1, 27.4]) {
        drapes.push(box(2.10, 15.7, 0.11, along, 8.2, 0.97));
        for (let fold = -0.9; fold <= 0.92; fold += 0.185) {
          drapes.push(box(0.096, 15.7, 0.14 + 0.025 * Math.cos(fold * 18), along + fold, 8.2, 1.06));
        }
      }
      for (const along of [11, 22]) {
        cabinets.push(box(2.15, 2.9, 0.13, along, 1.45, 0.21));
        doors.push(box(1.86, 2.62, 0.12, along, 1.31, 0.32));
      }
    }
  }
  meshGroup(parent, decks, mat(0x303238, { metalness: 0.21 }), 'passerelles latérales');
  meshGroup(parent, cabinets, mat(0x373940, { metalness: 0.12 }), 'cassettes des galeries');
  meshGroup(parent, seams, mat(0x454953, { metalness: 0.34 }), 'montants des galeries');
  meshGroup(parent, drapes, mat(0x101218, { roughness: 0.98 }), 'rideaux d’occultation');
  meshGroup(parent, doors, mat(0x191c23), 'portes de service');
}

// La baie vers le stade est fermée dans la configuration frontale simulée.
function addStagePortal(parent, stage, mat) {
  const z = -stage.depth - stage.backGap;
  const closed = new THREE.Mesh(new THREE.BoxGeometry(43, 15, 0.38), mat(0x171a21));
  closed.name = 'baie du stade fermée';
  closed.position.set(0, 7.5, z);
  parent.add(closed);
  const frame = [], slats = [];
  for (const x of [-21.65, 21.65]) {
    frame.push(new THREE.BoxGeometry(0.48, 15.5, 0.54).translate(x, 7.75, z + 0.16));
    for (let i = 0; i < 8; i++) {
      slats.push(new THREE.BoxGeometry(0.14, 14.95, 0.18).translate(x + Math.sign(x) * i * 0.17, 7.5, z + 0.56));
    }
  }
  frame.push(new THREE.BoxGeometry(43.9, 0.54, 0.73).translate(0, 15.24, z + 0.26));
  for (let y = 0.85; y < 14.9; y += 0.82) slats.push(new THREE.BoxGeometry(43, 0.038, 0.04).translate(0, y, z + 0.2));
  meshGroup(parent, frame, mat(0x424954, { metalness: 0.34 }), 'encadrement de la baie');
  meshGroup(parent, slats, mat(0x262a31, { metalness: 0.12 }), 'lames et rideaux de la baie');
}

export function buildHall(parent, venue, mat) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), mat(0x494641, { roughness: 0.74, metalness: 0.02 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 25);
  parent.add(floor);
  const walls = [];
  for (const [ax, az, bx, bz] of venue.walls) {
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) continue;
    // Certains traits du plan horizontal croisent des sièges. Les extruder à
    // pleine hauteur placerait une paroi fictive devant ces places.
    const overlapsSeats = venue.seats.some((seat) => {
      const x = seat.x - ax, z = seat.z - az;
      const along = (x * dx + z * dz) / length;
      return along >= 0 && along <= length && Math.abs(x * dz - z * dx) < 0.32 * length;
    });
    const height = overlapsSeats ? 0.10 : 19;
    const geometry = new THREE.BoxGeometry(length, height, 0.30);
    geometry.rotateY(-Math.atan2(dz, dx));
    geometry.translate((ax + bx) / 2, height / 2, (az + bz) / 2);
    walls.push(geometry);
  }
  meshGroup(parent, walls, mat(0x272a31, { roughness: 0.92 }), 'murs du plan D6');
  addStagePortal(parent, venue.stage, mat);
  addSideGallery(parent, mat);
  const exit = new THREE.MeshBasicMaterial({ color: 0x2bb676 });
  const signs = [[-31, 3.2, 20, Math.PI / 2.6], [31, 3.2, 20, -Math.PI / 2.6],
    [-20, 15.2, 61, 0], [20, 15.2, 61, 0], [-40, 3, 40, Math.PI / 2], [40, 3, 40, -Math.PI / 2]];
  for (const [x, y, z, yaw] of signs) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.22, 0.05), exit);
    sign.position.set(x, y, z);
    sign.rotation.y = yaw;
    parent.add(sign);
  }
  return addRoof(parent, mat);
}

// Profils de coques en mètres, du bord avant jusqu'en haut du dossier.
// [z, y, demi-largeur, relevé latéral de l'assise, cintrage du dossier]
const MOBILE_CHAIR = [
  [-0.24, 0.426, 0.143, 0.018, 0], [-0.205, 0.442, 0.198, 0.020, 0],
  [-0.08, 0.439, 0.204, 0.023, 0], [0.115, 0.438, 0.187, 0.025, -0.006],
  [0.174, 0.493, 0.175, 0.018, -0.015], [0.213, 0.626, 0.174, 0.007, -0.023],
  [0.239, 0.777, 0.174, 0, -0.024], [0.246, 0.814, 0.144, 0, -0.021],
];
const FIXED_SEAT = [
  [-0.218, 0.436, 0.143, 0.014, 0], [-0.184, 0.45, 0.189, 0.023, 0],
  [-0.035, 0.441, 0.196, 0.027, 0], [0.132, 0.456, 0.165, 0.019, 0],
];
const FIXED_BACK = [
  [0.148, 0.492, 0.142, 0, -0.016], [0.184, 0.554, 0.179, 0, -0.027],
  [0.231, 0.779, 0.179, 0, -0.027], [0.243, 0.845, 0.146, 0, -0.022],
];

function chairShell(profile, columns = [-1, 0, 1]) {
  const width = columns.length;
  const surfaceSize = profile.length * width;
  const positions = [], tones = [], faces = [];
  for (const underside of [false, true]) {
    profile.forEach(([z, y, half, rise, curve], i) => {
      const before = profile[Math.max(0, i - 1)], after = profile[Math.min(profile.length - 1, i + 1)];
      const dz = after[0] - before[0], dy = after[1] - before[1], length = Math.hypot(dz, dy);
      const offset = underside ? 0.017 / length : 0;
      for (const edge of columns) {
        positions.push(edge * half, y + rise * edge ** 2 - dz * offset, z + curve * edge ** 2 + dy * offset);
        const shade = (underside ? 0.78 : 0.96) + Math.abs(edge) * 0.10 - 0.06 * Math.cos(i * 0.7);
        tones.push(shade, shade, shade);
      }
    });
  }
  for (let i = 0; i < surfaceSize - width; i += width) {
    for (let x = 0; x < width - 1; x++) {
      const a = i + x, b = a + 1, c = a + width, d = c + 1;
      faces.push(a, c, b, b, c, d, a + surfaceSize, b + surfaceSize, c + surfaceSize, b + surfaceSize, d + surfaceSize, c + surfaceSize);
    }
  }
  const rim = columns.map((_, i) => i);
  for (let i = width * 2 - 1; i < surfaceSize; i += width) rim.push(i);
  for (let i = surfaceSize - 2; i >= surfaceSize - width; i--) rim.push(i);
  for (let i = surfaceSize - width * 2; i > 0; i -= width) rim.push(i);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    faces.push(a, b, a + surfaceSize, b, b + surfaceSize, a + surfaceSize);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(tones, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return geometry;
}

function chairBackRidge(profile) {
  const points = [];
  for (const side of [-1, 1]) {
    for (const [z, y, half, , curve] of side < 0 ? profile : [...profile].reverse()) {
      points.push(new THREE.Vector3(side * 0.85 * half, y - 0.009, z + curve * 0.85 + 0.017));
    }
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), 12, 0.006, 5, false);
}

function chairFrame(mobile) {
  const tubes = [];
  const bar = (a, b, radius = 0.016) => tube(new THREE.Vector3(...a), new THREE.Vector3(...b), radius, 4);
  if (mobile) {
    for (const x of [-0.155, 0.155]) {
      tubes.push(bar([x, 0.447, 0.054], [x * 1.18, 0.018, -0.204]));
      tubes.push(bar([x, 0.447, 0.054], [x * 1.12, 0.018, 0.225]));
    }
    tubes.push(bar([-0.17, 0.235, 0.138], [0.17, 0.235, 0.138], 0.012));
  } else {
    // Support étroit sous l'assise, et deux traverses de dossier rabattable.
    tubes.push(bar([0, 0.025, 0.04], [0, 0.431, 0.048], 0.035));
    tubes.push(bar([-0.164, 0.428, 0.07], [0.164, 0.428, 0.07], 0.016));
    for (const x of [-0.142, 0.142]) tubes.push(bar([x, 0.418, 0.064], [x, 0.552, 0.199], 0.014));
  }
  return mergeGeometries(tubes);
}

export function addVenueChairs(parent, seats, mat) {
  const shells = {
    mobile: chairShell(MOBILE_CHAIR),
    fixed: mergeGeometries([chairShell(FIXED_SEAT), chairShell(FIXED_BACK)]),
  };
  const frames = { mobile: chairFrame(true), fixed: chairFrame(false) };
  const overviewShells = {
    mobile: chairShell([MOBILE_CHAIR[0], MOBILE_CHAIR[2], MOBILE_CHAIR[4], MOBILE_CHAIR.at(-1)], [-1, 1]),
    fixed: chairShell([FIXED_SEAT[0], FIXED_SEAT.at(-1), FIXED_BACK[1], FIXED_BACK.at(-1)], [-1, 1]),
  };
  const seatMaterial = mat(0xffffff, { vertexColors: true, roughness: 0.53, metalness: 0.02 });
  const frameMaterial = mat(0x24262b, { roughness: 0.56, metalness: 0.29 });
  const colors = [0x2b6eaa, 0x80a0b9, 0x8dafc9, 0x284cae, 0x343a45].map((c) => new THREE.Color(c));
  const origin = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1), matrix = new THREE.Matrix4(), color = new THREE.Color();
  // Regrouper par bloc permet au moteur d'omettre les rangées hors du champ.
  const batches = new Map();
  const nearby = [];
  const levels = [];
  for (const seat of seats) {
    if (seat.pmr) continue;
    const key = `${seat.tier}-${seat.block}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(seat);
  }
  for (const [key, group] of batches) {
    const zone = group[0].companion ? 'gradin' : group[0].zone;
    const type = zone === 'parterre' ? 'mobile' : 'fixed';
    const shell = new THREE.InstancedMesh(shells[type], seatMaterial, group.length);
    const support = new THREE.InstancedMesh(frames[type], frameMaterial, group.length);
    shell.name = `coques ${key}`;
    support.name = `supports ${key}`;
    group.forEach((s, i) => {
      const isBlueCenter = s.tier === 'gradin1' && ['G', 'I'].includes(s.block) && s.row <= 26;
      const palette = s.companion ? 4 : zone === 'parterre' ? 0 : zone === 'tribune' ? 1 : isBlueCenter ? 3 : 2;
      origin.set(s.x, s.y, s.z);
      rotation.setFromAxisAngle(yAxis, s.yaw);
      matrix.compose(origin, rotation, scale);
      color.copy(colors[palette]).multiplyScalar(0.92 + ((i * 7 + s.num * 3) % 11) / 100);
      shell.setMatrixAt(i, matrix);
      shell.setColorAt(i, color);
      support.setMatrixAt(i, matrix);
      nearby.push({ seat: s, type, color: color.clone().multiplyScalar(0.66) });
    });
    parent.add(shell, support);
    shell.computeBoundingSphere();
    levels.push({ type, shell, support, simplified: false });
  }
  const ridgeMaterial = mat(0xffffff, { roughness: 0.48, metalness: 0.025 });
  const ridges = {
    mobile: new THREE.InstancedMesh(chairBackRidge(MOBILE_CHAIR.slice(-4)), ridgeMaterial, 48),
    fixed: new THREE.InstancedMesh(chairBackRidge(FIXED_BACK), ridgeMaterial, 48),
  };
  for (const ridge of Object.values(ridges)) {
    ridge.count = 0;
    ridge.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ridge.name = 'nervures moulées à proximité';
    parent.add(ridge);
  }
  const updateLevels = (overview) => {
    for (const { type, shell, support, simplified } of levels) {
      shell.geometry = overview || simplified ? overviewShells[type] : shells[type];
      support.visible = !overview;
    }
    for (const ridge of Object.values(ridges)) ridge.visible = !overview;
  };
  const focus = (observer) => {
    for (const level of levels) {
      const { center, radius } = level.shell.boundingSphere;
      level.simplified = Math.hypot(center.x - observer.x, center.z - observer.z) - radius > 24;
    }
    updateLevels(false);
    ridges.mobile.count = ridges.fixed.count = 0;
    for (const { seat, type, color } of nearby) {
      const ridge = ridges[type];
      if (ridge.count >= 48 || Math.abs(seat.y - observer.y) > 1.1 || Math.hypot(seat.x - observer.x, seat.z - observer.z) > 2.9) continue;
      origin.set(seat.x, seat.y, seat.z);
      rotation.setFromAxisAngle(yAxis, seat.yaw);
      ridge.setMatrixAt(ridge.count, matrix.compose(origin, rotation, scale));
      ridge.setColorAt(ridge.count++, color);
    }
    for (const ridge of Object.values(ridges)) {
      ridge.instanceMatrix.needsUpdate = true;
      if (ridge.instanceColor) ridge.instanceColor.needsUpdate = true;
      if (ridge.count) ridge.computeBoundingSphere();
    }
  };
  return { focus, updateLevels };
}
