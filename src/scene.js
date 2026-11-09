// Moteur 3D : construit n'importe quelle salle à partir de son layout (layout.js)
// et gère les transitions de caméra plan → place, place → place, place → plan.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { eyeOf, screenCenter, wallXAt } from './layout.js';
import { DemoFilm, projectionUv } from './film.js';

const SEAT_CHARCOAL = new THREE.Color(0x414145);
const SEL = new THREE.Color(0x2fd27a);
const CMP = new THREE.Color(0xffb02e);

const HALL_LIGHTS = {
  imax: { stair: 0x4278f1, fill: 0x9fbafa, power: 1.2, sconces: 0x8d9fb9 },
  screenx: { stair: 0xae453e, fill: 0xaaa4c0, power: 0.68 },
  aurore: { stair: 0xc9894a, fill: 0xaebce0, power: 0.95, sconces: 0xd7c9ad },
  lodge: { stair: 0x996544, fill: 0xe5b2a0, power: 0.9, sconces: 0xc69674 },
  classic: { stair: 0xa19aaf, fill: 0xa6a7dc, power: 0.85, sconces: 0xb3adbd },
  prestige: { stair: 0xb1a192, fill: 0xe3bb9e, power: 0.85, sconces: 0xb69d88 },
  standard: { stair: 0x887e8d, fill: 0xb9afc8, power: 0.75 },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return new THREE.Vector3()
    .addScaledVector(p0, u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
};

// ---------- textures procédurales (partagées) --------------------------------
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function upholsteryTextures(recliner) {
  // Grain satiné IMAX, trame mate plus contrastée sur les fauteuils Club.
  const draw = (g, n) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, n, n);
    const img = g.getImageData(0, 0, n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const weave = recliner ? 0 : ((x + y * 2) % 5 === 0 ? -21 : 5);
        const noise = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        const fold = recliner ? Math.max(0, Math.sin(x * 0.4 + 1.4 * Math.sin(y * 0.1))) ** 4 * Math.cos(y * 0.09) * 11 : 0;
        const v = 229 + weave + fold + noise * (recliner ? 9 : 18);
        const i = (y * n + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
    }
    g.putImageData(img, 0, 0);
  };
  const map = canvasTex(128, draw);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = canvasTex(128, draw);
  return { map, bump };
}

