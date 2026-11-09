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
const wideHome = matchMedia('(min-width: 900px)');
const inventory = new Map();
let venuePromise;
let module = null;
let mountedShowtime = null;
let loadedVenue = null;
let seatRequest = 0;

function getVenue() {
  venuePromise ??= loadVenue().catch((error) => { venuePromise = null; throw error; });
  return venuePromise;
}

function availabilityFor(venue, date) {
  if (!inventory.has(date.id)) inventory.set(date.id, simulateAvailability(venue, date));
  return inventory.get(date.id);
}

function loadHomeArt() {
  const images = wideHome.matches ? '#stepShow img[data-src]' : '.concert-poster[data-src]';
  for (const image of document.querySelectorAll(images)) {
    image.src = image.dataset.src;
    delete image.dataset.src;
  }
}

function renderShowtimes() {
  const list = $('showtimeList');
  list.textContent = '';
  for (const s of CONCERT.showtimes) {
    const id = `st-${s.id}`;
    const label = document.createElement('label');
    label.className = 'st';
    label.htmlFor = id;
    label.innerHTML = `<input type="radio" name="showtime" id="${id}" value="${s.id}" ${s.id === state.showtime.id ? 'checked' : ''}>
      <span class="st-date">${s.label}</span><span class="st-time">${s.time}</span>
      <span class="st-price" hidden></span>
      <progress class="st-fill" max="100" aria-label="Remplissage simulé le ${s.label}" hidden></progress>
      <span class="st-left">Chargement des disponibilités démo…</span>`;
    label.querySelector('input').addEventListener('change', () => {
      state.showtime = s;
      updateNavigation();
      updateUrl();
    });
    list.append(label);
  }
}

async function updateShowtimes() {
  try {
    const venue = await getVenue();
    for (const date of CONCERT.showtimes) {
      const { takenSeatIds } = availabilityFor(venue, date);
      const taken = new Set(takenSeatIds);
      const filled = Math.round(taken.size / venue.seats.length * 100);
      let price = Infinity;
      for (const seat of venue.seats) {
        if (!taken.has(seat.id)) price = Math.min(price, CATEGORIES[categoryOf(seat)].price);
      }
      const label = $(`st-${date.id}`).closest('.st');
      const gauge = label.querySelector('.st-fill');
      const from = label.querySelector('.st-price');
      gauge.value = filled;
      gauge.hidden = false;
      from.textContent = Number.isFinite(price) ? `Dès ${price} €` : 'Complet · démo';
      from.hidden = false;
      label.querySelector('.st-left').textContent = `${filled} % de places occupées · démo`;
    }
  } catch {
    for (const label of document.querySelectorAll('.st-left')) label.textContent = 'Disponibilités démo indisponibles';
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
  if (step === 'stepShow') loadHomeArt();
  if (step === 'stepDate') updateShowtimes();
}

async function openSeatModule({ push = true, focus = true, preview = false, guided = false, preset = null } = {}) {
  const request = ++seatRequest;
  show('stepSeat', push);
  const loading = $('planStatus'), retry = $('retryPlan');
  loading.hidden = !!module;
  retry.hidden = true;
  $('planStatusText').textContent = 'Chargement du plan…';
  let venue;
  try {
    venue = await getVenue();
  } catch {
    if (request !== seatRequest || document.body.dataset.step !== 'stepSeat') return;
    loading.hidden = false;
    $('planStatusText').textContent = 'Le plan est momentanément indisponible.';
    retry.hidden = false;
    retry.onclick = () => openSeatModule({ push: false, focus, preview, guided, preset });
    return;
  }
  if (request !== seatRequest || document.body.dataset.step !== 'stepSeat') return;
  loading.hidden = true;
  if (mountedShowtime !== state.showtime.id) {
    const view = module?.plan.getView();
    const availability = availabilityFor(venue, state.showtime);
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
  if (guided) return module.openGuidedComparison();
  if (preset) return module.openPreset(preset);
  if (preview && state.seatId) return module.open(state.seatId);
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
  if (state.seatId && step !== 'stepShow') p.set('place', state.seatId);
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
  const comparisonUrl = urlFor('stepSeat');
  comparisonUrl.searchParams.delete('place');
  comparisonUrl.searchParams.set('comparer', '1');
  $('guidedComparison').href = comparisonUrl;
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
for (const [id, guided] of [['directPlan', false], ['guidedComparison', true]]) {
  $(id).addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openSeatModule({ guided });
  });
}
for (const button of document.querySelectorAll('[data-home-preset]')) {
  button.addEventListener('click', () => openSeatModule({ preset: button.dataset.homePreset }));
}
wideHome.addEventListener('change', () => { if (document.body.dataset.step === 'stepShow') loadHomeArt(); });
window.addEventListener('popstate', (event) => navigate(event.state?.concertStep, { push: false }));
const guided = params.get('comparer') === '1';
const preview = params.get('apercu') === '1';
const step = params.get('etape');
const linkedSeat = Boolean(state.seatId) && (!step || step === 'place');
if (step === 'place' || linkedSeat || preview || guided) {
  openSeatModule({ push: false, focus: false, preview, guided });
} else {
  navigate(step === 'date' ? 'stepDate' : 'stepShow', { push: false, focus: false });
}
