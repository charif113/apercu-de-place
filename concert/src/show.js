import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARTIST } from './venue.js';

const INK = 0x0b151f;
const BLUE = 0x769cff;
const CORAL = 0xff9277;
const AMBER = 0xffd098;
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 180;
const SCREEN_INTERVAL = 1000 / 12;

const standard = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...options });

function mesh(parent, geometry, material, x, y, z) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function box(parent, size, material, x, y, z) {
  return mesh(parent, new THREE.BoxGeometry(...size), material, x, y, z);
}

function sphere(parent, size, material, x, y, z) {
  const object = mesh(parent, new THREE.SphereGeometry(1, 14, 9), material, x, y, z);
  object.scale.set(...size);
  return object;
}

function segment(parent, start, end, radiusA, radiusB, material, sides = 8) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const geometry = new THREE.CylinderGeometry(radiusB, radiusA, a.distanceTo(b), sides);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return mesh(parent, geometry, material, ...a.lerp(b, 0.5));
}

function makeTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');
  draw(c, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function typography(c, title, x, y, size, gap, color) {
  c.font = `700 ${size}px system-ui, sans-serif`;
  c.fillStyle = color;
  for (const char of title) {
    c.fillText(char, x, y);
    x += c.measureText(char).width + gap;
  }
}

function horizon(c, w, h) {
  const y = h * 0.65;
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#070f22');
  sky.addColorStop(0.58, '#22304d');
  sky.addColorStop(0.68, '#302339');
  sky.addColorStop(1, '#080d18');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  c.save();
  c.translate(w * 0.55, y - 8);
  c.scale(1, 0.39);
  const halo = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.39);
  halo.addColorStop(0, '#ffc294');
  halo.addColorStop(0.13, '#d26c61cc');
  halo.addColorStop(0.45, '#8d4b7077');
  halo.addColorStop(1, '#20305000');
  c.fillStyle = halo;
  c.fillRect(-w / 2, -w / 2, w, w);
  c.restore();
  for (let i = 0; i < 26; i++) {
    const p = i / 26;
    const left = w * (0.49 - p * 0.8);
    const yy = y + p * p * h * 0.34;
    c.strokeStyle = `rgba(${i % 4 ? '119,143,204' : '229,149,123'},${0.38 * (1 - p) + 0.05})`;
    c.lineWidth = i % 4 ? 1 : 1.6;
    c.beginPath();
    c.moveTo(left, yy);
    c.lineTo(w - left * 0.9, yy);
    c.stroke();
  }
  c.fillStyle = '#f4ad8a';
  c.fillRect(0, y, w, 2);
}

function ledWall(c, w, h) {
  horizon(c, w, h);
  c.fillStyle = '#d7d9ec';
  c.fillRect(48, 52, 53, 2);
  typography(c, 'NOVA LIGNE', 48, 99, 37, 4, '#f7eae0');
  typography(c, 'T O U R N É E   H O R I Z O N', 50, 128, 12, 0.4, '#e5b09f');
}

function closeup(c, w, h) {
  horizon(c, w, h);
  c.save();
  c.translate(w * 0.56, h * 0.45);
  c.scale(w / 320, h / 180);
  c.fillStyle = '#0c1322';
  c.strokeStyle = '#d9917c';
  c.lineWidth = 1.1;
  c.beginPath();
  c.moveTo(-96, 112); c.bezierCurveTo(-91, 69, -39, 63, -24, 54);
  c.bezierCurveTo(-20, 47, -20, 40, -23, 32);
  c.bezierCurveTo(-37, 15, -34, -16, -17, -29);
  c.bezierCurveTo(0, -40, 26, -35, 29, -13);
  c.bezierCurveTo(30, 0, 35, 4, 42, 13);
  c.lineTo(35, 20); c.bezierCurveTo(36, 36, 28, 44, 13, 45);
  c.lineTo(16, 57); c.bezierCurveTo(31, 65, 76, 68, 95, 112);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = '#121827';
  c.fillRect(46, 29, 5, 98);
  c.beginPath();
  c.ellipse(52, 28, 13, 5, -0.3, 0, Math.PI * 2);
  c.fill();
  c.restore();
  typography(c, 'NOVA LIGNE', 17, 28, 15, 1.6, '#eadbe4');
}

