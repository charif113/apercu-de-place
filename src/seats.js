// Cotes du modèle, en mètres, par rapport au centre de la place au sol.
// Les dossiers servent aussi d'enveloppes pour les rayons de visibilité.
const piece = (size, at, radius, tilt = 0, back = false) => ({ size, at, radius, tilt, back });

const SIDES = [-1, 1];

function recliner(w) {
  const upholstery = [
    piece([w * 0.77, 0.16, 0.60], [0, 0.40, -0.045], 0.065),
    piece([w * 0.78, 0.56, 0.19], [0, 0.75, 0.28], 0.085, 0.18, true),
    piece([w * 0.78, 0.25, 0.24], [0, 0.72, 0.23], 0.070, 0.18, true),
    piece([w * 0.80, 0.26, 0.22], [0, 0.93, 0.29], 0.075, 0.18, true),
    piece([w * 0.79, 0.22, 0.19], [0, 1.13, 0.32], 0.075, 0.18, true),
    piece([w * 0.74, 0.25, 0.11], [0, 0.27, -0.34], 0.045, -0.22),
  ];
  const structure = [piece([w * 0.66, 0.22, 0.56], [0, 0.16, 0.02], 0.035)];
  const cupholders = [];
  for (const sign of SIDES) {
    const x = sign * w * 0.414;
    structure.push(piece([w * 0.164, 0.57, 0.66], [x, 0.32, -0.005], 0.035));
    structure.push(piece([w * 0.164, 0.075, 0.66], [x, 0.61, -0.015], 0.030));
    cupholders.push([x, 0.648, -0.23, 0.046]);
  }
  return { upholstery, structure, cupholders, eye: { y: 1.18, z: 0.13 }, finish: 'satin' };
}

function club(w, upholsteredArms) {
  const upholstery = [
    piece([w * 0.82, 0.14, 0.48], [0, 0.41, -0.03], 0.060),
    piece([w * 0.88, 0.68, 0.15], [0, 0.80, 0.25], 0.070, 0.15, true),
  ];
  const structure = [piece([w * 0.66, 0.22, 0.34], [0, 0.16, 0.02], 0.035)];
  const cupholders = [];
  for (const sign of SIDES) {
    const x = sign * w * 0.425;
    if (upholsteredArms) upholstery.push(piece([w * 0.145, 0.51, 0.49], [x, 0.38, -0.025], 0.035));
    else {
      structure.push(piece([w * 0.12, 0.56, 0.15], [x, 0.29, 0.12], 0.020));
      structure.push(piece([w * 0.14, 0.075, 0.47], [x, 0.595, -0.025], 0.024));
    }
    cupholders.push([x, 0.635, -0.237, 0.035]);
  }
  return { upholstery, structure, cupholders, eye: { y: 1.15, z: 0.11 } };
}

function slider(w) {
  const upholstery = [
    piece([w * 0.76, 0.17, 0.52], [0, 0.415, -0.05], 0.07),
    piece([w * 0.83, 0.75, 0.17], [0, 0.83, 0.25], 0.075, 0.15, true),
  ];
  const structure = [piece([w * 0.68, 0.22, 0.42], [0, 0.14, 0.01], 0.04)];
  const cupholders = [];
  for (const sign of SIDES) {
    const x = sign * w * 0.405;
    upholstery.push(piece([w * 0.18, 0.55, 0.61], [x, 0.36, -0.022], 0.045));
    cupholders.push([x, 0.635, -0.21, 0.043]);
  }
  return { upholstery, structure, cupholders, eye: { y: 1.16, z: 0.115 } };
}

function lodge(w) {
  const upholstery = [
    piece([w * 0.69, 0.20, 0.65], [0, 0.39, -0.12], 0.085),
    piece([w * 0.73, 0.59, 0.28], [0, 0.71, 0.25], 0.09, 0.24, true),
    piece([w * 0.74, 0.29, 0.28], [0, 1.065, 0.34], 0.095, 0.24, true),
    piece([w * 0.66, 0.15, 0.35], [0, 0.30, -0.48], 0.06, -0.30),
  ];
  const structure = [
    piece([w * 0.62, 0.20, 0.59], [0, 0.14, 0], 0.04),
    piece([w * 0.61, 0.60, 0.13], [0, 0.72, 0.40], 0.055, 0.24, true),
  ];
  const cupholders = [];
  for (const sign of SIDES) {
    const x = sign * w * 0.40;
    upholstery.push(piece([w * 0.19, 0.59, 0.79], [x, 0.36, -0.06], 0.062));
    cupholders.push([x, 0.657, -0.31, 0.051], [x, 0.657, -0.18, 0.047]);
  }
  return { upholstery, structure, cupholders, eye: { y: 1.13, z: 0.15 } };
}

function prestige(w) {
  const upholstery = [
    piece([w * 0.83, 0.14, 0.46], [0, 0.415, -0.045], 0.06),
    piece([w * 0.91, 0.69, 0.145], [0, 0.81, 0.215], 0.071, 0.12, true),
  ];
  const structure = [piece([w * 0.70, 0.23, 0.35], [0, 0.16, 0.06], 0.045)];
  for (const sign of SIDES) {
    const x = sign * w * 0.43;
    upholstery.push(piece([w * 0.13, 0.115, 0.42], [x, 0.60, -0.01], 0.032));
    structure.push(piece([w * 0.11, 0.48, 0.12], [x, 0.27, 0.105], 0.02));
  }
  return { upholstery, structure, cupholders: [], eye: { y: 1.16, z: 0.10 } };
}

const PROFILES = { recliner, club, slider, lodge, prestige };

export function chairProfile({ type, width, upholsteredArms }) {
  // L'œil se trouve au-dessus de l'arrière de l'assise, devant le dossier.
  return (PROFILES[type] || club)(width, upholsteredArms);
}
