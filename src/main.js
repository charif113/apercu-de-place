import { CINEMAS, findHall, DEMO_SHOWTIMES } from './data.js';
import { computeLayout, seatMetrics, suggestCentral, demoTaken } from './layout.js';
import { SeatPlan } from './plan.js';
import { createSeatBridge } from './bridge.js';
import { findComparableSeat } from './hall-comparison.js';
import { renderStill } from './fallback.js';

const $ = (s) => document.querySelector(s);
const fmt = (n, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const euro = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const SCREENX_TRIAL = { hallId: 'demo-panoramique', first: 'F1', second: 'I10', showtime: '18:15' };
const COMPARABLE_HALLS = [
  { id: 'demo-classique', kind: 'classic', label: 'Classique' },
  { id: 'demo-grand-ecran', kind: 'imax', label: 'IMAX' },
  { id: 'demo-panoramique', kind: 'screenx', label: 'ScreenX' },
];

const params = new URLSearchParams(location.search);
const startCinema = CINEMAS.find((cinema) => cinema.id === params.get('cinema')) || CINEMAS[0];
const startHall = findHall(params.get('salle'))?.hall || startCinema.halls[0];
const state = {
  hallId: startHall.id,
  showtime: DEMO_SHOWTIMES[1],
  perHall: new Map(), // hallId → { selected, compare, view }
  active: 'A', // place affichée en 3D : A (sélection) ou B (comparaison)
  in3d: false,
  busy: false,
  compact: true,
  screenXTrial: false,
  showSpectators: false,
};

let scene = null; // chargé à la demande (Three.js)
let layout = null;
let taken = new Set();
let session = null;
let pendingSession = null;
let still = false;
let projectionMissing = false;
let previewedSeat = null;
let roomComparison = null;
const bridge = createSeatBridge({
  onSession(data) {
    if (!findHall(data.hallId)?.hall.model) return;
    pendingSession = data;
    applyPendingSession();
  },
});
document.body.classList.toggle('is-embedded', bridge.embedded);

async function applyPendingSession() {
  if (!pendingSession || state.busy) return;
  if (state.in3d) {
    await backToPlan();
    return;
  }
  const next = pendingSession;
  pendingSession = null;
  if (session?.sessionId !== next.sessionId || session?.journeyId !== next.journeyId) state.perHall.clear();
  session = next;
  state.showtime = next.showtime;
  selectHall(next.hallId);
}

function bookingSeat(seatId) {
  return { hallId: state.hallId, showtime: state.showtime, seatId };
}

const plan = new SeatPlan($('#plan'), {
  onSeatTap: (seat) => onSeatTap(seat),
  onZoom: (z) => { $('#zoomLevel').textContent = `${Math.round(z * 100)} %`; },
  onTapZoom: () => {
    $('#tapZoomHint').textContent = state.pickingB
      ? 'Touchez une autre place pour la comparer.'
      : 'Touchez un siège pour choisir votre place.';
  },
});

const hallState = () => {
  if (!state.perHall.has(state.hallId)) state.perHall.set(state.hallId, { selected: null, compare: null, view: null });
  return state.perHall.get(state.hallId);
};
const seatById = (id) => (id && layout ? layout.byId.get(id) : null);

// ---------------------------------------------------------------- sélecteurs
function renderHalls(cinema) {
  const main = $('#mainHalls');
  const more = $('#otherHalls');
  const other = $('#otherHallChips');
  const current = $('#currentOtherHall');
  main.replaceChildren();
  other.replaceChildren();
  current.hidden = true;
  more.open = false;
  for (const h of cinema.halls) {
    const isOther = cinema.id === 'demo' && h.model?.kind === 'classic';
    const selected = h.id === state.hallId;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (h.model ? '' : ' soon');
    b.dataset.hall = h.id;
    b.setAttribute('aria-pressed', selected);
    b.textContent = h.label;
    b.onclick = () => {
      selectHall(h.id);
      const mobile = matchMedia('(max-width: 760px)').matches;
      $(mobile ? '#planSheet' : isOther ? '#otherHalls summary' : `[data-hall="${h.id}"]`).focus({ preventScroll: true });
    };
    (isOther ? other : main).appendChild(b);
    if (isOther && selected) {
      current.textContent = h.label;
      current.hidden = false;
    }
  }
  more.hidden = !other.childElementCount;
}

function renderShowtimes() {
  const box = $('#showtimes');
  box.textContent = '';
  for (const t of DEMO_SHOWTIMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'time';
    b.textContent = t;
    b.setAttribute('aria-pressed', t === state.showtime);
    b.onclick = () => {
      state.showtime = t;
      renderShowtimes();
      refreshTaken();
      setPlanSheet(false);
    };
    box.appendChild(b);
  }
}

function selectHall(hallId, { fromPreview = false } = {}) {
  if (!fromPreview && (state.busy || state.in3d)) return;
  if (bridge.embedded && hallId !== session?.hallId) return;
  // mémorise le zoom de la salle quittée
  if (layout) hallState().view = plan.getView();
  state.hallId = hallId;
  const { cinema, hall } = findHall(hallId);
  state.active = 'A';
  state.pickingB = false;
  state.screenXTrial = false;
  $('#tapZoomHint').textContent = '';
  renderHalls(cinema);
  setPlanSheet(false);
  $('#hallName').textContent = `${cinema.name} · ${hall.label}`;
  $('#hallFacts').innerHTML = hall.facts.map((f) => `<li>${f}</li>`).join('');
  $('#hallCount').textContent = hall.capacity ? `${hall.capacity} emplacements · plan de démonstration` : '';
  const badges = [];
  if (!hall.model) badges.push('<span class="badge soon">Aperçu à venir</span>');
  else if (!hall.verified.layout) badges.push('<span class="badge illus">Plan illustratif</span>');
  if (hall.representative) badges.push('<span class="badge illus">Modèle représentatif</span>');
  $('#hallBadges').innerHTML = badges.join('');
  const other = $('#otherCinema');
  other.hidden = false;
  other.href = cinema.id === 'demo' ? '?cinema=autre' : './';
  other.textContent = cinema.id === 'demo' ? 'Explorer un autre cinéma' : 'Revenir au cinéma démo';
  $('.brand-kicker').textContent = cinema.id === 'demo' ? 'DÉMONSTRATION' : cinema.name.toUpperCase();

  const hasModel = !!hall.model;
  $('#planArea').hidden = !hasModel;
  $('#soon').hidden = hasModel;
  $('#showtimeOption').hidden = !hasModel;
  if (!hasModel) {
    layout = null;
    $('#soonTitle').textContent = hall.fullName;
    updateBar();
    return;
  }
  layout = computeLayout(hall);
  if (!hall.capacity) $('#hallCount').textContent = `${layout.seats.length} emplacements · plan de démonstration`;
  const hs = hallState();
  taken = availableMask();
  if (taken.has(hs.selected)) hs.selected = null;
  if (taken.has(hs.compare)) hs.compare = null;
  renderSeatPicker();
  updateBar();
  plan.setHall(layout, { taken, selected: hs.selected, compare: hs.compare, view: hs.view });
}

function availableMask() {
  if (!session) {
    const result = demoTaken(layout, state.showtime);
    result.delete(hallState().selected);
    result.delete(hallState().compare);
    return result;
  }
  const available = new Set(session.availableSeatIds);
  return new Set(layout.seats.filter((seat) => !available.has(seat.id)).map((seat) => seat.id));
}

function setPlanSheet(expanded) {
  $('#planSheet').setAttribute('aria-expanded', expanded);
  const { hall } = findHall(state.hallId);
  $('#planSheetLabel').textContent = expanded ? 'Replier la fiche' : hall.model
    ? `Salle et séance · ${state.showtime} (démo)`
    : 'Choisir une salle';
}

function refreshTaken() {
  if (!layout) return;
  taken = availableMask();
  const hs = hallState();
  plan.setStates({ taken, selected: hs.selected, compare: hs.compare });
  renderSeatPicker();
}

function renderSeatPicker(preferredRow) {
  if (!layout) return;
  const rowSelect = $('#rowPicker'), seatSelect = $('#seatPicker');
  const pmrOnly = $('#pmrOnly').checked;
  const canChoose = (seat) => !taken.has(seat.id) && (!pmrOnly || seat.pmr);
  const rows = layout.rows.filter((row) => row.seats.some(canChoose));
  const chosen = seatById(state.pickingB ? hallState().compare : hallState().selected);
  const rowId = preferredRow || chosen?.row || rowSelect.value;
  rowSelect.replaceChildren(...rows.map((row) => new Option(row.label, row.label)));
  if (rows.some((row) => row.label === rowId)) rowSelect.value = rowId;
  const row = rows.find((r) => r.label === rowSelect.value);
  seatSelect.replaceChildren(new Option(row ? 'Choisir une place' : 'Aucune place', ''));
  for (const seat of row?.seats.filter(canChoose) || []) {
    seatSelect.add(new Option(`Place ${seat.num}${seat.pmr ? ' · PMR' : ''}`, seat.id));
  }
  if (chosen) seatSelect.value = [...seatSelect.options].some((opt) => opt.value === chosen.id) ? chosen.id : '';
  rowSelect.disabled = seatSelect.disabled = !row;
}

function updateBar() {
  const hs = layout ? hallState() : {};
  const s = seatById(hs.selected);
  const bar = $('#bar');
  $('#openSeatPicker').hidden = !layout;
  $('#tryScreenX').hidden = bridge.embedded || !layout || state.pickingB || findHall(state.hallId).cinema.id !== 'demo';
  if (!layout) {
    bar.innerHTML = '<p class="hint">Cette salle n’a pas encore de modèle 3D.</p>';
    return;
  }
  if (state.pickingB) {
    const sug = suggestCentral(layout, (id) => taken.has(id), hs.selected);
    bar.innerHTML = `<div class="pick"><p><b>Comparer deux places</b><br>Touchez la 2<sup>e</sup> place sur le plan.</p>
      <div class="row"><button class="btn ghost" id="pickCancel">Annuler</button>
      ${sug ? `<button class="btn primary" id="pickSuggest">Place centrale ${sug.row}${sug.num}</button>` : ''}</div></div>`;
    $('#pickCancel').onclick = () => { state.pickingB = false; updateBar(); };
    if (sug) $('#pickSuggest').onclick = () => { state.pickingB = false; setCompare(sug, true); };
    return;
  }
  bar.innerHTML = s
    ? `<p class="sel"><span class="dot" aria-hidden="true"></span><span class="sel-copy"><small>Place choisie</small><span>Rang ${s.row} · Place ${s.num}</span></span>${hs.compare ? ` <span class="vs">avec ${hs.compare}</span>` : ''}</p>
       <button class="btn primary" id="reopen">Voir depuis cette place</button>`
    : '<p class="hint">Choisissez une place sur le plan.<br><small>Pincez ou utilisez + et − pour zoomer.</small></p>';
  const r = $('#reopen');
  if (r) r.onclick = () => openPreview(hs.compare && state.active === 'B' ? seatById(hs.compare) : s);
  if (s && bridge.embedded) {
    bar.insertAdjacentHTML('beforeend', '<button type="button" class="btn ghost" id="confirmPlan">Choisir cette place</button>');
    $('#confirmPlan').onclick = () => bridge.confirmed(bookingSeat(s.id));
  }
}

// ---------------------------------------------------------------- plan → 3D
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2200);
}