function sourceHalo(c, w, h) {
  const center = w / 2;
  const falloff = c.createRadialGradient(center, center, 0, center, center, center);
  falloff.addColorStop(0, '#fff');
  falloff.addColorStop(0.15, '#fffd');
  falloff.addColorStop(0.47, '#fff4');
  falloff.addColorStop(1, '#fff0');
  c.fillStyle = falloff;
  c.fillRect(0, 0, w, h);
}

function ringSurface(sides, levels, point) {
  const vertices = [], faces = [];
  for (let ring = 0; ring < levels; ring++) {
    for (let side = 0; side < sides; side++) {
      vertices.push(...point(side * Math.PI * 2 / sides, ring / (levels - 1)));
      if (!ring) continue;
      const a = (ring - 1) * sides + side;
      const b = (ring - 1) * sides + (side + 1) % sides;
      faces.push(a, b, b + sides, a, b + sides, a + sides);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return geometry;
}

function bodyProfile(rings, y) {
  const upper = rings.findIndex(([height]) => height >= y);
  if (upper === -1) return rings.at(-1).slice(1);
  if (upper === 0) return rings[0].slice(1);
  const [lo, ...a] = rings[upper - 1], [hi, ...b] = rings[upper];
  return a.map((v, i) => THREE.MathUtils.lerp(v, b[i], (y - lo) / (hi - lo)));
}

function singerHead(body, skin) {
  const head = new THREE.Group();
  head.position.set(0.009, 0.78, 0.015);
  body.add(head);
  const skull = [
    [-0.125, 0.042, 0.044, -0.021], [-0.099, 0.046, 0.052, -0.018],
    [-0.088, 0.048, 0.07, -0.006], [-0.065, 0.064, 0.074, -0.004],
    [-0.032, 0.071, 0.079, -0.003], [0.002, 0.077, 0.079, -0.006],
    [0.042, 0.076, 0.079, -0.01], [0.072, 0.069, 0.075, -0.012],
    [0.093, 0.049, 0.056, -0.015], [0.104, 0.001, 0.002, -0.016],
  ];
  const ovalAt = (theta, y, thickness = 0) => {
    const [w, d, z] = bodyProfile(skull, y);
    const side = Math.sin(theta), front = Math.cos(theta);
    return [(w + thickness) * side, y, z + (d + thickness) * front];
  };
  const face = (theta, y) => {
    const p = ovalAt(theta, y);
    if (Math.cos(theta) <= 0) return p;
    const x = p[0];
    const volume = (cx, cy, w, h) => Math.exp(-(((x - cx) / w) ** 2 + ((y - cy) / h) ** 2));
    // Les pommettes, le nez et les orbites appartiennent au même volume.
    p[2] += 0.025 * volume(0, -0.021, 0.016, 0.025)
      + 0.013 * volume(0, 0.008, 0.011, 0.029)
      - 0.008 * volume(Math.sign(x) * 0.033, 0.019, 0.025, 0.017)
      + 0.005 * volume(Math.sign(x) * 0.05, -0.016, 0.023, 0.021)
      + 0.005 * volume(0, -0.054, 0.027, 0.01);
    return p;
  };
  mesh(head, ringSurface(48, 29, (theta, k) => face(theta, -0.125 + 0.229 * k)), skin, 0, 0, 0);
  const hair = standard(0x28201e, { roughness: 0.94 });
  mesh(head, ringSurface(40, 13, (theta, k) => {
    const front = Math.cos(theta);
    const line = front > 0 ? -0.015 + 0.069 * Math.sqrt(front) + 0.006 * Math.sin(theta * 2) : -0.014 + 0.026 * front;
    const y = THREE.MathUtils.lerp(line, 0.104, k);
    const wave = Math.sin(9 * theta + 4.2 * k);
    const thickness = 0.001 + Math.sin(Math.PI * k) * (0.008 + 0.003 * wave);
    const point = ovalAt(theta, y, thickness);
    point[1] += k * (0.008 + 0.004 * Math.sin(Math.PI * k));
    point[0] -= 0.007 * k;
    return point;
  }), hair, 0, 0, 0);

  const onFace = (x, y) => face(Math.asin(x / bodyProfile(skull, y)[0]), y)[2];
  const eyeWhite = standard(0xa69788, { roughness: 0.75 });
  const iris = standard(0x332921);
  const lips = standard(0x4c2728);
  const ear = standard(0x975c49);
  for (const side of [-1, 1]) {
    const x = side * 0.033;
    const z = onFace(x, 0.018);
    sphere(head, [0.013, 0.0047, 0.006], eyeWhite, x, 0.018, z + 0.002);
    sphere(head, [0.0043, 0.0044, 0.0028], iris, x + 0.001, 0.0176, z + 0.0074);
    const brow = sphere(head, [0.014, 0.0034, 0.004], hair, x, 0.033, onFace(x, 0.033) + 0.002);
    brow.rotation.z = side * -0.15;
    const outerEar = sphere(head, [0.011, 0.026, 0.018], skin, side * 0.073, -0.005, -0.017);
    outerEar.rotation.z = -side * 0.17;
    sphere(head, [0.005, 0.014, 0.009], ear, side * 0.079, -0.006, -0.005);
  }
  sphere(head, [0.006, 0.008, 0.005], standard(0xdb8a72), 0.081, -0.01, -0.001);
  const mouth = sphere(head, [0.015, 0.0048, 0.004], lips, 0, -0.055, onFace(0, -0.055) + 0.001);
  return { head, mouth };
}

function singerGuitar(body) {
  const guitar = new THREE.Group();
  guitar.position.set(0.073, 0.124, 0.157);
  guitar.rotation.z = -0.24;
  body.add(guitar);
  const lacquer = standard(0x853f34, { roughness: 0.44 });
  const bone = standard(0xd4b79d, { roughness: 0.61 });
  const neck = standard(0x47332b, { roughness: 0.66 });
  const metal = standard(0x9a9ba6, { roughness: 0.44, metalness: 0.58 });
  const outline = new THREE.Shape();
  outline.moveTo(-0.16, 0.113);
  outline.bezierCurveTo(-0.14, 0.143, -0.071, 0.084, -0.029, 0.099);
  outline.bezierCurveTo(0.065, 0.141, 0.174, 0.132, 0.206, 0.046);
  outline.bezierCurveTo(0.25, -0.067, 0.131, -0.15, 0.025, -0.116);
  outline.bezierCurveTo(-0.032, -0.088, -0.087, -0.079, -0.15, -0.098);
  outline.bezierCurveTo(-0.203, -0.109, -0.183, -0.057, -0.151, -0.041);
  outline.lineTo(-0.12, -0.008);
  outline.bezierCurveTo(-0.09, 0.042, -0.18, 0.072, -0.16, 0.113);
  const shell = new THREE.ExtrudeGeometry(outline, {
    depth: 0.039, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.009, bevelSegments: 2, curveSegments: 5,
  });
  mesh(guitar, shell, lacquer, 0, 0, -0.025);
  box(guitar, [0.488, 0.052, 0.027], neck, -0.345, 0.023, 0.003);
  box(guitar, [0.105, 0.079, 0.026], neck, -0.624, 0.03, -0.001);
  for (const x of [-0.043, 0.018, 0.091]) box(guitar, [0.024, 0.077, 0.012], metal, x, 0.022, 0.022);
  box(guitar, [0.052, 0.043, 0.007], bone, 0.113, -0.057, 0.025);
  for (const y of [0.006, 0.017, 0.028, 0.039]) box(guitar, [0.692, 0.0016, 0.0016], metal, -0.255, y, 0.031);
  return guitar;
}

function leadSinger(parent, x, y, z, turn) {
  const rig = new THREE.Group();
  rig.position.set(x, y, z);
  rig.rotation.y = turn;
  parent.add(rig);
  const body = new THREE.Group();
  body.position.y = 0.87;
  rig.add(body);
  const jacket = standard(0x263c58, { roughness: 0.83 });
  const collar = standard(0x172331, { roughness: 0.95 });
  const seam = standard(0xc08569);
  const skin = standard(0xb8795d, { roughness: 0.9 });
  const pants = standard(0x202633);
  const metal = standard(0x333841, { roughness: 0.48, metalness: 0.48 });
  for (const side of [-1, 1]) {
    const hip = [side * 0.093, 0.9, 0.005];
    const knee = [side * 0.116, 0.47, side * -0.06];
    const ankle = [side * 0.137, 0.083, side * -0.09];
    segment(rig, hip, knee, 0.084, 0.066, pants, 12);
    sphere(rig, [0.067, 0.077, 0.067], pants, ...knee);
    segment(rig, knee, ankle, 0.067, 0.047, pants, 12);
    sphere(rig, [0.065, 0.048, 0.125], collar, ankle[0], 0.048, ankle[2] + 0.05);
  }
  const torso = [
    [-0.028, 0.12, 0.092, 0.002], [0.075, 0.137, 0.105, -0.005],
    [0.224, 0.145, 0.104, -0.01], [0.385, 0.174, 0.118, -0.013],
    [0.487, 0.191, 0.094, -0.007], [0.553, 0.121, 0.07, -0.001],
    [0.581, 0.063, 0.052, 0.005],
  ];
  mesh(body, ringSurface(24, 19, (theta, k) => {
    const y = -0.028 + 0.609 * k;
    const [w, depth, z] = bodyProfile(torso, y);
    return [w * Math.sin(theta), y, z + depth * Math.cos(theta)];
  }), jacket, 0, 0, 0);
  segment(body, [0.009, 0.567, 0.01], [0.009, 0.675, -0.002], 0.057, 0.043, skin, 16);
  segment(body, [0.006, 0.561, 0.006], [0.007, 0.605, 0.003], 0.071, 0.051, collar, 16);
  const { head, mouth } = singerHead(body, skin);
  segment(body, [0.017, 0.089, 0.101], [0.017, 0.418, 0.106], 0.003, 0.003, collar, 6);
  segment(body, [0.017, 0.415, 0.109], [0.037, 0.54, 0.062], 0.003, 0.003, seam, 6);
  segment(body, [0.116, 0.448, 0.07], [0.182, 0.462, 0.04], 0.005, 0.005, seam, 6);
  const guitar = singerGuitar(body);
  const strap = new THREE.Group();
  body.add(strap);
  segment(strap, [-0.13, 0.495, 0.036], [-0.033, 0.342, 0.112], 0.017, 0.017, collar, 6);
  segment(strap, [-0.033, 0.342, 0.112], [0.192, 0.117, 0.166], 0.017, 0.017, collar, 6);

  const leftElbow = [-0.239, 0.278, 0.05], leftWrist = [-0.321, 0.24, 0.184];
  segment(body, [-0.158, 0.465, 0.002], leftElbow, 0.066, 0.047, jacket, 12);
  sphere(body, [0.048, 0.048, 0.047], jacket, ...leftElbow);
  segment(body, leftElbow, leftWrist, 0.046, 0.032, jacket, 12);
  sphere(body, [0.031, 0.032, 0.025], skin, ...leftWrist);
  const rightElbow = [0.229, 0.255, 0.084];
  segment(body, [0.159, 0.464, -0.002], rightElbow, 0.065, 0.047, jacket, 12);
  sphere(body, [0.047, 0.049, 0.046], jacket, ...rightElbow);
  const forearm = new THREE.Group();
  forearm.position.set(...rightElbow);
  body.add(forearm);
  segment(forearm, [0, 0, 0], [-0.143, -0.109, 0.102], 0.046, 0.029, jacket, 12);
  sphere(forearm, [0.029, 0.035, 0.022], skin, -0.158, -0.117, 0.111);

  const microphone = new THREE.Group();
  rig.add(microphone);
  segment(microphone, [0.021, 0.028, 0.38], [0.021, 1.47, 0.38], 0.01, 0.009, metal);
  segment(microphone, [0.021, 1.47, 0.38], [0.016, 1.568, 0.189], 0.01, 0.01, metal);
  segment(microphone, [0.016, 1.568, 0.214], [0.016, 1.591, 0.142], 0.012, 0.012, collar, 12);
  sphere(microphone, [0.015, 0.014, 0.018], standard(0x66646a, { metalness: 0.45 }), 0.016, 1.593, 0.136);
  mesh(microphone, new THREE.CylinderGeometry(0.135, 0.146, 0.023, 14), metal, 0.021, 0.013, 0.38);
  return { rig, body, forearm, turn, gear: [guitar, strap, microphone], head, mouth };
}

function player(parent, x, y, z, turn, lead = false) {
  if (lead) return leadSinger(parent, x, y, z, turn);
  const rig = new THREE.Group();
  rig.position.set(x, y, z);
  rig.rotation.y = turn;
  parent.add(rig);
  const body = new THREE.Group();
  body.position.y = 0.87;
  rig.add(body);
  const jacket = standard(0x252436, { roughness: 0.67 });
  const shirt = standard(0x11131b);
  const skin = standard(0x906451);
  const hair = standard(0x1e1a20);
  const steel = standard(0x21242d, { roughness: 0.4, metalness: 0.5 });
  const guitar = standard(0x332b42, { roughness: 0.43 });
  const neck = standard(0x4b382b, { roughness: 0.65 });
  for (const side of [-1, 1]) {
    const hip = [side * 0.097, 0.91, -0.014];
    const knee = [side * 0.117, 0.47, side > 0 ? -0.041 : 0.046];
    const ankle = [side * 0.139, 0.089, side > 0 ? -0.1 : 0.106];
    segment(rig, hip, knee, 0.085, 0.066, shirt, 10);
    segment(rig, knee, ankle, 0.066, 0.041, shirt, 10);
    sphere(rig, [0.064, 0.041, 0.124], steel, ankle[0], 0.044, ankle[2] + 0.051);
  }
  sphere(body, [0.174, 0.23, 0.108], jacket, 0, 0.27, -0.008);
  sphere(body, [0.188, 0.117, 0.105], jacket, 0, 0.46, -0.011);
  sphere(body, [0.111, 0.129, 0.088], shirt, 0, 0.49, 0.041);
  segment(body, [0.01, 0.484, 0.011], [0.014, 0.724, 0.02], 0.056, 0.044, skin, 10);
  sphere(body, [0.079, 0.112, 0.089], skin, 0.015, 0.784, 0.018);
  sphere(body, [0.081, 0.081, 0.082], hair, 0.008, 0.825, -0.004);
  sphere(body, [0.018, 0.021, 0.019], skin, 0.017, 0.773, 0.106);
  segment(body, [-0.148, 0.46, -0.008], [-0.23, 0.239, 0.063], 0.064, 0.045, jacket);
  segment(body, [-0.23, 0.239, 0.063], [-0.34, 0.301, 0.19], 0.046, 0.029, jacket);
  sphere(body, [0.037, 0.034, 0.028], skin, -0.344, 0.3, 0.195);
  segment(body, [0.146, 0.46, -0.005], [0.228, 0.267, 0.102], 0.063, 0.044, jacket);
  const forearm = new THREE.Group();
  forearm.position.set(0.228, 0.267, 0.102);
  body.add(forearm);
  segment(forearm, [0, 0, 0], [-0.166, -0.093, 0.137], 0.043, 0.024, jacket);
  sphere(forearm, [0.027, 0.044, 0.026], skin, -0.176, -0.094, 0.143);
  const axe = new THREE.Group();
  axe.position.set(0.087, 0.12, 0.177);
  axe.rotation.z = -0.34;
  body.add(axe);
  sphere(axe, [0.183, 0.119, 0.047], guitar, 0.03, -0.013, 0);
  sphere(axe, [0.124, 0.103, 0.043], guitar, -0.096, 0.025, 0);
  box(axe, [0.462, 0.055, 0.029], neck, -0.327, 0.037, 0.021);
  box(axe, [0.115, 0.073, 0.035], neck, -0.586, 0.043, 0.021);
  box(axe, [0.086, 0.021, 0.015], steel, 0.03, 0.036, 0.048);
  return { rig, body, forearm, turn, gear: [axe] };
}

function truss(parent, width, x, y, z, material) {
  const geos = [];
  const make = (a, b, radius) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const geometry = new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 4);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    geometry.translate(...from.lerp(to, 0.5));
    geos.push(geometry);
  };
  const chord = 0.19;
  for (const d of [-chord, chord]) {
    for (const v of [-chord, chord]) make([-width / 2, v, d], [width / 2, v, d], 0.044);
    for (let i = -width / 2; i + 0.9 <= width / 2; i += 0.9) {
      make([i, -chord, d], [i + 0.45, chord, d], 0.024);
      make([i + 0.45, chord, d], [i + 0.9, -chord, d], 0.024);
    }
  }
  const object = mesh(parent, mergeGeometries(geos), material, x, y, z);
  geos.forEach((geometry) => geometry.dispose());
  return object;
}

