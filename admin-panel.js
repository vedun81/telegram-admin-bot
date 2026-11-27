// js/admin-panel.js
// Вхід — той самий нік і пароль, що й у грі, через справжній Firebase Authentication.
// Доступ до самої панелі відкривається тільки якщо в базі стоїть admins/{uid} = true
// (виставляється вручну через Firebase Console — див. README.md).

let currentUid = null;
let currentAdminNick = '';
let allPlayersCache = [];

// A separate audit trail for administrator operations.
async function writeAdminLog(action, details, targetUid = null) {
  if (!currentUid) return;
  const adminUid = currentUid;
  const adminNick = currentAdminNick || 'Administrator';
  const event = {
    adminUid,
    adminNick,
    nick: adminNick,
    action,
    details,
    targetUid,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    await rtdb.ref('adminLogs').push(event);
  } catch (error) {
    // Many existing Firebase projects only allow a user to write under
    // logs/<their UID>. Keep the audit trail working with that common rule.
    try {
      await rtdb.ref('logs/' + adminUid).push({ ...event, type: action === 'login' ? 'panel_login' : action === 'logout' ? 'panel_logout' : action });
    } catch (fallbackError) {
      console.warn('Could not write admin audit log:', fallbackError);
    }
  }
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const nick = document.getElementById('loginNick').value.trim();
  const pass = document.getElementById('loginPass').value.trim();
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  if (!nick || !pass) {
    errorEl.textContent = 'Введіть нік і пароль';
    return;
  }

  try {
    const cred = await auth.signInWithEmailAndPassword(nickToEmail(nick), normalizePassword(pass));
    const uid = cred.user.uid;

    const isAdmin = await dbGet('admins/' + uid);
    if (isAdmin !== true) {
      errorEl.textContent = 'У цього акаунта немає прав адміністратора';
      await auth.signOut();
      return;
    }

    currentUid = uid;
    currentAdminNick = nick;
    await writeAdminLog('login', 'Administrator signed in');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
    switchTab('tests');
    resetTestForm();
    loadTestsList();
    loadPlayers();
    loadSupport();
    loadResults();
    loadLogs();
  } catch (e) {
    console.error(e);
    if (e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      errorEl.textContent = 'Неправильний нік або пароль';
    } else if (e.code === 'auth/too-many-requests') {
      errorEl.textContent = 'Забагато спроб. Спробуйте пізніше';
    } else {
      errorEl.textContent = 'Помилка підключення';
    }
  }
}

async function logout() {
  await writeAdminLog('logout', 'Administrator signed out');
  await auth.signOut();
  currentUid = null;
  currentAdminNick = '';
  if (typeof lockBotTab === 'function') lockBotTab();
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'block';
  document.getElementById('loginPass').value = '';
}

function switchTab(tab) {
  document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');
  document.getElementById('tabbtn-' + tab).classList.add('active');
  if (tab === 'logins') loadLoginHistory();
  if (tab === 'bot' && typeof onBotTabOpen === 'function') onBotTabOpen();
}

function showToast(msg, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.background = isError ? '#e74c3c' : '#ffd700';
  toast.style.color = isError ? '#fff' : '#1a1a2e';
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

// ---------- Тести ----------

let questionCount = 0;
let editingTestId = null;

function resetTestForm() {
  editingTestId = null;
  document.getElementById('newTestName').value = '';
  document.getElementById('newTestCategory').value = '';
  document.getElementById('questionsList').innerHTML = '';
  document.getElementById('saveTestBtn').textContent = '💾 Зберегти тест';
  questionCount = 0;
  addQuestionRow();
}

function addQuestionRow(prefill) {
  questionCount++;
  const id = questionCount;
  const wrap = document.createElement('div');
  wrap.className = 'question-row';
  wrap.id = 'qrow-' + id;
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <b>Питання ${id}</b>
      <button type="button" class="btn btn-danger" onclick="document.getElementById('qrow-${id}').remove()">✖</button>
    </div>
    <input type="text" placeholder="Текст питання" class="q-text" value="${prefill ? escapeHtml(prefill.q || '') : ''}">
    <input type="text" placeholder="Правильна відповідь" class="q-correct" value="${prefill ? escapeHtml(prefill.a || '') : ''}">
    <input type="text" placeholder="Неправильна відповідь 1" class="q-wrong" value="${prefill && prefill.w ? escapeHtml(prefill.w[0] || '') : ''}">
    <input type="text" placeholder="Неправильна відповідь 2" class="q-wrong" value="${prefill && prefill.w ? escapeHtml(prefill.w[1] || '') : ''}">
    <input type="text" placeholder="Неправильна відповідь 3 (необов'язково)" class="q-wrong" value="${prefill && prefill.w ? escapeHtml(prefill.w[2] || '') : ''}">
  `;
  document.getElementById('questionsList').appendChild(wrap);
}

function editTest(id, test) {
  editingTestId = id;
  document.getElementById('newTestName').value = test.name || '';
  document.getElementById('newTestCategory').value = test.category || '';
  document.getElementById('questionsList').innerHTML = '';
  questionCount = 0;
  (test.questions || []).forEach(q => addQuestionRow(q));
  if (questionCount === 0) addQuestionRow();
  document.getElementById('saveTestBtn').textContent = '💾 Зберегти зміни в тесті "' + test.name + '"';
  switchTab('tests');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveTest() {
  const name = document.getElementById('newTestName').value.trim();
  const category = document.getElementById('newTestCategory').value.trim();
  if (!name) { showToast('Введіть назву тесту', true); return; }

  const rows = document.querySelectorAll('.question-row');
  const questions = [];
  for (const row of rows) {
    const q = row.querySelector('.q-text').value.trim();
    const a = row.querySelector('.q-correct').value.trim();
    const w = Array.from(row.querySelectorAll('.q-wrong')).map(i => i.value.trim()).filter(v => v);
    if (q && a && w.length >= 1) questions.push({ q, a, w });
  }
  if (questions.length === 0) { showToast('Додайте хоча б одне повне питання', true); return; }

  try {
    if (editingTestId) {
      await dbUpdate('customTests/' + editingTestId, {
        name, category: category || null, questions,
        updatedAt: new Date().toISOString()
      });
      await writeAdminLog('test_updated', 'Updated test: ' + name, editingTestId);
      showToast('✅ Тест оновлено');
    } else {
      const newTest = await rtdb.ref('customTests').push({
        name, category: category || null, questions,
        createdBy: currentUid,
        createdAt: new Date().toISOString()
      });
      await writeAdminLog('test_created', 'Created test: ' + name, newTest.key);
      showToast('✅ Тест створено');
    }
    resetTestForm();
    loadTestsList();
  } catch (e) {
    console.error(e);
    showToast('❌ Помилка збереження', true);
  }
}

async function loadTestsList() {
  const container = document.getElementById('testsList');
  container.innerHTML = 'Завантаження...';
  let data = null;
  try { data = await dbGet('customTests'); } catch (e) { console.error(e); }

  if (!data) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Ще немає жодного тесту</div>';
    return;
  }

  const groups = {};
  Object.entries(data).forEach(([id, t]) => {
    const cat = t.category || 'Без категорії';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ id, ...t });
  });

  container.innerHTML = Object.entries(groups).map(([cat, tests]) => `
    <div style="margin-bottom:12px;">
      <div style="color:#ffd700;font-size:12px;font-weight:bold;margin-bottom:6px;">${escapeHtml(cat)}</div>
      ${tests.map(t => `
        <div class="list-item">
          <span>${escapeHtml(t.name)} <span style="color:#aaa;font-size:11px;">(${(t.questions || []).length} питань)</span></span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-primary" onclick='editTest("${t.id}", ${JSON.stringify(t).replace(/'/g, "&#39;")})'>✏️</button>
            <button class="btn btn-danger" onclick="deleteTest('${t.id}')">🗑️</button>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function deleteTest(id) {
  if (!confirm('Видалити цей тест?')) return;
  dbRemove('customTests/' + id).then(async () => {
    await writeAdminLog('test_deleted', 'Deleted test', id);
    showToast('✅ Видалено');
    loadTestsList();
  }).catch(e => { console.error(e); showToast('❌ Помилка', true); });
}

// ---------- Гравці ----------

async function loadPlayers() {
  const container = document.getElementById('playersList');
  container.innerHTML = 'Завантаження...';
  let data = null;
  try { data = await dbGet('users'); } catch (e) { console.error(e); }
  allPlayersCache = data ? Object.entries(data).map(([uid, d]) => ({ uid, ...d })) : [];
  renderPlayers(allPlayersCache);
}

function renderPlayers(list) {
  const container = document.getElementById('playersList');
  if (list.length === 0) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Нікого не знайдено</div>';
    return;
  }
  container.innerHTML = list.slice(0, 300).map(p => `
    <div class="player-card">
      <div>
        <div class="player-name">${escapeHtml(p.name || '?')}</div>
        <div class="player-stats">💰 ${(p.points || 0).toLocaleString()} ₴ &nbsp;|&nbsp; 🏆 ${(p.points_earned || p.points || 0).toLocaleString()} ₴</div>
      </div>
      <div class="player-actions">
        <button class="btn btn-success" onclick="addMoney('${p.uid}')">💰+</button>
        <button class="btn btn-warning" onclick="removeMoney('${p.uid}')">💸-</button>
        <button class="btn btn-primary" title="Змінити пароль" onclick="changePlayerPassword('${p.uid}','${escapeHtml(p.name||'').replace(/'/g,"&#39;")}')">🔑</button>
        <button class="btn btn-danger" onclick="deletePlayer('${p.uid}','${escapeHtml(p.name||'').replace(/'/g,"&#39;")}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

function searchPlayers() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const filtered = q ? allPlayersCache.filter(p => (p.name || '').toLowerCase().includes(q)) : allPlayersCache;
  renderPlayers(filtered);
}

async function addMoney(uid) {
  const val = prompt('Скільки грошей додати?', '100');
  const amount = parseInt(val, 10);
  if (!amount || amount <= 0) return;
  const p = await dbGet('users/' + uid);
  if (!p) return;
  p.points = (p.points || 0) + amount;
  p.points_earned = (p.points_earned || p.points || 0) + amount;
  await dbSet('users/' + uid, p);
  await writeAdminLog('points_added', 'Added ' + amount + ' points to ' + (p.name || uid), uid);
  showToast('✅ Додано ' + amount + ' ₴');
  loadPlayers();
}

async function removeMoney(uid) {
  const val = prompt('Скільки грошей забрати?', '100');
  const amount = parseInt(val, 10);
  if (!amount || amount <= 0) return;
  const p = await dbGet('users/' + uid);
  if (!p) return;
  p.points = Math.max(0, (p.points || 0) - amount);
  await dbSet('users/' + uid, p);
  await writeAdminLog('points_removed', 'Removed ' + amount + ' points from ' + (p.name || uid), uid);
  showToast('✅ Забрано ' + amount + ' ₴');
  loadPlayers();
}

async function deletePlayer(uid, nick) {
  if (!confirm(`Видалити гравця "${nick}" повністю? Це не можна скасувати.`)) return;
  try {
    await dbRemove('users/' + uid);
    if (nick) await dbRemove('nicknames/' + nick.toLowerCase());
    await writeAdminLog('player_deleted', 'Deleted player: ' + (nick || uid), uid);
    showToast('✅ Гравця видалено з бази гри');
    loadPlayers();
  } catch (e) {
    console.error(e);
    showToast('❌ Помилка видалення', true);
  }
  // Обліковий запис (вхід/пароль) у Firebase Authentication це не видаляє —
  // для цього Authentication → Users → видалити акаунт вручну.
}

// ---------- Підтримка ----------

async function loadSupport() {
  const container = document.getElementById('supportList');
  container.innerHTML = 'Завантаження...';
  let data = null;
  try { data = await dbGet('support'); } catch (e) { console.error(e); }

  if (!data) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Повідомлень немає</div>';
    return;
  }

  let threads = [];
  for (const uid in data) {
    const messages = (data[uid] && data[uid].messages) || [];
    messages.forEach((m, idx) => threads.push({ uid, idx, ...m }));
  }
  threads.sort((a, b) => (b.id || 0) - (a.id || 0));

  if (threads.length === 0) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Повідомлень немає</div>';
    return;
  }

  container.innerHTML = threads.map(m => `
    <div class="message-card">
      <div class="message-header"><b>👤 ${escapeHtml(m.from || '?')}</b><span>${escapeHtml(m.date || '')}</span></div>
      <div class="message-text">${escapeHtml(m.message || '')}</div>
      ${m.reply
        ? `<div class="message-text" style="border-left:3px solid #2ecc71;"><b>Відповідь:</b> ${escapeHtml(m.reply)}</div>`
        : `<div class="reply-area">
             <textarea id="reply-${m.uid}-${m.idx}" placeholder="Відповідь..."></textarea>
             <button class="btn btn-primary" onclick="replySupport('${m.uid}', ${m.idx})">Відповісти</button>
           </div>`}
    </div>
  `).join('');
}

async function replySupport(uid, idx) {
  const input = document.getElementById('reply-' + uid + '-' + idx);
  const reply = input ? input.value.trim() : '';
  if (!reply) return;
  try {
    const messages = await dbGet('support/' + uid + '/messages');
    if (!messages || !messages[idx]) return;
    messages[idx].reply = reply;
    messages[idx].read = true;
    await dbSet('support/' + uid + '/messages', messages);
    await writeAdminLog('support_replied', 'Replied to support request', uid);
    showToast('✅ Відповідь надіслано');
    loadSupport();
  } catch (e) {
    console.error(e);
    showToast('❌ Помилка відправки', true);
  }
}

// ---------- Результати ----------

async function loadResults() {
  const container = document.getElementById('resultsList');
  container.innerHTML = 'Завантаження...';
  let data = null;
  try { data = await dbGet('results'); } catch (e) { console.error(e); }

  if (!data) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Учні ще не проходили тести</div>';
    return;
  }

  let all = [];
  for (const uid in data) {
    for (const resId in data[uid]) all.push(data[uid][resId]);
  }
  all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  renderResults(all);
}

