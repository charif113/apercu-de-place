// Concert FICTIF et données SIMULÉES (séances, tarifs, disponibilités).
// La salle et ses identifiants de places sont réels, rien d'autre.

export const CONCERT = {
  id: 'nova-ligne-2027',
  artist: 'Nova Ligne',
  tour: 'Tournée Horizon',
  venue: 'Palais Nikaïa · Nice',
  config: 'Concert frontal · tout assis',
  showtimes: [
    { id: 's1', date: '2027-03-12', label: 'Ven. 12 mars 2027', time: '20:30', fill: 0.62 },
    { id: 's2', date: '2027-03-13', label: 'Sam. 13 mars 2027', time: '20:30', fill: 0.81 },
    { id: 's3', date: '2027-03-14', label: 'Dim. 14 mars 2027', time: '18:00', fill: 0.44 },
  ],
};

export const CATEGORIES = {
  or: { label: 'Carré Or', price: 89, color: '#e8b04a' },
  c1: { label: 'Catégorie 1', price: 69, color: '#e0607e' },
  c2: { label: 'Catégorie 2', price: 55, color: '#5aa7e0' },
  c3: { label: 'Catégorie 3', price: 39, color: '#7fc79b' },
};

export function categoryOf(seat) {
  if (seat.zone === 'parterre') return seat.row <= 8 ? 'or' : 'c1';
  if (seat.zone === 'tribune') return seat.block === 'W' ? 'c1' : 'c2';
  if (seat.tier === 'gradin1') return ['G', 'I'].includes(seat.block) ? 'c1' : 'c2';
  if (seat.tier === 'gradin2') return ['G', 'I', 'D', 'L'].includes(seat.block) ? 'c2' : 'c3';
  return 'c3';
}

// Places prises, déterministes par séance (même résultat à chaque visite).
export function simulateAvailability(venue, showtime) {
  let h = 2166136261;
  for (const ch of `${showtime.id}${showtime.date}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  const taken = [];
  // les blocs se remplissent par paquets (groupes d'amis) plutôt qu'au hasard pur
  let streak = 0;
  for (const s of venue.seats) {
    const central = 1 - Math.min(1, Math.abs(s.x) / 30);
    const near = 1 - Math.min(1, s.z / 60);
    const p = showtime.fill * (0.55 + 0.35 * central + 0.25 * near) * (s.pmr || s.companion ? 0.4 : 1);
    if (streak > 0) { taken.push(s.id); streak--; continue; }
    if (rnd() < p * 0.5) { taken.push(s.id); streak = Math.floor(rnd() * 4); }
  }
  return {
    showtimeId: showtime.id,
    takenSeatIds: taken,
    simulated: true,
  };
}