function onSeatTap(seat) {
  if (state.busy || state.in3d) return;
  const hs = hallState();
  if (taken.has(seat.id)) {
    toast(`${seat.row}${seat.num} : place déjà prise (démo)`);
    return;
  }
  if (state.pickingB) {
    if (seat.id === hs.selected) { toast('Choisissez une autre place que la première'); return; }
    state.pickingB = false;
    setCompare(seat, false);
    return;
  }
  $('#tapZoomHint').textContent = '';
  state.screenXTrial = false;
  hs.selected = seat.id;
  if (hs.compare === seat.id) hs.compare = null;
  state.active = 'A';
  plan.setStates({ taken, selected: hs.selected, compare: hs.compare });
  renderSeatPicker(seat.row);
  updateBar();
  setPlanSheet(false);
}

function tryScreenX() {
  if (bridge.embedded || state.busy || state.in3d) return;
  state.showtime = SCREENX_TRIAL.showtime;
  renderShowtimes();
  selectHall(SCREENX_TRIAL.hallId);
  const first = seatById(SCREENX_TRIAL.first);
  const second = seatById(SCREENX_TRIAL.second);
  if (!first || !second || taken.has(first.id) || taken.has(second.id)) {
    toast('Les deux places de l’essai ScreenX sont indisponibles.');
    return;
  }
  hallState().compare = null;
  onSeatTap(first);
  state.screenXTrial = true;
  state.extended = true;
  openPreview(first);
}