function renderResults(list) {
  const container = document.getElementById('resultsList');
  if (list.length === 0) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Нічого не знайдено</div>';
    return;
  }
  container.innerHTML = list.slice(0, 300).map(r => `
    <div class="log-entry">
      <div><span class="log-player">👤 ${escapeHtml(r.nick || '?')}</span> — ${escapeHtml(r.themeName || r.themeId || '')}</div>
      <div style="font-size:11px;color:#aaa;margin-top:4px;">
        📅 ${escapeHtml(r.date || '')} ⏰ ${escapeHtml(r.time || '')}
        &nbsp;|&nbsp; ✅ ${r.correct ?? '?'} ❌ ${r.wrong ?? '?'} з ${r.total ?? '?'} (${r.percent ?? '?'}%)
      </div>
    </div>
  `).join('');
}

function searchResults() {
  const q = document.getElementById('resultsSearch').value.trim().toLowerCase();
  dbGet('results').then(data => {
    if (!data) return;
    let all = [];
    for (const uid in data) for (const resId in data[uid]) all.push(data[uid][resId]);
    all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (q) all = all.filter(r => (r.nick || '').toLowerCase().includes(q) || (r.themeName || '').toLowerCase().includes(q));
    renderResults(all);
  });
}

// ---------- Логи дій ----------

async function loadLogs() {
  const container = document.getElementById('logsList');
  container.innerHTML = 'Завантаження...';
  let data = null;
  try { data = await dbGet('adminLogs'); } catch (e) { console.error(e); }

  if (!data) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Логів ще немає</div>';
    return;
  }

  const all = Object.entries(data).map(([id, entry]) => ({ id, ...entry }));
  all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  renderLogs(all);
}

const LOG_ICONS = { login: '🔓', logout: '🔒', purchase: '🛒' };

function renderLogs(list) {
  const container = document.getElementById('logsList');
  if (list.length === 0) {
    container.innerHTML = '<div style="color:#aaa;padding:10px;">Нічого не знайдено</div>';
    return;
  }
  container.innerHTML = list.slice(0, 300).map(l => `
    <div class="log-entry">
      <span class="log-player">${LOG_ICONS[l.action] || '📌'} ${escapeHtml(l.action || 'action')}</span>
      — ${escapeHtml(l.details || '')}
      <div style="font-size:11px;color:#aaa;margin-top:2px;">${l.timestamp ? new Date(l.timestamp).toLocaleString() : ''} · admin: ${escapeHtml(l.adminUid || '?')}</div>
    </div>
  `).join('');
}

function searchLogs() {
  const q = document.getElementById('logsSearch').value.trim().toLowerCase();
  dbGet('adminLogs').then(data => {
    if (!data) return;
    let all = Object.entries(data).map(([id, entry]) => ({ id, ...entry }));
    all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (q) all = all.filter(l => (l.details || '').toLowerCase().includes(q) || (l.action || '').toLowerCase().includes(q) || (l.adminUid || '').toLowerCase().includes(q));
    renderLogs(all);
  });
}

// ---------- Пароль гравця ----------

