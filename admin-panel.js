// js/admin-panel.js
// Вхід — той самий нік і пароль, що й у грі, через справжній Firebase Authentication.
// Доступ до самої панелі відкривається тільки якщо в базі стоїть admins/{uid} = true
// (виставляється вручну через Firebase Console — див. README.md).

let currentUid = null;
let allPlayersCache = [];

// A separate audit trail for administrator operations.
async function writeAdminLog(action, details, targetUid = null) {
  if (!currentUid) return;
  try {
    await rtdb.ref('adminLogs').push({
      adminUid: currentUid,
      action,
      details,
      targetUid,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
  } catch (error) {
    // Do not make a completed admin action fail only because logging is blocked.
    console.warn('Could not write admin audit log:', error);
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

function logout() {
  writeAdminLog('logout', 'Administrator signed out');
  auth.signOut();
  currentUid = null;
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'block';
  document.getElementById('loginPass').value = '';
}

function switchTab(tab) {
  document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');
  document.getElementById('tabbtn-' + tab).classList.add('active');
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
        <button class="btn btn-primary" onclick="showResetHint('${escapeHtml(p.name||'').replace(/'/g,"&#39;")}')">🔑</button>
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

// ---------- Скидання пароля ----------
// Пряме скидання пароля іншого гравця з браузера неможливе — це навмисне
// обмеження Firebase Auth (безпека). Робиться окремим скриптом з Admin SDK,
// який виконує розробник зі свого комп'ютера: scripts/reset-password.js
function showResetHint(nick) {
  alert('Щоб скинути пароль гравцю "' + nick + '":\n\n' +
    '1. Відкрийте термінал у папці scripts вашого проєкту гри\n' +
    '2. Виконайте:\n   node reset-password.js "' + nick + '" НовийПароль123\n\n' +
    'Це не можна зробити прямо з браузера з міркувань безпеки.');
}
