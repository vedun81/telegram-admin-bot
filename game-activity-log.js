// Include this file in the game after firebase-config.js.
// Example: recordGameActivity(currentUser.uid, currentUser.nick, 'purchase', 'Bought premium pack');
async function recordGameActivity(uid, nick, type, details = '') {
  if (!uid || !nick || !type) return;
  return rtdb.ref('logs/' + uid).push({
    uid,
    nick,
    type,
    details,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
}

// Event types used by the admin panel:
// login, logout, purchase, friend_added, friend_removed, game_started, game_finished