async function changePlayerPassword(uid, nick) {
  const password = prompt('Новий пароль для гравця "' + (nick || uid) + '":');
  if (password === null) return;

  const newPassword = password.trim();
  if (newPassword.length < 6 || newPassword.length > 128) {
    showToast('Пароль має містити від 6 до 128 символів', true);
    return;
  }

  try {
    if (!PASSWORD_API_URL) {
      showToast('❌ Не налаштовано сервер зміни пароля', true);
      return;
    }

    const token = await auth.currentUser.getIdToken();
    const response = await fetch(PASSWORD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ uid, password: newPassword })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || 'Не вдалося змінити пароль');
      error.code = result.code || 'password-api/error';
      throw error;
    }
    showToast('✅ Пароль гравця змінено');
  } catch (error) {
    console.error(error);
    const code = error && error.code ? String(error.code) : '';
    if (code.includes('not-found')) {
      showToast('❌ Функцію не розгорнуто у Firebase', true);
    } else if (code.includes('permission-denied')) {
      showToast('❌ Недостатньо прав для зміни пароля', true);
    } else if (code.includes('unauthenticated')) {
      showToast('❌ Сесія адміністратора завершилась', true);
    } else if (code.includes('invalid-argument')) {
      showToast('❌ Некоректний пароль або гравець', true);
    } else {
      showToast('❌ ' + (error.message || 'Не вдалося змінити пароль'), true);
    }
  }
}
// Unified activity log: game events from /logs and administrative events from
// /adminLogs. Game records are resolved to a player nickname before display.
let activityLogsCache = [];
let currentLogFilter = 'all';

const ACTIVITY_LABELS = {
  panel_login: 'Вхід в адмін-панель', panel_logout: 'Вихід з адмін-панелі',
  login: 'Вхід у гру', logout: 'Вихід з гри', purchase: 'Покупка',
  friend_added: 'Додано друга', friend_removed: 'Видалено друга',
  game_started: 'Початок гри', game_finished: 'Кінець гри',
  points_added: 'Нараховано гроші', points_removed: 'Знято гроші',
  test_created: 'Створено тест', test_updated: 'Оновлено тест', test_deleted: 'Видалено тест',
  player_deleted: 'Видалено гравця', support_replied: 'Відповідь у підтримці',
  password_changed: 'Змінено пароль',
  bot_button_saved: 'Бот: збережено кнопку', bot_button_deleted: 'Бот: видалено кнопку',
  bot_builtin_saved: 'Бот: змінено стандартні кнопки', bot_settings_saved: 'Бот: змінено налаштування',
  bot_giveaway_saved: 'Бот: збережено роздачу', bot_giveaway_stopped: 'Бот: зупинено роздачу',
  bot_giveaway_deleted: 'Бот: видалено роздачу', bot_unlock: 'Бот: розблоковано вкладку'
};

function collectGameLogs(data, users) {
  const output = [];
  Object.entries(data || {}).forEach(([ownerUid, entries]) => {
    Object.entries(entries || {}).forEach(([id, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const uid = entry.uid || entry.userUid || ownerUid;
      const player = users[uid] || {};
      output.push({
        id, uid,
        nick: entry.nick || entry.nickname || entry.userName || player.name || player.nick || 'Невідомий гравець',
        action: entry.type || entry.action || 'other',
        details: entry.details || entry.message || entry.itemName || '',
        timestamp: entry.timestamp || entry.createdAt || entry.date || 0
      });
    });
  });
  return output;
}

async function loadLogs() {
  const container = document.getElementById('logsList');
  container.innerHTML = 'Завантаження...';
  try {
    const [gameData, adminData, users] = await Promise.all([
      dbGet('logs'), dbGet('adminLogs'), dbGet('users')
    ]);
    const gameLogs = collectGameLogs(gameData, users || {});
    const panelLogs = Object.entries(adminData || {}).map(([id, entry]) => ({
      id,
      nick: entry.adminNick || 'Адміністратор',
      action: entry.action === 'login' ? 'panel_login' : entry.action === 'logout' ? 'panel_logout' : entry.action || 'other',
      details: entry.details || '',
      timestamp: entry.timestamp || 0
    }));
    activityLogsCache = [...gameLogs, ...panelLogs].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    renderLogs(activityLogsCache);
  } catch (error) {
    console.error(error);
    container.textContent = 'Не вдалося завантажити логи.';
  }
}

function setLogFilter(filter) {
  currentLogFilter = filter;
  document.querySelectorAll('[data-log-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.logFilter === filter);
  });
  renderLogs(activityLogsCache);
}

function renderLogs(list) {
  const container = document.getElementById('logsList');
  const query = document.getElementById('logsSearch').value.trim().toLowerCase();
  const visible = list.filter(log =>
    (currentLogFilter === 'all' || log.action === currentLogFilter) &&
    (!query || [log.nick, log.action, log.details].join(' ').toLowerCase().includes(query))
  );
  if (!visible.length) {
    container.textContent = 'Нічого не знайдено.';
    return;
  }
  container.innerHTML = visible.slice(0, 300).map(log => `
    <div class="log-entry">
      <span class="log-player">${escapeHtml(log.nick)}</span> - ${escapeHtml(ACTIVITY_LABELS[log.action] || log.action)}
      ${log.details ? `<div>${escapeHtml(log.details)}</div>` : ''}
      <div style="font-size:11px;color:#aaa;margin-top:2px;">${log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}</div>
    </div>
  `).join('');
}

function searchLogs() {
  renderLogs(activityLogsCache);
}

let loginHistoryCache = [];