function lightBeam(color, geometry) {
  const material = new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, strength: { value: 0.115 } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vPath;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-p.xyz);
        vPath = 1.0 - uv.y;
        gl_Position = projectionMatrix * p;
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float strength;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vPath;
      void main() {
        float profile = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.35);
        float falloff = smoothstep(0.0, 0.05, vPath) * (1.0 - smoothstep(0.45, 1.0, vPath));
        gl_FragColor = vec4(tint, strength * profile * falloff);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
}

export class ConcertShow {
  constructor(venue, scene, tour) {
    this.venue = venue;
    this.scene = scene;
    this.tour = tour;
    this.workLights = false;
    this.enabled = true;
    this.buildStage();
    this.buildLights();
    this.update(2);
  }

  buildStage() {
    const Y = this.venue.stage.height;
    const cabinet = standard(0x151a21, { roughness: 0.69 });
    const dark = standard(0x151921);
    const frame = standard(0x353d4d, { metalness: 0.58, roughness: 0.49 });
    const led = new THREE.MeshBasicMaterial({ map: makeTexture(768, 336, ledWall), toneMapped: false });
    this.screenArtwork = makeTexture(384, 216, closeup);
    this.sideScreenMaterial = new THREE.MeshBasicMaterial({ map: this.screenArtwork, toneMapped: false });
    box(this.tour, [17.2, 7.68, 0.23], cabinet, 0, Y + 4.93, -11.67);
    mesh(this.tour, new THREE.PlaneGeometry(16.9, 7.4), led, 0, Y + 4.93, -11.54);
    for (const sx of [-1, 1]) {
      const display = new THREE.Group();
      display.position.set(sx * 17.2, 8.6, -1.2);
      display.rotation.y = -sx * 0.32;
      box(display, [6.63, 3.83, 0.18], cabinet, 0, 0, -0.09);
      mesh(display, new THREE.PlaneGeometry(6.4, 3.6), this.sideScreenMaterial, 0, 0, 0.01);
      this.tour.add(display);
      const array = new THREE.Group();
      const body = new THREE.BoxGeometry(1.2, 0.32, 0.58);
      const bodies = new THREE.InstancedMesh(body, cabinet, 12);
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
      for (let i = 0; i < bodies.count; i++) {
        position.set(0, -i * 0.34, -i * i * 0.004);
        rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.02 + i * 0.022);
        bodies.setMatrixAt(i, matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1)));
      }
      array.add(bodies);
      array.position.set(sx * 13.6, 13.2, 0.2);
      array.rotation.y = -sx * 0.18;
      this.tour.add(array);
      box(this.tour, [2.6, 1.08, 0.9], cabinet, sx * 9, 0.54, 0.65);
      box(this.tour, [0.8, 0.3, 0.42], dark, sx * 1.9, Y + 0.15, -0.65).rotation.x = -0.2;
    }
    truss(this.tour, 22, 0, 12.35, -2.0, frame);
    truss(this.tour, 22, 0, 12.75, -6.7, frame);
    truss(this.tour, 21, 0, 13.0, -10.6, frame);
    box(this.tour, [4.2, 0.46, 2.8], cabinet, 0, Y + 0.23, -8.0);
    const drum = mesh(this.tour, new THREE.CylinderGeometry(0.42, 0.42, 0.36, 18), cabinet, 0, Y + 0.9, -7.72);
    drum.rotation.x = Math.PI / 2;
    const brass = standard(0x8c654e, { metalness: 0.58, roughness: 0.39 });
    for (const x of [-0.8, 0.8]) {
      segment(this.tour, [x, Y + 0.47, -8.2], [x, Y + 1.55, -8.2], 0.012, 0.009, frame, 5);
      mesh(this.tour, new THREE.CylinderGeometry(0.3, 0.34, 0.025, 16), brass, x, Y + 1.55, -8.2);
    }
    // Le musicien central sert toujours de repère d’échelle (1,77 m).
    const lead = player(this.scene, ARTIST.x, Y, ARTIST.z, -0.1, true);
    this.players = [lead, player(this.tour, -5.9, Y, -5.2, 0.26), player(this.tour, 6.1, Y, -5.9, -0.36)];
  }

  buildScreenFeed() {
    const source = this.players[0].rig;
    const performer = source.clone(true);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101623);
    scene.add(performer);
    // Partage des géométries et des matériaux avec le musicien sur scène.
    // Seules les transformations locales sont recopiées dans la scène vidéo.
    const originals = [], copies = [];
    source.traverse((part) => originals.push(part));
    performer.traverse((part) => copies.push(part));

    const backdrop = makeTexture(384, 216, horizon);
    const Y = this.venue.stage.height;
    const backdropMesh = mesh(scene, new THREE.PlaneGeometry(6.4, 3.6),
      new THREE.MeshBasicMaterial({ map: backdrop, toneMapped: false }), ARTIST.x - 0.65, Y + 1.57, ARTIST.z - 1.35);
    const fill = new THREE.HemisphereLight(0xb3c7ef, 0x5a3c36, 1.15);
    const key = new THREE.DirectionalLight(0xffd1bb, 1.65);
    key.position.set(-2.2, 3.5, 4.2);
    const rim = new THREE.DirectionalLight(0x91aaff, 1.05);
    rim.position.set(2.5, 2.7, -2);
    scene.add(fill, key, rim);

    const camera = new THREE.PerspectiveCamera(25, SCREEN_WIDTH / SCREEN_HEIGHT, 0.1, 20);
    camera.position.set(ARTIST.x + 1.02, Y + 1.48, ARTIST.z + 2.65);
    camera.lookAt(ARTIST.x - 0.10, Y + 1.30, ARTIST.z + 0.04);
    const target = new THREE.WebGLRenderTarget(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.screenFeed = { scene, camera, target, originals, copies, backdropMesh, lastFrame: -Infinity };
  }

  renderScreens(renderer, now, animated) {
    if (!this.enabled || this.workLights || this.screenFeedFailed) return;
    const current = this.screenFeed;
    if (current && this.sideScreenMaterial.map === current.target.texture &&
        (animated ? now - current.lastFrame < SCREEN_INTERVAL : current.still)) return;
    const previousTarget = renderer.getRenderTarget();
    try {
      if (!this.screenFeed) this.buildScreenFeed();
      const feed = this.screenFeed;
      feed.originals.forEach((part, i) => {
        const copy = feed.copies[i];
        copy.position.copy(part.position);
        copy.quaternion.copy(part.quaternion);
        copy.scale.copy(part.scale);
        copy.visible = part.visible;
      });
      renderer.setRenderTarget(feed.target);
      renderer.render(feed.scene, feed.camera);
      this.sideScreenMaterial.map = feed.target.texture;
      feed.lastFrame = now;
      feed.still = !animated;
    } catch (error) {
      console.warn('[apercu] gros plan indisponible :', error.message);
      this.sideScreenMaterial.map = this.screenArtwork;
      this.screenFeedFailed = true;
    } finally {
      if (renderer.getRenderTarget() !== previousTarget) renderer.setRenderTarget(previousTarget);
      if (this.screenFeedFailed) this.disposeScreenFeed();
    }
  }

  disposeScreenFeed() {
    const feed = this.screenFeed;
    if (!feed) return;
    feed.target.dispose();
    feed.backdropMesh.geometry.dispose();
    feed.backdropMesh.material.map.dispose();
    feed.backdropMesh.material.dispose();
    this.screenFeed = null;
  }

  buildLights() {
    const Y = this.venue.stage.height;
    this.room = new THREE.HemisphereLight(0x9cabcf, 0x57505b, 1.5);
    this.house = new THREE.AmbientLight(0xbbbed8, 0.69);
    this.scene.add(this.room, this.house);
    const lightRig = new THREE.Group();
    lightRig.name = 'eclairage-tournee';
    this.tour.add(lightRig);
    this.lightRig = lightRig;
    const halo = makeTexture(64, 64, sourceHalo);
    const cone = new THREE.CylinderGeometry(0.075, 1.95, 1, 20, 1, true);
    cone.translate(0, -0.5, 0);
    const caseMat = standard(0x161b25, { roughness: 0.53, metalness: 0.35 });
    const emitter = new THREE.SphereGeometry(0.13, 10, 6);
    const fixtures = [
      [-9, 12.14, -2.0, 8.5, 2.2, 12, BLUE], [-5.8, 12.11, -2.0, -9, 1.0, 16, CORAL],
      [5.8, 12.11, -2.0, 9, 1.0, 16, CORAL], [9, 12.14, -2.0, -8.5, 2.2, 12, BLUE],
      [-8.3, 12.45, -6.7, -5, Y, -3, BLUE], [-3.2, 12.7, -10.6, -1.9, Y + 1, -1, AMBER],
      [3.2, 12.7, -10.6, 1.9, Y + 1, -1, AMBER], [8.3, 12.45, -6.7, 5, Y, -3, BLUE],
      [-7.0, Y + 0.34, -10.3, -1.4, Y + 6.0, -3.6, BLUE], [7.0, Y + 0.34, -10.3, 1.4, Y + 6.0, -3.6, CORAL],
    ];
    this.beams = fixtures.map(([x, y, z, tx, ty, tz, color], i) => {
      const beam = lightBeam(color, cone);
      beam.position.set(x, y - 0.24, z);
      lightRig.add(beam);
      box(lightRig, [0.39, 0.38, 0.35], caseMat, x, y, z);
      const source = mesh(lightRig, emitter, new THREE.MeshBasicMaterial({ color, toneMapped: false }), x, y - 0.21, z);
      source.scale.set(1, 0.63, 1);
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({
        map: halo, color, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.69, toneMapped: false,
      }));
      flare.position.copy(source.position);
      flare.scale.setScalar(0.96);
      lightRig.add(flare);
      return { beam, flare, target: new THREE.Vector3(tx, ty, tz), phase: i * 0.79 };
    });

    const spots = [
      [-7, 11.9, -6.8, -4, Y, -1.0, BLUE, 960, 0.57],
      [7, 11.9, -6.8, 4, Y, -1.0, CORAL, 880, 0.61],
      [0, 8.7, -8.1, 0, Y + 0.8, ARTIST.z, AMBER, 940, 0.43],
    ];
    this.spots = spots.map(([x, y, z, tx, ty, tz, color, intensity, angle]) => {
      const lamp = new THREE.SpotLight(color, intensity, 38, angle, 0.72, 1.7);
      lamp.position.set(x, y, z);
      lamp.target.position.set(tx, ty, tz);
      lightRig.add(lamp, lamp.target);
      return { lamp, intensity };
    });
    // Deux débords diffus vers les premiers rangs donnent un liseré sur les
    // coques et le public. Le reste de la salle reste lisible en demi-teinte.
    for (const [x, z, color] of [[-8.7, 0.6, BLUE], [9.2, -0.5, CORAL]]) {
      const spill = new THREE.PointLight(color, 78, 39, 1.5);
      spill.position.set(x, 5.1, z);
      lightRig.add(spill);
      const pool = mesh(lightRig, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: halo, color, transparent: true, depthWrite: false, opacity: 0.18, blending: THREE.AdditiveBlending,
      }), x * 0.54, Y + 0.012, -4.1);
      pool.rotation.x = -Math.PI / 2;
      pool.scale.set(12, 10, 1);
    }
  }

  setTourGear(on) {
    this.enabled = on;
    for (const gear of this.players[0].gear) gear.visible = on;
    if (!on) this.update(2);
    this.setLightLevel();
  }

  setWorkLights(on) {
    this.workLights = on;
    this.setLightLevel();
  }

  setLightLevel() {
    const work = this.workLights;
    const concert = this.enabled && !work;
    this.lightRig.visible = concert;
    this.house.color.set(work ? 0xfff4e5 : 0xbbbed8);
    this.house.intensity = work ? 2.45 : concert ? 0.69 : 1.04;
    this.room.intensity = work ? 1.8 : concert ? 1.5 : 1.7;
    this.scene.fog.color.set(INK);
    this.scene.fog.density = work ? 0.002 : concert ? 0.0062 : 0.0044;
    if (!concert) this.sideScreenMaterial.map = this.screenArtwork;
  }

  update(t, reveal = 1) {
    const entrance = 0.54 + 0.46 * reveal;
    const down = new THREE.Vector3(0, -1, 0), ray = new THREE.Vector3();
    for (const { beam, flare, target, phase } of this.beams) {
      ray.copy(target).sub(beam.position);
      ray.x += 1.24 * Math.sin(t * 0.53 + phase);
      ray.z += 0.87 * Math.cos(t * 0.45 + phase);
      beam.scale.y = ray.length();
      beam.quaternion.setFromUnitVectors(down, ray.normalize());
      const cue = 0.5 + 0.5 * Math.sin(t * 0.79 + phase);
      beam.material.uniforms.strength.value = (0.094 + 0.056 * cue) * entrance;
      flare.material.opacity = (0.52 + 0.24 * cue) * entrance;
    }
    this.spots.forEach(({ lamp, intensity }, i) => {
      lamp.intensity = intensity * (0.9 + 0.16 * Math.sin(t * 0.84 + 1.7 * i)) * entrance;
    });
    this.players.forEach(({ rig, body, forearm, turn, head, mouth }, i) => {
      rig.rotation.y = turn + Math.sin(t * 0.82 + i * 2.1) * (head ? 0.095 : 0.17);
      body.rotation.z = Math.sin(t * 1.22 + i * 1.53) * (head ? 0.026 : 0.047);
      forearm.rotation.y = Math.sin(t * 4.8 + i * 2.4) * (head ? 0.075 : 0.22);
      if (head) {
        forearm.rotation.z = Math.sin(t * 6.8) * 0.15;
        head.rotation.y = 0.027 + Math.sin(t * 0.74) * 0.045;
        head.rotation.x = Math.sin(t * 1.17) * 0.025;
        mouth.scale.y = 0.0048 * (0.54 + 0.62 * Math.abs(Math.sin(t * 3.15)));
      }
    });
  }
}
