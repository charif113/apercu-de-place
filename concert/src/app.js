// Billetterie de démonstration (hôte) : concert → date → place → récapitulatif.
// Le module reçoit la salle et les disponibilités ; il renvoie l'identifiant du siège.

import { loadVenue, seatLabel, zoneLabel } from './venue.js';
import { CONCERT, CATEGORIES, categoryOf, simulateAvailability } from './concert.js';
import { mountSeatPreview } from './seat-preview.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {
  showtime: CONCERT.showtimes.find((s) => s.id === params.get('seance')) || CONCERT.showtimes[0],
  seatId: params.get('place') || null,
  confirmed: null,
};
const steps = ['stepShow', 'stepDate', 'stepSeat', 'stepRecap'];
const venuePromise = loadVenue();
let module = null;
let mountedShowtime = null;
let loadedVenue = null;

function renderShowtimes() {
  const list = $('showtimeList');
  list.textContent = '';
  for (const s of CONCERT.showtimes) {
    const id = `st-${s.id}`;
    const left = Math.round((1 - s.fill) * 100);
    const label = document.createElement('label');
    label.className = 'st';
    label.htmlFor = id;
    label.innerHTML = `<input type="radio" name="showtime" id="${id}" value="${s.id}" ${s.id === state.showtime.id ? 'checked' : ''}>
      <span class="st-date">${s.label}</span><span class="st-time">${s.time}</span>
      <span class="st-left">${left < 25 ? 'Dernières places' : 'Places disponibles'} · simulé</span>`;
    label.querySelector('input').addEventListener('change', () => {
      state.showtime = s;
      updateNavigation();
      updateUrl();
    });
    list.append(label);
  }
}

function canRecap() {
  return state.confirmed?.showtimeId === state.showtime.id && state.confirmed.seatId === state.seatId;
}

function updateNavigation() {
  for (const button of document.querySelectorAll('.booking-steps button')) {
    const target = button.dataset.stepTarget;
    button.disabled = target === 'stepRecap' && !canRecap();
    if (target === document.body.dataset.step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
}

function show(step, push) {
  const changed = document.body.dataset.step !== step;
  for (const id of steps) $(id).hidden = id !== step;
  document.body.dataset.step = step;
  updateNavigation();
  updateUrl(push && changed);
  if (changed) window.scrollTo(0, 0);
}

async function openSeatModule({ push = true, focus = true, preview = false } = {}) {
  show('stepSeat', push);
  const venue = await venuePromise;
  if (document.body.dataset.step !== 'stepSeat') return;
  if (mountedShowtime !== state.showtime.id) {
    const view = module?.plan.getView();
    const availability = simulateAvailability(venue, state.showtime);
    if (!venue.byId.has(state.seatId)) state.seatId = null;
    module?.destroy();
    module = mountSeatPreview($('seatModule'), {
      venue,
      availability,
      categoryOf,
      categories: CATEGORIES,
      context: { title: CONCERT.artist, subtitle: `${state.showtime.label} · ${state.showtime.time}`, showtimeId: state.showtime.id },
      initialSeatId: state.seatId,
      initialView: view,
      onPreviewSeatChange: (seatId) => {
        state.seatId = seatId;
        updateNavigation();
        updateUrl();
      },
      onSelect: (seatId) => {
        state.seatId = seatId;
        state.confirmed = { seatId, showtimeId: state.showtime.id };
        recap(venue, seatId, true);
        window.dispatchEvent(new CustomEvent('demo:seat-selected', { detail: { seatId, showtimeId: state.showtime.id } }));
      },
      onCancel: () => navigate('stepDate'),
    });
    mountedShowtime = state.showtime.id;
    loadedVenue = venue;
    window.__demo = { module, venue, availability };
    updateUrl();
  }
  if (preview && state.seatId) module.open(state.seatId);
  else if (focus) module.plan.canvas.focus({ preventScroll: true });
}

function recap(venue, seatId, push) {
  const s = venue.byId.get(seatId);
  const c = CATEGORIES[categoryOf(s)];
  $('recapDate').textContent = `${state.showtime.label} · ${state.showtime.time}`;
  const dl = $('recapSeat');
  dl.innerHTML = '';
  for (const [k, v] of [['Place', seatLabel(s)], ['Zone', zoneLabel(s)], ['Catégorie', c.label], ['Prix (simulé)', `${c.price},00 €`]]) {
    const div = document.createElement('div');
    div.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
    dl.append(div);
  }
  $('recapId').textContent = seatId;
  show('stepRecap', push);
  $('recapTitle').focus();
}

function urlFor(step) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  const p = url.searchParams;
  p.set('seance', state.showtime.id);
  if (state.seatId) p.set('place', state.seatId);
  if (step === 'stepSeat') p.set('etape', 'place');
  if (step === 'stepDate') p.set('etape', 'date');
  if (params.get('vue') === 'fixe') p.set('vue', 'fixe');
  return url;
}

function updateUrl(push = false) {
  const step = document.body.dataset.step;
  const method = push ? 'pushState' : 'replaceState';
  history[method]({ concertStep: step }, '', urlFor(step));
  $('directPlan').href = urlFor('stepSeat');
}

function navigate(step, { push = true, focus = true } = {}) {
  if (step !== 'stepSeat' && document.body.classList.contains('v3-open')) module?.close();
  if (step === 'stepSeat') return openSeatModule({ push, focus });
  if (step === 'stepRecap' && canRecap()) return recap(loadedVenue, state.seatId, push);
  const next = step === 'stepDate' ? 'stepDate' : 'stepShow';
  show(next, push);
  if (focus) $(next === 'stepDate' ? 'dateTitle' : 'showTitle').focus({ preventScroll: true });
}

renderShowtimes();
for (const button of document.querySelectorAll('[data-step-target]')) {
  button.addEventListener('click', () => navigate(button.dataset.stepTarget));
}
$('chooseDate').addEventListener('click', () => navigate('stepDate'));
$('goPlan').addEventListener('click', () => openSeatModule());
$('changeSeat').addEventListener('click', () => openSeatModule());
$('restart').addEventListener('click', () => navigate('stepShow'));
$('directPlan').addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openSeatModule();
});
window.addEventListener('popstate', (event) => navigate(event.state?.concertStep, { push: false }));
if (params.get('etape') === 'place' || params.get('apercu') === '1') {
  openSeatModule({ push: false, focus: false, preview: params.get('apercu') === '1' });
} else {
  navigate(params.get('etape') === 'date' ? 'stepDate' : 'stepShow', { push: false, focus: false });
}