async function loadLoginHistory() {
  const container = document.getElementById('loginHistoryList');
  container.textContent = 'Завантаження...';
  try {
    const [gameLogs, adminLogs, users] = await Promise.all([
      dbGet('logs'), dbGet('adminLogs'), dbGet('users')
    ]);
    const players = users || {};
    const gameEntries = [];
    Object.entries(gameLogs || {}).forEach(([ownerUid, entries]) => {
      Object.entries(entries || {}).forEach(([id, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        const action = entry.type || entry.action;
        if (action !== 'login') return;
        const uid = entry.uid || entry.userUid || ownerUid;
        const user = players[uid] || {};
        gameEntries.push({ id, nick: entry.nick || entry.nickname || user.name || user.nick || 'Невідомий гравець', timestamp: entry.timestamp || entry.createdAt || entry.date || 0, source: 'Гра' });
      });
    });
    const panelEntries = Object.entries(adminLogs || {}).filter(([, entry]) => entry && entry.action === 'login').map(([id, entry]) => ({
      id, nick: entry.adminNick || entry.nick || 'Адміністратор', timestamp: entry.timestamp || 0, source: 'Адмін-панель'
    }));
    loginHistoryCache = [...gameEntries, ...panelEntries].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    renderLoginHistory();
  } catch (error) {
    console.error(error);
    container.textContent = 'Не вдалося завантажити історію входів.';
  }
}

function renderLoginHistory() {
  const container = document.getElementById('loginHistoryList');
  const search = (document.getElementById('loginHistorySearch').value || '').trim().toLowerCase();
  const visible = loginHistoryCache.filter(entry => !search || entry.nick.toLowerCase().includes(search));
  if (!visible.length) {
    container.textContent = 'Записів входу ще немає.';
    return;
  }
  container.innerHTML = visible.slice(0, 300).map(entry => `
    <div class="log-entry">
      <div><span class="log-player">👤 ${escapeHtml(entry.nick)}</span> — ${escapeHtml(entry.source)}</div>
      <div style="font-size:11px;color:#aaa;margin-top:4px;">📅 ${entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : '—'} &nbsp; ⏰ ${entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '—'}</div>
    </div>
  `).join('');
}


// =====================================================================
// 🤖 ВКЛАДКА «БОТ» — візуальний конструктор без коду
// ---------------------------------------------------------------------
// Усе, що ви тут налаштовуєте, зберігається у Firebase (botConfig) і
// миттєво з'являється в грі/боті — без правок коду й перезавантаження.
//
// Захист: вкладка закрита паролем адміністратора. У коді зберігається лише
// SHA-256 хеш пароля (а не сам пароль). Справжній захист запису — це правила
// Firebase (запис у botConfig дозволений тільки admins/{uid} = true), див.
// database.rules.json. Пароль вкладки — додатковий рівень від випадкових дій.
// =====================================================================

const BOT_PASS_HASH = '97c2da506bbd2abd5d9845c392efad7e93af19384c1a16a9b1af6dea17d534e2';

const BOT_SCREENS = [
  ['menu', 'Головне меню'], ['sections', 'Вибір теми'], ['shop', 'Крамничка'],
  ['cabinet', 'Моя скринька'], ['top', 'Топ гравців'], ['custom-tests-screen', 'Додаткові тести'],
  ['frazeologizmy', 'Фразеологізми'], ['antisurzhyk', 'Антисуржик'], ['punctuation', 'Пунктуація'],
  ['apostrophe', 'Апостроф'], ['imennyky', 'Іменники'], ['prykmetnyky', 'Прикметники'],
  ['zajmennyky', 'Займенники'], ['chyslivnyky', 'Числівники']
];
const BOT_COLORS = {
  default: ['Стандартний (синій)', '#00a2ff', '#fff'], green: ['Зелений', '#2ecc71', '#fff'],
  red: ['Червоний', '#ff4d4d', '#fff'], purple: ['Фіолетовий', '#9b59b6', '#fff'],
  gold: ['Золотий', '#f1c40f', '#222'], dark: ['Темний', '#333', '#fff'], blue: ['Блакитний', '#00a2ff', '#fff']
};
const BOT_BANNER_COLORS = {
  gold: ['Жовтий', '#fff3c4', '#5a4300'], green: ['Зелений', '#d9f7e4', '#0f5132'],
  red: ['Червоний', '#ffdede', '#7a1c1c'], purple: ['Фіолетовий', '#ecdcf6', '#4a1d63'],
  blue: ['Блакитний', '#d6efff', '#0b4a70']
};
const BOT_BUILTIN = [
  { key: 'play', name: 'ГРАТИ', order: 10, color: 'default' },
  { key: 'top', name: 'ТОП', order: 20, color: 'dark' },
  { key: 'shop', name: 'КРАМНИЧКА', order: 30, color: 'green' },
  { key: 'cabinet', name: '📦 МОЯ СКРИНЬКА', order: 40, color: 'purple' }
];
const BOT_ACTIONS = { screen: 'Відкрити розділ гри', link: 'Відкрити посилання', message: 'Показати повідомлення' };

let botUnlocked = false;
let botFails = 0;
let botLockUntil = 0;
let botCfg = {};
let botSub = 'preview';
let botServerOffset = 0;
let botRef = null;
let botOffsetRef = null;
let botTimerInt = null;
let botEditBtnId = null;
let botEditGiftId = null;
let botFormsLoaded = false;

// ---------- Допоміжні ----------
const botEl = id => document.getElementById(id);
const botNow = () => Date.now() + botServerOffset;
function botIsLive(o, t) {
  if (!o || o.enabled === false) return false;
  if (o.startAt && t < o.startAt) return false;
  if (o.endAt && t >= o.endAt) return false;
  return true;
}
function botFmt(ms) {
  ms = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(ms / 86400), h = Math.floor(ms % 86400 / 3600), m = Math.floor(ms % 3600 / 60), s = ms % 60;
  const p = x => String(x).padStart(2, '0');
  return (d ? d + ' д ' : '') + p(h) + ':' + p(m) + ':' + p(s);
}
function botToInput(ms) {
  if (!ms) return '';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function botFromInput(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return isFinite(t) ? t : null;
}
function botDateText(ms) { return ms ? new Date(ms).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
async function botSha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function botGuard() {
  if (!botUnlocked || !currentUid) { showToast('🔒 Спочатку розблокуйте вкладку «Бот»', true); return false; }
  return true;
}
function botOptions(map, withKey) {
  return Object.entries(map).map(([k, v]) => `<option value="${k}">${escapeHtml(Array.isArray(v) ? v[0] : v)}</option>`).join('');
}

// ---------- Ініціалізація вкладки ----------
function botInitTab() {
  const tabs = document.querySelector('#mainContent .tabs');
  const main = document.getElementById('mainContent');
  if (!tabs || !main || botEl('tabbtn-bot')) return;

  const style = document.createElement('style');
  style.textContent = `
    #panel-bot label{display:block;font-size:12px;color:#ccc;margin:8px 0 4px}
    #panel-bot input[type=number],#panel-bot input[type=password],#panel-bot input[type=url],#panel-bot input[type=datetime-local],#panel-bot select{
      width:100%;padding:10px;border-radius:12px;border:none;background:rgba(255,255,255,.95);margin-bottom:6px;font-size:14px;color:#111}
    #panel-bot .bot-card{background:rgba(255,255,255,.06);border-radius:18px;padding:14px;margin-bottom:14px}
    #panel-bot .bot-card h4{color:#ffd700;font-size:14px;margin-bottom:6px}
    #panel-bot .bot-hint{font-size:11px;color:#aaa;margin:2px 0 6px}
    #panel-bot .bot-row{display:flex;gap:8px}
    #panel-bot .bot-row>div{flex:1;min-width:0}
    #panel-bot .bot-check{display:flex;align-items:center;gap:8px;color:#eee;font-size:13px;margin:8px 0}
    #panel-bot .bot-check input{width:18px;height:18px}
    #panel-bot .bot-chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
    #panel-bot .bot-chips .btn{background:rgba(255,255,255,.15);color:#eee}
    #panel-bot .bot-actions{display:flex;gap:6px;flex-wrap:wrap}
    #panel-bot .bot-pill{display:inline-block;font-size:10px;padding:2px 8px;border-radius:50px;background:rgba(255,255,255,.15);color:#ddd;margin-left:4px}
    #panel-bot .bot-pill.on{background:#2ecc71;color:#08331b}
    #panel-bot .bot-pill.wait{background:#f39c12;color:#3a2600}
    #panel-bot .bot-pill.off{background:#7f8c8d;color:#fff}
    #panel-bot .bot-subtabs .tab{min-width:70px;padding:8px 6px}
    .pv-phone{max-width:300px;margin:0 auto 12px;background:rgba(255,255,255,.92);color:#000;border-radius:24px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
    .pv-phone h5{text-align:center;font-size:15px;margin-bottom:4px}
    .pv-nick{text-align:center;font-weight:700;font-size:18px;margin:4px 0}
    .pv-money{text-align:center;font-weight:900;font-size:22px;color:#f1c40f;margin-bottom:8px}
    .pv-btn{padding:11px;border-radius:50px;text-align:center;font-weight:700;font-size:13px;margin:6px 0}
    .pv-off{opacity:.45;outline:2px dashed #888}
    .pv-tag{display:block;font-size:10px;font-weight:400;opacity:.9}
    .pv-banner{margin:8px 0;padding:8px 10px;border-radius:12px;font-size:12px;font-weight:700;text-align:center;white-space:pre-wrap}
    .pv-gift{margin:8px 0;padding:10px;border-radius:14px;color:#fff;text-align:center;background:linear-gradient(135deg,#8a5bff,#4820a1)}
    .pv-gift.soon{background:linear-gradient(135deg,#555a78,#2c2f4a)}
    .pv-gift b{display:block;font-size:13px}
    .pv-gift small{display:block;font-size:11px;opacity:.9;white-space:pre-wrap}
    .pv-gift .pv-timer{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:8px;background:rgba(0,0,0,.25);font-weight:800;font-size:12px}
    .pv-claim{margin-top:6px;padding:8px;border-radius:10px;font-weight:800;font-size:12px;color:#102516;background:linear-gradient(135deg,#84ff42,#46d985)}
    #botFrame{width:100%;height:560px;border:0;border-radius:18px;background:#fff;margin-top:8px}
  `;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'tabbtn-bot';
  btn.className = 'tab';
  btn.textContent = '🤖 Бот';
  btn.addEventListener('click', () => switchTab('bot'));
  tabs.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'panel-bot';
  panel.className = 'panel';
  main.appendChild(panel);

  panel.addEventListener('click', botOnClick);
  panel.addEventListener('change', botOnChange);
  panel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'botPass') botTryUnlock(); });

  botRenderLocked();
}

function botRenderLocked() {
  const panel = botEl('panel-bot');
  if (!panel) return;
  panel.innerHTML = `
    <h3>🔒 Керування ботом</h3>
    <p class="bot-hint" style="font-size:13px;margin-bottom:12px">Ця вкладка змінює бота для всіх гравців. Введіть пароль адміністратора, щоб продовжити.</p>
    <input type="password" id="botPass" placeholder="Пароль адміністратора" autocomplete="off">
    <button class="btn btn-primary btn-full" data-bot-act="unlock">🔓 Розблокувати</button>
    <div id="botPassErr" class="error"></div>`;
}

function lockBotTab() {
  botUnlocked = false;
  botStopListener();
  botRenderLocked();
}

function onBotTabOpen() {
  if (!botUnlocked) {
    botRenderLocked();
    const i = botEl('botPass');
    if (i) i.focus();
  } else {
    botRenderAll();
  }
}

async function botTryUnlock() {
  const err = botEl('botPassErr'), input = botEl('botPass');
  if (!err || !input) return;
  const wait = botLockUntil - Date.now();
  if (wait > 0) { err.textContent = 'Забагато спроб. Зачекайте ' + Math.ceil(wait / 1000) + ' с'; return; }
  if (!window.crypto || !crypto.subtle) { err.textContent = 'Потрібне захищене з\'єднання (HTTPS)'; return; }
  const hash = await botSha256(input.value);
  if (hash === BOT_PASS_HASH) {
    botUnlocked = true;
    botFails = 0;
    writeAdminLog('bot_unlock', 'Розблоковано вкладку «Бот»');
    botBuildUI();
    botStartListener();
  } else {
    botFails++;
    input.value = '';
    if (botFails >= 5) { botFails = 0; botLockUntil = Date.now() + 60000; err.textContent = 'Забагато спроб. Спробуйте через хвилину'; }
    else err.textContent = 'Невірний пароль (' + botFails + '/5)';
  }
}

