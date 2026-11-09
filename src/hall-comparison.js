function relativePosition(seat, layout) {
  const front = layout.rows[0].z;
  const span = layout.rows.at(-1).z - front;
  return {
    lateral: seat.x / (2 * layout.halfWidth),
    depth: (seat.z - front) / (span || 1),
  };
}

export function findComparableSeat(sourceSeat, sourceLayout, targetLayout) {
  const exact = targetLayout.byId.get(sourceSeat.id);
  if (exact) return { seat: exact, exact: true };

  // Les deux axes sont ramenés à des fractions de la salle. En cas
  // d'égalité, l'ordre du plan donne la même place à chaque comparaison.
  const origin = relativePosition(sourceSeat, sourceLayout);
  let best = null;
  let bestDistance = Infinity;
  for (const seat of targetLayout.seats) {
    const position = relativePosition(seat, targetLayout);
    const distance = Math.hypot(position.lateral - origin.lateral, position.depth - origin.depth);
    if (distance < bestDistance) {
      best = seat;
      bestDistance = distance;
    }
  }
  return best ? { seat: best, exact: false } : null;
}
