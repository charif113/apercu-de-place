import { eyeOf, screenCenter } from './layout.js';

// Vue schématique calculée depuis le même œil. Elle ne dépend ni de Three.js ni de WebGL.
export function renderStill(container, seat, layout, projectionMissing) {
  const width = 1000;
  const height = Math.round(width * container.clientHeight / Math.max(1, container.clientWidth));
  const eye = eyeOf(seat, layout);
  const center = screenCenter(layout);
  const yaw = Math.atan2(center.x - eye.x, eye.z - center.z);
  const pitch = Math.atan2(center.y - eye.y, Math.hypot(center.x - eye.x, eye.z - center.z));
  const focal = width / 2 / Math.tan(33 * Math.PI / 180);
  const cy = height / 2 - 10;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ground = (x, y, z) => {
    const dx = x - eye.x, forward = eye.z - z;
    const ahead = dx * sn + forward * cs;
    const up = y - eye.y;
    const depth = ahead * cp + up * sp;
    if (depth < 0.15) return null;
    return [
      Math.round(width / 2 + focal * (dx * cs - forward * sn) / depth),
      Math.round(cy - focal * (up * cp - ahead * sp) / depth),
    ];
  };
  const { screen } = layout.model;
  const half = screen.width / 2;
  const z = screen.curve ? screen.curve - Math.sqrt(screen.curve ** 2 - half ** 2) : 0;
  const face = [[-half, screen.bottom, z], [-half, screen.bottom + screen.height, z],
    [half, screen.bottom + screen.height, z], [half, screen.bottom, z]].map((p) => ground(...p));
  const polygon = (points) => points.map((p) => p.join(',')).join(' ');
  const screenArt = face.every(Boolean) ? (() => {
    const points = polygon(face);
    const screenShape = `<polygon points="${points}" fill="#7c94a8" stroke="#a7b7c6" stroke-width="2"/>`;
    if (projectionMissing) return screenShape;
    const xs = face.map(([x]) => x), ys = face.map(([, y]) => y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return `${screenShape}<clipPath id="stillScreen"><polygon points="${points}"/></clipPath>
      <image href="assets/passe-des-glaces.webp" x="${x}" y="${y}" width="${Math.max(...xs) - x}" height="${Math.max(...ys) - y}"
        preserveAspectRatio="xMidYMid slice" clip-path="url(#stillScreen)"/>`;
  })() : '';
  const back = layout.chair.upholstery.filter((part) => part.back);
  const chairTop = Math.max(...back.map((part) => part.at[1] + part.size[1] / 2));
  const span = layout.model.seat.width * 0.43;
  const color = '#' + layout.model.seat.color.toString(16).padStart(6, '0');
  const chairs = layout.seats.filter((s) => s.rowIndex < seat.rowIndex && !s.pmr).map((s) => {
    const z = s.z + 0.28;
    const points = [
      ground(s.x - span, s.floor + 0.13, z), ground(s.x - span, s.floor + chairTop, z),
      ground(s.x + span, s.floor + chairTop, z), ground(s.x + span, s.floor + 0.13, z),
    ];
    return points.every(Boolean) ? `<polygon points="${polygon(points)}"/>` : '';
  });
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img"
      aria-label="Vue fixe schématique depuis le rang ${seat.row}, place ${seat.num}">
      <defs><linearGradient id="stillRoom" x2="0" y2="1"><stop stop-color="#19242c"/><stop offset="1" stop-color="#080b0f"/></linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#stillRoom)"/>
      ${screenArt}<g fill="${color}" stroke="#6c7179" stroke-width="1.25" stroke-linejoin="round">${chairs.join('')}</g>
    </svg><span class="still-label">${projectionMissing ? 'Vue fixe · Image indisponible' : 'Vue fixe schématique'}</span>`;
}

