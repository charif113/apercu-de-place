import { findHall, DEMO_SHOWTIMES } from './data.js';
import { computeLayout, demoTaken } from './layout.js';
import { SEAT_PROTOCOL, seatMessage, matchesSeatEvent } from './bridge.js';

const $ = (selector) => document.querySelector(selector);
const filmId = 'dune-troisieme-partie';
const trailerUrl = 'https://www.youtube-nocookie.com/embed/9JEN4lN1wH8';
const sections = ['film', 'screenings', 'seats', 'recap'];
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
let iframe, session, screening, selection, completed, readyTimer;

function show(step) {
  document.body.classList.toggle('booking-seats', step === 'seats');
  sections.forEach((name, i) => {
    $('#' + name).hidden = name !== step;
    const item = $('#steps').children[i];
    if (name === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  $('#' + step + 'Title').focus({ preventScroll: true });
}

function record(type, data) {
  // Point de raccord de la télémétrie. Le pilote branchera son collecteur ici.
  window.dispatchEvent(new CustomEvent('apercu:metric', { detail: {
    type,
    ...data,
    occurredAt: new Date().toISOString(),
    demo: true,
  } }));
}

function createSession(hall, showtime) {
  const layout = computeLayout(hall);
  const taken = demoTaken(layout, showtime);
  return {
    journeyId: Array.from(crypto.getRandomValues(new Uint32Array(3)), (value) => value.toString(36)).join('-'),
    sessionId: ['demo', hall.id, showtime.replace(':', '')].join('-'),
    filmId,
    hallId: hall.id,
    showtime,
    availableSeatIds: layout.seats.filter(({ id }) => !taken.has(id)).map(({ id }) => id),
    takenSeatIds: [...taken],
  };
}

function closeSeatModule() {
  clearTimeout(readyTimer);
  iframe?.remove();
  iframe = null;
}

function openSeatModule() {
  closeSeatModule();
  const status = $('#seatStatus');
  status.hidden = false;
  status.textContent = 'Chargement du plan…';
  $('#screeningContext').textContent = screening.cinema.name + ' · ' + screening.hall.label + ' · ' + session.showtime + ' · Démo';
  show('seats');
  iframe = document.createElement('iframe');
  iframe.title = 'Plan et aperçu de place';
  iframe.src = './?embed=1';
  $('#seatFrame').appendChild(iframe);
  readyTimer = setTimeout(() => { status.textContent = 'Le plan tarde à s’ouvrir. Revenez au choix de la séance pour réessayer.'; }, 8000);
}

function showRecap(id) {
  selection = computeLayout(screening.hall).byId.get(id);
  const details = $('#recapDetails');
  details.replaceChildren();
  for (const [label, value] of [
    ['Salle', screening.cinema.name + ' · ' + screening.hall.label],
    ['Séance (démo)', session.showtime],
    ['Place', 'Rang ' + selection.row + ' · Place ' + selection.num],
    ['Tarif (démo)', eur.format(screening.hall.model.price)],
  ]) {
    const pair = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    pair.append(term, description);
    details.appendChild(pair);
  }
  completed = false;
  $('#recapActions').hidden = false;
  $('#bookingComplete').hidden = true;
  $('#startOver').hidden = true;
  show('recap');
}

window.addEventListener('message', (event) => {
  if (!iframe || event.source !== iframe.contentWindow || event.origin !== location.origin) return;
  const { protocol, type, data } = event.data ?? {};
  if (protocol !== SEAT_PROTOCOL) return;
  if (type === 'module.ready') {
    clearTimeout(readyTimer);
    $('#seatStatus').hidden = true;
    iframe.contentWindow.postMessage(seatMessage('session.set', session), location.origin);
    return;
  }
  if (!['preview.opened', 'preview.compared', 'preview.returned', 'seat.selected'].includes(type)) return;
  if (!matchesSeatEvent(data, session, type === 'preview.compared')) return;
  const { journeyId, sessionId, filmId, hallId, showtime } = session;
  const metric = { journeyId, sessionId, filmId, hallId, showtime, seatId: data.seatId };
  if (type === 'preview.compared') metric.comparisonSeatId = data.comparisonSeatId;
  record(type, metric);
  if (type === 'seat.selected') {
    closeSeatModule();
    showRecap(data.seatId);
  }
});

// L'adaptateur prestataire pourra appeler cette fonction après confirmation
// effective de sa transaction. La démo ne l'appelle que depuis le récapitulatif.
export function recordBookingOutcome({ journeyId, sessionId, status, bookingId }) {
  if (!session || !selection || completed || journeyId !== session.journeyId || sessionId !== session.sessionId) return false;
  if (status !== 'completed' || typeof bookingId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(bookingId)) return false;
  completed = true;
  record('booking.completed', {
    journeyId, sessionId, bookingId,
    filmId: session.filmId, hallId: session.hallId, showtime: session.showtime, seatId: selection.id,
  });
  return true;
}

for (const hallId of ['demo-grand-ecran', 'demo-panoramique']) {
  const option = findHall(hallId);
  const block = document.createElement('div');
  const heading = document.createElement('h2');
  const times = document.createElement('div');
  times.className = 'screening-times';
  heading.textContent = option.cinema.name + ' · ' + option.hall.label;
  block.append(heading, times);
  for (const showtime of DEMO_SHOWTIMES) {
    const button = document.createElement('button');
    button.textContent = showtime + ' · ' + eur.format(option.hall.model.price);
    button.setAttribute('aria-label', heading.textContent + ', ' + showtime + ', ' + eur.format(option.hall.model.price) + ', démo');
    button.dataset.hall = hallId;
    button.dataset.showtime = showtime;
    button.onclick = () => {
      screening = option;
      session = createSession(option.hall, showtime);
      selection = null;
      record('screening.selected', { journeyId: session.journeyId, sessionId: session.sessionId, filmId, hallId, showtime });
      openSeatModule();
    };
    times.appendChild(button);
  }
  $('#screeningOptions').appendChild(block);
}

$('#showTrailer').onclick = () => {
  const panel = $('#trailer');
  panel.hidden = !panel.hidden;
  $('#showTrailer').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) {
    const player = document.createElement('iframe');
    player.src = trailerUrl;
    player.title = 'Bande-annonce officielle Warner Bros. France';
    player.allow = 'encrypted-media; picture-in-picture; fullscreen';
    player.allowFullscreen = true;
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    $('#trailerPlayer').appendChild(player);
    panel.scrollIntoView({ block: 'nearest' });
  } else {
    $('#trailerPlayer').replaceChildren();
  }
};

$('#chooseScreening').onclick = () => {
  $('#trailerPlayer').replaceChildren();
  $('#trailer').hidden = true;
  $('#showTrailer').setAttribute('aria-expanded', 'false');
  show('screenings');
};
$('#backFilm').onclick = () => show('film');
$('#backScreenings').onclick = () => {
  closeSeatModule();
  show('screenings');
};
$('#backSeats').onclick = openSeatModule;
$('#completeBooking').onclick = () => {
  const { journeyId, sessionId } = session;
  if (!recordBookingOutcome({ journeyId, sessionId, status: 'completed', bookingId: 'simulation-' + journeyId })) return;
  $('#recapActions').hidden = true;
  $('#bookingComplete').hidden = false;
  $('#startOver').hidden = false;
  $('#startOver').focus();
};
$('#startOver').onclick = () => show('film');
