// Push-Benachrichtigung an alle Vize (Stellvertretung Gebietsleitung) einer
// Region, wenn in einer ihrer Filialen jemand krank wird oder (genehmigten)
// Urlaub bekommt - damit der Vize sofort weiß, wo evtl. ausgeholfen werden
// muss, ohne erst im Dienstplan nachzuschauen (Auftrag t.duong 01.10.2026).
// Nutzt die bereits vorhandene FCM-Token-Registrierung (mitarbeiter.html,
// maPushRegister -> emps/{id}.fcmTokens) - diese Datei ist die bisher
// fehlende SENDE-Seite dazu.
const { getDb, admin } = require('./firestore-client');

async function notifyVize({ region, filiale, name, type }) {
  if (!region || !filiale || !name || !['krank', 'urlaub'].includes(type)) {
    throw new Error('region/filiale/name/type fehlen oder type ungültig');
  }
  const db = getDb();
  const snap = await db.collection('emps').where('region', '==', region).where('vize', '==', true).get();
  const tokens = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (d.active === false) return;
    (d.fcmTokens || []).forEach((t) => tokens.push(t));
  });
  if (!tokens.length) return { sent: 0, failed: 0, reason: 'keine Vize mit registriertem Push-Token in dieser Region' };

  const title = type === 'krank' ? '🤒 Krankmeldung' : '🌴 Urlaub genehmigt';
  const body = `${name} - ${filiale}`;
  const resp = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
  });

  // Tokens, die der Browser/das Gerät gelöscht hat (z.B. App deinstalliert),
  // wieder aus den Profilen entfernen - sonst wächst die Liste nur und jeder
  // Versuch schlägt für diese Tokens erneut fehl.
  const invalid = [];
  resp.responses.forEach((r, i) => {
    if (!r.success && r.error && (r.error.code === 'messaging/registration-token-not-registered')) invalid.push(tokens[i]);
  });
  if (invalid.length) {
    const batch = db.batch();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const own = (d.fcmTokens || []).filter((t) => invalid.includes(t));
      if (own.length) batch.update(doc.ref, { fcmTokens: admin.firestore.FieldValue.arrayRemove(...own) });
    });
    await batch.commit().catch(() => {});
  }

  return { sent: resp.successCount, failed: resp.failureCount };
}

module.exports = { notifyVize };
