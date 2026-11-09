(() => {
  if (location.protocol !== 'file:') return;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'ouverture-locale.css';
  document.head.append(css);

  const main = document.createElement('main');
  main.className = 'local-start';
  main.innerHTML = `
    <h1>Ouvrir la démo d’aperçu de place</h1>
    <p id="local-status" role="status">Recherche du serveur local…</p>
    <p id="local-help" hidden>Dans l’Explorateur Windows, ouvrez le dossier du projet et double-cliquez sur <strong>Ouvrir la demo.cmd</strong>. Le lanceur démarre le serveur et ouvre la démo dans le navigateur.</p>
    <p id="local-hosting" hidden>Si vous avez extrait l’archive web, servez ses fichiers avec un serveur HTTP ou HTTPS.</p>`;
  document.body.replaceChildren(main);
  document.body.className = 'local-start-page';

  // La sonde charge uniquement une image. Elle n'exécute aucun code du port testé.
  const probe = (origin) => new Promise((resolve) => {
    const image = new Image();
    const timeout = setTimeout(() => resolve(false), 950);
    const done = (found) => {
      clearTimeout(timeout);
      resolve(found);
    };
    image.onload = () => done(image.naturalWidth === 2172 && image.naturalHeight === 724);
    image.onerror = () => done(false);
    image.src = origin + '/assets/passe-des-glaces.webp';
  });

  const origins = ['http://127.0.0.1:5180', 'http://127.0.0.1:5218'];
  Promise.all(origins.map(probe)).then((available) => {
    const origin = origins.find((_, i) => available[i]);
    if (origin) {
      const page = location.pathname.endsWith('/booking.html') ? '/booking.html' : '/';
      location.replace(origin + page + location.search + location.hash);
      return;
    }
    main.querySelector('#local-status').textContent = 'Le serveur de la démo est introuvable. Le navigateur a besoin d’une adresse HTTP pour charger le plan et la 3D.';
    main.querySelector('#local-help').hidden = false;
    main.querySelector('#local-hosting').hidden = false;
  });
})();