// ---------- Підписка на botConfig ----------
function botStartListener() {
  botStopListener();
  botFormsLoaded = false;
  botOffsetRef = rtdb.ref('.info/serverTimeOffset');
  botOffsetRef.on('value', s => { botServerOffset = Number(s.val()) || 0; });
  botRef = rtdb.ref('botConfig');
  botRef.on('value', snap => {
    botCfg = snap.val() || {};
    if (!botFormsLoaded) { botFillSettings(); botFillBuiltin(); botFormsLoaded = true; }
    botRenderAll();
  }, () => showToast('❌ Немає доступу до botConfig — додайте правила з database.rules.json', true));
  botTimerInt = setInterval(botTick, 1000);
}
function botStopListener() {
  if (botRef) { botRef.off(); botRef = null; }
  if (botOffsetRef) { botOffsetRef.off(); botOffsetRef = null; }
  if (botTimerInt) { clearInterval(botTimerInt); botTimerInt = null; }
}

// ---------- Каркас інтерфейсу ----------
function botBuildUI() {
  const panel = botEl('panel-bot');
  const screenOpts = BOT_SCREENS.map(([v, n]) => `<option value="${v}">${escapeHtml(n)}</option>`).join('');
  const colorOpts = botOptions(BOT_COLORS);
  const bannerColorOpts = botOptions(BOT_BANNER_COLORS);

  const builtinRows = BOT_BUILTIN.map(b => `
    <div class="bot-row" style="align-items:flex-end">
      <div style="flex:2"><label>${escapeHtml(b.name)} — свій текст</label><input type="text" id="bi-label-${b.key}" maxlength="40" placeholder="${escapeHtml(b.name)}"></div>
      <div style="flex:1"><label>Порядок</label><input type="number" id="bi-order-${b.key}" placeholder="${b.order}"></div>
      <div style="flex:1"><label class="bot-check" style="margin:0 0 10px"><input type="checkbox" id="bi-hidden-${b.key}"> Сховати</label></div>
    </div>`).join('');

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
      <h3 style="margin:0">🤖 Керування ботом</h3>
      <button class="btn btn-warning" data-bot-act="lock">🔒 Заблокувати</button>
    </div>
    <div class="tabs bot-subtabs">
      <button class="tab" data-bot-sub="preview">👁️ Бот зараз</button>
      <button class="tab" data-bot-sub="buttons">🔘 Кнопки</button>
      <button class="tab" data-bot-sub="gifts">🎁 Роздачі</button>
      <button class="tab" data-bot-sub="settings">⚙️ Оголошення</button>
    </div>

    <div class="bot-sub" id="botSub-preview">
      <p class="bot-hint">Так бота бачать гравці просто зараз. Тьмяні елементи з пунктирною рамкою — ще не активні (таймер/вимкнено).</p>
      <div id="botPreviewBox"></div>
      <div class="bot-card">
        <h4>🎮 Жива гра (необов'язково)</h4>
        <p class="bot-hint">Вставте адресу вашої гри (https://…), щоб побачити її справжній вигляд прямо тут.</p>
        <input type="url" id="botGameUrl" placeholder="https://ваша-гра.example">
        <button class="btn btn-primary btn-full" data-bot-act="frame-load">Показати гру</button>
        <div id="botFrameWrap"></div>
      </div>
    </div>

    <div class="bot-sub" id="botSub-buttons" style="display:none">
      <div class="bot-card" id="botBtnFormCard">
        <h4 id="bfTitle">➕ Нова кнопка</h4>
        <label>Текст кнопки</label>
        <input type="text" id="bf-label" maxlength="40" placeholder="Напр.: Наш Telegram-канал">
        <div class="bot-row">
          <div><label>Емодзі (необов'язково)</label><input type="text" id="bf-icon" maxlength="4" placeholder="📢"></div>
          <div><label>Колір</label><select id="bf-color">${colorOpts}</select></div>
        </div>
        <div class="bot-row">
          <div><label>Де показати</label><select id="bf-place"><option value="menu">Головне меню</option><option value="sections">Екран «Обери тему»</option></select></div>
          <div><label>Порядок (менше — вище)</label><input type="number" id="bf-order" value="100"></div>
        </div>
        <label>Що робить кнопка</label>
        <select id="bf-action">${botOptions(BOT_ACTIONS)}</select>
        <div id="bf-wrap-screen"><label>Який розділ відкрити</label><select id="bf-screen">${screenOpts}</select></div>
        <div id="bf-wrap-link" style="display:none"><label>Посилання</label><input type="url" id="bf-link" placeholder="https://t.me/ваш_канал"></div>
        <div id="bf-wrap-message" style="display:none">
          <label>Заголовок вікна</label><input type="text" id="bf-mtitle" maxlength="60" placeholder="Напр.: Правила">
          <label>Текст повідомлення</label><textarea id="bf-mtext" maxlength="1000" rows="4" placeholder="Що побачить гравець після натискання"></textarea>
        </div>
        <label class="bot-check"><input type="checkbox" id="bf-enabled" checked> Увімкнена</label>
        <label class="bot-check"><input type="checkbox" id="bf-sched"> Показувати за таймером</label>
        <div id="bf-wrap-sched" style="display:none">
          <label>Показувати з</label><input type="datetime-local" id="bf-start">
          <label>Показувати до</label><input type="datetime-local" id="bf-end">
          <p class="bot-hint">Одне з полів можна залишити порожнім.</p>
        </div>
        <button class="btn btn-success btn-full" id="bfSaveBtn" data-bot-act="btn-save">💾 Зберегти кнопку</button>
        <button class="btn btn-full" style="background:rgba(255,255,255,.15);color:#eee" data-bot-act="btn-cancel">↺ Очистити форму</button>
      </div>

      <h3>Додані кнопки</h3>
      <div id="botBtnList"></div>

      <div class="bot-card" style="margin-top:14px">
        <h4>🧱 Стандартні кнопки меню</h4>
        <p class="bot-hint">Можна перейменувати, пересунути або сховати. Порожній текст = стандартний.</p>
        ${builtinRows}
        <button class="btn btn-primary btn-full" data-bot-act="builtin-save">💾 Зберегти стандартні кнопки</button>
      </div>
    </div>

    <div class="bot-sub" id="botSub-gifts" style="display:none">
      <div class="bot-card">
        <h4 id="gfTitle">➕ Нова роздача</h4>
        <label>Назва</label>
        <input type="text" id="gf-title" maxlength="60" placeholder="Напр.: Подарунок до свята">
        <label>Опис (необов'язково)</label>
        <textarea id="gf-desc" maxlength="300" rows="2" placeholder="Коротко, за що роздача"></textarea>
        <label>Нагорода, ₴ (кожен гравець забирає один раз)</label>
        <input type="number" id="gf-reward" min="0" step="1" value="500">
        <label>Початок</label>
        <input type="datetime-local" id="gf-start">
        <p class="bot-hint">Порожньо — стартує одразу після збереження.</p>
        <label>Кінець (таймер роздачі)</label>
        <input type="datetime-local" id="gf-end">
        <div class="bot-chips">
          <span class="bot-hint" style="width:100%;margin:0">Швидко: тривалість від початку</span>
          <button class="btn" data-bot-act="gift-dur" data-min="10">10 хв</button>
          <button class="btn" data-bot-act="gift-dur" data-min="30">30 хв</button>
          <button class="btn" data-bot-act="gift-dur" data-min="60">1 год</button>
          <button class="btn" data-bot-act="gift-dur" data-min="360">6 год</button>
          <button class="btn" data-bot-act="gift-dur" data-min="1440">24 год</button>
          <button class="btn" data-bot-act="gift-dur" data-min="10080">7 днів</button>
        </div>
        <label class="bot-check"><input type="checkbox" id="gf-enabled" checked> Увімкнена</label>
        <button class="btn btn-success btn-full" data-bot-act="gift-save">💾 Зберегти роздачу</button>
        <button class="btn btn-full" style="background:rgba(255,255,255,.15);color:#eee" data-bot-act="gift-cancel">↺ Очистити форму</button>
      </div>
      <h3>Усі роздачі</h3>
      <div id="botGiftList"></div>
    </div>

    <div class="bot-sub" id="botSub-settings" style="display:none">
      <div class="bot-card">
        <h4>📝 Заголовок меню</h4>
        <input type="text" id="sf-title" maxlength="30" placeholder="МЕНЮ">
        <p class="bot-hint">Порожньо — стандартне «МЕНЮ».</p>
      </div>
      <div class="bot-card">
        <h4>📢 Банер-оголошення в меню</h4>
        <label class="bot-check"><input type="checkbox" id="sf-banner-on"> Показувати банер</label>
        <label>Текст оголошення</label>
        <textarea id="sf-banner-text" maxlength="300" rows="3" placeholder="Напр.: Сьогодні подвійні бонуси!"></textarea>
        <label>Колір</label>
        <select id="sf-banner-color">${bannerColorOpts}</select>
        <label>Показувати з (необов'язково)</label><input type="datetime-local" id="sf-banner-start">
        <label>Показувати до (необов'язково)</label><input type="datetime-local" id="sf-banner-end">
      </div>
      <button class="btn btn-success btn-full" data-bot-act="settings-save">💾 Зберегти оголошення</button>
    </div>`;

  try { botEl('botGameUrl').value = localStorage.getItem('botGameUrl') || ''; } catch (e) {}
  botEditBtnId = null;
  botEditGiftId = null;
  botShowSub(botSub);
  botToggleFormParts();
}

function botShowSub(name) {
  botSub = name;
  document.querySelectorAll('#panel-bot .bot-sub').forEach(el => { el.style.display = el.id === 'botSub-' + name ? 'block' : 'none'; });
  document.querySelectorAll('#panel-bot [data-bot-sub]').forEach(b => b.classList.toggle('active', b.dataset.botSub === name));
}

function botToggleFormParts() {
  const a = botEl('bf-action');
  if (!a) return;
  botEl('bf-wrap-screen').style.display = a.value === 'screen' ? 'block' : 'none';
  botEl('bf-wrap-link').style.display = a.value === 'link' ? 'block' : 'none';
  botEl('bf-wrap-message').style.display = a.value === 'message' ? 'block' : 'none';
  botEl('bf-wrap-sched').style.display = botEl('bf-sched').checked ? 'block' : 'none';
}

// ---------- Обробники подій ----------
function botOnChange(e) {
  if (e.target.id === 'bf-action' || e.target.id === 'bf-sched') botToggleFormParts();
}

function botOnClick(e) {
  const subBtn = e.target.closest('[data-bot-sub]');
  if (subBtn) { botShowSub(subBtn.dataset.botSub); return; }
  const el = e.target.closest('[data-bot-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.botAct) {
    case 'unlock': botTryUnlock(); break;
    case 'lock': lockBotTab(); break;
    case 'frame-load': botLoadFrame(); break;
    case 'btn-save': botSaveButton(); break;
    case 'btn-cancel': botResetButtonForm(); break;
    case 'btn-edit': botEditButton(id); break;
    case 'btn-toggle': botToggleButton(id); break;
    case 'btn-del': botDeleteButton(id); break;
    case 'builtin-save': botSaveBuiltin(); break;
    case 'gift-dur': botSetGiftDuration(Number(el.dataset.min)); break;
    case 'gift-save': botSaveGift(); break;
    case 'gift-cancel': botResetGiftForm(); break;
    case 'gift-edit': botEditGift(id, false); break;
    case 'gift-copy': botEditGift(id, true); break;
    case 'gift-stop': botStopGift(id); break;
    case 'gift-del': botDeleteGift(id); break;
    case 'settings-save': botSaveSettings(); break;
  }
}

// ---------- Перегляд «Бот зараз» ----------
function botRenderAll() {
  if (!botUnlocked || !botEl('botPreviewBox')) return;
  botRenderPreview();
  botRenderButtonList();
  botRenderGiftList();
}

function botBtnStyle(color, fallbackColor) {
  const c = BOT_COLORS[color] || BOT_COLORS[fallbackColor || 'default'];
  return `background:${c[1]};color:${c[2]}`;
}

function botRenderPreview() {
  const box = botEl('botPreviewBox');
  const t = botNow();
  const s = botCfg.settings || {};
  const builtinCfg = botCfg.builtin || {};
  const buttons = Object.entries(botCfg.buttons || {}).map(([id, b]) => Object.assign({ id }, b));

  const menuItems = [];
  const hiddenNames = [];
  BOT_BUILTIN.forEach(b => {
    const c = builtinCfg[b.key] || {};
    const label = String(c.label || '').trim() || b.name;
    if (c.hidden) { hiddenNames.push(label); return; }
    menuItems.push({ order: Number.isFinite(Number(c.order)) && c.order !== null && c.order !== undefined ? Number(c.order) : b.order, label, style: botBtnStyle(b.color) });
  });
  buttons.filter(b => b.place !== 'sections').forEach(b => {
    const live = botIsLive(b, t);
    menuItems.push({
      order: Number.isFinite(Number(b.order)) ? Number(b.order) : 100,
      label: ((b.icon || '') + ' ' + (b.label || '')).trim(),
      style: botBtnStyle(b.color), off: !live, tag: botButtonStatus(b, t).text
    });
  });
  menuItems.sort((a, b) => a.order - b.order);

  let banner = '';
  if (s.banner && s.banner.text) {
    const col = BOT_BANNER_COLORS[s.banner.color] || BOT_BANNER_COLORS.gold;
    const live = botIsLive({ enabled: s.banner.enabled === true, startAt: s.banner.startAt, endAt: s.banner.endAt }, t);
    banner = `<div class="pv-banner ${live ? '' : 'pv-off'}" style="background:${col[1]};color:${col[2]}">${escapeHtml(s.banner.text)}${live ? '' : '<span class="pv-tag">банер зараз не показується</span>'}</div>`;
  }

  const gifts = Object.entries(botCfg.giveaways || {}).map(([id, g]) => Object.assign({ id }, g))
    .filter(g => g.endAt && t < g.endAt).sort((a, b) => a.endAt - b.endAt)
    .map(g => {
      const soon = g.startAt && t < g.startAt;
      const off = g.enabled === false;
      return `<div class="pv-gift ${soon ? 'soon' : ''} ${off ? 'pv-off' : ''}">
        <b>🎁 ${escapeHtml(g.title || 'Роздача')}</b>
        ${g.description ? `<small>${escapeHtml(g.description)}</small>` : ''}
        <span class="pv-timer" data-pv-timer data-start="${Number(g.startAt) || 0}" data-end="${Number(g.endAt)}" data-state="${soon ? 'soon' : 'active'}"></span>
        ${!soon && Number(g.reward) > 0 ? `<div class="pv-claim">Забрати ${Number(g.reward).toLocaleString('uk-UA')} ₴</div>` : ''}
        ${off ? '<small>вимкнена — гравці її не бачать</small>' : ''}
      </div>`;
    }).join('');

  const sectionBtns = buttons.filter(b => b.place === 'sections')
    .sort((a, b) => (Number(a.order) || 100) - (Number(b.order) || 100))
    .map(b => {
      const live = botIsLive(b, t);
      return `<div class="pv-btn ${live ? '' : 'pv-off'}" style="${botBtnStyle(b.color)}">${escapeHtml(((b.icon || '') + ' ' + (b.label || '')).trim())}${live ? '' : `<span class="pv-tag">${escapeHtml(botButtonStatus(b, t).text)}</span>`}</div>`;
    }).join('');

  box.innerHTML = `
    <div class="pv-phone">
      <h5>${escapeHtml(String(s.menuTitle || '').trim() || 'МЕНЮ')}</h5>
      <div class="pv-nick">Нікнейм гравця</div>
      <div class="pv-money">1 000 ₴</div>
      ${banner}${gifts}
      ${menuItems.map(i => `<div class="pv-btn ${i.off ? 'pv-off' : ''}" style="${i.style}">${escapeHtml(i.label)}${i.off ? `<span class="pv-tag">${escapeHtml(i.tag)}</span>` : ''}</div>`).join('')}
    </div>
    ${hiddenNames.length ? `<p class="bot-hint" style="text-align:center">Приховані стандартні кнопки: ${escapeHtml(hiddenNames.join(', '))}</p>` : ''}
    ${sectionBtns ? `<div class="pv-phone"><h5>Екран «Обери тему» — додаткові кнопки</h5>${sectionBtns}</div>` : ''}`;
  botTick();
}

function botTick() {
  const els = document.querySelectorAll('[data-pv-timer]');
  if (!els.length) return;
  const t = botNow();
  for (const el of els) {
    const start = Number(el.dataset.start), end = Number(el.dataset.end);
    const st = t >= end ? 'ended' : (start && t < start ? 'soon' : 'active');
    if (el.dataset.state && st !== el.dataset.state) { botRenderAll(); return; }
    el.textContent = st === 'soon' ? '⏳ Старт через ' + botFmt(start - t) : '⏱ Лишилось ' + botFmt(end - t);
  }
}

function botLoadFrame() {
  const url = botEl('botGameUrl').value.trim();
  const wrap = botEl('botFrameWrap');
  if (!/^https:\/\//i.test(url)) { showToast('Вкажіть адресу, що починається з https://', true); return; }
  try { localStorage.setItem('botGameUrl', url); } catch (e) {}
  wrap.innerHTML = '';
  const f = document.createElement('iframe');
  f.id = 'botFrame';
  f.src = url;
  wrap.appendChild(f);
}

// ---------- Кнопки ----------
function botButtonStatus(b, t) {
  if (b.enabled === false) return { cls: 'off', text: 'вимкнена' };
  if (b.startAt && t < b.startAt) return { cls: 'wait', text: 'стартує ' + botDateText(b.startAt) };
  if (b.endAt && t >= b.endAt) return { cls: 'off', text: 'час показу минув' };
  return { cls: 'on', text: b.endAt ? 'активна до ' + botDateText(b.endAt) : 'активна' };
}

function botActionText(b) {
  if (b.action === 'link') return 'посилання: ' + (b.value || '');
  if (b.action === 'message') return 'повідомлення';
  const sc = BOT_SCREENS.find(x => x[0] === b.value);
  return 'розділ: ' + (sc ? sc[1] : b.value);
}

function botRenderButtonList() {
  const box = botEl('botBtnList');
  if (!box) return;
  const t = botNow();
  const list = Object.entries(botCfg.buttons || {}).map(([id, b]) => Object.assign({ id }, b))
    .sort((a, b) => String(a.place).localeCompare(String(b.place)) || (Number(a.order) || 100) - (Number(b.order) || 100));
  if (!list.length) { box.innerHTML = '<div style="color:#aaa;padding:10px;">Ще немає доданих кнопок</div>'; return; }
  box.innerHTML = list.map(b => {
    const st = botButtonStatus(b, t);
    return `<div class="list-item">
      <div style="min-width:0;flex:1">
        <div><b>${escapeHtml(((b.icon || '') + ' ' + (b.label || '')).trim())}</b><span class="bot-pill ${st.cls}">${escapeHtml(st.text)}</span></div>
        <div style="font-size:11px;color:#aaa">${b.place === 'sections' ? 'Екран тем' : 'Головне меню'} · ${escapeHtml(botActionText(b))} · порядок ${Number(b.order) || 100}</div>
      </div>
      <div class="bot-actions">
        <button class="btn btn-primary" title="Редагувати" data-bot-act="btn-edit" data-id="${escapeHtml(b.id)}">✏️</button>
        <button class="btn btn-warning" title="Увімкнути/вимкнути" data-bot-act="btn-toggle" data-id="${escapeHtml(b.id)}">${b.enabled === false ? '▶️' : '⏸️'}</button>
        <button class="btn btn-danger" title="Видалити" data-bot-act="btn-del" data-id="${escapeHtml(b.id)}">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function botResetButtonForm() {
  botEditBtnId = null;
  botEl('bfTitle').textContent = '➕ Нова кнопка';
  botEl('bfSaveBtn').textContent = '💾 Зберегти кнопку';
  botEl('bf-label').value = '';
  botEl('bf-icon').value = '';
  botEl('bf-color').value = 'default';
  botEl('bf-place').value = 'menu';
  botEl('bf-order').value = '100';
  botEl('bf-action').value = 'screen';
  botEl('bf-screen').value = 'sections';
  botEl('bf-link').value = '';
  botEl('bf-mtitle').value = '';
  botEl('bf-mtext').value = '';
  botEl('bf-enabled').checked = true;
  botEl('bf-sched').checked = false;
  botEl('bf-start').value = '';
  botEl('bf-end').value = '';
  botToggleFormParts();
}

function botEditButton(id) {
  const b = (botCfg.buttons || {})[id];
  if (!b) return;
  botEditBtnId = id;
  botEl('bfTitle').textContent = '✏️ Редагування кнопки';
  botEl('bfSaveBtn').textContent = '💾 Зберегти зміни';
  botEl('bf-label').value = b.label || '';
  botEl('bf-icon').value = b.icon || '';
  botEl('bf-color').value = BOT_COLORS[b.color] ? b.color : 'default';
  botEl('bf-place').value = b.place === 'sections' ? 'sections' : 'menu';
  botEl('bf-order').value = Number.isFinite(Number(b.order)) ? b.order : 100;
  botEl('bf-action').value = BOT_ACTIONS[b.action] ? b.action : 'screen';
  botEl('bf-screen').value = b.action === 'screen' ? b.value : 'sections';
  botEl('bf-link').value = b.action === 'link' ? (b.value || '') : '';
  botEl('bf-mtitle').value = b.title || '';
  botEl('bf-mtext').value = b.action === 'message' ? (b.value || '') : '';
  botEl('bf-enabled').checked = b.enabled !== false;
  botEl('bf-sched').checked = !!(b.startAt || b.endAt);
  botEl('bf-start').value = botToInput(b.startAt);
  botEl('bf-end').value = botToInput(b.endAt);
  botToggleFormParts();
  botEl('botBtnFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function botSaveButton() {
  if (!botGuard()) return;
  const label = botEl('bf-label').value.trim();
  const action = botEl('bf-action').value;
  if (!label) { showToast('Введіть текст кнопки', true); return; }

  let value = '';
  if (action === 'screen') value = botEl('bf-screen').value;
  if (action === 'link') {
    value = botEl('bf-link').value.trim();
    if (!/^https?:\/\/\S+$/i.test(value)) { showToast('Посилання має починатися з https://', true); return; }
  }
  if (action === 'message') {
    value = botEl('bf-mtext').value.trim();
    if (!value) { showToast('Введіть текст повідомлення', true); return; }
  }

  let startAt = null, endAt = null;
  if (botEl('bf-sched').checked) {
    startAt = botFromInput(botEl('bf-start').value);
    endAt = botFromInput(botEl('bf-end').value);
    if (!startAt && !endAt) { showToast('Вкажіть хоча б одну дату для таймера', true); return; }
    if (startAt && endAt && endAt <= startAt) { showToast('«До» має бути пізніше за «З»', true); return; }
  }
  const orderNum = parseInt(botEl('bf-order').value, 10);
  const old = botEditBtnId ? ((botCfg.buttons || {})[botEditBtnId] || {}) : {};
  const data = {
    label, icon: botEl('bf-icon').value.trim() || null, color: botEl('bf-color').value,
    place: botEl('bf-place').value, order: Number.isFinite(orderNum) ? orderNum : 100,
    enabled: botEl('bf-enabled').checked, action, value,
    title: action === 'message' ? (botEl('bf-mtitle').value.trim() || null) : null,
    startAt, endAt,
    createdAt: old.createdAt || firebase.database.ServerValue.TIMESTAMP,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    let key = botEditBtnId;
    if (key) await rtdb.ref('botConfig/buttons/' + key).set(data);
    else key = (await rtdb.ref('botConfig/buttons').push(data)).key;
    await writeAdminLog('bot_button_saved', 'Кнопка: ' + label, key);
    showToast('✅ Кнопку збережено — вона вже в боті');
    botResetButtonForm();
  } catch (e) {
    console.error(e);
    showToast('❌ Не вдалося зберегти (перевірте правила бази)', true);
  }
}

async function botToggleButton(id) {
  if (!botGuard()) return;
  const b = (botCfg.buttons || {})[id];
  if (!b) return;
  try {
    await rtdb.ref('botConfig/buttons/' + id + '/enabled').set(b.enabled === false);
    showToast(b.enabled === false ? '✅ Кнопку увімкнено' : '⏸️ Кнопку вимкнено');
  } catch (e) { console.error(e); showToast('❌ Помилка', true); }
}

async function botDeleteButton(id) {
  if (!botGuard()) return;
  const b = (botCfg.buttons || {})[id];
  if (!b || !confirm('Видалити кнопку «' + (b.label || '') + '»?')) return;
  try {
    await rtdb.ref('botConfig/buttons/' + id).remove();
    await writeAdminLog('bot_button_deleted', 'Видалено кнопку: ' + (b.label || ''), id);
    if (botEditBtnId === id) botResetButtonForm();
    showToast('✅ Кнопку видалено');
  } catch (e) { console.error(e); showToast('❌ Помилка видалення', true); }
}

// ---------- Стандартні кнопки ----------
function botFillBuiltin() {
  const cfg = botCfg.builtin || {};
  BOT_BUILTIN.forEach(b => {
    const c = cfg[b.key] || {};
    botEl('bi-label-' + b.key).value = c.label || '';
    botEl('bi-order-' + b.key).value = (c.order === undefined || c.order === null) ? '' : c.order;
    botEl('bi-hidden-' + b.key).checked = c.hidden === true;
  });
}

async function botSaveBuiltin() {
  if (!botGuard()) return;
  const out = {};
  BOT_BUILTIN.forEach(b => {
    const label = botEl('bi-label-' + b.key).value.trim();
    const ord = parseInt(botEl('bi-order-' + b.key).value, 10);
    const hidden = botEl('bi-hidden-' + b.key).checked;
    out[b.key] = { label: label || null, order: Number.isFinite(ord) ? ord : null, hidden };
  });
  if (out.play.hidden && !confirm('Ви ховаєте кнопку «ГРАТИ». Гравці не зможуть почати гру з меню. Продовжити?')) return;
  try {
    await rtdb.ref('botConfig/builtin').set(out);
    await writeAdminLog('bot_builtin_saved', 'Змінено стандартні кнопки меню');
    showToast('✅ Збережено');
  } catch (e) { console.error(e); showToast('❌ Не вдалося зберегти', true); }
}

// ---------- Роздачі ----------
function botGiftStatus(g, t) {
  if (g.enabled === false) return { cls: 'off', text: 'вимкнена' };
  if (t >= g.endAt) return { cls: 'off', text: 'завершена' };
  if (g.startAt && t < g.startAt) return { cls: 'wait', text: 'очікує старту' };
  return { cls: 'on', text: 'триває' };
}

function botRenderGiftList() {
  const box = botEl('botGiftList');
  if (!box) return;
  const t = botNow();
  const list = Object.entries(botCfg.giveaways || {}).map(([id, g]) => Object.assign({ id }, g))
    .sort((a, b) => (b.endAt || 0) - (a.endAt || 0));
  if (!list.length) { box.innerHTML = '<div style="color:#aaa;padding:10px;">Ще немає жодної роздачі</div>'; return; }
  box.innerHTML = list.map(g => {
    const st = botGiftStatus(g, t);
    const running = st.cls === 'on' || st.cls === 'wait';
    return `<div class="list-item">
      <div style="min-width:0;flex:1">
        <div><b>🎁 ${escapeHtml(g.title || 'Роздача')}</b><span class="bot-pill ${st.cls}">${escapeHtml(st.text)}</span></div>
        <div style="font-size:11px;color:#aaa">${Number(g.reward || 0).toLocaleString('uk-UA')} ₴ · ${escapeHtml(botDateText(g.startAt) || 'одразу')} → ${escapeHtml(botDateText(g.endAt))}</div>
      </div>
      <div class="bot-actions">
        <button class="btn btn-primary" title="Редагувати" data-bot-act="gift-edit" data-id="${escapeHtml(g.id)}">✏️</button>
        <button class="btn btn-success" title="Запустити знову (копія)" data-bot-act="gift-copy" data-id="${escapeHtml(g.id)}">📋</button>
        ${running ? `<button class="btn btn-warning" title="Зупинити зараз" data-bot-act="gift-stop" data-id="${escapeHtml(g.id)}">⏹️</button>` : ''}
        <button class="btn btn-danger" title="Видалити" data-bot-act="gift-del" data-id="${escapeHtml(g.id)}">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function botResetGiftForm() {
  botEditGiftId = null;
  botEl('gfTitle').textContent = '➕ Нова роздача';
  botEl('gf-title').value = '';
  botEl('gf-desc').value = '';
  botEl('gf-reward').value = '500';
  botEl('gf-start').value = '';
  botEl('gf-end').value = '';
  botEl('gf-enabled').checked = true;
}

function botSetGiftDuration(min) {
  const start = botFromInput(botEl('gf-start').value) || botNow();
  botEl('gf-end').value = botToInput(start + min * 60000);
}

function botEditGift(id, asCopy) {
  const g = (botCfg.giveaways || {})[id];
  if (!g) return;
  botEditGiftId = asCopy ? null : id;
  botEl('gfTitle').textContent = asCopy ? '📋 Нова роздача (копія)' : '✏️ Редагування роздачі';
  botEl('gf-title').value = (g.title || '') + (asCopy ? ' (копія)' : '');
  botEl('gf-desc').value = g.description || '';
  botEl('gf-reward').value = Number(g.reward) || 0;
  if (asCopy) {
    const dur = (g.endAt || 0) - (g.startAt || g.createdAt || 0);
    botEl('gf-start').value = '';
    botEl('gf-end').value = botToInput(botNow() + (dur > 0 ? dur : 3600000));
  } else {
    botEl('gf-start').value = botToInput(g.startAt);
    botEl('gf-end').value = botToInput(g.endAt);
  }
  botEl('gf-enabled').checked = g.enabled !== false;
  showToast(asCopy ? '📋 Перевірте час і збережіть' : '✏️ Редагуйте та збережіть');
  botEl('gfTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function botSaveGift() {
  if (!botGuard()) return;
  const title = botEl('gf-title').value.trim();
  const reward = parseInt(botEl('gf-reward').value, 10);
  const endAt = botFromInput(botEl('gf-end').value);
  const startInput = botFromInput(botEl('gf-start').value);
  const t = botNow();
  if (!title) { showToast('Введіть назву роздачі', true); return; }
  if (!Number.isFinite(reward) || reward < 0 || reward > 10000000) { showToast('Нагорода: від 0 до 10 000 000 ₴', true); return; }
  if (!endAt) { showToast('Вкажіть кінець роздачі (таймер)', true); return; }
  const startAt = startInput || (botEditGiftId ? ((botCfg.giveaways || {})[botEditGiftId] || {}).startAt || t : t);
  if (endAt <= startAt) { showToast('Кінець має бути пізніше за початок', true); return; }
  if (!botEditGiftId && endAt <= t) { showToast('Кінець роздачі вже в минулому', true); return; }

  const old = botEditGiftId ? ((botCfg.giveaways || {})[botEditGiftId] || {}) : {};
  const data = {
    title, description: botEl('gf-desc').value.trim() || null, reward, startAt, endAt,
    enabled: botEl('gf-enabled').checked,
    createdAt: old.createdAt || firebase.database.ServerValue.TIMESTAMP
  };
  try {
    let key = botEditGiftId;
    if (key) await rtdb.ref('botConfig/giveaways/' + key).set(data);
    else key = (await rtdb.ref('botConfig/giveaways').push(data)).key;
    await writeAdminLog('bot_giveaway_saved', 'Роздача: ' + title + ' (' + reward + ' ₴)', key);
    showToast('✅ Роздачу збережено — таймер запущено');
    botResetGiftForm();
  } catch (e) {
    console.error(e);
    showToast('❌ Не вдалося зберегти (перевірте правила бази)', true);
  }
}

async function botStopGift(id) {
  if (!botGuard()) return;
  const g = (botCfg.giveaways || {})[id];
  if (!g || !confirm('Зупинити роздачу «' + (g.title || '') + '» зараз?')) return;
  try {
    await rtdb.ref('botConfig/giveaways/' + id + '/endAt').set(botNow());
    await writeAdminLog('bot_giveaway_stopped', 'Зупинено роздачу: ' + (g.title || ''), id);
    showToast('⏹️ Роздачу зупинено');
  } catch (e) { console.error(e); showToast('❌ Помилка', true); }
}

async function botDeleteGift(id) {
  if (!botGuard()) return;
  const g = (botCfg.giveaways || {})[id];
  if (!g || !confirm('Видалити роздачу «' + (g.title || '') + '»?')) return;
  try {
    await rtdb.ref('botConfig/giveaways/' + id).remove();
    await writeAdminLog('bot_giveaway_deleted', 'Видалено роздачу: ' + (g.title || ''), id);
    if (botEditGiftId === id) botResetGiftForm();
    showToast('✅ Роздачу видалено');
  } catch (e) { console.error(e); showToast('❌ Помилка видалення', true); }
}

// ---------- Оголошення та заголовок ----------
function botFillSettings() {
  const s = botCfg.settings || {};
  const b = s.banner || {};
  botEl('sf-title').value = s.menuTitle || '';
  botEl('sf-banner-on').checked = b.enabled === true;
  botEl('sf-banner-text').value = b.text || '';
  botEl('sf-banner-color').value = BOT_BANNER_COLORS[b.color] ? b.color : 'gold';
  botEl('sf-banner-start').value = botToInput(b.startAt);
  botEl('sf-banner-end').value = botToInput(b.endAt);
}

async function botSaveSettings() {
  if (!botGuard()) return;
  const startAt = botFromInput(botEl('sf-banner-start').value);
  const endAt = botFromInput(botEl('sf-banner-end').value);
  const text = botEl('sf-banner-text').value.trim();
  const enabled = botEl('sf-banner-on').checked;
  if (enabled && !text) { showToast('Введіть текст оголошення', true); return; }
  if (startAt && endAt && endAt <= startAt) { showToast('«До» має бути пізніше за «З»', true); return; }
  const data = {
    menuTitle: botEl('sf-title').value.trim() || null,
    banner: { enabled, text: text || null, color: botEl('sf-banner-color').value, startAt, endAt }
  };
  try {
    await rtdb.ref('botConfig/settings').set(data);
    await writeAdminLog('bot_settings_saved', 'Змінено заголовок/оголошення бота');
    showToast('✅ Збережено — оголошення вже в боті');
  } catch (e) { console.error(e); showToast('❌ Не вдалося зберегти', true); }
}

botInitTab();