async function ensureScene() {
  if (scene) return scene;
  const { CinemaScene } = await import('./scene.js');
  scene = new CinemaScene($('#gl'));
  return scene;
}

function planRectForCanvas() {
  // Portion du monde couverte par le canvas plein écran, d'après le zoom du plan
  const pb = $('#plan').getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  const a = plan.toWorld(-pb.left, -pb.top);
  const b = plan.toWorld(W - pb.left, H - pb.top);
  return { x0: a.x, z0: a.z, x1: b.x, z1: b.z, w: W, h: H };
}

async function preparePreviewHall() {
  still = params.get('vue') === 'fixe';
  projectionMissing = false;
  $('#loading').hidden = false;
  try {
    if (!still) {
      const sc = await ensureScene();
      projectionMissing = !(await sc.film.load());
      if (projectionMissing) {
        still = true;
      } else {
        sc.reducedMotion = $('#noMotion').checked;
        sc.loadHall(layout);
      }
    }
  } catch (error) {
    console.warn('Vue fixe de secours', error);
    still = true;
  }
  $('#loading').hidden = true;
  $('#gl').hidden = still;
  $('#stillPreview').hidden = !still;
  $('#recenter').hidden = still;
  $('.look-hint').hidden = still;
  if (still) scene?.stop();
}

