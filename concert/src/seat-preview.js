// Module « Voir depuis ma place » à intégrer dans une billetterie.
//
//   const preview = mountSeatPreview(container, {
//     venue,                         // configuration de salle (loadVenue)
//     availability: { takenSeatIds },// disponibilités fournies par la billetterie
//     categoryOf, categories,        // catégories et tarifs (ici simulés)
//     context: { title, subtitle },
//     initialSeatId,                 // facultatif
//     onSelect(seatId),              // renvoie l'identifiant du siège choisi
//     onCancel(),
//   });
//
// La 3D n'est chargée qu'à l'ouverture d'un aperçu (import dynamique).

import { SeatPlan } from './plan.js';
import { ZONES, seatLabel, zoneLabel, seatMetrics, obstructions } from './venue.js';
import { drawFixedView } from './fallback.js';

const fmt = (n, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
};

export function choosePresets(venue, taken = new Set(), excludedId = null) {
  const pick = (filter, score) => venue.seats.filter(filter).sort((a, b) => score(a) - score(b))[0];
  const references = [
    { key: 'proche', label: 'Proche · centre', reference: pick((s) => s.zone === 'parterre' && s.row === 3, (s) => Math.abs(s.x)) },
    { key: 'lateral', label: 'Latéral', reference: pick((s) => s.block === 'P' && s.row === 27 && s.tier === 'gradin1', (s) => -s.x) },
    { key: 'haut', label: 'En hauteur', reference: pick((s) => s.block === 'H' && s.row === 63, (s) => Math.abs(s.x + 3)) },
  ];
  return references.flatMap(({ key, label, reference }) => {
    if (!reference) return [];
    let seat = null, best = Infinity;
    for (const candidate of venue.seats) {
      if (candidate.tier !== reference.tier || candidate.pmr || candidate.companion ||
          candidate.id === excludedId || taken.has(candidate.id)) continue;
      const distance = Math.hypot(candidate.x - reference.x, candidate.y - reference.y, candidate.z - reference.z);
      if (distance < best) { seat = candidate; best = distance; }
    }
    if (!seat) return [];
    const position = key === 'lateral' ? `bloc ${seat.block}` : `rang ${seat.row}`;
    return [{ key, label, seat, hint: `${zoneLabel(seat)}, ${position}` }];
  });
}

