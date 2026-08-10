// js/firebase-config.js
// Той самий проєкт Firebase, що й у грі UkrMova Pro.
// apiKey тут не є секретом (він публічний за задумом Firebase) —
// реальний захист забезпечують Security Rules бази даних, а не цей ключ.

const firebaseConfig = {
  apiKey: "AIzaSyCr7fiw5bBbwGxWGw2IeQbhFeIQC6CWMT0",
  authDomain: "ukrmova-game.firebaseapp.com",
  databaseURL: "https://ukrmova-game-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ukrmova-game",
  storageBucket: "ukrmova-game.firebasestorage.app",
  messagingSenderId: "308588793628",
  appId: "1:308588793628:web:3e644485e493f01c17f4d9"
};

firebase.initializeApp(firebaseConfig);
firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

const auth = firebase.auth();
const rtdb = firebase.database();

const NICK_EMAIL_DOMAIN = "ukrmova.app";

function nickToEmail(nick) {
  return nick.trim().toLowerCase() + "@" + NICK_EMAIL_DOMAIN;
}

// Ідентична функція є в грі (js/firebase-config.js) і в скрипті міграції —
// має лишатись такою самою, інакше логін з коротким старим паролем не спрацює.
function normalizePassword(pass) {
  let p = String(pass || '');
  if (p.length >= 6) return p;
  if (p.length === 0) return 'x'.repeat(6);
  let out = p;
  while (out.length < 6) out += p;
  return out;
}

async function dbGet(path) {
  const snap = await rtdb.ref(path).get();
  return snap.exists() ? snap.val() : null;
}
async function dbSet(path, value) { return rtdb.ref(path).set(value); }
async function dbUpdate(path, value) { return rtdb.ref(path).update(value); }
async function dbRemove(path) { return rtdb.ref(path).remove(); }

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}
