if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const installTip = document.getElementById('installTip');
if (installTip && isIOS && !isStandalone && localStorage.getItem('moody-install-tip') !== 'hidden') {
  installTip.hidden = false;
  document.getElementById('closeInstallTip')?.addEventListener('click', () => {
    installTip.hidden = true;
    localStorage.setItem('moody-install-tip', 'hidden');
  });
}
