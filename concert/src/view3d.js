// Vue 3D depuis la place (chargée à la demande). Même repère que le plan :
// x latéral, z distance au nez de scène, y hauteur. Focale horizontale fixe.
//
// LIEU (fixe)          : murs (plan D6), scène standard, gradins, tribunes,
//                        fauteuils, garde-corps, emplacement de régie, charpente.
// TOURNÉE (variable)   : façades son, écrans, mur LED, ponts lumière, faisceaux,
//                        consoles de régie, musiciens. Bouton « Équipement de tournée ».

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { eyeOf, ARTIST, obstructions, ARC_CENTER } from './venue.js';
import { addVenueChairs, buildHall } from './hall-model.js';
import { AudienceModel } from './audience.js';
import { ConcertShow, stageDeckTexture, stageSkirtTexture } from './show.js';
import { aimAt, createPlunge, PLUNGE_DURATION, CUTAWAY_HEIGHT } from './camera-flight.js';

export const HFOV = 70; // degrés, identique pour toutes les places et tous les écrans


export class SeatView3D {
  constructor(canvas, venue, { taken = new Set(), audience = true, tourGear = true, mode = 'empty' } = {}) {
    this.canvas = canvas;
    this.venue = venue;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.FogExp2(0x0a0b12, 0.0085);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
    this.look = { yaw: 0, pitch: 0 };
    this.base = { yaw: 0, pitch: 0 };
    this.t0 = performance.now();
    this.still = false;
    this.fixed = new THREE.Group(); this.fixed.name = 'lieu';
    this.tour = new THREE.Group(); this.tour.name = 'tournee';
    this.scene.add(this.fixed, this.tour);
    this._buildHall();
    this._buildStage();
    this._buildSeating();
    this._buildRails();
    this._buildRegie();
    this.show = new ConcertShow(venue, this.scene, this.tour);
    this.taken = taken;
    this.audienceEnabled = audience;
    this.setPreviewMode(mode);
    this.setTourGear(tourGear);
    this._bindLook();
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.37, 0.49, 32), new THREE.MeshBasicMaterial({
      color: 0x72efdd, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
    }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 30;
    this.marker.visible = false;
    this.scene.add(this.marker);
    this._observer = new ResizeObserver(() => this._resize());
    this._loop = this._loop.bind(this);
    this.setActive(true);
  }

