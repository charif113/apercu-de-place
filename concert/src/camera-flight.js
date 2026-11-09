const TURN = 0.33;
const CLEAR_HEIGHT = 30;
const TOP_FOV = 50 * Math.PI / 180;

export const PLUNGE_DURATION = 1050;
export const CUTAWAY_HEIGHT = 18;

const clamp = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => { const k = clamp(t); return k * k * (3 - 2 * k); };
const mix = (a, b, t) => a + (b - a) * t;
const verticalFov = (span, distance) => 2 * Math.atan(span / (2 * distance)) * 180 / Math.PI;

export function aimAt(pos, target) {
  const dx = target.x - pos.x, dz = target.z - pos.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(target.y - pos.y, Math.hypot(dx, dz)) };
}

// L'œil sert de plan de référence pour retrouver l'échelle du plan 2D.
// Le déplacement horizontal se fait au-dessus de la salle. Une fois à l'aplomb
// de la place, la descente reste verticale, même pour les sièges en bord de gradin.
export function createPlunge(rect, eye, target, seatFov) {
  const span = rect.z1 - rect.z0;
  const clear = Math.max(CLEAR_HEIGHT, eye.y + 7);
  const start = {
    x: (rect.x0 + rect.x1) / 2,
    y: Math.max(clear, eye.y + span / (2 * Math.tan(TOP_FOV / 2))),
    z: (rect.z0 + rect.z1) / 2,
  };
  const fromFov = verticalFov(span, start.y - eye.y);
  const nearFov = verticalFov(Math.min(span, 22), clear - eye.y);
  return (progress) => {
    const approach = smooth(progress / TURN);
    const drop = smooth((progress - TURN) / (1 - TURN));
    const pos = {
      x: mix(start.x, eye.x, approach),
      y: progress < TURN ? mix(start.y, clear, approach) : mix(clear, eye.y, drop),
      z: mix(start.z, eye.z, approach),
    };
    const look = aimAt(pos, target);
    const turn = smooth((progress - TURN) / 0.58);
    return {
      ...pos,
      yaw: mix(0, look.yaw, turn),
      pitch: mix(-Math.PI / 2, look.pitch, turn),
      fov: progress < TURN ? mix(fromFov, nearFov, approach) : mix(nearFov, seatFov, drop),
    };
  };
}
