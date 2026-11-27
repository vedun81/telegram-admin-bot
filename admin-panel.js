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
  bot_giveaway_deleted: 'Бот: видалено роздачу', bot_unlock: 'Бот: розблоковано вкладку',
  bot_block_saved: 'Бот: збережено блок', bot_block_deleted: 'Бот: видалено блок',
  bot_page_saved: 'Бот: збережено сторінку', bot_page_deleted: 'Бот: видалено сторінку',
  bot_layout_saved: 'Бот: змінено порядок елементів'
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
// Усе, що ви тут створюєте, зберігається у Firebase (botConfig) і
// миттєво з'являється в грі/боті — без правок коду й перезавантаження.
//
// Що можна: кнопки (розділ / власна сторінка / посилання / повідомлення),
// текст, картинки, роздільники, власні сторінки, роздачі з таймером,
// щоденні нагороди, банер; усе це перетягується у вкладці «Макет».
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
  blue: ['Синій', '#d6efff', '#0b4a70']
};
const BOT_TEXT_COLORS = {
  default: ['Чорний', '#111'], gold: ['Золотий', '#b8860b'], green: ['Зелений', '#1e8449'],
  red: ['Червоний', '#c0392b'], purple: ['Фіолетовий', '#7d3c98'], blue: ['Синій', '#1f618d']
};
const BOT_TEXT_SIZES = { small: ['Дрібний', 12], normal: ['Звичайний', 15], large: ['Великий', 20], xl: ['Дуже великий', 26] };
// Стандартні кнопки гри (їх можна перейменувати, сховати, переставити)
const BOT_BUILTIN = [
  { key: 'play', place: 'menu', name: 'ГРАТИ', order: 10, color: 'default' },
  { key: 'top', place: 'menu', name: 'ТОП', order: 20, color: 'dark' },
  { key: 'shop', place: 'menu', name: 'КРАМНИЧКА', order: 30, color: 'green' },
  { key: 'cabinet', place: 'menu', name: '📦 МОЯ СКРИНЬКА', order: 40, color: 'purple' },
  { key: 's_structure', place: 'sections', name: '🧩 РОЗДІЛ І. Будова слова', order: 10, color: 'default' },
  { key: 's_formation', place: 'sections', name: '🛠️ РОЗДІЛ ІІ. Словотвір', order: 20, color: 'default' },
  { key: 's_speech', place: 'sections', name: '📚 РОЗДІЛ ІІІ. Частини мови', order: 30, color: 'default' },
  { key: 's_fraz', place: 'sections', name: '💬 Фразеологізми', order: 40, color: 'default' },
  { key: 's_anti', place: 'sections', name: '🗣️ Антисуржик', order: 50, color: 'default' },
  { key: 's_punct', place: 'sections', name: '✍️ Пунктуація', order: 60, color: 'default' },
  { key: 's_apos', place: 'sections', name: '’ Апостроф', order: 70, color: 'default' },
  { key: 's_custom', place: 'sections', name: '📝 Додаткові тести', order: 80, color: 'default' }
];
const BOT_ACTIONS = {
  screen: 'Відкрити розділ гри', page: 'Відкрити мою сторінку',
  link: 'Відкрити посилання', message: 'Показати повідомлення'
};
const BOT_BLOCK_TYPES = { text: '📝 Текст', image: '🖼️ Картинка', divider: '➖ Роздільник' };

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
let botEditBlockId = null;
let botEditGiftId = null;
let botEditPageId = null;
let botFormsLoaded = false;
let botDrag = null;

