// Modèle de données commun : un cinéma contient des salles ; une salle "modélisée"
// porte un objet `model` que le moteur (layout.js + scene.js) sait construire.
// Ajouter une salle = ajouter une entrée ici, sans toucher au moteur.
//
// Convention de repère (mètres) : l'écran frontal est dans le plan z = 0, centré
// en x = 0 ; le public est vers +z ; y = hauteur depuis le sol du premier rang.
//
// Les établissements sont fictifs. Les plans, dimensions, séances,
// disponibilités et tarifs sont des données de démonstration.

// Rangées : une ligne par groupe de rangées.
//   { rows: 'A-B', blocks: [3, 12, 3] }  → rangées A et B, trois blocs séparés par des allées
const rowsSpec = (...groups) => groups;

// Géométrie représentative commune aux salles classiques de démonstration.
const classicModel = {
  kind: 'classic',
  screen: { width: 11.2, height: 4.8, bottom: 1.4, curve: 0 },
  seat: { type: 'club', width: 0.58, color: 0x38396a, upholsteredArms: true },
  firstRow: 4.6, rowPitch: 1.05, riser: 0.29, flatRows: 2, aisle: 1.10, sideAisle: 1.15,
  rows: rowsSpec({ rows: 'A', blocks: [4, 5], pmr: [0, 8] }, { rows: 'B-J', blocks: [7, 7] }),
  ceiling: 7.2, price: 12.5,
};

function smallHallModel(width, height, capacity) {
  // Répartition fictive des places dans une salle de démonstration.
  const columns = Math.round(Math.sqrt(capacity) * 1.20);
  const count = Math.ceil(capacity / columns);
  const rows = Array.from({ length: count }, (_, i) => {
    const n = Math.floor(capacity / count) + (i < capacity % count ? 1 : 0);
    return { rows: String.fromCharCode(65 + i), blocks: [Math.floor(n / 2), Math.ceil(n / 2)] };
  });
  return {
    kind: 'standard',
    screen: { width, height, bottom: 1.45, curve: 0 },
    seat: { type: 'club', width: 0.54, color: 0x49434c },
    firstRow: Math.max(2.7, width * 0.42), rowPitch: 0.94, riser: 0.25, flatRows: 2, aisle: 1.0, sideAisle: 0.95,
    rows, ceiling: Math.max(5.2, height + 2.3), price: 11.2,
  };
}

