// Vue fixe de secours (sans WebGL) : esquisse en perspective calculée avec la
// même caméra que la 3D (œil du siège, regard vers l'artiste, champ horizontal
// identique). Elle montre scène, artiste, garde-corps, régie et rangs devant.

import { eyeOf, ARTIST } from './venue.js';

export function drawFixedView(canvas, venue, seat, { hfov = 70, taken = new Set(), tourGear = true, masks } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 360, h = canvas.clientHeight || 640;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const e = eyeOf(seat);
  const Y = venue.stage.height;
  const tx = ARTIST.x - e.x, ty = Y + 1.3 - e.y, tz = ARTIST.z - e.z;
  const yaw = Math.atan2(-tx, -tz), pitch = Math.atan2(ty, Math.hypot(tx, tz));
  const f = (w / 2) / Math.tan((hfov * Math.PI) / 360);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const P = (x, y, z) => {
    let dx = x - e.x, dy = y - e.y, dz = z - e.z;
    // rotation inverse : lacet puis tangage (repère caméra regardant vers -z)
    const rx = cy * dx - sy * dz, rz = sy * dx + cy * dz;
    const ry2 = cp * dy + sp * rz, rz2 = -sp * dy + cp * rz;
    if (rz2 > -0.05) return null;
    return { x: w / 2 + (rx / -rz2) * f, y: h / 2 - (ry2 / -rz2) * f, d: -rz2 };
  };
  const poly = (pts, fill, stroke) => {
    const q = pts.map((p) => P(...p));
    if (q.some((p) => !p)) return;
    c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.stroke(); }
  };
  // fond
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#07070c'); bg.addColorStop(1, '#141019');
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  // sol de la fosse
  poly([[-40, 0, -6], [40, 0, -6], [40, 0, 60], [-40, 0, 60]], '#17151c');
  // scène
  const st = venue.stage, W = st.width / 2;
  poly([[-W, Y, -st.depth], [W, Y, -st.depth], [W, Y, 0], [-W, Y, 0]], '#2a1f36', '#d58cff');
  poly([[-W, 0, 0], [W, 0, 0], [W, Y, 0], [-W, Y, 0]], '#0c0b10');
  if (tourGear) {
    poly([[-8, Y + 1.4, -11.5], [8, Y + 1.4, -11.5], [8, Y + 8.4, -11.5], [-8, Y + 8.4, -11.5]], '#5b2a8a');
    for (const s of [-1, 1]) poly([[s * 14.1, 8.6 - 1.8, -1.2], [s * 20.3, 8.6 - 1.8, -1.2], [s * 20.3, 8.6 + 1.8, -1.2], [s * 14.1, 8.6 + 1.8, -1.2]], '#8a4fb0');
  }
  // artiste
  const foot = P(ARTIST.x, Y, ARTIST.z), top = P(ARTIST.x, Y + ARTIST.height, ARTIST.z);
  if (foot && top) {
    const hgt = foot.y - top.y, wd = hgt * 0.26;
    c.fillStyle = '#050507';
    c.beginPath(); c.ellipse(top.x, top.y + hgt * 0.07, wd * 0.25, hgt * 0.07, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(top.x - wd / 2, top.y + hgt * 0.15, wd, hgt * 0.42);
    c.fillRect(top.x - wd * 0.36, top.y + hgt * 0.55, wd * 0.28, hgt * 0.45);
    c.fillRect(top.x + wd * 0.08, top.y + hgt * 0.55, wd * 0.28, hgt * 0.45);
    c.strokeStyle = 'rgba(255,240,220,.6)'; c.lineWidth = 1;
    c.strokeRect(top.x - wd / 2, top.y, wd, hgt);
  }
  // régie (emplacement + consoles)
  for (const p of venue.regie.parts) poly([[p.x0, p.y, p.z0], [p.x1, p.y, p.z0], [p.x1, 0, p.z0], [p.x0, 0, p.z0]], '#22252c');
  if (tourGear) {
    const d = venue.regie.desk;
    poly([[d.x0, d.y + d.h, d.z0], [d.x1, d.y + d.h, d.z0], [d.x1, d.y, d.z0], [d.x0, d.y, d.z0]], '#121317', '#3e7bd6');
  }
  // têtes et dossiers des rangs devant (jusqu'à 14 m)
  const ahead = venue.seats.filter((s) => s.id !== seat.id && Math.hypot(s.x - e.x, s.z - e.z) < 14 && ((s.x - e.x) * seat.fx + (s.z - e.z) * seat.fz) > 0.3);
  ahead.sort((a, b) => Math.hypot(b.x - e.x, b.z - e.z) - Math.hypot(a.x - e.x, a.z - e.z));
  for (const s of ahead) {
    const tx = -s.fz * 0.22, tz = s.fx * 0.22, bx = s.x - s.fx * 0.24, bz = s.z - s.fz * 0.24;
    poly([[bx - tx, s.y + 0.48, bz - tz], [bx + tx, s.y + 0.48, bz + tz], [bx + tx, s.y + 0.88, bz + tz], [bx - tx, s.y + 0.88, bz - tz]], '#36557a', '#4f74a3');
    if (taken.has(s.id)) {
      poly([[s.x - tx * 0.8, s.y + 0.55, s.z - tz * 0.8], [s.x + tx * 0.8, s.y + 0.55, s.z + tz * 0.8], [s.x + tx * 0.7, s.y + 1.05, s.z + tz * 0.7], [s.x - tx * 0.7, s.y + 1.05, s.z - tz * 0.7]], '#0d0e11');
      const head = P(s.x, s.y + 1.19, s.z);
      if (head) { c.fillStyle = '#0d0e11'; c.beginPath(); c.arc(head.x, head.y, Math.max(1, 0.1 * f / head.d), 0, Math.PI * 2); c.fill(); }
    }
  }
  // garde-corps (surlignés s'ils masquent)
  const hot = new Set(masks?.rails || []);
  venue.rails.forEach((r, i) => {
    for (let k = 0; k < r.pts.length - 1; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
      poly([[ax, r.y, az], [bx, r.y, bz], [bx, r.y + r.h, bz], [ax, r.y + r.h, az]], hot.has(i) ? 'rgba(255,165,58,.55)' : 'rgba(150,160,175,.35)', hot.has(i) ? '#ffa53a' : '#9aa0aa');
    }
  });
  c.fillStyle = 'rgba(255,255,255,.7)';
  c.font = '600 12px system-ui, sans-serif';
  c.textAlign = 'left';
  c.fillText('Vue fixe schématique (WebGL indisponible)', 12, h - 14);
}