// ---------- Допоміжні ----------
const botEl = id => document.getElementById(id);
const botAttr = v => escapeHtml(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function botNum(v, d) {
  if (v === null || v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function botIsLive(o, t) {
  if (!o || o.enabled === false) return false;
  if (o.startAt && t < o.startAt) return false;
  if (o.endAt && t >= o.endAt) return false;
  return true;
}
const botNow = () => Date.now() + botServerOffset;
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
function botOptions(map) {
  return Object.entries(map).map(([k, v]) => `<option value="${k}">${escapeHtml(Array.isArray(v) ? v[0] : v)}</option>`).join('');
}
function botFillSelect(id, html) {
  const el = botEl(id);
  if (!el) return;
  const old = el.value;
  el.innerHTML = html;
  if (old && Array.from(el.options).some(o => o.value === old)) el.value = old;
}
function botPlaces() {
  const arr = [['menu', 'Головне меню'], ['sections', 'Екран «Обери тему»']];
  Object.entries(botCfg.pages || {}).forEach(([id, p]) => arr.push(['page:' + id, 'Сторінка: ' + (p.title || id)]));
  return arr;
}
function botPlaceName(place) {
  const f = botPlaces().find(p => p[0] === place);
  return f ? f[1] : place;
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
    #panel-bot .lay-row{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);border-radius:14px;padding:8px 10px;margin-bottom:6px;user-select:none}
    #panel-bot .lay-row.lay-drag{outline:2px solid #ffd700;background:rgba(255,215,0,.18)}
    #panel-bot .lay-row.lay-dim{opacity:.55}
    #panel-bot .lay-handle{font-size:22px;line-height:1;cursor:grab;touch-action:none;padding:4px 6px;color:#ffd700}
    #panel-bot .lay-main{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis}
    #panel-bot .lay-sub{font-size:11px;color:#aaa}
    .pv-phone{max-width:300px;margin:0 auto 12px;background:rgba(255,255,255,.92);color:#000;border-radius:24px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
    .pv-phone h5{text-align:center;font-size:15px;margin-bottom:4px}
    .pv-cap{max-width:300px;margin:0 auto 4px;font-size:11px;color:#aaa;text-align:center}
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
    .pv-text{margin:6px 0;white-space:pre-wrap;word-break:break-word}
    .pv-img{margin:6px 0;text-align:center}
    .pv-img img{max-width:100%;border-radius:12px}
    .pv-img small{display:block;font-size:11px;color:#444}
    .pv-empty{text-align:center;font-size:12px;color:#777;padding:10px}
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
  panel.addEventListener('pointerdown', botDragStart);
  document.addEventListener('pointermove', botDragMove);
  document.addEventListener('pointerup', botDragEnd);
  document.addEventListener('pointercancel', botDragEnd);

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
    if (!botFormsLoaded) { botFillSettings(); botFormsLoaded = true; }
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

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
      <h3 style="margin:0">🤖 Керування ботом</h3>
      <button class="btn btn-warning" data-bot-act="lock">🔒 Заблокувати</button>
    </div>
    <div class="tabs bot-subtabs">
      <button class="tab" data-bot-sub="preview">👁️ Бот зараз</button>
      <button class="tab" data-bot-sub="layout">🧩 Макет</button>
      <button class="tab" data-bot-sub="buttons">🔘 Кнопки</button>
      <button class="tab" data-bot-sub="blocks">📝 Блоки</button>
      <button class="tab" data-bot-sub="gifts">🎁 Роздачі</button>
      <button class="tab" data-bot-sub="pages">📄 Сторінки</button>
      <button class="tab" data-bot-sub="settings">⚙️ Оголошення</button>
    </div>

    <div class="bot-sub" id="botSub-preview">
      <p class="bot-hint">Так бота бачать гравці просто зараз. Тьмяні елементи з пунктирною рамкою гравці не бачать (вимкнено, сховано або ще не настав час).</p>
      <div id="botPreviewBox"></div>
      <div class="bot-card">
        <h4>🎮 Жива гра (необов'язково)</h4>
        <p class="bot-hint">Вставте адресу вашої гри (https://…), щоб побачити її справжній вигляд прямо тут.</p>
        <input type="url" id="botGameUrl" placeholder="https://ваша-гра.example">
        <button class="btn btn-primary btn-full" data-bot-act="frame-load">Показати гру</button>
        <div id="botFrameWrap"></div>
      </div>
    </div>

    <div class="bot-sub" id="botSub-layout" style="display:none">
      <div class="bot-card">
        <h4>🧩 Розташування елементів</h4>
        <p class="bot-hint">Тягніть за ⠿, щоб змінити порядок — збережеться одразу. Стандартні кнопки теж можна рухати, ховати й перейменовувати.</p>
        <label>Де редагуємо</label>
        <select id="lay-place"></select>
        <div class="bot-chips" id="layAddBar">
          <span class="bot-hint" style="width:100%;margin:0">Додати сюди:</span>
          <button class="btn" data-bot-act="lay-add" data-what="button">🔘 Кнопку</button>
          <button class="btn" data-bot-act="lay-add" data-what="text">📝 Текст</button>
          <button class="btn" data-bot-act="lay-add" data-what="image">🖼️ Картинку</button>
          <button class="btn" data-bot-act="lay-add" data-what="divider">➖ Роздільник</button>
          <button class="btn" data-bot-act="lay-add" data-what="gift" id="layAddGift">🎁 Роздачу</button>
        </div>
      </div>
      <div id="botLayoutList"></div>
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
          <div><label>Де показати</label><select id="bf-place"></select></div>
          <div><label>Порядок (менше — вище)</label><input type="number" id="bf-order" value="100"></div>
        </div>
        <label>Що робить кнопка</label>
        <select id="bf-action">${botOptions(BOT_ACTIONS)}</select>
        <div id="bf-wrap-screen"><label>Який розділ відкрити</label><select id="bf-screen">${screenOpts}</select></div>
        <div id="bf-wrap-page" style="display:none"><label>Яку сторінку відкрити</label><select id="bf-page"></select>
          <p class="bot-hint">Сторінки створюються у вкладці «📄 Сторінки».</p></div>
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
    </div>

    <div class="bot-sub" id="botSub-blocks" style="display:none">
      <div class="bot-card" id="botBlockFormCard">
        <h4 id="bkTitle">➕ Новий блок</h4>
        <label>Тип блока</label>
        <select id="bk-type">${botOptions(BOT_BLOCK_TYPES)}</select>
        <label>Де показати</label>
        <select id="bk-place"></select>
        <div id="bk-wrap-text">
          <label id="bk-text-label">Текст</label>
          <textarea id="bk-text" maxlength="1000" rows="4" placeholder="Напишіть що завгодно"></textarea>
        </div>
        <div id="bk-wrap-textstyle">
          <div class="bot-row">
            <div><label>Розмір</label><select id="bk-size">${Object.entries(BOT_TEXT_SIZES).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>
            <div><label>Вирівнювання</label><select id="bk-align"><option value="left">Ліворуч</option><option value="center">По центру</option><option value="right">Праворуч</option></select></div>
          </div>
          <div class="bot-row">
            <div><label>Колір</label><select id="bk-color">${botOptions(BOT_TEXT_COLORS)}</select></div>
            <div><label class="bot-check" style="margin-top:28px"><input type="checkbox" id="bk-bold"> Жирний</label></div>
          </div>
        </div>
        <div id="bk-wrap-image" style="display:none">
          <label>Адреса картинки (https://…)</label>
          <input type="url" id="bk-url" placeholder="https://site.com/picture.jpg">
          <label>Ширина, % від екрана</label>
          <input type="number" id="bk-width" min="10" max="100" value="100">
        </div>
        <div id="bk-wrap-divider" style="display:none">
          <label>Висота відступу, px</label>
          <input type="number" id="bk-height" min="4" max="200" value="16">
          <label class="bot-check"><input type="checkbox" id="bk-line" checked> Показувати лінію</label>
        </div>
        <label>Порядок (менше — вище)</label>
        <input type="number" id="bk-order" value="100">
        <label class="bot-check"><input type="checkbox" id="bk-enabled" checked> Увімкнений</label>
        <label class="bot-check"><input type="checkbox" id="bk-sched"> Показувати за таймером</label>
        <div id="bk-wrap-sched" style="display:none">
          <label>Показувати з</label><input type="datetime-local" id="bk-start">
          <label>Показувати до</label><input type="datetime-local" id="bk-end">
        </div>
        <button class="btn btn-success btn-full" id="bkSaveBtn" data-bot-act="block-save">💾 Зберегти блок</button>
        <button class="btn btn-full" style="background:rgba(255,255,255,.15);color:#eee" data-bot-act="block-cancel">↺ Очистити форму</button>
      </div>
      <p class="bot-hint">Список усіх блоків і їх порядок — у вкладці «🧩 Макет».</p>
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
        <label class="bot-check"><input type="checkbox" id="gf-daily"> 🔁 Щоденна нагорода (кожен гравець забирає раз на добу)</label>
        <p class="bot-hint">Для щоденної «Кінець» можна залишити порожнім — тоді кнопка буде завжди. Нова доба починається о 00:00 за UTC (02:00 за Києвом узимку).</p>
        <label class="bot-check"><input type="checkbox" id="gf-enabled" checked> Увімкнена</label>
        <button class="btn btn-success btn-full" data-bot-act="gift-save">💾 Зберегти роздачу</button>
        <button class="btn btn-full" style="background:rgba(255,255,255,.15);color:#eee" data-bot-act="gift-cancel">↺ Очистити форму</button>
      </div>
      <h3>Усі роздачі</h3>
      <div id="botGiftList"></div>
    </div>

    <div class="bot-sub" id="botSub-pages" style="display:none">
      <div class="bot-card">
        <h4 id="pgTitle">➕ Нова сторінка</h4>
        <p class="bot-hint">Сторінка — це окремий екран у боті, на який ви ставите будь-які кнопки, тексти й картинки (вкладка «🧩 Макет»).</p>
        <div class="bot-row">
          <div style="flex:3"><label>Назва сторінки</label><input type="text" id="pg-title" maxlength="40" placeholder="Напр.: Новини"></div>
          <div style="flex:1"><label>Емодзі</label><input type="text" id="pg-icon" maxlength="4" placeholder="📰"></div>
        </div>
        <label class="bot-check"><input type="checkbox" id="pg-enabled" checked> Увімкнена</label>
        <label class="bot-check" id="pg-menu-wrap"><input type="checkbox" id="pg-menu" checked> Додати кнопку на цю сторінку в головне меню</label>
        <button class="btn btn-success btn-full" id="pgSaveBtn" data-bot-act="page-save">💾 Зберегти сторінку</button>
        <button class="btn btn-full" style="background:rgba(255,255,255,.15);color:#eee" data-bot-act="page-cancel">↺ Очистити форму</button>
      </div>
      <h3>Мої сторінки</h3>
      <div id="botPageList"></div>
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
        <select id="sf-banner-color">${botOptions(BOT_BANNER_COLORS)}</select>
        <label>Показувати з (необов'язково)</label><input type="datetime-local" id="sf-banner-start">
        <label>Показувати до (необов'язково)</label><input type="datetime-local" id="sf-banner-end">
        <p class="bot-hint">Положення банера змінюється перетягуванням у вкладці «🧩 Макет».</p>
      </div>
      <button class="btn btn-success btn-full" data-bot-act="settings-save">💾 Зберегти оголошення</button>
    </div>`;

  try { botEl('botGameUrl').value = localStorage.getItem('botGameUrl') || ''; } catch (e) {}
  botEditBtnId = botEditBlockId = botEditGiftId = botEditPageId = null;
  botShowSub(botSub);
  botToggleFormParts();
  botToggleBlockParts();
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
  botEl('bf-wrap-page').style.display = a.value === 'page' ? 'block' : 'none';
  botEl('bf-wrap-link').style.display = a.value === 'link' ? 'block' : 'none';
  botEl('bf-wrap-message').style.display = a.value === 'message' ? 'block' : 'none';
  botEl('bf-wrap-sched').style.display = botEl('bf-sched').checked ? 'block' : 'none';
}

function botToggleBlockParts() {
  const t = botEl('bk-type');
  if (!t) return;
  botEl('bk-wrap-text').style.display = t.value === 'divider' ? 'none' : 'block';
  botEl('bk-text-label').textContent = t.value === 'image' ? 'Підпис під картинкою (необов\'язково)' : 'Текст';
  botEl('bk-wrap-textstyle').style.display = t.value === 'text' ? 'block' : 'none';
  botEl('bk-wrap-image').style.display = t.value === 'image' ? 'block' : 'none';
  botEl('bk-wrap-divider').style.display = t.value === 'divider' ? 'block' : 'none';
  botEl('bk-wrap-sched').style.display = botEl('bk-sched').checked ? 'block' : 'none';
}

// ---------- Обробники подій ----------
function botOnChange(e) {
  const id = e.target.id;
  if (id === 'bf-action' || id === 'bf-sched') botToggleFormParts();
  else if (id === 'bk-type' || id === 'bk-sched') botToggleBlockParts();
  else if (id === 'lay-place') botRenderLayout();
}

function botOnClick(e) {
  const subBtn = e.target.closest('[data-bot-sub]');
  if (subBtn) { botShowSub(subBtn.dataset.botSub); return; }
  const el = e.target.closest('[data-bot-act]');
  if (!el) return;
  const id = el.dataset.id, kind = el.dataset.kind;
  switch (el.dataset.botAct) {
    case 'unlock': botTryUnlock(); break;
    case 'lock': lockBotTab(); break;
    case 'frame-load': botLoadFrame(); break;
    case 'btn-save': botSaveButton(); break;
    case 'btn-cancel': botResetButtonForm(); break;
    case 'btn-edit': botEditButton(id); break;
    case 'btn-toggle': botLayToggle('button', id); break;
    case 'btn-del': botDeleteButton(id); break;
    case 'block-save': botSaveBlock(); break;
    case 'block-cancel': botResetBlockForm(); break;
    case 'gift-dur': botSetGiftDuration(Number(el.dataset.min)); break;
    case 'gift-save': botSaveGift(); break;
    case 'gift-cancel': botResetGiftForm(); break;
    case 'gift-edit': botEditGift(id, false); break;
    case 'gift-copy': botEditGift(id, true); break;
    case 'gift-stop': botStopGift(id); break;
    case 'gift-del': botDeleteGift(id); break;
    case 'page-save': botSavePage(); break;
    case 'page-cancel': botResetPageForm(); break;
    case 'page-edit': botEditPage(id); break;
    case 'page-content': botEl('lay-place').value = 'page:' + id; botShowSub('layout'); botRenderLayout(); break;
    case 'page-del': botDeletePage(id); break;
    case 'settings-save': botSaveSettings(); break;
    case 'lay-add': botLayAdd(el.dataset.what); break;
    case 'lay-edit': botLayEdit(kind, id); break;
    case 'lay-toggle': botLayToggle(kind, id); break;
    case 'lay-del': botLayDelete(kind, id); break;
  }
}

// ---------- Збір елементів одного місця (спільне для прев'ю і макета) ----------
function botBlockLabel(b) {
  if (b.type === 'image') return '🖼️ ' + (b.text ? b.text.slice(0, 40) : 'Картинка');
  if (b.type === 'divider') return '➖ Роздільник';
  return '📝 ' + String(b.text || '').replace(/\s+/g, ' ').slice(0, 40);
}

function botCollect(place, t) {
  const items = [];
  const cfg = botCfg;
  BOT_BUILTIN.filter(b => b.place === place).forEach(b => {
    const c = (cfg.builtin || {})[b.key] || {};
    items.push({
      kind: 'builtin', id: b.key, order: botNum(c.order, b.order),
      label: String(c.label || '').trim() || b.name, color: b.color,
      live: c.hidden !== true, tag: c.hidden === true ? 'сховано' : '', hidden: c.hidden === true, sub: 'стандартна кнопка гри'
    });
  });
  Object.entries(cfg.buttons || {}).forEach(([id, b]) => {
    if (!b || (b.place || 'menu') !== place) return;
    const st = botButtonStatus(b, t);
    items.push({
      kind: 'button', id, order: botNum(b.order, 100), label: ((b.icon || '') + ' ' + (b.label || '')).trim(),
      color: b.color, live: st.cls === 'on', tag: st.cls === 'on' ? '' : st.text, hidden: b.enabled === false,
      sub: 'кнопка · ' + botActionText(b)
    });
  });
  Object.entries(cfg.blocks || {}).forEach(([id, b]) => {
    if (!b || (b.place || 'menu') !== place) return;
    const st = botButtonStatus(b, t);
    items.push({
      kind: 'block', id, order: botNum(b.order, 100), label: botBlockLabel(b), b,
      live: st.cls === 'on', tag: st.cls === 'on' ? '' : st.text, hidden: b.enabled === false,
      sub: (BOT_BLOCK_TYPES[b.type] || 'блок').replace(/^\S+\s/, '')
    });
  });
  if (place === 'menu') {
    Object.entries(cfg.giveaways || {}).forEach(([id, g]) => {
      if (!g || (g.endAt && t >= g.endAt)) return;
      if (!g.daily && !g.endAt) return;
      const st = botGiftStatus(g, t);
      items.push({
        kind: 'gift', id, order: botNum(g.order, -50), label: (g.daily ? '🔁 ' : '🎁 ') + (g.title || 'Роздача'), g,
        live: st.cls === 'on', tag: st.cls === 'on' ? '' : st.text, hidden: g.enabled === false,
        sub: (g.daily ? 'щоденна нагорода' : 'роздача') + ' · ' + Number(g.reward || 0).toLocaleString('uk-UA') + ' ₴'
      });
    });
    const bn = (cfg.settings || {}).banner;
    if (bn && bn.text) {
      const live = botIsLive({ enabled: bn.enabled === true, startAt: bn.startAt, endAt: bn.endAt }, t);
      items.push({
        kind: 'banner', id: 'banner', order: botNum(bn.order, -100), label: '📢 ' + String(bn.text).replace(/\s+/g, ' ').slice(0, 40), bn,
        live, tag: live ? '' : 'не показується', hidden: bn.enabled !== true, sub: 'банер-оголошення'
      });
    }
  }
  items.sort((a, b) => a.order - b.order);
  return items;
}

// ---------- Перегляд «Бот зараз» ----------
function botRenderAll() {
  if (!botUnlocked || !botEl('botPreviewBox')) return;
  const places = botPlaces();
  const pageOpts = Object.entries(botCfg.pages || {}).map(([id, p]) => `<option value="${botAttr(id)}">${escapeHtml(p.title || id)}</option>`).join('');
  const placeOpts = places.map(([v, n]) => `<option value="${botAttr(v)}">${escapeHtml(n)}</option>`).join('');
  botFillSelect('lay-place', placeOpts);
  botFillSelect('bf-place', placeOpts);
  botFillSelect('bk-place', placeOpts);
  botFillSelect('bf-page', pageOpts || '<option value="">— ще немає сторінок —</option>');
  botRenderPreview();
  botRenderLayout();
  botRenderButtonList();
  botRenderGiftList();
  botRenderPageList();
}

function botItemHtml(i) {
  const dim = i.live ? '' : ' pv-off';
  const tag = (!i.live && i.tag) ? `<span class="pv-tag">${escapeHtml(i.tag)}</span>` : '';
  if (i.kind === 'builtin' || i.kind === 'button') {
    const c = BOT_COLORS[i.color] || BOT_COLORS.default;
    return `<div class="pv-btn${dim}" style="background:${c[1]};color:${c[2]}">${escapeHtml(i.label)}${tag}</div>`;
  }
  if (i.kind === 'block') {
    const b = i.b;
    if (b.type === 'image') {
      return `<div class="pv-img${dim}"><img src="${botAttr(b.url || '')}" style="width:${Math.min(100, Math.max(10, botNum(b.width, 100)))}%" referrerpolicy="no-referrer" alt="">${b.text ? `<small>${escapeHtml(b.text)}</small>` : ''}${tag}</div>`;
    }
    if (b.type === 'divider') {
      const h = Math.min(200, Math.max(4, botNum(b.height, 16)));
      return `<div class="${dim.trim()}" style="height:${h / 2}px;margin-bottom:${h / 2}px;${b.line !== false ? 'border-bottom:1px solid rgba(0,0,0,.18)' : ''}"></div>`;
    }
    const size = (BOT_TEXT_SIZES[b.size] || BOT_TEXT_SIZES.normal)[1];
    const col = (BOT_TEXT_COLORS[b.color] || BOT_TEXT_COLORS.default)[1];
    const al = ['left', 'center', 'right'].includes(b.align) ? b.align : 'left';
    return `<div class="pv-text${dim}" style="font-size:${size}px;text-align:${al};font-weight:${b.bold ? 800 : 400};color:${col}">${escapeHtml(b.text || '')}${tag}</div>`;
  }
  if (i.kind === 'gift') {
    const g = i.g, t = botNow();
    const soon = g.startAt && t < g.startAt;
    return `<div class="pv-gift ${soon ? 'soon' : ''}${dim}">
      <b>${escapeHtml(i.label)}</b>
      ${g.description ? `<small>${escapeHtml(g.description)}</small>` : ''}
      ${g.daily && !g.endAt ? '<span class="pv-timer">🔁 Нагорода щодня</span>' : `<span class="pv-timer" data-pv-timer data-start="${Number(g.startAt) || 0}" data-end="${Number(g.endAt)}" data-state="${soon ? 'soon' : 'active'}"></span>`}
      ${!soon && Number(g.reward) > 0 ? `<div class="pv-claim">${g.daily ? 'Забрати щоденну нагороду: ' : 'Забрати '}${Number(g.reward).toLocaleString('uk-UA')} ₴</div>` : ''}
      ${tag}
    </div>`;
  }
  if (i.kind === 'banner') {
    const col = BOT_BANNER_COLORS[i.bn.color] || BOT_BANNER_COLORS.gold;
    return `<div class="pv-banner${dim}" style="background:${col[1]};color:${col[2]}">${escapeHtml(i.bn.text)}${tag}</div>`;
  }
  return '';
}

function botRenderPreview() {
  const box = botEl('botPreviewBox');
  const t = botNow();
  const s = botCfg.settings || {};
  const phone = (title, place, head) => {
    const items = botCollect(place, t);
    return `<div class="pv-phone"><h5>${escapeHtml(title)}</h5>${head || ''}
      ${items.length ? items.map(botItemHtml).join('') : '<div class="pv-empty">Порожньо — додайте елементи у вкладці «Макет»</div>'}</div>`;
  };
  let html = `<div class="pv-cap">Головне меню</div>` +
    phone(String(s.menuTitle || '').trim() || 'МЕНЮ', 'menu', '<div class="pv-nick">Нікнейм гравця</div><div class="pv-money">1 000 ₴</div>') +
    `<div class="pv-cap">Екран «Обери тему»</div>` + phone('Обери тему', 'sections', '');
  Object.entries(botCfg.pages || {}).forEach(([id, p]) => {
    html += `<div class="pv-cap">Сторінка «${escapeHtml(p.title || id)}»${p.enabled === false ? ' (вимкнена)' : ''}</div>` +
      phone(((p.icon || '') + ' ' + (p.title || '')).trim(), 'page:' + id, '');
  });
  box.innerHTML = html;
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

// ---------- 🧩 Макет: список, перетягування, швидкі дії ----------
const BOT_KIND_ICON = { builtin: '🧱', button: '🔘', block: '📝', gift: '🎁', banner: '📢' };

function botRenderLayout() {
  const box = botEl('botLayoutList');
  const sel = botEl('lay-place');
  if (!box || !sel) return;
  const place = sel.value || 'menu';
  botEl('layAddGift').style.display = place === 'menu' ? '' : 'none';
  const items = botCollect(place, botNow());
  if (!items.length) { box.innerHTML = '<div style="color:#aaa;padding:10px;">Тут ще порожньо — додайте елемент кнопками вище</div>'; return; }
  box.innerHTML = items.map(i => `
    <div class="lay-row ${i.hidden || !i.live ? 'lay-dim' : ''}" data-kind="${i.kind}" data-id="${botAttr(i.id)}">
      <span class="lay-handle" title="Перетягніть">⠿</span>
      <div class="lay-main">
        <div>${BOT_KIND_ICON[i.kind] || ''} <b>${escapeHtml(i.label)}</b>${i.tag ? `<span class="bot-pill ${i.hidden ? 'off' : 'wait'}">${escapeHtml(i.tag)}</span>` : ''}</div>
        <div class="lay-sub">${escapeHtml(i.sub || '')}</div>
      </div>
      <div class="bot-actions">
        <button class="btn btn-primary" title="${i.kind === 'builtin' ? 'Перейменувати' : 'Редагувати'}" data-bot-act="lay-edit" data-kind="${i.kind}" data-id="${botAttr(i.id)}">✏️</button>
        <button class="btn btn-warning" title="${i.hidden ? 'Показати' : 'Сховати'}" data-bot-act="lay-toggle" data-kind="${i.kind}" data-id="${botAttr(i.id)}">${i.hidden ? '👁️' : '🙈'}</button>
        ${i.kind === 'builtin' || i.kind === 'banner' ? '' : `<button class="btn btn-danger" title="Видалити" data-bot-act="lay-del" data-kind="${i.kind}" data-id="${botAttr(i.id)}">🗑️</button>`}
      </div>
    </div>`).join('');
}

function botDragStart(e) {
  const h = e.target.closest && e.target.closest('.lay-handle');
  if (!h) return;
  const row = h.closest('.lay-row');
  if (!row) return;
  e.preventDefault();
  botDrag = { row, list: row.parentNode };
  row.classList.add('lay-drag');
}
function botDragMove(e) {
  if (!botDrag) return;
  e.preventDefault && e.preventDefault();
  const rows = Array.from(botDrag.list.querySelectorAll('.lay-row')).filter(r => r !== botDrag.row);
  let before = null;
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    if (e.clientY < b.top + b.height / 2) { before = r; break; }
  }
  if (before !== botDrag.row.nextSibling) botDrag.list.insertBefore(botDrag.row, before);
  if (e.clientY < 70) window.scrollBy(0, -12);
  else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
}
function botDragEnd() {
  if (!botDrag) return;
  botDrag.row.classList.remove('lay-drag');
  botDrag = null;
  botCommitLayout();
}

async function botCommitLayout() {
  if (!botGuard()) return;
  const rows = Array.from(document.querySelectorAll('#botLayoutList .lay-row'));
  const upd = {};
  rows.forEach((r, i) => {
    const order = (i + 1) * 10, kind = r.dataset.kind, id = r.dataset.id;
    const path = { builtin: 'builtin/' + id + '/order', button: 'buttons/' + id + '/order', block: 'blocks/' + id + '/order',
      gift: 'giveaways/' + id + '/order', banner: 'settings/banner/order' }[kind];
    if (path) upd[path] = order;
  });
  if (!Object.keys(upd).length) return;
  try {
    await rtdb.ref('botConfig').update(upd);
    await writeAdminLog('bot_layout_saved', 'Змінено порядок елементів: ' + botPlaceName(botEl('lay-place').value));
    showToast('✅ Порядок збережено — бот уже оновився');
  } catch (e) { console.error(e); showToast('❌ Не вдалося зберегти порядок', true); }
}

function botLayAdd(what) {
  const place = botEl('lay-place').value || 'menu';
  if (what === 'button') {
    botResetButtonForm();
    botEl('bf-place').value = place;
    botShowSub('buttons');
  } else if (what === 'gift') {
    botResetGiftForm();
    botShowSub('gifts');
  } else {
    botResetBlockForm();
    botEl('bk-type').value = what;
    botEl('bk-place').value = place;
    botToggleBlockParts();
    botShowSub('blocks');
  }
}

function botLayEdit(kind, id) {
  if (kind === 'button') { botShowSub('buttons'); botEditButton(id); }
  else if (kind === 'block') { botShowSub('blocks'); botEditBlock(id); }
  else if (kind === 'gift') { botShowSub('gifts'); botEditGift(id, false); }
  else if (kind === 'banner') { botShowSub('settings'); }
  else if (kind === 'builtin') botRenameBuiltin(id);
}

async function botRenameBuiltin(key) {
  if (!botGuard()) return;
  const def = BOT_BUILTIN.find(b => b.key === key);
  if (!def) return;
  const cur = ((botCfg.builtin || {})[key] || {}).label || '';
  const v = prompt('Новий текст кнопки (порожньо — стандартний «' + def.name + '»):', cur);
  if (v === null) return;
  try {
    await rtdb.ref('botConfig/builtin/' + key + '/label').set(v.trim() || null);
    await writeAdminLog('bot_builtin_saved', 'Перейменовано стандартну кнопку: ' + (v.trim() || def.name));
    showToast('✅ Збережено');
  } catch (e) { console.error(e); showToast('❌ Не вдалося зберегти', true); }
}

async function botLayToggle(kind, id) {
  if (!botGuard()) return;
  let path, val;
  if (kind === 'builtin') { const c = (botCfg.builtin || {})[id] || {}; path = 'builtin/' + id + '/hidden'; val = c.hidden !== true; }
  else if (kind === 'button') { const b = (botCfg.buttons || {})[id]; if (!b) return; path = 'buttons/' + id + '/enabled'; val = b.enabled === false; }
  else if (kind === 'block') { const b = (botCfg.blocks || {})[id]; if (!b) return; path = 'blocks/' + id + '/enabled'; val = b.enabled === false; }
  else if (kind === 'gift') { const g = (botCfg.giveaways || {})[id]; if (!g) return; path = 'giveaways/' + id + '/enabled'; val = g.enabled === false; }
  else if (kind === 'banner') { const bn = (botCfg.settings || {}).banner || {}; path = 'settings/banner/enabled'; val = bn.enabled !== true; }
  else return;
  if (kind === 'builtin' && id === 'play' && val === true && !confirm('Ви ховаєте кнопку «ГРАТИ». Гравці не зможуть почати гру з меню. Продовжити?')) return;
  try {
    await rtdb.ref('botConfig/' + path).set(val);
    showToast('✅ Збережено');
  } catch (e) { console.error(e); showToast('❌ Помилка', true); }
}

function botLayDelete(kind, id) {
  if (kind === 'button') botDeleteButton(id);
  else if (kind === 'block') botDeleteBlock(id);
  else if (kind === 'gift') botDeleteGift(id);
}

// ---------- Кнопки ----------
function botButtonStatus(b, t) {
  if (b.enabled === false) return { cls: 'off', text: 'вимкнено' };
  if (b.startAt && t < b.startAt) return { cls: 'wait', text: 'стартує ' + botDateText(b.startAt) };
  if (b.endAt && t >= b.endAt) return { cls: 'off', text: 'час показу минув' };
  return { cls: 'on', text: b.endAt ? 'активно до ' + botDateText(b.endAt) : 'активно' };
}

function botActionText(b) {
  if (b.action === 'link') return 'посилання: ' + (b.value || '');
  if (b.action === 'message') return 'повідомлення';
  if (b.action === 'page') { const p = (botCfg.pages || {})[b.value]; return 'сторінка: ' + (p ? p.title : '(видалена)'); }
  const sc = BOT_SCREENS.find(x => x[0] === b.value);
  return 'розділ: ' + (sc ? sc[1] : b.value);
}

function botRenderButtonList() {
  const box = botEl('botBtnList');
  if (!box) return;
  const t = botNow();
  const list = Object.entries(botCfg.buttons || {}).map(([id, b]) => Object.assign({ id }, b))
    .sort((a, b) => String(a.place).localeCompare(String(b.place)) || botNum(a.order, 100) - botNum(b.order, 100));
  if (!list.length) { box.innerHTML = '<div style="color:#aaa;padding:10px;">Ще немає доданих кнопок</div>'; return; }
  box.innerHTML = list.map(b => {
    const st = botButtonStatus(b, t);
    return `<div class="list-item">
      <div style="min-width:0;flex:1">
        <div><b>${escapeHtml(((b.icon || '') + ' ' + (b.label || '')).trim())}</b><span class="bot-pill ${st.cls}">${escapeHtml(st.text)}</span></div>
        <div style="font-size:11px;color:#aaa">${escapeHtml(botPlaceName(b.place || 'menu'))} · ${escapeHtml(botActionText(b))} · порядок ${botNum(b.order, 100)}</div>
      </div>
      <div class="bot-actions">
        <button class="btn btn-primary" title="Редагувати" data-bot-act="btn-edit" data-id="${botAttr(b.id)}">✏️</button>
        <button class="btn btn-warning" title="Увімкнути/вимкнути" data-bot-act="btn-toggle" data-id="${botAttr(b.id)}">${b.enabled === false ? '▶️' : '⏸️'}</button>
        <button class="btn btn-danger" title="Видалити" data-bot-act="btn-del" data-id="${botAttr(b.id)}">🗑️</button>
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
  botEl('bf-place').value = b.place || 'menu';
  botEl('bf-order').value = botNum(b.order, 100);
  botEl('bf-action').value = BOT_ACTIONS[b.action] ? b.action : 'screen';
  botEl('bf-screen').value = b.action === 'screen' ? b.value : 'sections';
  if (b.action === 'page') botEl('bf-page').value = b.value;
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
  if (action === 'page') {
    value = botEl('bf-page').value;
    if (!value) { showToast('Спершу створіть сторінку у вкладці «Сторінки»', true); return; }
  }
  if (action === 'link') {
    value = botEl('bf-link').value.trim();
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(value)) { showToast('Посилання має починатися з https://', true); return; }
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
    place: botEl('bf-place').value || 'menu', order: Number.isFinite(orderNum) ? orderNum : 100,
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

// ---------- Блоки: текст / картинка / роздільник ----------
function botResetBlockForm() {
  botEditBlockId = null;
  botEl('bkTitle').textContent = '➕ Новий блок';
  botEl('bkSaveBtn').textContent = '💾 Зберегти блок';
  botEl('bk-type').value = 'text';
  botEl('bk-place').value = 'menu';
  botEl('bk-text').value = '';
  botEl('bk-size').value = 'normal';
  botEl('bk-align').value = 'left';
  botEl('bk-color').value = 'default';
  botEl('bk-bold').checked = false;
  botEl('bk-url').value = '';
  botEl('bk-width').value = '100';
  botEl('bk-height').value = '16';
  botEl('bk-line').checked = true;
  botEl('bk-order').value = '100';
  botEl('bk-enabled').checked = true;
  botEl('bk-sched').checked = false;
  botEl('bk-start').value = '';
  botEl('bk-end').value = '';
  botToggleBlockParts();
}

function botEditBlock(id) {
  const b = (botCfg.blocks || {})[id];
  if (!b) return;
  botEditBlockId = id;
  botEl('bkTitle').textContent = '✏️ Редагування блока';
  botEl('bkSaveBtn').textContent = '💾 Зберегти зміни';
  botEl('bk-type').value = BOT_BLOCK_TYPES[b.type] ? b.type : 'text';
  botEl('bk-place').value = b.place || 'menu';
  botEl('bk-text').value = b.text || '';
  botEl('bk-size').value = BOT_TEXT_SIZES[b.size] ? b.size : 'normal';
  botEl('bk-align').value = b.align || 'left';
  botEl('bk-color').value = BOT_TEXT_COLORS[b.color] ? b.color : 'default';
  botEl('bk-bold').checked = b.bold === true;
  botEl('bk-url').value = b.url || '';
  botEl('bk-width').value = botNum(b.width, 100);
  botEl('bk-height').value = botNum(b.height, 16);
  botEl('bk-line').checked = b.line !== false;
  botEl('bk-order').value = botNum(b.order, 100);
  botEl('bk-enabled').checked = b.enabled !== false;
  botEl('bk-sched').checked = !!(b.startAt || b.endAt);
  botEl('bk-start').value = botToInput(b.startAt);
  botEl('bk-end').value = botToInput(b.endAt);
  botToggleBlockParts();
  botEl('botBlockFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function botSaveBlock() {
  if (!botGuard()) return;
  const type = botEl('bk-type').value;
  const text = botEl('bk-text').value.trim();
  const url = botEl('bk-url').value.trim();
  if (type === 'text' && !text) { showToast('Введіть текст', true); return; }
  if (type === 'image' && !/^https:\/\/[^\s"'<>]+$/i.test(url)) { showToast('Адреса картинки має починатися з https://', true); return; }
  let startAt = null, endAt = null;
  if (botEl('bk-sched').checked) {
    startAt = botFromInput(botEl('bk-start').value);
    endAt = botFromInput(botEl('bk-end').value);
    if (!startAt && !endAt) { showToast('Вкажіть хоча б одну дату для таймера', true); return; }
    if (startAt && endAt && endAt <= startAt) { showToast('«До» має бути пізніше за «З»', true); return; }
  }
  const order = parseInt(botEl('bk-order').value, 10);
  const old = botEditBlockId ? ((botCfg.blocks || {})[botEditBlockId] || {}) : {};
  const data = {
    type, place: botEl('bk-place').value || 'menu', order: Number.isFinite(order) ? order : 100,
    enabled: botEl('bk-enabled').checked, startAt, endAt,
    text: type === 'divider' ? null : (text || null),
    size: type === 'text' ? botEl('bk-size').value : null,
    align: type === 'text' ? botEl('bk-align').value : null,
    color: type === 'text' ? botEl('bk-color').value : null,
    bold: type === 'text' ? botEl('bk-bold').checked : null,
    url: type === 'image' ? url : null,
    width: type === 'image' ? Math.min(100, Math.max(10, parseInt(botEl('bk-width').value, 10) || 100)) : null,
    height: type === 'divider' ? Math.min(200, Math.max(4, parseInt(botEl('bk-height').value, 10) || 16)) : null,
    line: type === 'divider' ? botEl('bk-line').checked : null,
    createdAt: old.createdAt || firebase.database.ServerValue.TIMESTAMP,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    let key = botEditBlockId;
    if (key) await rtdb.ref('botConfig/blocks/' + key).set(data);
    else key = (await rtdb.ref('botConfig/blocks').push(data)).key;
    await writeAdminLog('bot_block_saved', 'Блок: ' + (BOT_BLOCK_TYPES[type] || type), key);
    showToast('✅ Блок збережено — він уже в боті');
    botResetBlockForm();
  } catch (e) {
    console.error(e);
    showToast('❌ Не вдалося зберегти (перевірте правила бази)', true);
  }
}

async function botDeleteBlock(id) {
  if (!botGuard()) return;
  const b = (botCfg.blocks || {})[id];
  if (!b || !confirm('Видалити цей блок?')) return;
  try {
    await rtdb.ref('botConfig/blocks/' + id).remove();
    await writeAdminLog('bot_block_deleted', 'Видалено блок', id);
    if (botEditBlockId === id) botResetBlockForm();
    showToast('✅ Блок видалено');
  } catch (e) { console.error(e); showToast('❌ Помилка видалення', true); }
}

// ---------- Власні сторінки ----------
function botRenderPageList() {
  const box = botEl('botPageList');
  if (!box) return;
  const list = Object.entries(botCfg.pages || {}).map(([id, p]) => Object.assign({ id }, p));
  if (!list.length) { box.innerHTML = '<div style="color:#aaa;padding:10px;">Ще немає жодної сторінки</div>'; return; }
  box.innerHTML = list.map(p => {
    const count = Object.values(botCfg.buttons || {}).filter(b => b.place === 'page:' + p.id).length +
      Object.values(botCfg.blocks || {}).filter(b => b.place === 'page:' + p.id).length;
    return `<div class="list-item">
      <div style="min-width:0;flex:1">
        <div><b>${escapeHtml(((p.icon || '') + ' ' + (p.title || '')).trim())}</b>${p.enabled === false ? '<span class="bot-pill off">вимкнена</span>' : '<span class="bot-pill on">активна</span>'}</div>
        <div style="font-size:11px;color:#aaa">елементів на сторінці: ${count}</div>
      </div>
      <div class="bot-actions">
        <button class="btn btn-success" title="Вміст сторінки" data-bot-act="page-content" data-id="${botAttr(p.id)}">🧩 Вміст</button>
        <button class="btn btn-primary" title="Редагувати" data-bot-act="page-edit" data-id="${botAttr(p.id)}">✏️</button>
        <button class="btn btn-danger" title="Видалити" data-bot-act="page-del" data-id="${botAttr(p.id)}">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function botResetPageForm() {
  botEditPageId = null;
  botEl('pgTitle').textContent = '➕ Нова сторінка';
  botEl('pgSaveBtn').textContent = '💾 Зберегти сторінку';
  botEl('pg-title').value = '';
  botEl('pg-icon').value = '';
  botEl('pg-enabled').checked = true;
  botEl('pg-menu').checked = true;
  botEl('pg-menu-wrap').style.display = '';
}

function botEditPage(id) {
  const p = (botCfg.pages || {})[id];
  if (!p) return;
  botEditPageId = id;
  botEl('pgTitle').textContent = '✏️ Редагування сторінки';
  botEl('pgSaveBtn').textContent = '💾 Зберегти зміни';
  botEl('pg-title').value = p.title || '';
  botEl('pg-icon').value = p.icon || '';
  botEl('pg-enabled').checked = p.enabled !== false;
  botEl('pg-menu-wrap').style.display = 'none';
}

async function botSavePage() {
  if (!botGuard()) return;
  const title = botEl('pg-title').value.trim();
  if (!title) { showToast('Введіть назву сторінки', true); return; }
  const icon = botEl('pg-icon').value.trim() || null;
  const old = botEditPageId ? ((botCfg.pages || {})[botEditPageId] || {}) : {};
  const data = { title, icon, enabled: botEl('pg-enabled').checked, createdAt: old.createdAt || firebase.database.ServerValue.TIMESTAMP };
  try {
    let key = botEditPageId;
    if (key) await rtdb.ref('botConfig/pages/' + key).set(data);
    else {
      key = (await rtdb.ref('botConfig/pages').push(data)).key;
      if (botEl('pg-menu').checked) {
        await rtdb.ref('botConfig/buttons').push({
          label: title, icon, color: 'purple', place: 'menu', order: 100, enabled: true,
          action: 'page', value: key, createdAt: firebase.database.ServerValue.TIMESTAMP
        });
      }
    }
    await writeAdminLog('bot_page_saved', 'Сторінка: ' + title, key);
    showToast('✅ Сторінку збережено');
    botResetPageForm();
  } catch (e) {
    console.error(e);
    showToast('❌ Не вдалося зберегти (перевірте правила бази)', true);
  }
}

async function botDeletePage(id) {
  if (!botGuard()) return;
  const p = (botCfg.pages || {})[id];
  if (!p || !confirm('Видалити сторінку «' + (p.title || '') + '» разом з усім її вмістом і кнопками, що на неї ведуть?')) return;
  const upd = { ['pages/' + id]: null };
  Object.entries(botCfg.buttons || {}).forEach(([bid, b]) => { if (b.place === 'page:' + id || (b.action === 'page' && b.value === id)) upd['buttons/' + bid] = null; });
  Object.entries(botCfg.blocks || {}).forEach(([bid, b]) => { if (b.place === 'page:' + id) upd['blocks/' + bid] = null; });
  try {
    await rtdb.ref('botConfig').update(upd);
    await writeAdminLog('bot_page_deleted', 'Видалено сторінку: ' + (p.title || ''), id);
    if (botEditPageId === id) botResetPageForm();
    showToast('✅ Сторінку видалено');
  } catch (e) { console.error(e); showToast('❌ Помилка видалення', true); }
}

// ---------- Роздачі ----------
function botGiftStatus(g, t) {
  if (g.enabled === false) return { cls: 'off', text: 'вимкнено' };
  if (g.endAt && t >= g.endAt) return { cls: 'off', text: 'завершена' };
  if (g.startAt && t < g.startAt) return { cls: 'wait', text: 'очікує старту' };
  return { cls: 'on', text: 'триває' };
}

function botRenderGiftList() {
  const box = botEl('botGiftList');
  if (!box) return;
  const t = botNow();
  const list = Object.entries(botCfg.giveaways || {}).map(([id, g]) => Object.assign({ id }, g))
    .sort((a, b) => (b.endAt || Infinity) - (a.endAt || Infinity));
  if (!list.length) { box.innerHTML = '<div style="color:#aaa;padding:10px;">Ще немає жодної роздачі</div>'; return; }
  box.innerHTML = list.map(g => {
    const st = botGiftStatus(g, t);
    const running = st.cls === 'on' || st.cls === 'wait';
    return `<div class="list-item">
      <div style="min-width:0;flex:1">
        <div><b>${g.daily ? '🔁' : '🎁'} ${escapeHtml(g.title || 'Роздача')}</b><span class="bot-pill ${st.cls}">${escapeHtml(st.text)}</span>${g.daily ? '<span class="bot-pill">щодня</span>' : ''}</div>
        <div style="font-size:11px;color:#aaa">${Number(g.reward || 0).toLocaleString('uk-UA')} ₴ · ${escapeHtml(botDateText(g.startAt) || 'одразу')} → ${escapeHtml(botDateText(g.endAt) || 'без кінця')}</div>
      </div>
      <div class="bot-actions">
        <button class="btn btn-primary" title="Редагувати" data-bot-act="gift-edit" data-id="${botAttr(g.id)}">✏️</button>
        <button class="btn btn-success" title="Запустити знову (копія)" data-bot-act="gift-copy" data-id="${botAttr(g.id)}">📋</button>
        ${running ? `<button class="btn btn-warning" title="Зупинити зараз" data-bot-act="gift-stop" data-id="${botAttr(g.id)}">⏹️</button>` : ''}
        <button class="btn btn-danger" title="Видалити" data-bot-act="gift-del" data-id="${botAttr(g.id)}">🗑️</button>
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
  botEl('gf-daily').checked = false;
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
    botEl('gf-end').value = g.endAt ? botToInput(botNow() + (dur > 0 ? dur : 3600000)) : '';
  } else {
    botEl('gf-start').value = botToInput(g.startAt);
    botEl('gf-end').value = botToInput(g.endAt);
  }
  botEl('gf-enabled').checked = g.enabled !== false;
  botEl('gf-daily').checked = g.daily === true;
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
  const daily = botEl('gf-daily').checked;
  if (!endAt && !daily) { showToast('Вкажіть кінець роздачі (таймер)', true); return; }
  const startAt = startInput || (botEditGiftId ? ((botCfg.giveaways || {})[botEditGiftId] || {}).startAt || t : t);
  if (endAt && endAt <= startAt) { showToast('Кінець має бути пізніше за початок', true); return; }
  if (!botEditGiftId && endAt && endAt <= t) { showToast('Кінець роздачі вже в минулому', true); return; }

  const old = botEditGiftId ? ((botCfg.giveaways || {})[botEditGiftId] || {}) : {};
  const data = {
    title, description: botEl('gf-desc').value.trim() || null, reward, startAt, endAt: endAt || null, daily,
    enabled: botEl('gf-enabled').checked,
    order: old.order === undefined ? null : old.order,
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
  const oldBanner = (botCfg.settings || {}).banner || {};
  const data = {
    menuTitle: botEl('sf-title').value.trim() || null,
    banner: {
      enabled, text: text || null, color: botEl('sf-banner-color').value, startAt, endAt,
      order: oldBanner.order === undefined ? null : oldBanner.order
    }
  };
  try {
    await rtdb.ref('botConfig/settings').set(data);
    await writeAdminLog('bot_settings_saved', 'Змінено заголовок/оголошення бота');
    showToast('✅ Збережено — оголошення вже в боті');
  } catch (e) { console.error(e); showToast('❌ Не вдалося зберегти', true); }
}

botInitTab();