export function mountSeatPreview(root, opts) {
  const { venue, categoryOf, categories, context = {}, onPreviewSeatChange, onSelect, onCancel } = opts;
  let taken = new Set(opts.availability?.takenSeatIds || []);
  const params = new URLSearchParams(location.search);
  const forceFixed = params.get('vue') === 'fixe';
  const state = {
    selected: null, compare: null, active: 'A', zone: null, category: null,
    tourGear: true, audience: true, noMotion: matchMedia('(prefers-reduced-motion: reduce)').matches || localStorageGet('noMotion') === '1',
  };
  document.documentElement.classList.toggle('no-motion', state.noMotion);
  // ----- squelette -----------------------------------------------------------
  root.textContent = '';
  root.classList.add('sp');
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite', id: 'spLive' });
  const back = h('button', { type: 'button', class: 'sp-back', onclick: () => onCancel?.() }, h('span', { 'aria-hidden': 'true' }, '‹'), ' Dates');
  const head = h('header', { class: 'sp-head' },
    back,
    h('div', { class: 'sp-title' }, h('strong', {}, context.title || ''), h('span', {}, context.subtitle || '')),
    h('span', { class: 'sp-sim', title: 'Tarifs et disponibilités simulés pour la démonstration' }, 'Démo · simulé'),
  );
  const zoneBar = h('nav', { class: 'sp-zones', 'aria-label': 'Accès rapide aux zones' },
    h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', 'data-zone': '', onclick: () => goZone(null) }, 'Toute la salle'),
    ...ZONES.map((z) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-zone': z.id, onclick: () => goZone(z.id) }, z.short)),
  );
  const presetList = h('div', { class: 'sp-preset-list' });
  const presetBar = h('section', { class: 'sp-presets', 'aria-label': 'Vues depuis des places libres' },
    h('h2', { class: 'sp-h' }, 'Vues à comparer'),
    presetList,
  );
  renderPresets();
  const planBox = h('div', { class: 'sp-plan', id: 'spPlan' });
  const zoomBox = h('div', { class: 'sp-zoom', role: 'group', 'aria-label': 'Zoom du plan' },
    h('button', { type: 'button', 'aria-label': 'Zoomer', onclick: () => plan.zoomBy(1.5) }, '+'),
    h('button', { type: 'button', 'aria-label': 'Dézoomer', onclick: () => plan.zoomBy(1 / 1.5) }, '−'),
    h('button', { type: 'button', 'aria-label': 'Plan entier', class: 'fit', onclick: () => { goZone(null); } }, '⤢'),
  );
  const legend = h('ul', { class: 'sp-legend', 'aria-label': 'Légende et tarifs simulés' },
    ...Object.entries(categories).map(([k, c]) => h('li', {},
      h('button', { type: 'button', class: 'cat', 'aria-pressed': 'false', 'data-cat': k, onclick: () => toggleCategory(k) },
        h('i', { style: `background:${c.color}`, 'aria-hidden': 'true' }), `${c.label} `, h('b', {}, `${c.price} €`)))),
    h('li', {}, h('span', { class: 'cat static' }, h('i', { class: 'taken', 'aria-hidden': 'true' }), 'Vendue')),
    h('li', {}, h('span', { class: 'cat static' }, h('i', { style: 'background:#3d8bff', 'aria-hidden': 'true' }), 'PMR')),
  );
  const hint = h('p', { class: 'sp-hint', id: 'spHint', hidden: true }, 'Touchez la place B à comparer.');
  const sheet = h('section', { class: 'sp-sheet', 'aria-label': 'Place sélectionnée', 'aria-live': 'off' });
  const picker = buildPicker();
  const motionToggle = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', id: 'spNoMotion', ...(state.noMotion ? { checked: true } : {}), onchange: (e) => setNoMotion(e.target.checked) }), ' Sans animation');
  const main = h('div', { class: 'sp-main' },
    h('div', { class: 'sp-planwrap' }, planBox, zoomBox, hint),
    h('aside', { class: 'sp-side' }, presetBar, h('div', { class: 'sp-drawer' },
      context.subtitle ? h('p', { class: 'sp-side-date' }, context.subtitle) : null, sheet, legend,
      h('details', { class: 'sp-more' }, h('summary', {}, 'Plus d’options'), picker, motionToggle))),
  );
  root.append(live, head, zoneBar, main);

  // ----- vue 3D (calque plein écran) ----------------------------------------------
  const v3 = buildViewLayer();
  root.append(v3.el);
  const shareStatus = v3.el.querySelector('#v3ShareStatus');
  v3.el.querySelector('#v3Share').addEventListener('click', shareActiveView);
  v3.el.querySelector('#v3Export').addEventListener('click', exportActiveView);

  const plan = new SeatPlan(planBox, venue, {
    categoryOf, categories,
    onSeat: (s, how) => {
      const pickingB = state.pickingB;
      select(s);
      if (how?.keyboard && !pickingB) openPreview(s);
    },
    onFocusSeat: (s) => announce(describe(s, true)),
  });
  plan.setState({ taken });

  if (opts.initialSeatId && venue.byId.get(opts.initialSeatId)) {
    const s = venue.byId.get(opts.initialSeatId);
    select(s, { silent: true });
    if (!opts.initialView) plan.centerOn(s, 14);
  }
  if (opts.initialView) plan.setView(opts.initialView);
  renderSheet();

  // ----- comportements ------------------------------------------------------------
  function announce(t) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = t; }); }

  function renderPresets() {
    const presets = choosePresets(venue, taken, state.pickingB ? state.selected : null);
    presetBar.hidden = !presets.length;
    presetList.replaceChildren(...presets.map((p) => h('button', {
      type: 'button', class: 'preset', 'data-preset': p.key,
      'aria-label': `Vue ${p.label} : ${seatLabel(p.seat)}`,
      onclick: () => {
        const pickingB = state.pickingB;
        select(p.seat, { silent: true });
        if (!pickingB) openPreview(p.seat);
      },
    }, h('span', { class: `preset-ico ico-${p.key}`, 'aria-hidden': 'true' }),
    h('span', { class: 'preset-t' }, p.label), h('span', { class: 'preset-s' }, p.hint))));
  }

  function describe(s, short = false) {
    const st = taken.has(s.id) ? 'vendue' : 'libre';
    const c = categories[categoryOf(s)];
    const m = seatMetrics(venue, s);
    const base = `${seatLabel(s)}, ${zoneLabel(s)}, ${st}`;
    return short ? base : `${base}, ${c.label} ${c.price} euros, à ${fmt(m.dist)} mètres de l'artiste.`;
  }

  function goZone(id) {
    state.zone = id;
    zoneBar.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.zone || null) === id)));
    if (!id) { plan.fit(); return; }
    plan.frameSeats(venue.seats.filter((s) => s.tier === id));
    announce(`${ZONES.find((z) => z.id === id).label} affiché.`);
  }

  function toggleCategory(k) {
    state.category = state.category === k ? null : k;
    legend.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === state.category)));
    plan.setState({ category: state.category });
  }

  function select(s, { silent = false } = {}) {
    if (state.pickingB) {
      if (s.id === state.selected) { announce('Choisissez une autre place que la place A.'); return; }
      state.pickingB = false;
      hint.hidden = true;
      renderPresets();
      state.compare = s.id;
      plan.setState({ compare: s.id });
      openPreview(venue.byId.get(state.selected), 'B');
      return;
    }
    state.selected = s.id;
    if (state.compare === s.id) state.compare = null;
    plan.setState({ selected: s.id, compare: state.compare, focus: s.id });
    renderSheet();
    syncPicker(s);
    onPreviewSeatChange?.(s.id);
    if (!silent) announce(describe(s));
  }

  function renderSheet() {
    sheet.textContent = '';
    const s = venue.byId.get(state.selected);
    if (!s) {
      sheet.append(h('p', { class: 'sp-seat-help' }, 'Zoomez sur le plan pour choisir un siège.'));
      return;
    }
    const m = seatMetrics(venue, s);
    const c = categories[categoryOf(s)];
    const isTaken = taken.has(s.id);
    const mk = obstructions(venue, s, { tourGear: state.tourGear });
    sheet.append(...[
      h('div', { class: 'seat-id' }, h('span', { class: 'pill' }, 'A'), h('strong', {}, seatLabel(s))),
      h('p', { class: 'seat-meta' }, `${zoneLabel(s)} · `, h('span', { style: `color:${c.color}` }, `${c.label} · ${c.price} € démo`), isTaken ? h('span', { class: 'sold' }, ' · Vendue') : null),
      h('dl', { class: 'facts' },
        h('div', {}, h('dt', {}, 'Artiste'), h('dd', {}, `${fmt(m.dist)} m`)),
        h('div', {}, h('dt', {}, 'Hauteur d’œil'), h('dd', {}, `${m.eyeAboveStage >= 0 ? '+' : ''}${fmt(m.eyeAboveStage, 1)} m / scène`)),
        h('div', {}, h('dt', {}, 'Tête à tourner'), h('dd', {}, `${fmt(Math.abs(m.turn))}°`)),
      ),
      maskText(mk) ? h('p', { class: 'warn' }, maskText(mk)) : null,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', id: 'spOpen', onclick: () => openPreview(s) }, 'Voir depuis cette place'),
        h('button', { type: 'button', class: 'btn ghost', id: 'spConfirm', disabled: isTaken, onclick: () => confirm(s) }, isTaken ? 'Place vendue' : 'Choisir'),
      ),
    ].filter(Boolean));
  }

  function confirm(s) {
    if (taken.has(s.id)) return;
    announce(`${seatLabel(s)} choisie.`);
    onSelect?.(s.id);
  }

  async function shareActiveView() {
    const seat = currentSeat();
    if (!seat) return;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('etape', 'place');
    url.searchParams.set('place', seat.id);
    url.searchParams.set('apercu', '1');
    if (context.showtimeId) url.searchParams.set('seance', context.showtimeId);
    if (forceFixed) url.searchParams.set('vue', 'fixe');
    const title = `${context.title || 'Aperçu de place'} · ${seatLabel(seat)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url: url.href });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url.href);
      shareStatus.textContent = 'Lien de la place copié.';
    } catch {
      const field = h('input', { type: 'url', readonly: true, value: url.href, 'aria-label': 'Lien de la place à copier' });
      shareStatus.replaceChildren('Copiez le lien de la place.', field);
      field.focus({ preventScroll: true });
      field.select();
    }
  }

  function exportActiveView() {
    const seat = currentSeat();
    const source = v3.fixed ? v3.still : v3.canvas;
    if (!seat || !source.width || !source.height) return;
    try {
      // Lecture dans la même tâche que le rendu, même avec le tampon WebGL éphémère.
      if (v3.view) v3.view.renderer.render(v3.view.scene, v3.view.camera);
      const image = document.createElement('canvas');
      const scale = Math.min(1, 1440 / Math.max(source.width, source.height));
      image.width = Math.round(source.width * scale);
      image.height = Math.round(source.height * scale);
      const ctx = image.getContext('2d');
      ctx.drawImage(source, 0, 0, image.width, image.height);
      const font = Math.max(12, Math.round(image.width / 46));
      const band = font * 3.2;
      ctx.fillStyle = '#10111bee';
      ctx.fillRect(0, image.height - band, image.width, band);
      ctx.fillStyle = '#ff9a88';
      ctx.font = `bold ${font}px system-ui`;
      ctx.fillText(`${context.title || 'Aperçu de place'} · VUE SIMULÉE`, font, image.height - font * 1.8, image.width - font * 2);
      ctx.fillStyle = '#f9f4ec';
      ctx.fillText(seatLabel(seat), font, image.height - font * 0.55, image.width - font * 2);
      h('a', { href: image.toDataURL('image/png'), download: `vue-${seat.id}.png` }).click();
      shareStatus.textContent = 'Image préparée pour le téléchargement.';
    } catch {
      shareStatus.textContent = 'L’image n’a pas pu être enregistrée. Le lien de la place reste disponible.';
    }
  }

  function setNoMotion(on) {
    state.noMotion = on;
    localStorageSet('noMotion', on ? '1' : '0');
    document.documentElement.classList.toggle('no-motion', on);
    v3.view?.setStill(on);
    v3.syncToggles();
  }

  // ----- choix au clavier / lecteur d'écran : bloc → rang → place ------------
  function buildPicker() {
    const blockSel = h('select', { id: 'spBlock' });
    const rowSel = h('select', { id: 'spRow' });
    const seatSel = h('select', { id: 'spSeat' });
    const go = h('button', { type: 'button', class: 'btn', id: 'spPickGo', onclick: () => { const s = venue.byId.get(seatSel.value); if (s) { select(s); plan.centerOn(s, 14); } } }, 'Afficher');
    const keys = [...new Set(venue.blocks.map((b) => `${b.block}|${b.tier}`))];
    for (const k of keys) {
      const [b, t] = k.split('|');
      blockSel.append(h('option', { value: k }, `Bloc ${b} · ${ZONES.find((z) => z.id === t).short}`));
    }
    const fillRows = () => {
      const [b, t] = blockSel.value.split('|');
      const rows = [...new Set(venue.seats.filter((s) => s.block === b && s.tier === t).map((s) => s.row))]
        .sort((a, c) => (typeof a === 'number' ? a : 999) - (typeof c === 'number' ? c : 999));
      rowSel.textContent = '';
      for (const r of rows) rowSel.append(h('option', { value: r }, r === 'PMR' ? 'Fauteuil roulant' : r === 'AC' ? 'Accompagnateur' : `Rang ${r}`));
      fillSeats();
    };
    const fillSeats = () => {
      const [b, t] = blockSel.value.split('|');
      seatSel.textContent = '';
      venue.seats.filter((s) => s.block === b && s.tier === t && String(s.row) === rowSel.value).sort((a, c) => a.num - c.num)
        .forEach((s) => seatSel.append(h('option', { value: s.id }, `Place ${s.num}${taken.has(s.id) ? ' (vendue)' : ''}`)));
    };
    blockSel.addEventListener('change', fillRows);
    rowSel.addEventListener('change', fillSeats);
    fillRows();
    const box = h('details', { class: 'sp-picker' },
      h('summary', {}, 'Choisir par bloc, rang et place'),
      h('div', { class: 'fields' },
        h('label', {}, 'Bloc', blockSel), h('label', {}, 'Rang', rowSel), h('label', {}, 'Place', seatSel), go));
    box._sync = (s) => {
      blockSel.value = `${s.block}|${s.tier}`; fillRows();
      rowSel.value = String(s.row); fillSeats(); seatSel.value = s.id;
    };
    return box;
  }
  function syncPicker(s) { picker._sync?.(s); }

  // ----- calque 3D -------------------------------------------------------------
  function buildViewLayer() {
    const canvas = h('canvas', { class: 'v3-canvas', 'aria-label': 'Vue depuis la place. Glissez ou utilisez les flèches pour regarder autour.', tabindex: '0', role: 'img' });
    const still = h('canvas', { class: 'v3-canvas v3-still', hidden: true, 'aria-hidden': 'true' });
    const fade = h('div', { class: 'v3-fade', 'aria-hidden': 'true' });
    const label = h('div', { class: 'v3-label', 'aria-live': 'polite' });
    const abA = h('button', { type: 'button', class: 'ab', 'data-ab': 'A', 'aria-pressed': 'true', onclick: () => showSide('A') });
    const abB = h('button', { type: 'button', class: 'ab', 'data-ab': 'B', 'aria-pressed': 'false', onclick: () => showSide('B') });
    const abBox = h('div', { class: 'v3-ab', role: 'group', 'aria-label': 'Comparer deux places' }, abA, abB);
    const cmpMenu = h('div', { class: 'v3-cmp', hidden: true, id: 'v3CmpMenu' });
    const renderComparePresets = () => {
      cmpMenu.replaceChildren(h('p', {}, 'Comparer avec :'),
        ...choosePresets(venue, taken, state.selected).map((p) => h('button', {
          type: 'button', class: 'btn small', 'data-cmp': p.key,
          'aria-label': `Comparer avec ${p.label.toLowerCase()}, ${seatLabel(p.seat)}`,
          onclick: () => setCompare(p.seat),
        }, p.label)),
        h('button', { type: 'button', class: 'btn small', onclick: () => pickOnPlan() }, 'Une place du plan'));
    };
    const cmpBtn = h('button', {
      type: 'button', class: 'btn small', id: 'v3Compare', 'aria-expanded': 'false', 'aria-controls': 'v3CmpMenu',
      onclick: () => {
        if (cmpMenu.hidden) renderComparePresets();
        cmpMenu.hidden = !cmpMenu.hidden;
        cmpBtn.setAttribute('aria-expanded', String(!cmpMenu.hidden));
      },
    }, 'Comparer');
    const tg = h('input', { type: 'checkbox', checked: true, onchange: (e) => { state.tourGear = e.target.checked; layer.view?.setTourGear(state.tourGear); refreshInfo(); } });
    const au = h('input', { type: 'checkbox', checked: true, onchange: (e) => { state.audience = e.target.checked; layer.view?.setAudience(taken, state.audience); } });
    const nm = h('input', { type: 'checkbox', onchange: (e) => { setNoMotion(e.target.checked); } });
    const info = h('div', { class: 'v3-info' });
    const choose = h('button', { type: 'button', class: 'btn primary', id: 'v3Choose', onclick: () => { const s = currentSeat(); if (s) { close(); select(s, { silent: true }); confirm(s); } } }, 'Choisir cette place');
    const closeBtn = h('button', { type: 'button', class: 'v3-close', id: 'v3Back', 'aria-label': 'Retour au plan', onclick: () => close() }, '‹ Plan');
    const recenter = h('button', { type: 'button', class: 'v3-round', 'aria-label': 'Recentrer le regard sur l’artiste', onclick: () => layer.view?.recenter() }, '◎');
    const sum = h('p', { class: 'v3-sum', id: 'v3Sum' });
    const mask = h('p', { class: 'v3-mask', id: 'v3Mask', hidden: true, role: 'status' });
    const more = h('details', { class: 'v3-more' },
      h('summary', {}, 'Plus'),
      sum,
      info,
      h('div', { class: 'v3-opts' },
        h('label', { class: 'toggle' }, tg, ' Équipement de tournée'),
        h('label', { class: 'toggle' }, au, ' Public simulé'),
        h('label', { class: 'toggle' }, nm, ' Sans animation')),
      h('div', { class: 'v3-share' },
        h('button', { type: 'button', class: 'btn small', id: 'v3Share' }, 'Partager cette vue'),
        h('button', { type: 'button', class: 'btn small', id: 'v3Export' }, 'Enregistrer une image')),
      h('p', { class: 'v3-share-status', id: 'v3ShareStatus', 'aria-live': 'polite' }));
    const panel = h('div', { class: 'v3-panel' }, cmpMenu, more, h('div', { class: 'v3-row' }, cmpBtn, choose));
    const loading = h('div', { class: 'v3-loading', hidden: true }, 'Chargement de la salle…');
    const el = h('div', { class: 'v3', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vue depuis la place' },
      canvas, still, fade, loading,
      h('div', { class: 'v3-top' }, closeBtn, label, recenter),
      h('div', { class: 'v3-mid' }, abBox, mask),
      panel,
      h('p', { class: 'v3-fov' }, 'Champ horizontal 70° · hauteurs estimées'));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'c' || e.key === 'C') { if (state.compare) showSide(state.active === 'A' ? 'B' : 'A'); }
      else if (e.key === 'r' || e.key === 'R') layer.view?.recenter();
      else if (e.target === canvas && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = 0.08;
        layer.view?.lookBy(e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
      } else if (e.key === 'Tab') trapFocus(e, el);
    });
    const layer = {
      el, canvas, still, fade, view: null, fixed: false,
      syncToggles() { nm.checked = state.noMotion; },
      info, label, abA, abB, abBox, cmpMenu, cmpBtn, renderComparePresets, loading, sum, mask,
    };
    return layer;
  }

  function currentSeat() { return venue.byId.get(state.active === 'B' ? state.compare : state.selected); }

  let lastFocus = null;
  let viewTicket = 0;
  function hideCompare() {
    v3.cmpMenu.hidden = true;
    v3.cmpBtn.setAttribute('aria-expanded', 'false');
  }

  function planRectForCanvas() {
    const box = plan.canvas.getBoundingClientRect();
    const topLeft = plan.toWorld(-box.left, -box.top);
    const bottomRight = plan.toWorld(innerWidth - box.left, innerHeight - box.top);
    return { x0: topLeft.x, z0: topLeft.z, x1: bottomRight.x, z1: bottomRight.z };
  }

  async function openPreview(seat, side = 'A') {
    if (!seat || !v3.el.hidden || (side === 'B' && !state.compare)) return;
    if (side === 'A' && state.selected !== seat.id) select(seat, { silent: true });
    const ticket = ++viewTicket;
    const rect = planRectForCanvas();
    lastFocus = document.activeElement;
    v3.el.hidden = false;
    document.body.classList.add('v3-open');
    v3.syncToggles();
    state.active = side;
    hideCompare();
    if (!v3.view && !v3.fixed) {
      v3.el.classList.add('is-loading');
      v3.loading.hidden = false;
      try {
        if (forceFixed) throw new Error('vue fixe demandée');
        const mod = await import('./view3d.js');
        if (viewTicket !== ticket) return;
        if (!mod.webglAvailable()) throw new Error('WebGL indisponible');
        v3.view = new mod.SeatView3D(v3.canvas, venue, { taken, audience: state.audience, tourGear: state.tourGear });
        v3.view.setStill(state.noMotion);
        window.__view3d = v3.view;
      } catch (err) {
        if (viewTicket !== ticket) return;
        console.warn('[apercu] vue fixe de secours :', err.message);
        v3.fixed = true;
        v3.canvas.hidden = true; v3.still.hidden = false;
      }
      v3.loading.hidden = true;
      v3.el.classList.remove('is-loading');
    }
    v3.view?.setActive(true);
    showSide(side, { rect });
    (v3.fixed ? v3.el.querySelector('#v3Back') : v3.canvas).focus({ preventScroll: true });
  }

  function veilTo(opacity, duration) {
    const from = Number(v3.fade.style.opacity) || 0;
    v3.fade.style.opacity = String(opacity);
    const tween = v3.fade.animate([{ opacity: from }, { opacity }], { duration, easing: 'ease-in-out' });
    return tween.finished.catch(() => {});
  }

  async function showSide(side, { rect } = {}) {
    const s = venue.byId.get(side === 'B' ? state.compare : state.selected);
    if (!s || v3.el.hidden || v3.el.matches('.is-loading, .is-flying, .is-switching')) return;
    if (!rect && v3.view?.seat?.id === s.id) return;
    const ticket = viewTicket;
    const fade = !rect && !state.noMotion;
    if (fade) {
      v3.el.classList.add('is-switching');
      await veilTo(1, 100);
      if (ticket !== viewTicket) return;
    }
    state.active = side;
    v3.abA.setAttribute('aria-pressed', String(side === 'A'));
    v3.abB.setAttribute('aria-pressed', String(side === 'B'));
    v3.view?.setSeat(s);
    const flight = rect && v3.view?.flyFromPlan(rect);
    if (flight) v3.el.classList.add('is-flying');
    const warning = refreshInfo();
    announce(`Vue ${side} : ${describe(s)} ${warning}`);
    if (flight) {
      await flight;
      if (ticket === viewTicket) v3.el.classList.remove('is-flying');
    }
    if (fade) {
      await new Promise(requestAnimationFrame);
      if (ticket !== viewTicket) return;
      await veilTo(0, 140);
      if (ticket === viewTicket) v3.el.classList.remove('is-switching');
    }
  }

  function refreshInfo() {
    const s = currentSeat();
    if (!s) return;
    shareStatus.textContent = '';
    const A = venue.byId.get(state.selected), B = venue.byId.get(state.compare);
    v3.abBox.hidden = !(A && B);
    v3.cmpBtn.textContent = B ? 'Changer B' : 'Comparer';
    v3.label.textContent = `${state.active} · ${seatLabel(s)}`;
    const m = seatMetrics(venue, s);
    const mk = v3.view?.masks ?? obstructions(venue, s, { tourGear: state.tourGear });
    const c = categories[categoryOf(s)];
    v3.info.textContent = '';
    const cells = [
      ['Distance de l’artiste', `${fmt(m.dist)} m`],
      ['Taille apparente de l’artiste', `${fmt(m.artistDeg, 1)}°`],
      ['Œil / plateau', `${m.eyeAboveStage >= 0 ? '+' : ''}${fmt(m.eyeAboveStage, 1)} m`],
      ['Tarif simulé', `${c.price} € · ${c.label}`],
    ];
    if (B && A) {
      const mA = A === s ? m : seatMetrics(venue, A);
      const mB = B === s ? m : seatMetrics(venue, B);
      renderComparisonSeat(v3.abA, 'A', A, mA);
      renderComparisonSeat(v3.abB, 'B', B, mB);
      cells.push(['Écart A → B', `${mB.dist - mA.dist >= 0 ? '+' : ''}${fmt(mB.dist - mA.dist)} m`]);
    }
    v3.info.append(h('dl', { class: 'facts' }, ...cells.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))));
    const t = maskText(mk);
    v3.mask.hidden = !t;
    v3.mask.textContent = t ? `Vue simulée · visibilité à confirmer. ${t}` : '';
    v3.sum.textContent = `${fmt(m.dist)} m de l’artiste · ${zoneLabel(s)}`;
    if (taken.has(s.id)) v3.info.append(h('p', { class: 'muted' }, 'Place déjà vendue : aperçu seulement.'));
    const ch = v3.el.querySelector('#v3Choose');
    ch.disabled = taken.has(s.id);
    ch.textContent = taken.has(s.id) ? 'Place vendue' : 'Choisir cette place';
    if (v3.fixed) drawFixedView(v3.still, venue, s, { taken, tourGear: state.tourGear, masks: mk });
    return v3.mask.textContent;
  }

  function renderComparisonSeat(button, side, seat, metrics) {
    const { price } = categories[categoryOf(seat)];
    const distance = fmt(metrics.dist);
    button.replaceChildren(h('span', { class: 'ab-seat' }, `${side} · ${short(seat)}`),
      h('span', { class: 'ab-metrics' }, `${price} € démo · ${distance} m`));
    button.setAttribute('aria-label', `${side}, ${seatLabel(seat)}, ${price} euros au tarif démo, ${distance} mètres de l’artiste`);
  }

  function setCompare(seat) {
    if (v3.el.matches('.is-loading, .is-flying, .is-switching')) return;
    if (seat.id === state.selected) { announce('Cette place est déjà la place A.'); return; }
    state.compare = seat.id;
    plan.setState({ compare: seat.id });
    hideCompare();
    showSide('B');
  }

  function pickOnPlan() {
    state.pickingB = true;
    close();
    renderPresets();
    plan.canvas.focus({ preventScroll: true });
    hint.hidden = false;
    hint.textContent = 'Touchez la place B à comparer.';
    announce('Choisissez sur le plan la place B à comparer.');
  }

  function close() {
    if (v3.el.hidden) return;
    viewTicket++;
    v3.fade.getAnimations().forEach((animation) => animation.cancel());
    v3.fade.style.opacity = '0';
    v3.view?.setActive(false);
    v3.loading.hidden = true;
    v3.el.classList.remove('is-loading', 'is-flying', 'is-switching');
    v3.el.hidden = true;
    document.body.classList.remove('v3-open');
    (lastFocus && root.contains(lastFocus) && !v3.el.contains(lastFocus) ? lastFocus : plan.canvas).focus({ preventScroll: true });
  }

  return {
    destroy() { close(); plan.destroy(); v3.view?.dispose(); root.textContent = ''; },
    setAvailability(ids) {
      taken = new Set(ids);
      plan.setState({ taken });
      renderPresets();
      renderSheet();
      if (!v3.cmpMenu.hidden) v3.renderComparePresets();
      if (!v3.el.hidden && !v3.el.matches('.is-loading')) refreshInfo();
      v3.view?.setAudience(taken, state.audience);
    },
    open: (id, side) => openPreview(venue.byId.get(id), side),
    compare: (id) => { state.compare = id; plan.setState({ compare: id }); },
    close,
    plan,
    get state() { return { ...state }; },
  };
}

function short(s) { return s ? (s.pmr || s.companion ? `${s.block} ${s.row} ${s.num}` : `${s.block}·${s.row}·${s.num}`) : ''; }

export function maskText(mk) {
  if (mk?.nearMiss) return `Garde-corps à ${fmt(mk.nearMiss.margin * 100)} cm sous la ligne de vue estimée.`;
  if (!mk || (!mk.stage && !mk.artist)) return '';
  const both = mk.by.length > 1;
  const who = both ? 'Le garde-corps et la régie masquent' : mk.by[0] === 'régie' ? 'La régie masque' : 'Le garde-corps masque';
  if (mk.artist >= 0.99) return `${who} l’artiste depuis cette place.`;
  if (mk.artist > 0) return `${who} le bas de l’artiste (jusqu’à ${fmt(mk.artistMaskedBelow, 1)} m du plateau) et ${fmt(mk.stage * 100)} % de la scène.`;
  return `${who} ${fmt(mk.stage * 100)} % de la scène (avant-scène basse).`;
}

function trapFocus(e, el) {
  const f = [...el.querySelectorAll('button, [tabindex="0"], input, select')].filter((n) => !n.hidden && n.offsetParent !== null && !n.disabled);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function localStorageGet(k) { try { return localStorage.getItem(`concert-apercu.${k}`); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(`concert-apercu.${k}`, v); } catch { /* stockage indisponible */ } }
