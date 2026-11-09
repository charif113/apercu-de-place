export const SEAT_PROTOCOL = 'cine-apercu/v1';
const opaqueId = /^[a-zA-Z0-9_-]{1,96}$/;
const seatId = /^[A-Z][1-9][0-9]{0,2}$/;

export const seatMessage = (type, data) => ({ protocol: SEAT_PROTOCOL, type, data });

export function validSession(session) {
  if (!session || !['journeyId', 'sessionId', 'filmId', 'hallId'].every((key) => (
    typeof session[key] === 'string' && opaqueId.test(session[key])
  ))) return false;
  if (typeof session.showtime !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(session.showtime)) return false;
  const { availableSeatIds, takenSeatIds } = session;
  if (![availableSeatIds, takenSeatIds].every((ids) => (
    Array.isArray(ids) && ids.length <= 2000 && ids.every((id) => typeof id === 'string' && seatId.test(id))
  ))) return false;
  const all = [...availableSeatIds, ...takenSeatIds];
  return new Set(all).size === all.length;
}

export function matchesSeatEvent(data, session, comparison = false) {
  if (!session || !data || !['journeyId', 'sessionId', 'filmId', 'hallId', 'showtime'].every((key) => data[key] === session[key])) return false;
  const { availableSeatIds } = session;
  return availableSeatIds.includes(data.seatId) && (!comparison || (
    data.seatId !== data.comparisonSeatId && availableSeatIds.includes(data.comparisonSeatId)
  ));
}

// Le contrat de la démo est limité au parent immédiat, sur la même origine.
export function createSeatBridge({ onSession }) {
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('embed') === '1';
  let session = null;
  const origin = location.origin;
  const send = (type, data) => window.parent.postMessage(seatMessage(type, data), origin);
  if (embedded) {
    window.addEventListener('message', (event) => {
      if (event.origin !== origin || event.source !== window.parent) return;
      const { protocol, type, data } = event.data ?? {};
      if (protocol !== SEAT_PROTOCOL || type !== 'session.set' || !validSession(data)) return;
      const { journeyId, sessionId, filmId, hallId, showtime } = data;
      session = { journeyId, sessionId, filmId, hallId, showtime, availableSeatIds: data.availableSeatIds };
      onSession(data);
    });
    send('module.ready', null);
  }
  function emit(type, { hallId, showtime, seatId, comparisonSeatId }) {
    if (!session) return;
    const { journeyId, sessionId, filmId } = session;
    const data = { journeyId, sessionId, filmId, hallId, showtime, seatId };
    if (type === 'preview.compared') data.comparisonSeatId = comparisonSeatId;
    if (matchesSeatEvent(data, session, type === 'preview.compared')) send(type, data);
  }
  return {
    embedded,
    opened: (data) => emit('preview.opened', data),
    compared: (data) => emit('preview.compared', data),
    returned: (data) => emit('preview.returned', data),
    confirmed: (data) => emit('seat.selected', data),
  };
}