async function openPreview(seat) {
  if (!seat || state.busy) return;
  $('#tapZoomHint').textContent = '';
  state.busy = true;
  roomComparison = null;
  await preparePreviewHall();
  state.compact = true;
  const hs = hallState();
  const v = $('#view3d');
  setImmersive(false);
  v.hidden = false;
  v.classList.remove('shown');
  $('#app').inert = true;
  state.in3d = true;
  previewedSeat = seat;
  renderSheet(seat);
  requestAnimationFrame(() => v.classList.add('shown'));
  if (still) {
    showStill(seat);
  } else {
    scene.markSeats(hs.selected, hs.compare);
    scene.setSpectators(taken, state.showSpectators);
    scene.setExtended(state.extended !== false);
    scene.start();
    await scene.flyFromPlan(planRectForCanvas(), seat);
  }
  state.busy = false;
  v.classList.add('settled');
  bridge.opened(bookingSeat(seat.id));
  ($('#tryScreenXCompare') || $('#back')).focus({ preventScroll: true });
  applyPendingSession();
}

function showStill(seat) {
  renderStill($('#stillPreview'), seat, layout, projectionMissing);
}

async function backToPlan() {
  if (state.busy || !state.in3d) return;
  state.busy = true;
  const v = $('#view3d');
  const returnedSeat = bookingSeat(previewedSeat.id);
  const origin = roomComparison?.origin;
  v.classList.remove('settled');
  if (origin && origin.layout.hall.id !== state.hallId) {
    // Pendant le fondu, réaffiche le plan d’origine avec sa vue mémorisée.
    selectHall(origin.layout.hall.id, { fromPreview: true });
  } else if (!still) {
    await scene.flyToPlan(planRectForCanvas());
  }
  v.classList.remove('shown');
  if (!$('#noMotion').checked && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await new Promise((r) => setTimeout(r, 320));
  }
  v.hidden = true;
  scene?.stop();
  $('#app').inert = false;
  state.in3d = false;
  state.busy = false;
  roomComparison = null;
  if (origin) {
    state.active = origin.active;
    state.screenXTrial = origin.screenXTrial;
  }
  const hs = hallState();
  plan.setStates({ taken, selected: hs.selected, compare: hs.compare });
  updateBar();
  bridge.returned(returnedSeat);
  $(state.pickingB ? '#pickCancel' : '#reopen')?.focus({ preventScroll: true });
  applyPendingSession();
}

