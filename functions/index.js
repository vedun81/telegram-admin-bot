const { onCall, HttpsError } = require('firebase-functions/v1/https');
const admin = require('firebase-admin');

admin.initializeApp();

exports.adminSetUserPassword = onCall(async (data, context) => {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'Потрібна авторизація.');
  }

  const adminSnapshot = await admin.database().ref(`admins/${context.auth.uid}`).once('value');
  if (adminSnapshot.val() !== true) {
    throw new HttpsError('permission-denied', 'Недостатньо прав.');
  }

  const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
  const password = typeof data.password === 'string' ? data.password.trim() : '';
  if (!uid || password.length < 6 || password.length > 128) {
    throw new HttpsError('invalid-argument', 'Некоректний пароль або ідентифікатор гравця.');
  }

  try {
    await admin.auth().updateUser(uid, { password });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Обліковий запис гравця не знайдено.');
    }
    console.error('Could not update player password:', error);
    throw new HttpsError('internal', 'Не вдалося змінити пароль.');
  }

  try {
    await admin.database().ref('adminLogs').push({
      adminUid: context.auth.uid,
      action: 'password_changed',
      details: `Changed password for player ${uid}`,
      targetUid: uid,
      timestamp: admin.database.ServerValue.TIMESTAMP
    });
  } catch (error) {
    console.warn('Could not write password change audit log:', error);
  }

  return { ok: true };
});
