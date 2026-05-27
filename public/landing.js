// Compteur live de l'uptime + horloge serveur sur la landing.
// Charge en externe (et non inline) pour respecter le CSP `script-src 'self'` pose par helmet.
(function () {
  var bootMs = Number(document.body.dataset.boot);
  var nowMs = Number(document.body.dataset.now);
  if (!bootMs || !nowMs) return;

  // Decalage horloge visiteur <-> serveur, mesure une fois au chargement.
  // Permet de rester sur l'heure serveur meme si l'horloge locale est desynchronisee.
  var offset = Date.now() - nowMs;

  var uptimeEl = document.getElementById('uptime');
  var timeEl = document.getElementById('time');

  var dtFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  function formatUptime(sec) {
    var total = Math.floor(sec);
    var d = Math.floor(total / 86400);
    var h = Math.floor((total % 86400) / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (d > 0 ? d + 'j ' : '') + h + 'h ' + m + 'm ' + s + 's';
  }

  function tick() {
    var serverNow = Date.now() - offset;
    if (uptimeEl) uptimeEl.textContent = formatUptime((serverNow - bootMs) / 1000);
    if (timeEl) timeEl.textContent = dtFmt.format(serverNow);
  }

  tick();
  setInterval(tick, 1000);
})();