export const CINEMAS = [
  {
    id: 'demo',
    name: 'Cinéma démo',
    short: 'Démo',
    hallNaming: 'name', // le sélecteur affiche le nom premium
    halls: [
      {
        id: 'demo-panoramique',
        label: 'ScreenX',
        fullName: 'ScreenX',
        verified: { name: false, layout: false },
        facts: ['Écran frontal et projections latérales', 'Écran frontal d’environ 15 m de diagonale', 'Fauteuils rembourrés'],
        capacity: null,
        model: {
          kind: 'screenx',
          screen: { width: 13.8, height: 5.8, bottom: 1.6, curve: 0 },
          sides: { from: 0, to: 19.6, bottom: 1.6, top: 7.4 },
          seat: { type: 'club', width: 0.58, color: 0x414145, upholsteredArms: true },
          firstRow: 5.6, rowPitch: 1.1, riser: 0.36, flatRows: 2, aisle: 1.15, sideAisle: 1.3,
          rows: rowsSpec(
            { rows: 'A', blocks: [3, 11, 3], pmr: [0, 1, 15, 16] },
            { rows: 'B', blocks: [3, 12, 3] },
            { rows: 'C-L', blocks: [4, 12, 4] },
            { rows: 'M', blocks: [4, 13, 4] },
          ),
          ceiling: 8.1,
          price: 15.9,
        },
      },
      {
        id: 'demo-grand-ecran',
        label: 'IMAX',
        fullName: 'IMAX with Laser',
        verified: { name: false, layout: false },
        facts: ['Écran courbe de 23 × 13 m', 'Gradins à pente marquée', 'Fauteuils inclinables'],
        capacity: 513,
        model: {
          kind: 'imax',
          screen: { width: 23, height: 13, bottom: 1.2, curve: 38 },
          seat: { type: 'recliner', width: 0.66, color: 0x333840 },
          firstRow: 7.2, rowPitch: 1.34, riser: 0.46, flatRows: 1, aisle: 1.25, sideAisle: 1.5,
          rows: rowsSpec(
            { rows: 'A-C', blocks: [4, 16, 4], pmr: [0, 1, 22, 23] },
            { rows: 'D-O', blocks: [6, 18, 6] },
            { rows: 'P-R', blocks: [5, 17, 5] },
          ),
          ceiling: 16,
          price: 18.5,
        },
      },
      {
        id: 'demo-confort', label: 'Aurore', fullName: 'Aurore',
        verified: { name: false, layout: false },
        facts: ['Écran plat d’environ 21 m de diagonale', 'Fauteuils larges et rembourrés'],
        capacity: null,
        model: {
          kind: 'aurore',
          screen: { width: 19.6, height: 7.54, bottom: 1.55, curve: 0 },
          seat: { type: 'slider', width: 0.62, color: 0x326b98 },
          firstRow: 6.2, rowPitch: 1.18, riser: 0.40, flatRows: 2, aisle: 1.24, sideAisle: 1.35,
          rows: rowsSpec(
            { rows: 'A', blocks: [4, 13, 4], pmr: [0, 20] },
            { rows: 'B-D', blocks: [5, 15, 5] },
            { rows: 'E-P', blocks: [5, 17, 5] },
          ),
          ceiling: 10.9, price: 14.9,
        },
      },
      {
        id: 'demo-lounge', label: 'Lodge', fullName: 'Lodge',
        verified: { name: false, layout: false },
        facts: ['Écran d’environ 14 m de diagonale', 'Fauteuils inclinables et rangées espacées'],
        capacity: null,
        model: {
          kind: 'lodge',
          screen: { width: 12.9, height: 5.45, bottom: 1.55, curve: 0 },
          seat: { type: 'lodge', width: 0.94, color: 0xaf2428 },
          firstRow: 4.8, rowPitch: 1.8, riser: 0.36, flatRows: 1, aisle: 1.3, sideAisle: 1.3,
          rows: rowsSpec({ rows: 'A', blocks: [4, 4], pmr: [0, 7] }, { rows: 'B-H', blocks: [5, 5] }),
          ceiling: 8.4, price: 18.5,
        },
      },
      {
        id: 'demo-salle-3', label: 'Salle 3', fullName: 'Salle 3',
        verified: { name: false, layout: false },
        facts: ['Salle classique avec allée centrale'],
        representative: true, capacity: null, model: {
          ...classicModel,
          rows: rowsSpec({ rows: 'A', blocks: [4, 4], pmr: [0, 7] }, { rows: 'B-I', blocks: [7, 7] }, { rows: 'J', blocks: [6, 6] }),
        },
      },
      ...[5, 6, 7, 9, 10, 11].map((number) => ({
        id: `demo-salle-${number}`, label: `Salle ${number}`, fullName: `Salle ${number}`,
        verified: { name: false, layout: false },
        facts: ['Salle classique avec allée centrale'],
        representative: true, capacity: null, model: classicModel,
      })),
      {
        id: 'demo-classique', label: 'Classique démo', fullName: 'Classique démo',
        verified: { name: false, layout: false },
        facts: ['Écran plat d’environ 12 m de diagonale', 'Fauteuils rembourrés'],
        demoLabel: true, representative: true, capacity: null, model: classicModel,
      },
    ],
  },
  {
    id: 'autre',
    name: 'Autre cinéma',
    short: 'Autre cinéma',
    hallNaming: 'number',
    halls: [
      {
        id: 'autre-1',
        label: 'Salle 1',
        fullName: 'Salle 1',
        verified: { name: false, layout: false },
        facts: ['Écran de 10,56 × 4,05 m', 'Fauteuils rembourrés et rideaux latéraux'],
        capacity: 331,
        model: {
          kind: 'prestige',
          screen: { width: 10.56, height: 4.05, bottom: 1.5, curve: 0 },
          seat: { type: 'prestige', width: 0.54, color: 0x962e24 },
          firstRow: 4.6, rowPitch: 0.98, riser: 0.24, flatRows: 3, aisle: 1.1, sideAisle: 1.1,
          rows: rowsSpec(
            { rows: 'A', blocks: [3, 10, 3], pmr: [0, 15] },
            { rows: 'B', blocks: [3, 12, 3] },
            { rows: 'C-O', blocks: [4, 13, 4] },
            { rows: 'P', blocks: [5, 14, 5] },
          ),
          ceiling: 7.5,
          price: 11.2,
        },
      },
      ...[
        [2, 221, 8.21, 3.50, '7.1'],
        [3, 72, 5.80, 2.69, '5.1'],
        [4, 72, 5.68, 2.70, '5.1'],
        [5, 114, 6.46, 2.70, '7.1'],
        [6, 67, 4.09, 1.95, '5.1'],
        [7, 82, 4.58, 2.05, '5.1'],
        [8, 127, 6.74, 2.88, '5.1'],
        [9, 79, 4.80, 2.40, '5.1'],
      ].map(([n, seats, width, height, sound]) => ({
        id: `autre-${n}`,
        label: `Salle ${n}`,
        fullName: `Salle ${n}`,
        verified: { name: false, layout: false },
        facts: [`${seats} places`, `Écran ${width.toLocaleString('fr-FR')} × ${height.toLocaleString('fr-FR')} m`, `Son ${sound}`],
        representative: true, capacity: seats,
        model: smallHallModel(width, height, seats),
      })),
    ],
  },
];

export function findHall(hallId) {
  for (const c of CINEMAS) {
    const h = c.halls.find((x) => x.id === hallId);
    if (h) return { cinema: c, hall: h };
  }
  return null;
}

// Séances de démonstration (pas de vraies données de programmation).
export const DEMO_SHOWTIMES = ['14:30', '18:15', '21:00'];

