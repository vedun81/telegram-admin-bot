// ========== ФУНКЦІЇ ДЛЯ ЛОГІВ ==========

// Функція додавання логу покупки
window.logPurchase = async function(itemName, price, newBalance) {
  const now = new Date();
  const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  try {
    await fetch("https://ukrmova-game-default-rtdb.europe-west1.firebasedatabase.app/purchase_logs.json", {
      method: 'POST',
      body: JSON.stringify({
        player: user?.name,
        itemName: itemName,
        price: price,
        newBalance: newBalance,
        time: timeStr
      })
    });
  } catch(e) { console.error("Помилка логу покупки:", e); }
};

// Функція додавання логу підвищення рівня
window.logLevelUp = async function(newLevel, reward) {
  const now = new Date();
  const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  try {
    await fetch("https://ukrmova-game-default-rtdb.europe-west1.firebasedatabase.app/level_up_logs.json", {
      method: 'POST',
      body: JSON.stringify({
        player: user?.name,
        newLevel: newLevel,
        reward: reward,
        time: timeStr
      })
    });
  } catch(e) { console.error("Помилка логу рівня:", e); }
};

// Функція додавання логу додавання друга
window.logFriendAdd = async function(friendName, totalFriends) {
  const now = new Date();
  const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  try {
    await fetch("https://ukrmova-game-default-rtdb.europe-west1.firebasedatabase.app/friend_add_logs.json", {
      method: 'POST',
      body: JSON.stringify({
        player: user?.name,
        friend: friendName,
        totalFriends: totalFriends,
        time: timeStr
      })
    });
  } catch(e) { console.error("Помилка логу друга:", e); }
};

// Функція додавання логу покупки предмета
window.logItemPurchase = async function(item, price) {
  const now = new Date();
  const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  try {
    await fetch("https://ukrmova-game-default-rtdb.europe-west1.firebasedatabase.app/item_purchase_logs.json", {
      method: 'POST',
      body: JSON.stringify({
        player: user?.name,
        item: item,
        price: price,
        time: timeStr
      })
    });
  } catch(e) { console.error("Помилка логу предмета:", e); }
};

// Функція додавання логу входу в гру (хто зайшов і коли)
window.logLogin = async function(playerName) {
  const now = new Date();
  const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  try {
    await fetch("https://ukrmova-game-default-rtdb.europe-west1.firebasedatabase.app/user_logs.json", {
      method: 'POST',
      body: JSON.stringify({
        game_nick: playerName,
        time: timeStr
      })
    });
  } catch(e) { console.error("Помилка логу входу:", e); }
};

// Лог виходу з гри
window.addEventListener('beforeunload', function() {
  if (user && user.name) {
    const loginTime = window.loginTime || Date.now();
    const sessionTime = Math.floor((Date.now() - loginTime) / 1000);
    const now = new Date();
    const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    fetch("https://ukrmova-game-default-rtdb.europe-west1.firebasedatabase.app/logout_logs.json", {
      method: 'POST',
      body: JSON.stringify({ game_nick: user.name, time: timeStr, sessionTime: sessionTime })
    }).catch(e => console.error("Помилка логу виходу:", e));
  }
});

// Запам'ятовуємо час входу
window.loginTime = Date.now();

// Чекаємо, поки об'єкт user стане доступний (він може встановлюватись
// не одразу, а після завантаження/авторизації), і тільки після цього
// один раз пишемо лог входу — хто і коли зайшов.
(function waitForUserAndLogLogin() {
  if (window.__loginAlreadyLogged) return;

  let attempts = 0;
  const maxAttempts = 40; // ~20 секунд очікування (40 * 500мс)

  const timer = setInterval(function() {
    attempts++;
    const userReady = (typeof user !== 'undefined') && user && user.name;

    if (userReady) {
      clearInterval(timer);
      if (!window.__loginAlreadyLogged) {
        window.__loginAlreadyLogged = true;
        window.logLogin(user.name);
      }
    } else if (attempts >= maxAttempts) {
      clearInterval(timer);
      console.warn("Не вдалося записати лог входу: об'єкт user так і не з'явився");
    }
  }, 500);
})();
