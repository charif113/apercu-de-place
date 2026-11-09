// « La passe des glaces » : un panorama original, animé comme un lent
// panoramique aérien. La même transformation de texture anime les trois faces.
import * as THREE from 'three';
import { wallXAt } from './layout.js';

const PANORAMA = new URL('../assets/passe-des-glaces.webp', import.meta.url).href;
const PANORAMA_RATIO = 3;
const PAN_DISTANCE = 0.068;

export function projectionUv(layout) {
  const { screen, sides } = layout.model;
  if (!sides) {
    const height = 0.92;
    const width = height * screen.width / screen.height / PANORAMA_RATIO;
    return (x, y) => [
      0.54 + x / screen.width * width,
      0.5 + ((y - screen.bottom) / screen.height - 0.5) * height,
    ];
  }

  // Repère virtuel fixe dans les deux tiers arrière de la salle. Le calcul
  // dépend des coordonnées monde, donc les sommets partagés ont les mêmes UV.
  const originZ = layout.rows[Math.floor(layout.rows.length * 2 / 3)].z + 0.2;
  const endAngle = Math.atan2(wallXAt(layout, sides.to), originZ - sides.to);
  // La partie frontale garde le cadrage du paysage. La périphérie comprime
  // progressivement la largeur sans modifier les raccords.
  const angleScale = 3.6;
  const range = Math.asinh(angleScale * endAngle);
  return (x, y, z) => {
    const azimuth = Math.atan2(x, originZ - z);
    return [
      0.5 + 0.42 * Math.asinh(angleScale * azimuth) / range,
      0.10 + 0.80 * (y - screen.bottom) / screen.height,
    ];
  };
}

export class DemoFilm {
  constructor() {
    this.texture = new THREE.TextureLoader().load(PANORAMA);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.userData.shared = true;
    this.motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  update(now) {
    this.start ??= now;
    const phase = (now - this.start) / 1000 * 0.42;
    if (this.motion) this.texture.offset.x = Math.sin(phase) * PAN_DISTANCE;
  }
}