  // ----- matériaux ------------------------------------------------------------
  _mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts }); }

  // ----- salle ----------------------------------------------------------------
  _buildHall() {
    const { overhead, setConcertLighting } = buildHall(this.fixed, this.venue, this._mat);
    this.overhead = overhead;
    this.setRoofConcertLighting = setConcertLighting;
  }

  _buildStage() {
    const st = this.venue.stage;
    const skirt = this._mat(0xffffff, { map: stageSkirtTexture() });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(st.width, st.height, st.depth), [
      skirt, skirt, this._mat(0xffffff, { map: stageDeckTexture(), roughness: 0.68 }), this._mat(0x0d0d10), skirt, skirt,
    ]);
    deck.position.set(0, st.height / 2, -st.depth / 2);
    this.fixed.add(deck);
    // nez de scène souligné (repère de bord)
    const lip = new THREE.Mesh(new THREE.BoxGeometry(st.width, 0.04, 0.06), new THREE.MeshBasicMaterial({ color: 0x3a2e48 }));
    lip.position.set(0, st.height, 0.01);
    this.fixed.add(lip);
  }

  // Gradins : marches annulaires autour du centre des rangées, une par rang.
  _buildSeating() {
    const { venue } = this;
    const rows = new Map();
    for (const s of venue.seats) {
      if (s.zone !== 'gradin' && s.zone !== 'pmr') continue;
      const row = s.zone === 'pmr' ? s.stepRow : s.row;
      const R = Math.hypot(s.x - ARC_CENTER.x, s.z - ARC_CENTER.z);
      const a = Math.atan2(s.x - ARC_CENTER.x, s.z - ARC_CENTER.z);
      const r = rows.get(row) || { row, R: 0, n: 0, angles: [], y: s.y };
      if (s.zone === 'gradin') { r.R += R; r.n++; }
      r.angles.push(a);
      rows.set(row, r);
    }
    const list = [...rows.values()].sort((a, b) => a.row - b.row);
    list.forEach((r) => { r.R /= r.n; r.angles.sort((a, b) => a - b); });
    const pos = [], idx = [], col = [];
    const concrete = new THREE.Color(0x3b3f45), nose = new THREE.Color(0x494e57);
    const push = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
    const P = (rad, t, y) => [ARC_CENTER.x + rad * Math.sin(t), y, ARC_CENTER.z + rad * Math.cos(t)];
    list.forEach((r, i) => {
      const next = list[i + 1];
      const rin = r.R - 0.42, rout = next ? next.R - 0.42 : r.R + 0.9;
      // marches seulement sous les sièges et les escaliers (trous < 2,6 m) : pas sous la régie ni les plateformes PMR
      const runs = [];
      let start = r.angles[0], prev = start;
      for (const a of r.angles.slice(1)) {
        if ((a - prev) * r.R > 2.6) { runs.push([start, prev]); start = a; }
        prev = a;
      }
      runs.push([start, prev]);
      for (const [b0, b1] of runs) {
        const pad = 0.45 / r.R, a0 = b0 - pad, a1 = b1 + pad;
        const N = Math.max(2, Math.ceil((a1 - a0) / 0.02));
        for (let k = 0; k < N; k++) {
          const t0 = a0 + ((a1 - a0) * k) / N, t1 = a0 + ((a1 - a0) * (k + 1)) / N;
          const q = [P(rin, t0, r.y), P(rin, t1, r.y), P(rout, t1, r.y), P(rout, t0, r.y)].map((p) => push(...p, concrete));
          idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
          const f = [P(rin, t0, 0), P(rin, t1, 0), P(rin, t1, r.y), P(rin, t0, r.y)].map((p) => push(...p, nose));
          idx.push(f[0], f[1], f[2], f[0], f[2], f[3]);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.fixed.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })));

    // tribunes télescopiques : gradins droits, contremarches bois (photo officielle)
    const tr = venue.seats.filter((s) => s.zone === 'tribune');
    const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this._mat(0x2b2d33), tr.length);
    const riser = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this._mat(0x79503a, { roughness: 0.68 }), tr.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    tr.forEach((s, i) => {
      e.set(0, s.yaw, 0); q.setFromEuler(e);
      const back = 0.1;
      m.compose(new THREE.Vector3(s.x + s.fx * -back, s.y / 2, s.z + s.fz * -back), q, new THREE.Vector3(0.52, Math.max(0.02, s.y), 0.8));
      tread.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(s.x + s.fx * 0.3, s.y - 0.12, s.z + s.fz * 0.3), q, new THREE.Vector3(0.53, 0.24, 0.02));
      riser.setMatrixAt(i, m);
    });
    this.fixed.add(tread, riser);

    this.chairDetail = addVenueChairs(this.fixed, venue.seats, this._mat);
  }

  _buildRails() {
    this.railMeshes = [];
    const metal = this._mat(0x9aa0aa, { roughness: 0.4, metalness: 0.7 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.6, transparent: true, opacity: 0.85 });
    this.venue.rails.forEach((r) => {
      const geos = [], pgeos = [];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), ang = -Math.atan2(bz - az, bx - ax);
        const top = new THREE.BoxGeometry(len + 0.02, 0.05, 0.05); top.rotateY(ang); top.translate((ax + bx) / 2, r.y + r.h, (az + bz) / 2);
        const p = new THREE.BoxGeometry(len, r.h - 0.12, 0.02); p.rotateY(ang); p.translate((ax + bx) / 2, r.y + (r.h - 0.12) / 2 + 0.02, (az + bz) / 2);
        geos.push(top); pgeos.push(p);
      }
      const g = new THREE.Group();
      const mt = new THREE.Mesh(mergeGeometries(geos), metal.clone());
      const mp = new THREE.Mesh(mergeGeometries(pgeos), panel.clone());
      g.add(mt, mp);
      this.fixed.add(g);
      this.railMeshes.push({ top: mt, panel: mp });
    });
  }

  _buildRegie() {
    const { regie } = this.venue;
    for (const p of regie.parts) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0, p.y, p.z1 - p.z0), this._mat(0x202329));
      box.position.set((p.x0 + p.x1) / 2, p.y / 2, (p.z0 + p.z1) / 2);
      this.fixed.add(box);
    }
    // consoles et opérateurs : tournée
    const d = regie.desk;
    const desk = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(d.x1 - d.x0, 0.9, d.z1 - d.z0), this._mat(0x16171b));
    body.position.set(0, d.y + 0.45, (d.z0 + d.z1) / 2);
    const screens = new THREE.Mesh(new THREE.BoxGeometry(d.x1 - d.x0 - 0.4, 0.28, 0.05), new THREE.MeshBasicMaterial({ color: 0x3e7bd6 }));
    screens.position.set(0, d.y + d.h, d.z1 - 0.1);
    const drape = new THREE.Mesh(new THREE.BoxGeometry(d.x1 - d.x0 + 0.8, 1.1, 0.04), this._mat(0x0b0b0d));
    drape.position.set(0, d.y + 0.55, d.z0 - 0.45);
    desk.add(body, screens, drape);
    this.crew = new THREE.Group();
    for (const x of [-2, 0, 2]) this.crew.add(this._person(x, d.y, d.z1 + 0.55, Math.PI, 0x1b1c20, true));
    desk.add(this.crew);
    desk.name = 'regie-tournee';
    this.tour.add(desk);
  }

  _person(x, y, z, yaw, color = 0x101114, standing = false) {
    const g = new THREE.Group();
    const mat = this._mat(color, { roughness: 0.9 });
    const torsoH = standing ? 0.68 : 0.62;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, torsoH - 0.3, 4, 8), mat);
    torso.position.y = (standing ? 1.05 : 0.48) + torsoH / 2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mat);
    head.position.y = torso.position.y + torsoH / 2 + 0.17;
    g.add(torso, head);
    if (standing) {
      for (const sx of [-0.1, 0.1]) {
        const legM = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.82, 4, 6), mat);
        legM.position.set(sx, 0.5, 0); g.add(legM);
      }
    }
    g.position.set(x, y, z); g.rotation.y = yaw;
    return g;
  }

  setPreviewMode(mode) {
    this.previewMode = mode === 'concert' ? 'concert' : 'empty';
    const concert = this.previewMode === 'concert';
    this.setWorkLights(!concert);
    this.show.setPerformersVisible(concert);
    this.crew.visible = concert;
    this._syncAudience();
  }

  setAudience(taken, on = this.audienceEnabled) {
    this.taken = taken;
    this.audienceEnabled = on;
    this._syncAudience();
  }

  _syncAudience() {
    const visible = this.audienceEnabled && this.previewMode === 'concert';
    if (visible && !this.audienceModel) {
      this.audienceModel = new AudienceModel(this.venue, this.scene);
      this.audienceModel.setObserver(this.seat);
    }
    this.audienceModel?.setAudience(this.taken, visible);
    this.requestRender();
  }

  setTourGear(on) {
    this.tourOn = on;
    this.tour.visible = on;
    this.show.setTourGear(on);
    this.setRoofConcertLighting(on && !this.show.workLights);
    this._updateMasks();
    this.requestRender();
  }

  // ----- caméra -----------------------------------------------------------------
  setSeat(seat) {
    this._endFlight();
    this.seat = seat;
    const e = eyeOf(seat);
    this.audienceModel?.setObserver(seat);
    this.chairDetail.focus(seat);
    this.target = { x: ARTIST.x, y: this.venue.stage.height + 1.3, z: ARTIST.z };
    this.base = aimAt(e, this.target);
    this.look = { yaw: 0, pitch: 0 };
    this.eye = new THREE.Vector3(e.x, e.y, e.z);
    this._updateMasks();
    this._applyCamera();
    this.requestRender();
    return this.masks;
  }

  flyFromPlan(rect) {
    if (this.still || !this.eye || rect.z1 <= rect.z0) return;
    return new Promise((resolve) => {
      this.fly = { sample: createPlunge(rect, this.eye, this.target, this.camera.fov), resolve };
      this.renderer.setPixelRatio(Math.min(0.85, this.pixelRatio));
      this.marker.position.set(this.seat.x, this.eye.y + 0.12, this.seat.z);
      this._applyCamera();
      this.requestRender();
    });
  }

  _endFlight() {
    if (!this.fly) return;
    const { resolve } = this.fly;
    this.fly = null;
    if (this.overhead) this.overhead.visible = true;
    this.chairDetail.updateLevels(false);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.marker.visible = false;
    this._resize();
    resolve();
  }

  skipFlight() {
    if (!this.fly) return false;
    this._endFlight();
    this._applyCamera();
    this.requestRender();
    return true;
  }

  setCameraRaw({ x, y, z, yaw, pitch, hfov }) {
    // utilisé pour les captures de recoupement photo (tests)
    this._endFlight();
    this.eye = new THREE.Vector3(x, y, z);
    this.base = { yaw, pitch };
    this.look = { yaw: 0, pitch: 0 };
    if (hfov) this.hfov = hfov;
    this._resize();
    this.requestRender();
  }

  // Salle éclairée (lumière de service) : sert aux recoupements avec les photos de jour.
  setWorkLights(on) {
    this.show.setWorkLights(on);
    this.setRoofConcertLighting(this.tourOn && !on);
    this.requestRender();
  }

  recenter() {
    if (this.fly) return;
    this.look = { yaw: 0, pitch: 0 };
    this._applyCamera();
    this.requestRender();
  }

  _updateMasks() {
    if (!this.seat) return;
    this.masks = obstructions(this.venue, this.seat, { tourGear: this.tourOn });
    const hot = new Set(this.masks.rails);
    const near = this.masks.nearMiss?.rail;
    this.railMeshes.forEach((r, i) => {
      const on = hot.has(i), close = near === i;
      r.top.material.color.set(on ? 0xffa53a : close ? 0xffd27a : 0x9aa0aa);
      r.top.material.emissive.set(on ? 0x8a4a00 : close ? 0x5a4200 : 0x000000);
      r.panel.material.color.set(on ? 0x5a3510 : 0x1c1f26);
    });
  }

  _applyCamera(now) {
    if (this.fly) {
      const k = now == null || this.fly.t0 == null ? 0 : THREE.MathUtils.clamp((now - this.fly.t0) / PLUNGE_DURATION, 0, 1);
      if (k < 1) {
        const p = this.fly.sample(k);
        this.camera.position.set(p.x, p.y, p.z);
        this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
        this.camera.fov = p.fov;
        this.camera.updateProjectionMatrix();
        const overview = p.y >= CUTAWAY_HEIGHT;
        if (this.overhead) this.overhead.visible = !overview;
        if (this.fly.overview !== overview) {
          this.fly.overview = overview;
          this.chairDetail.updateLevels(overview);
        }
        this.marker.visible = k < 0.72;
        this.marker.material.opacity = Math.min(1, (0.72 - k) * 6);
        const span = 2 * Math.max(0, p.y - this.marker.position.y) * Math.tan(THREE.MathUtils.degToRad(p.fov) / 2);
        this.marker.scale.setScalar(Math.max(0.9, (span / Math.max(this.canvas.clientHeight, 1)) * 32));
        return;
      }
      this._endFlight();
    }
    const yaw = this.base.yaw + this.look.yaw, pitch = this.base.pitch + this.look.pitch;
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  _resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const hf = THREE.MathUtils.degToRad(this.hfov || HFOV);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / aspect));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  _bindLook() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button !== 0 || this.skipFlight()) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, look: { ...this.look } };
      try { c.setPointerCapture(e.pointerId); } catch { /* */ }
    });
    c.addEventListener('pointermove', (e) => {
      if (drag?.id !== e.pointerId) return;
      const k = THREE.MathUtils.degToRad(HFOV) / c.clientWidth;
      this.look.yaw = THREE.MathUtils.clamp(drag.look.yaw + (e.clientX - drag.x) * k, -1.6, 1.6);
      this.look.pitch = THREE.MathUtils.clamp(drag.look.pitch + (e.clientY - drag.y) * k, -0.7, 0.8);
      this._applyCamera(); this.requestRender();
    });
    const up = (e) => { if (drag?.id === e.pointerId) drag = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  }

  lookBy(dyaw, dpitch) {
    if (this.fly) return;
    this.look.yaw = THREE.MathUtils.clamp(this.look.yaw + dyaw, -1.6, 1.6);
    this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + dpitch, -0.7, 0.8);
    this._applyCamera(); this.requestRender();
  }

  setStill(still) {
    this.still = still;
    if (still) this.skipFlight();
    this.requestRender();
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this._observer.observe(this.canvas);
      this._resize();
      this._raf = requestAnimationFrame(this._loop);
    } else {
      this._observer.disconnect();
      cancelAnimationFrame(this._raf);
      this._endFlight();
    }
  }

  requestRender() { this.dirty = true; }

  // ----- animation --------------------------------------------------------------
  _loop(now) {
    if (!this.active) return;
    this._raf = requestAnimationFrame(this._loop);
    const animating = !this.still && this.tourOn && !this.show.workLights;
    if (!animating && !this.dirty && !this.fly) return;
    const t = this.still ? 2.0 : (now - this.t0) / 1000;
    const reveal = this.fly ? THREE.MathUtils.smoothstep((now - (this.fly.t0 ?? now)) / PLUNGE_DURATION, 0.56, 1) : 1;
    if (this.tourOn && !this.show.workLights && (animating || this.dirty)) this.show.update(t, reveal);
    if (this.eye) this._applyCamera(now);
    if (this.eye && !this.fly) this.show.renderScreens(this.renderer, now, animating);
    const density = this.scene.fog.density;
    if (this.fly) this.scene.fog.density = density * THREE.MathUtils.lerp(1, 0.24, THREE.MathUtils.clamp((this.camera.position.y - 14) / 12, 0, 1));
    this.renderer.render(this.scene, this.camera);
    this.scene.fog.density = density;
    if (this.fly) this.fly.t0 ??= performance.now();
    this.dirty = false;
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/jpeg', 0.85);
  }

  dispose() {
    this.setActive(false);
    this.show.disposeScreenFeed();
    this.renderer.dispose();
  }
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}