function carpetTexture() {
  const t = canvasTex(256, (g, n) => {
    g.fillStyle = '#28292d';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${50 + (i % 30)},${51 + (i % 20)},${55 + (i % 25)},${0.25 + (i % 5) * 0.05})`;
      g.fillRect((i * 97.13) % n, (i * 57.91) % n, 2, 2);
    }
  }, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wallTexture() {
  const t = canvasTex(256, (g, n) => {
    g.fillStyle = '#131418';
    g.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += 64) {
      const gr = g.createLinearGradient(x, 0, x + 64, 0);
      gr.addColorStop(0, '#25252a');
      gr.addColorStop(0.5, '#2d2e33');
      gr.addColorStop(1, '#212228');
      g.fillStyle = gr;
      g.fillRect(x + 2, 0, 60, n);
    }
  });
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ceilingTexture() {
  const t = canvasTex(64, (g, n) => {
    g.fillStyle = '#232429';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#393a3f';
    g.strokeRect(0, 0, n, n);
  });
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text, color = '#ffcf7a') {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#120e10';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = color;
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- géométrie de fauteuil (une seule par type, instanciée) ----------
function seatGeometry(profile) {
  const boxes = (parts) => parts.map(({ size, at, tilt, radius }) => {
    const segments = profile.finish === 'satin' && at[1] > 1 ? 2 : 1;
    return new RoundedBoxGeometry(...size, segments, radius).rotateX(tilt).translate(...at);
  });
  const rims = profile.cupholders.map(([x, y, z, r]) => {
    const section = [[r * 0.78, -0.006], [r * 0.78, 0.004], [r * 0.86, 0.007], [r, 0.004], [r, -0.006]];
    const g = new THREE.LatheGeometry(section.map(([a, b]) => new THREE.Vector2(a, b)), 12);
    return g.toNonIndexed().translate(x, y, z);
  });
  return { fabric: mergeGeometries(boxes(profile.upholstery)), frame: mergeGeometries([...boxes(profile.structure), ...rims]) };
}

function spectatorMesh(capacity) {
  // Une silhouette assise partage sa géométrie et son matériau avec toute la salle.
  const shoulders = [[0, 0], [0.12, 0], [0.17, 0.22], [0.225, 0.48], [0.195, 0.57], [0.06, 0.63], [0, 0.63]];
  const parts = [
    [new THREE.LatheGeometry(shoulders.map(([x, y]) => new THREE.Vector2(x, y)), 12).scale(1, 1, 0.60), 0x464b53],
    [new THREE.CylinderGeometry(0.039, 0.047, 0.11, 8).translate(0, 0.643, -0.025), 0x554e4c],
    [new THREE.SphereGeometry(1, 12, 8).scale(0.077, 0.102, 0.095).translate(0, 0.762, -0.036), 0x514b49],
  ];
  const geometry = mergeGeometries(parts.map(([part, tint]) => {
    const flat = part.toNonIndexed();
    part.dispose();
    const color = new THREE.Color(tint);
    const colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return flat;
  }));
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
  }), capacity);
  mesh.name = 'spectators';
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function hallSconces(layout, color) {
  const { model: m, depth, halfWidth, backFloor } = layout;
  const bars = [];
  const glowVertices = [];
  const lightY = (z) => (m.kind === 'imax' ? 4.7 : 0.43 * m.ceiling) + (m.kind === 'imax' ? 1 : 0.58) * backFloor * (z / depth);
  for (const side of [-1, 1]) {
    const x = side * (halfWidth - 0.03);
    const bar = (y0, z0, y1, z1) => {
      const a = new THREE.Vector3(x, y0, z0), b = new THREE.Vector3(x, y1, z1);
      const delta = b.clone().sub(a);
      const g = new THREE.BoxGeometry(0.028, delta.length(), 0.036);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
      bars.push(g.translate(...a.lerp(b, 0.5).toArray()));
    };
    if (m.kind === 'lodge') {
      const step = (depth - 4) / 8;
      const y = (z, i) => lightY(z) + [0, 0.70, 0.14, -0.40][i % 4];
      for (let i = 0; i < 8; i++) {
        const z = 2 + i * step;
        bar(y(z, i), z, y(z + step, i + 1), z + step);
      }
      continue;
    }
    const spacing = m.kind === 'imax' ? 6.2 : 3.7;
    for (let z = m.kind === 'imax' ? 5.5 : 2.6; z < depth - 1; z += spacing) {
      const y = lightY(z);
      if (m.kind === 'aurore') bar(y - 0.45, z - 1.05, y + 0.28, z + 1.05);
      else if (m.kind === 'prestige') {
        bar(y, z - 0.09, y, z + 0.09);
        glowVertices.push(x, y, z, x, y - 1.75, z - 0.72, x, y - 1.75, z + 0.72);
      }
      else {
        const halfLength = m.kind === 'imax' ? 1.65 : 0.72;
        bar(y - halfLength, z, y + halfLength, z);
      }
    }
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeometries(bars), new THREE.MeshBasicMaterial({ color, toneMapped: false })));
  if (glowVertices.length) {
    const colors = new Float32Array(glowVertices.length / 3 * 4);
    for (let i = 0; i < colors.length; i += 12) colors.set([1, 1, 1, 0.28, 1, 1, 1, 0, 1, 1, 1, 0], i);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(glowVertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    const glow = new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geometry, glow));
  }
  return group;
}

function prestigeCurtains(screen) {
  const width = 0.66, height = screen.height + 0.65;
  const geometry = new THREE.PlaneGeometry(width, height, 48, 1);
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) points.setZ(i, 0.028 * Math.cos(points.getX(i) / width * Math.PI * 14));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x6f181d, roughness: 0.95 });
  const curtains = new THREE.Group();
  for (const side of [-1, 1]) {
    const curtain = new THREE.Mesh(geometry, material);
    curtain.position.set(side * (screen.width / 2 + width / 2 + 0.035), screen.bottom + screen.height / 2, 0.06);
    curtains.add(curtain);
  }
  return curtains;
}

// UV d'une surface de projection calculés depuis les positions monde.
function mapUV(geo, project) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    uv.set(project(x, y, z), i * 2);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function sideGeometry(layout, side, from, to, bottom, top, inset = 0, columns = 1, rows = 1) {
  const geo = new THREE.PlaneGeometry(1, 1, columns, rows);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = lerp(from, to, 0.5 + side * p.getX(i));
    const y = lerp(bottom(z), top(z), p.getY(i) + 0.5);
    p.setXYZ(i, side * (wallXAt(layout, z) - inset), y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export class CinemaScene {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    RectAreaLightUniformsLib.init();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050406);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
    this.upholstery = { recliner: upholsteryTextures(true), club: upholsteryTextures(false) };
    this.carpet = carpetTexture();
    this.wall = wallTexture();
    this.ceiling = ceilingTexture();
    for (const t of [this.carpet, this.wall, this.ceiling, ...Object.values(this.upholstery).flatMap(Object.values)]) t.userData.shared = true;
    this.seatGeos = new Map();
    this.spectators = null;
    this.occupiedIds = new Set();
    this.look = { yaw: 0, pitch: 0 };
    this.mode = 'plan';
    this.extended = true;
    this.running = false;
    this.tween = null;
    this._clock = performance.now();
    this._bindLook();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  // ---------- construction d'une salle ----------------------------------------
  loadHall(layout) {
    if (this.layout === layout) return;
    if (this.hall) {
      this.scene.remove(this.hall);
      const geometries = new Set(), materials = new Set();
      this.hall.traverse((o) => {
        if (!o.isMesh) return;
        if (o.isInstancedMesh) o.dispose();
        if (!o.userData.sharedGeo) geometries.add(o.geometry);
        materials.add(o.material);
      });
      for (const g of geometries) g.dispose();
      for (const material of materials) {
        if (material.map && !material.map.userData.shared) material.map.dispose();
        material.dispose();
      }
      this.filmTex?.dispose();
    }
    this.layout = layout;
    this.spectators = null;
    this.occupiedIds = new Set();
    const m = layout.model;
    const imax = m.kind === 'imax';
    const lights = HALL_LIGHTS[m.kind] || HALL_LIGHTS.standard;
    const W = layout.halfWidth;
    const D = layout.depth;
    const hall = (this.hall = new THREE.Group());
    this.scene.add(hall);

    // Sol et gradins
    const carpetMat = new THREE.MeshStandardMaterial({ map: this.carpet, roughness: 0.95, color: imax ? 0xffffff : 0xccc3cc });
    const frontStart = -0.8, frontEnd = m.firstRow - m.rowPitch / 2;
    const front = new THREE.Mesh(new THREE.BoxGeometry(2 * W, 0.4, frontEnd - frontStart), carpetMat);
    front.position.set(0, -0.2, (frontStart + frontEnd) / 2);
    hall.add(front);
    const stepGeo = [], aisleTreads = [];
    for (const row of layout.rows) {
      const h = row.floor + 0.4;
      const g = new THREE.BoxGeometry(2 * W, h, m.rowPitch);
      g.translate(0, row.floor - h / 2, row.z);
      stepGeo.push(g);
      const previous = layout.rows[row.index - 1];
      if (!previous || previous.floor === row.floor) continue;
      const run = m.rowPitch * 0.31, rise = (row.floor - previous.floor) / 2;
      const z = row.z - m.rowPitch / 2 - run / 2;
      for (const x of row.aisles) {
        stepGeo.push(new THREE.BoxGeometry(m.aisle - 0.02, rise, run).translate(x, previous.floor + rise / 2, z));
        aisleTreads.push([x, previous.floor + rise, z - run / 2]);
      }
    }
    const steps = new THREE.Mesh(mergeGeometries(stepGeo), carpetMat);
    hall.add(steps);
    // Palier du fond
    const backH = layout.backFloor + 0.4;
    const landingStart = layout.rows.at(-1).z + m.rowPitch / 2;
    const landing = new THREE.Mesh(new THREE.BoxGeometry(2 * W, backH, D - landingStart), carpetMat);
    landing.position.set(0, layout.backFloor - backH / 2, (D + landingStart) / 2);
    hall.add(landing);

    // Murs, plafond
    const H = m.ceiling;
    const wallMat = new THREE.MeshStandardMaterial({ map: this.wall, roughness: 0.94, color: imax ? 0xb8c0d0 : 0x88858b });
    this.wall.repeat.set(D / 2.5, 1);
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(sideGeometry(layout, s, -1, D, () => -1, () => H, -0.015), wallMat);
      hall.add(wall);
    }
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a090b, roughness: 1 });
    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, H + 1), dark);
    frontWall.position.set(0, H / 2 - 0.5, -0.6);
    hall.add(frontWall);
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, H + 2), wallMat);
    backWall.rotation.y = Math.PI;
    backWall.position.set(0, H / 2, D + 0.05);
    hall.add(backWall);
    this.ceiling.repeat.set(2 * W / 1.2, (D + 1) / 1.2);
    const ceilingMat = new THREE.MeshStandardMaterial({ map: this.ceiling, roughness: 1 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, D + 1), ceilingMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H, D / 2 - 0.5);
    hall.add(ceil);
    // Cabine de projection (petite fenêtre lumineuse au fond)
    const booth = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshBasicMaterial({ color: 0x8fb6ff }));
    booth.rotation.y = Math.PI;
    booth.position.set(0, Math.min(H - 1, layout.backFloor + 3.2), D);
    hall.add(booth);

    // Écran(s) et extrait de démo
    this.film = new DemoFilm();
    const tex = (this.filmTex = this.film.texture);
    const sc = m.screen;
    const project = projectionUv(layout);
    let scrGeo;
    if (sc.curve) {
      const R = sc.curve, half = Math.asin(sc.width / (2 * R));
      scrGeo = new THREE.CylinderGeometry(R, R, sc.height, 48, 1, true, Math.PI - half, 2 * half);
      scrGeo.translate(0, sc.bottom + sc.height / 2, R);
    } else {
      scrGeo = new THREE.PlaneGeometry(sc.width, sc.height, m.sides ? 48 : 1, m.sides ? 12 : 1);
      scrGeo.translate(0, sc.bottom + sc.height / 2, 0);
    }
    mapUV(scrGeo, project);
    const screenMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    const screen = new THREE.Mesh(scrGeo, screenMat);
    screen.name = 'projection-front';
    hall.add(screen);
    // Cache noir autour de l'écran
    if (!m.sides) {
      const mask = new THREE.Mesh(new THREE.PlaneGeometry(sc.width + 1.4, sc.height + 1.0), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      mask.position.set(0, sc.bottom + sc.height / 2, -0.05);
      hall.add(mask);
    }
    if (m.kind === 'prestige') hall.add(prestigeCurtains(sc));

    // Lumière émise par l'écran
    this.screenLight = new THREE.RectAreaLight(0xffd2a8, 4, sc.width, sc.height);
    this.screenLight.position.set(0, sc.bottom + sc.height / 2, 0.1);
    this.screenLight.lookAt(0, sc.bottom + sc.height / 2, 10);
    hall.add(this.screenLight);
    hall.add(new THREE.HemisphereLight(imax ? 0x9aa9cd : 0xa59aaa, 0x454449, 1.85));
    // Réflexion diffuse dans le fond, perceptible sur le dos des fauteuils.
    const bounce = new THREE.DirectionalLight(lights.fill, lights.power);
    bounce.position.set(-W / 3, H - 1, D);
    hall.add(bounce);

    // Surfaces latérales ScreenX
    this.sidePanels = [];
    this.sideLights = [];
    if (m.sides) {
      const sd = m.sides;
      const top = () => sd.top;
      // Le bas de la projection remonte au fond pour rester au-dessus des gradins.
      const rise = Math.max(0, layout.backFloor + 0.75 - sd.bottom);
      const bottom = (z) => sd.bottom + rise * ((z - sd.from) / (sd.to - sd.from)) ** 2;
      const sideMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      const trim = new THREE.MeshBasicMaterial({ color: 0xbb372e, toneMapped: false });
      const glow = new THREE.MeshBasicMaterial({ color: 0xb01d17, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
      this.sideTrim = trim;
      this.sideGlow = glow;
      const midZ = (sd.from + sd.to) / 2;
      const midY = (sd.top + bottom(midZ)) / 2;
      for (const s of [-1, 1]) {
        const g = sideGeometry(layout, s, sd.from, sd.to, bottom, top, 0, 64, 12);
        const p = new THREE.Mesh(mapUV(g, project), sideMat);
        p.name = s < 0 ? 'projection-left' : 'projection-right';
        hall.add(p);
        this.sidePanels.push(p);
        const L = new THREE.RectAreaLight(0xb8c9e0, 1.4, sd.to - sd.from, sd.top - bottom(midZ));
        L.position.set(s * (wallXAt(layout, midZ) - 0.1), midY, midZ);
        L.lookAt(0, midY, midZ);
        hall.add(L);
        this.sideLights.push(L);

        const rim = sideGeometry(layout, s, sd.from, sd.to, (z) => bottom(z) - 0.07, (z) => bottom(z) - 0.045, 0.008, 32);
        hall.add(new THREE.Mesh(rim, trim));
        const halo = sideGeometry(layout, s, sd.from, sd.to, (z) => bottom(z) - 0.43, (z) => bottom(z) - 0.07, 0.007, 32, 6);
        const uv = halo.attributes.uv;
        const colors = new Float32Array(uv.count * 4);
        for (let i = 0; i < uv.count; i++) colors.set([1, 1, 1, uv.getY(i) ** 3], i * 4);
        halo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        hall.add(new THREE.Mesh(halo, glow));
      }
      this.setExtended(this.extended);
    }

    // Fauteuils : deux InstancedMesh par modèle (revêtement et structure).
    const key = `${m.seat.type}:${m.seat.width}:${!!m.seat.upholsteredArms}`;
    if (!this.seatGeos.has(key)) this.seatGeos.set(key, seatGeometry(layout.chair));
    const geo = this.seatGeos.get(key);
    const seats = layout.seats.filter((s) => !s.pmr);
    const recliner = layout.chair.finish === 'satin';
    const { map, bump } = recliner ? this.upholstery.recliner : this.upholstery.club;
    const fabMat = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: recliner ? 0.005 : 0.008, roughness: recliner ? 0.54 : 0.96 });
    const frameMat = new THREE.MeshStandardMaterial({ color: recliner ? 0x252930 : 0x272629, roughness: 0.64 });
    const fab = new THREE.InstancedMesh(geo.fabric, fabMat, seats.length);
    const frm = new THREE.InstancedMesh(geo.frame, frameMat, seats.length);
    fab.userData.sharedGeo = frm.userData.sharedGeo = true;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const base = new THREE.Color(m.seat.color || SEAT_CHARCOAL);
    this.seatIndex = new Map();
    this.seatBase = [];
    seats.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      mtx.compose(new THREE.Vector3(s.x, s.floor, s.z), q, one);
      fab.setMatrixAt(i, mtx);
      frm.setMatrixAt(i, mtx);
      const c = base.clone().offsetHSL(0, 0, ((i * 7) % 5) * 0.004 - 0.008);
      this.seatBase.push(c);
      fab.setColorAt(i, c);
      this.seatIndex.set(s.id, i);
    });
    hall.add(fab, frm);
    this.fab = fab;
    this.frm = frm;
    this.seatMatrices = new Map(seats.map((s, i) => { const m4 = new THREE.Matrix4(); fab.getMatrixAt(i, m4); return [s.id, m4]; }));
    this.hiddenSeat = null;

    // Espaces PMR (marquage au sol)
    const pmrMat = new THREE.MeshBasicMaterial({ color: 0x2a6bd6, transparent: true, opacity: 0.55 });
    for (const s of layout.seats.filter((x) => x.pmr)) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(m.seat.width * 0.9, 0.9), pmrMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(s.x, s.floor + 0.01, s.z);
      hall.add(p);
    }

    // Balisage : LED de nez de marche dans les allées + lettres de rangée
    const ledPos = aisleTreads;
    for (const row of layout.rows) {
      const xs = [...row.aisles, -(row.width / 2 + m.sideAisle / 2), row.width / 2 + m.sideAisle / 2];
      for (const x of xs) ledPos.push([x, row.floor, row.z - m.rowPitch / 2]);
    }
    const led = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.013, 0.017), new THREE.MeshBasicMaterial({ color: lights.stair, toneMapped: false }), ledPos.length);
    ledPos.forEach(([x, y, z], i) => { mtx.makeTranslation(x, y + 0.012, z + 0.012); led.setMatrixAt(i, mtx); });
    hall.add(led);
    const plaqueGeo = new THREE.PlaneGeometry(0.16, 0.16);
    for (const row of layout.rows) {
      const mat = new THREE.MeshBasicMaterial({ map: labelTexture(row.label, `#${lights.stair.toString(16).padStart(6, '0')}`), toneMapped: false });
      for (const s of [-1, 1]) {
        const end = s < 0 ? row.seats[0] : row.seats[row.seats.length - 1];
        const p = new THREE.Mesh(plaqueGeo, mat);
        p.position.set(end.x + s * (m.seat.width / 2 + 0.005), end.floor + 0.5, end.z + 0.05);
        p.rotation.y = s * Math.PI / 2;
        hall.add(p);
      }
    }
    // Panneaux SORTIE (pictogramme vert lumineux)
    const exitMat = new THREE.MeshBasicMaterial({ map: labelTexture('⇥', '#d8ffe6'), color: 0x2fd27a, toneMapped: false });
    const wallAngle = Math.atan2(wallXAt(layout, D) - wallXAt(layout, 0), D);
    const frontExitY = m.sides ? m.sides.bottom - 0.5 : 2.6;
    for (const [z, y] of [[1.0, frontExitY], [D - 0.6, layout.backFloor + 2.4]]) {
      for (const sign of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), exitMat);
        e.position.set(sign * (wallXAt(layout, z) - 0.025), y, z);
        e.rotation.y = -sign * (Math.PI / 2 - wallAngle);
        hall.add(e);
      }
    }
    if (lights.sconces) hall.add(hallSconces(layout, lights.sconces));
    this.selected = this.compare = null;
  }

  // Masque le fauteuil où l'on est assis (sinon on voit son propre dossier).
  hideSeat(id) {
    if (!this.fab || this.hiddenSeat === id) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [sid, val] of [[this.hiddenSeat, null], [id, zero]]) {
      if (!sid || !this.seatIndex.has(sid)) continue;
      const i = this.seatIndex.get(sid);
      const m4 = val || this.seatMatrices.get(sid);
      this.fab.setMatrixAt(i, m4);
      this.frm.setMatrixAt(i, m4);
    }
    this.hiddenSeat = id;
    this.fab.instanceMatrix.needsUpdate = this.frm.instanceMatrix.needsUpdate = true;
    this._updateSpectators();
  }

  setSpectators(occupiedIds, visible) {
    this.occupiedIds = occupiedIds instanceof Set ? occupiedIds : new Set(occupiedIds);
    if (!this.hall || !visible || !this.occupiedIds.size) {
      if (this.spectators) this.spectators.visible = false;
      return;
    }
    if (!this.spectators) {
      this.spectators = spectatorMesh(this.layout.seats.length);
      this.hall.add(this.spectators);
    }
    this.spectators.visible = true;
    this._updateSpectators();
  }

  _updateSpectators() {
    const mesh = this.spectators;
    if (!mesh?.visible) return;
    const { chair, byId } = this.layout;
    const cushion = chair.upholstery[0];
    const baseY = cushion.at[1] + cushion.size[1] / 2 - 0.04;
    const baseZ = chair.eye.z - 0.03;
    const axis = new THREE.Vector3(0, 1, 0);
    const position = new THREE.Vector3(), scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let count = 0;
    for (const id of this.occupiedIds) {
      const seat = byId.get(id);
      if (!seat || seat.pmr || id === this.selected || id === this.compare || id === this.hiddenSeat) continue;
      const variation = ((seat.rowIndex * 37 + seat.num * 17) % 29) / 28;
      position.set(seat.x + Math.sin(seat.yaw) * baseZ, seat.floor + baseY, seat.z + Math.cos(seat.yaw) * baseZ);
      rotation.setFromAxisAngle(axis, seat.yaw);
      scale.set(0.92 + variation * 0.12, 0.90 + variation * 0.17, 1);
      mesh.setMatrixAt(count, matrix.compose(position, rotation, scale));
      mesh.setColorAt(count, color.setScalar(0.74 + variation * 0.26));
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  setExtended(on) {
    this.extended = on;
    if (!this.sidePanels?.length) return;
    for (const p of this.sidePanels) p.visible = on;
    for (const L of this.sideLights) L.visible = on;
    this.sideTrim.color.setHex(on ? 0xbb372e : 0x56211b);
    this.sideGlow.opacity = on ? 0.55 : 0.22;
  }

  markSeats(selectedId, compareId) {
    if (!this.fab) return;
    this.selected = selectedId;
    this.compare = compareId;
    for (const [id, i] of this.seatIndex) {
      const c = id === selectedId ? SEL : id === compareId ? CMP : this.seatBase[i];
      this.fab.setColorAt(i, c);
    }
    this.fab.instanceColor.needsUpdate = true;
    this._updateSpectators();
  }

  // ---------- caméra -----------------------------------------------------------
  // Zone réellement visible (entre le bandeau du haut et la fiche du bas)
  setInsets(top, bottom) {
    this.insets = { top, bottom };
    if (this.mode === 'seat' && this.seat && !this.tween) this._applyPose(this.seatPose(this.seat));
  }

  seatFov() {
    // 66° horizontal sur toute la toile, indépendamment de la place et des fiches.
    const a = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    const hf = THREE.MathUtils.degToRad(66);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / a));
  }

  _projection(fov, k) {
    // Décalage vertical de l'axe dans la zone visible, sans changement de focale.
    const cam = this.camera;
    const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1;
    const i = this.insets || { top: 0, bottom: 0 };
    cam.fov = fov;
    cam.setViewOffset(W, H, 0, (i.bottom - i.top) * k / 2, W, H);
  }

  seatPose(seat, look = this.look) {
    const e = eyeOf(seat, this.layout);
    const eye = new THREE.Vector3(e.x, e.y, e.z);
    const c = screenCenter(this.layout);
    const yaw0 = Math.atan2(c.x - e.x, e.z - c.z);
    const pitch0 = Math.atan2(c.y - e.y, Math.hypot(e.x - c.x, e.z - c.z));
    const yaw = yaw0 + look.yaw, pitch = pitch0 + look.pitch;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    return { pos: eye, target: eye.clone().add(dir), up: new THREE.Vector3(0, 1, 0), fov: this.seatFov(), inset: 1 };
  }

  overheadPose(rect) {
    // Caméra verticale calée sur la portion du plan visible à l'écran.
    const fov = 34;
    const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
    const span = rect.z1 - rect.z0;
    const yRef = this.layout.backFloor * 0.5;
    const h = span / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2)) + yRef;
    return { pos: new THREE.Vector3(cx, h, cz), target: new THREE.Vector3(cx, yRef, cz), up: new THREE.Vector3(0, 0, -1), fov, inset: 0 };
  }

  _applyPose(p) {
    const cam = this.camera;
    cam.position.copy(p.pos);
    cam.up.copy(p.up).normalize();
    cam.lookAt(p.target);
    this._projection(p.fov, p.inset ?? 1);
  }

  _blend(a, b, t, path) {
    return {
      pos: path ? path(t) : a.pos.clone().lerp(b.pos, t),
      target: a.target.clone().lerp(b.target, t),
      up: a.up.clone().lerp(b.up, t),
      fov: lerp(a.fov, b.fov, t),
      inset: lerp(a.inset ?? 1, b.inset ?? 1, t),
    };
  }

  _run(ms, fn) {
    return new Promise((resolve) => {
      const reduce = this.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.tween = { t0: performance.now(), ms: reduce ? 1 : ms, fn, resolve };
      if (window.__demoSeek != null) { this._seek = window.__demoSeek; window.__demoSeek = null; }
    });
  }

  // Plan → place : plongée depuis la vue de dessus jusqu'à hauteur des yeux.
  async flyFromPlan(rect, seat) {
    this.look = { yaw: 0, pitch: 0 };
    this.seat = seat;
    const A = this.overheadPose(rect);
    const B = this.seatPose(seat);
    this._applyPose(A);
    const P1 = new THREE.Vector3(lerp(A.pos.x, B.pos.x, 0.5), A.pos.y * 0.55 + B.pos.y, B.pos.z + 7);
    const P2 = new THREE.Vector3(B.pos.x, B.pos.y + 1.6, B.pos.z + 2.4);
    const path = (t) => bez(A.pos, P1, P2, B.pos, t);
    this.mode = 'flying';
    await this._run(2100, (k) => {
      const t = ease(k);
      const tl = ease(Math.min(1, k * 1.25)); // le regard se relève un peu avant
      const p = this._blend(A, B, tl);
      p.pos = path(t);
      p.fov = lerp(A.fov, B.fov, t);
      p.inset = t;
      this.hideSeat(k > 0.93 ? seat.id : null);
      return p;
    });
    this.mode = 'seat';
  }

  // Place → place, même cadrage (même focale, même décalage de regard)
  async flyToSeat(seat) {
    const A = this.seatPose(this.seat);
    const B = this.seatPose(seat);
    this.seat = seat;
    const lift = 0.9 + Math.abs(A.pos.z - B.pos.z) * 0.12;
    this.mode = 'flying';
    await this._run(1100, (k) => {
      const t = ease(k);
      const p = this._blend(A, B, t);
      p.pos.y += Math.sin(Math.PI * t) * lift;
      this.hideSeat(k < 0.1 ? this.hiddenSeat : k > 0.92 ? seat.id : null);
      return p;
    });
    this.mode = 'seat';
  }

  snapToSeat(seat) {
    const tween = this.tween;
    this.tween = null;
    this._seek = null;
    tween?.resolve();
    this.look = { yaw: 0, pitch: 0 };
    this.seat = seat;
    this.mode = 'seat';
    this.hideSeat(seat.id);
    this._applyPose(this.seatPose(seat));
  }

  async flyToPlan(rect) {
    const A = this.seatPose(this.seat);
    const B = this.overheadPose(rect);
    const P1 = new THREE.Vector3(A.pos.x, A.pos.y + 1.6, A.pos.z + 2.4);
    const P2 = new THREE.Vector3(lerp(A.pos.x, B.pos.x, 0.5), B.pos.y * 0.55 + A.pos.y, A.pos.z + 7);
    this.mode = 'flying';
    await this._run(1500, (k) => {
      const t = ease(k);
      const p = this._blend(A, B, ease(Math.max(0, k * 1.25 - 0.25)));
      p.pos = bez(A.pos, P1, P2, B.pos, t);
      p.fov = lerp(A.fov, B.fov, t);
      p.inset = 1 - t;
      this.hideSeat(k < 0.07 ? this.hiddenSeat : null);
      return p;
    });
    this.mode = 'plan';
  }

  // Fige la transition en cours à la fraction k (null = reprendre)
  seek(k) {
    this._seek = k;
  }

  recenter() {
    const from = { ...this.look };
    this._run(450, (k) => {
      const t = ease(k);
      this.look = { yaw: lerp(from.yaw, 0, t), pitch: lerp(from.pitch, 0, t) };
      return this.seatPose(this.seat);
    });
  }

  _bindLook() {
    const c = this.canvas;
    let last = null;
    c.addEventListener('pointerdown', (e) => { if (this.mode === 'seat') { last = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch { /* ignoré */ } } });
    c.addEventListener('pointermove', (e) => {
      if (!last || this.mode !== 'seat' || this.tween) return;
      const k = THREE.MathUtils.degToRad(this.camera.fov) / c.clientHeight;
      this.look.yaw = THREE.MathUtils.clamp(this.look.yaw - (e.clientX - last.x) * k, -1.75, 1.75);
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + (e.clientY - last.y) * k, -0.6, 0.6);
      last = { x: e.clientX, y: e.clientY };
      this._applyPose(this.seatPose(this.seat));
      this.onLook && this.onLook(this.look);
    });
    const up = () => { last = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  // ---------- boucle ------------------------------------------------------------
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    if (this.mode === 'seat' && this.seat) this._applyPose(this.seatPose(this.seat));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  frame(now) {
    if (this.tween) {
      const tw = this.tween;
      if (this._seek != null) tw.t0 = now - this._seek * tw.ms; // gel (captures de test)
      const k = Math.min(1, (now - tw.t0) / tw.ms);
      this._applyPose(tw.fn(k));
      if (k >= 1) { this.tween = null; tw.resolve(); }
    }
    if (!this.reducedMotion) this.film?.update(now);
    this.renderer.render(this.scene, this.camera);
    this.frames = (this.frames || 0) + 1;
  }
}