// ---------------------------------------------------------------- comparaison
async function setCompare(seatB, from3d) {
  $('#tapZoomHint').textContent = '';
  const hs = hallState();
  hs.compare = seatB.id;
  bridge.compared({ ...bookingSeat(hs.selected), comparisonSeatId: seatB.id });
  plan.setStates({ taken, selected: hs.selected, compare: hs.compare });
  state.active = 'B';
  if (from3d && state.in3d) {
    await moveToSeat(seatB, true);
  } else {
    updateBar();
    await openPreview(seatB);
  }
}

async function switchTo(which) {
  const hs = hallState();
  if (state.busy || which === state.active) return;
  const seat = seatById(which === 'A' ? hs.selected : hs.compare);
  if (!seat) return;
  state.active = which;
  await moveToSeat(seat);
}

async function moveToSeat(seat, mark = false) {
  const hs = hallState();
  if (mark && !still) scene.markSeats(hs.selected, hs.compare);
  previewedSeat = seat;
  renderSheet(seat);
  state.busy = true;
  if (still) showStill(seat);
  else await scene.flyToSeat(seat);
  state.busy = false;
  applyPendingSession();
}

function comparableHalls() {
  const origin = roomComparison?.origin.layout || layout;
  if (bridge.embedded || !COMPARABLE_HALLS.some((hall) => hall.kind === origin.model.kind) ||
      findHall(origin.hall.id).cinema.id !== 'demo') return [];
  return COMPARABLE_HALLS.map((hall) =>
    hall.kind === origin.model.kind ? { ...hall, id: origin.hall.id } : hall);
}

