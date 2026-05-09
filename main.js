// Додати лог виходу з гри
window.addEventListener('beforeunload', function() {
  if (user && user.name) {
    const sessionTime = Math.floor((Date.now() - (window.loginTime || Date.now())) / 1000);
    if (typeof addLogoutLog === 'function') {
      addLogoutLog(user.name, sessionTime);
    }
  }
});

// Запам'ятати час входу
if (typeof user !== 'undefined' && user) {
  window.loginTime = Date.now();
}