async function compareHall(hallId) {
  if (state.busy || !state.in3d) return;
  if (hallId === state.hallId) {
    state.compact = true;
    renderSheet(previewedSeat);
    $('#roomComparison summary')?.focus({ preventScroll: true });
    return;
  }
  const origin = roomComparison?.origin || {
    seat: previewedSeat,
    layout,
    active: state.active,
    screenXTrial: state.screenXTrial,
  };
  const returning = hallId === origin.layout.hall.id;
  const result = returning
    ? { seat: origin.seat, exact: true }
    : findComparableSeat(origin.seat, origin.layout, computeLayout(findHall(hallId).hall));
  if (!result) return;

  state.busy = true;
  selectHall(hallId, { fromPreview: true });
  state.compact = true;
  roomComparison = returning ? null : { origin, exact: result.exact };
  if (returning) {
    state.active = origin.active;
    state.screenXTrial = origin.screenXTrial;
  }
  previewedSeat = result.seat;
  await preparePreviewHall();
  renderSheet(previewedSeat);
  if (still) {
    showStill(previewedSeat);
  } else {
    const hs = hallState();
    scene.markSeats(returning ? hs.selected : null, returning ? hs.compare : null);
    scene.setSpectators(taken, state.showSpectators);
    scene.setExtended(state.extended !== false);
    scene.start();
    scene.snapToSeat(previewedSeat);
  }
  state.busy = false;
  $('#roomComparison summary')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- fiche 3D
function metricCells(m) {
  const side = m.offset < -0.05 ? ' à gauche' : m.offset > 0.05 ? ' à droite' : '';
  const cells = [
    ['Distance au centre de l’écran', `${fmt(m.dist)} m`],
    ['Angle horizontal du frontal', `${Math.round(m.hfov)}°`],
    ['Écart à l’axe', `${fmt(Math.abs(m.offset))} m${side}`],
    ['Angle vers le haut de l’écran', `${fmt(m.tilt)}°`],
  ];
  if (m.total) cells.push(['Champ avec les côtés', `${Math.round(m.total)}°`]);
  return cells;
}

function renderSheet(seat) {
  const { cinema, hall } = findHall(state.hallId);
  const hs = hallState();
  const m = seatMetrics(seat, layout);
  const cmp = roomComparison ? null : seatById(hs.compare);
  const sel = roomComparison ? null : seatById(hs.selected);
  $('#ctxCinema').textContent = `${cinema.name} · ${hall.label}`;
  $('#ctxSeat').textContent = `Rang ${seat.row} · Place ${seat.num}`;
  const comparable = $('#ctxComparable');
  comparable.textContent = roomComparison && !roomComparison.exact
    ? `Place comparable à ${roomComparison.origin.seat.id}`
    : '';
  comparable.hidden = !comparable.textContent;

  const sx = $('#sxToggle');
  sx.hidden = still || !hall.model.sides;
  sx.querySelectorAll('[data-sx]').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.sx === '1') === (state.extended !== false)));

  const blocked = m.sightlines?.blocked;
  const trialSeat = state.screenXTrial && seat.id === SCREENX_TRIAL.first && !cmp
    ? seatById(SCREENX_TRIAL.second) : null;
  const compareTrial = trialSeat && !taken.has(trialSeat.id);
  const halls = comparableHalls();
  const roomOptions = halls.length ? `<details id="roomComparison" class="room-comparison">
    <summary>Même place, autre salle</summary>
    <div class="seg" role="group" aria-label="Comparer les salles">
      ${halls.map(({ id, label }) => `<button type="button" data-compare-hall="${id}" aria-pressed="${id === state.hallId}">${label}</button>`).join('')}
    </div>
    <p class="note">${roomComparison
      ? roomComparison.exact ? `Même rang et numéro · ${seat.id}` : `Place comparable à ${roomComparison.origin.seat.id} · ${seat.id}`
      : 'Même rang et numéro quand la place existe.'}</p>
  </details>` : '';
  const spectatorButton = still ? '' : `<button type="button" class="btn ghost" id="toggleSpectators"
    aria-pressed="${state.showSpectators}">Spectateurs simulés</button>`;
  let measures = `<div class="metrics">${metricCells(m).map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`).join('')}</div>`;
  let comparison = '';
  if (cmp && sel) {
    const ca = metricCells(seatMetrics(sel, layout));
    const cb = metricCells(seatMetrics(cmp, layout));
    comparison = `<div class="seg ab" role="group" aria-label="Basculer entre les deux places">
      <button type="button" data-ab="A" aria-pressed="${state.active === 'A'}"><i class="k a"></i>A · ${sel.id}</button>
      <button type="button" data-ab="B" aria-pressed="${state.active === 'B'}"><i class="k b"></i>B · ${cmp.id}</button></div>`;
    measures = `<table class="cmp" aria-label="Mesures des places A et B">
      <thead><tr><th scope="col">Mesure</th><td>A · ${sel.id}</td><td>B · ${cmp.id}</td></tr></thead>
      <tbody>${ca.map(([label, value], i) => `<tr><th scope="row">${label}</th>
        <td class="${state.active === 'A' ? 'on' : ''}">${value}</td>
        <td class="${state.active === 'B' ? 'on' : ''}">${cb[i][1]}</td></tr>`).join('')}</tbody>
      </table><p class="note">Les deux places utilisent la même focale.</p>`;
  }

  const sheet = $('#sheet');
  sheet.innerHTML = `${blocked ? '<p class="visibility">Vue partiellement masquée dans le modèle</p>' : ''}
    ${comparison}
    <div class="sheet-controls${compareTrial ? ' trial-controls' : roomComparison && still ? ' one-control' : ''}">
      <button type="button" class="btn ghost sheet-toggle" id="sheetHandle" aria-controls="sheetDetail" aria-expanded="${!state.compact}">
        Mesures <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5"/></svg></button>
      ${roomComparison ? spectatorButton : compareTrial
        ? '<button type="button" class="btn primary" id="tryScreenXCompare">Comparer avec I10 au centre</button>'
        : `<button type="button" class="btn ghost" id="cmpBtn" aria-controls="cmpChoices" aria-expanded="false">${cmp ? 'Changer la place B' : 'Comparer deux places'}</button>`}
    </div>
    <div class="preview-tools"${still && !roomOptions ? ' hidden' : ''}>
      ${roomComparison ? '' : spectatorButton}
      ${roomOptions}
      ${still ? '' : `<p class="note" id="spectatorNote"${state.showSpectators ? '' : ' hidden'}>Silhouettes de taille indicative aux places prises.</p>`}
    </div>
    <div class="sheet-detail" id="sheetDetail">
      <h2>Vue estimée depuis ${seat.id}</h2>
      <p class="sub">Plan illustratif · ${euro(hall.model.price)} (tarif démo)</p>
      ${measures}
    </div>
    <div class="cmp-choices" id="cmpChoices" hidden></div>
    ${bridge.embedded ? '<button type="button" class="btn primary" id="confirmPreview">Choisir cette place</button>' : ''}`;
  sheet.classList.toggle('compact', state.compact);
  $('#sheetHandle').onclick = () => {
    state.compact = !state.compact;
    sheet.classList.toggle('compact', state.compact);
    $('#sheetHandle').setAttribute('aria-expanded', !state.compact);
  };
  updateInsets();
  if (bridge.embedded) $('#confirmPreview').onclick = () => {
    if (!state.busy) bridge.confirmed(bookingSeat(seat.id));
  };

  sheet.querySelectorAll('[data-ab]').forEach((b) => (b.onclick = () => switchTo(b.dataset.ab)));
  sheet.querySelectorAll('[data-compare-hall]').forEach((b) => {
    b.onclick = () => compareHall(b.dataset.compareHall);
  });
  if (!still) {
    $('#toggleSpectators').onclick = (event) => {
      if (state.busy) return;
      state.showSpectators = !state.showSpectators;
      scene.setSpectators(taken, state.showSpectators);
      event.currentTarget.setAttribute('aria-pressed', state.showSpectators);
      $('#spectatorNote').hidden = !state.showSpectators;
    };
  }
  if (roomComparison) return;
  if (compareTrial) {
    $('#tryScreenXCompare').onclick = async () => {
      if (state.busy) return;
      await setCompare(trialSeat, true);
      ($('.view3d.immersive') ? $('#immersiveToggle') : $('[data-ab="B"]'))?.focus({ preventScroll: true });
    };
    return;
  }
  $('#cmpBtn').onclick = () => {
    if (state.busy) return;
    const box = $('#cmpChoices');
    box.hidden = !box.hidden;
    $('#cmpBtn').setAttribute('aria-expanded', !box.hidden);
    if (box.hidden) return;
    const sug = suggestCentral(layout, (id) => taken.has(id), hs.selected);
    box.innerHTML = `${sug ? `<button type="button" class="btn primary" id="cmpSuggest">Place centrale suggérée · ${sug.id}</button>` : ''}
      <button type="button" class="btn ghost" id="cmpPick">Choisir sur le plan</button>`;
    const s = $('#cmpSuggest');
    if (s) s.onclick = () => { if (!state.busy) setCompare(sug, true); };
    $('#cmpPick').onclick = async () => {
      if (state.busy) return;
      state.pickingB = true;
      state.active = 'A';
      await backToPlan();
    };
  };
}

function setImmersive(enabled) {
  $('#view3d').classList.toggle('immersive', enabled);
  const toggle = $('#immersiveToggle');
  const label = enabled ? 'Afficher les commandes' : 'Masquer les commandes';
  toggle.setAttribute('aria-expanded', String(!enabled));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  toggle.querySelector('.immersive-label').textContent = enabled ? 'Commandes' : label;
}

function updateInsets() {
  if (!scene || still) return;
  if ($('.view3d.immersive')) {
    scene.setInsets(0, 0);
    return;
  }
  const hud = $('.hud').getBoundingClientRect();
  const toggle = $('#sxToggle');
  const mobile = matchMedia('(max-width: 760px)').matches;
  scene.setInsets(mobile && !toggle.hidden ? toggle.getBoundingClientRect().bottom : hud.bottom, mobile ? 68 : 120);
}

$('#sxToggle').querySelectorAll('[data-sx]').forEach((b) => (b.onclick = () => {
  state.extended = b.dataset.sx === '1';
  scene.setExtended(state.extended);
  $('#sxToggle').querySelectorAll('[data-sx]').forEach((x) => x.setAttribute('aria-pressed', x === b));
}));
window.addEventListener('resize', () => {
  if (!state.in3d) return;
  if (still) showStill(previewedSeat);
  else updateInsets();
});

// ---------------------------------------------------------------- liaisons
$('#back').onclick = () => backToPlan();
$('#immersiveToggle').onclick = () => {
  if (!state.in3d || state.busy) return;
  setImmersive(!$('.view3d.immersive'));
  updateInsets();
};
$('#recenter').onclick = () => scene && scene.recenter();
$('#zoomIn').onclick = () => plan.zoomBy(1.6);
$('#zoomOut').onclick = () => plan.zoomBy(1 / 1.6);
$('#zoomFit').onclick = $('#screenKey').onclick = () => {
  $('#tapZoomHint').textContent = '';
  plan.reset();
};
$('#tryScreenX').onclick = tryScreenX;
const sheetToggle = $('#planSheet');
let sheetDrag = null;
let lastSheetSwipe = -Infinity;
sheetToggle.onpointerdown = (event) => {
  if (event.pointerType !== 'touch') return;
  sheetDrag = { id: event.pointerId, y: event.clientY };
  sheetToggle.setPointerCapture(event.pointerId);
};
sheetToggle.onpointerup = (event) => {
  if (sheetDrag?.id !== event.pointerId) return;
  const delta = event.clientY - sheetDrag.y;
  sheetDrag = null;
  if (Math.abs(delta) < 25) return;
  lastSheetSwipe = performance.now();
  setPlanSheet(delta < 0);
};
sheetToggle.onpointercancel = () => { sheetDrag = null; };
sheetToggle.onclick = () => {
  if (performance.now() - lastSheetSwipe > 350) setPlanSheet(sheetToggle.getAttribute('aria-expanded') !== 'true');
};
const seatPickerDialog = $('#seatPickerDialog');
const seatFields = $('.seat-fields');
const seatPickerTrigger = $('#openSeatPicker');
const seatPickerMobile = matchMedia('(max-width: 760px)');
function closeSeatPicker() {
  if (!seatPickerDialog.open) return;
  seatPickerDialog.close();
  $('#seatPickerInline').append(seatFields);
  (seatPickerMobile.matches ? seatPickerTrigger : $('#rowPicker')).focus({ preventScroll: true });
}
seatPickerTrigger.onclick = () => {
  if (!layout || !seatPickerMobile.matches || seatPickerDialog.open) return;
  setPlanSheet(false);
  seatPickerDialog.append(seatFields);
  seatPickerDialog.showModal();
  $('#rowPicker').focus({ preventScroll: true });
};
$('#closeSeatPicker').onclick = closeSeatPicker;
seatPickerDialog.oncancel = (event) => {
  event.preventDefault();
  closeSeatPicker();
};
seatPickerMobile.addEventListener('change', (event) => {
  if (!event.matches) closeSeatPicker();
});
$('#rowPicker').onchange = (event) => renderSeatPicker(event.target.value);
$('#seatPicker').onchange = (event) => {
  const seat = seatById(event.target.value);
  if (!seat) return;
  closeSeatPicker();
  plan.centerOn(seat);
  onSeatTap(seat);
  if (!state.in3d) $('#reopen')?.focus({ preventScroll: true });
};
$('#pmrOnly').onchange = (event) => {
  $('#plan').classList.toggle('pmr-only', event.target.checked);
  renderSeatPicker();
};
$('#noMotion').onchange = (event) => document.body.classList.toggle('no-motion', event.target.checked);
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || seatPickerDialog.open) return;
  if (state.in3d) backToPlan();
  else setPlanSheet(false);
});

renderShowtimes();
if (bridge.embedded) {
  $('#hallName').textContent = 'Chargement de la séance…';
  $('#planArea').hidden = true;
} else {
  selectHall(state.hallId);
  const seat = seatById(params.get('place')?.toUpperCase());
  if (seat && !taken.has(seat.id)) onSeatTap(seat);
}

// Accès pour les tests automatisés
window.__demo = {
  state,
  get layout() { return layout; },
  get taken() { return taken; },
  get scene() { return scene; },
  plan,
  seatPoint: (id) => plan.screenOf(layout.byId.get(id)),
  pitch: () => layout.model.seat.width * plan.view.s,
};

