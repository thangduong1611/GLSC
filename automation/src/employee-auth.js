// Ersetzt die bisherige "anonym + Personalnummer" Anmeldung von mitarbeiter.html
// durch eine echte Identitätsbindung: der Mitarbeiter meldet sich mit PID + PIN
// an, hier geprüft, und bekommt ein Firebase Custom Token mit uid `emp_<pid>`
// und Claim `pid` zurück. Vorher konnte JEDER anonyme Nutzer sich als jede
// beliebige Personalnummer ausgeben (Firestore-Regeln konnten das nicht
// unterscheiden — anonyme Auth hat keine Identität, nur "irgendwer ist
// angemeldet"). Jetzt kann firestore.rules `request.auth.token.pid` prüfen.
//
// Läuft mit Admin SDK (bypasst Firestore-Regeln bewusst, wie jede
// Cloud-Run-Route hier) — die eigentliche Prüfung passiert in diesem Skript.
// Erste Anmeldung eines Mitarbeiters legt den PIN fest (Self-Service, kein
// Admin muss PINs verteilen) — jede weitere Anmeldung muss ihn bestätigen.
const bcrypt = require('bcryptjs');
const { getDb, admin } = require('./firestore-client');

const PIN_REGEX = /^\d{4,6}$/;
// Sperr-Regeln (Änderung 20.09.2026, nach vielen Meldungen "Zu viele
// Fehlversuche"): früher 5 Versuche → immer 15 Min. Sperre — für Mitarbeiter,
// die ihren selbst gewählten PIN nach ein paar Tagen vergessen hatten, zu hart
// und ohne jede Vorwarnung. Jetzt 8 Versuche und eine STUFENWEISE steigende
// Sperre (5 → 15 → 30 Min.), die erst bei erfolgreichem Login wieder auf die
// erste Stufe zurückfällt: wer sich nur vertippt hat, wartet kurz; wer den PIN
// dauerhaft rät (Brute-Force), wird trotzdem auf ~16 Versuche/Stunde gebremst
// (früher 20/Stunde — also nicht schwächer als vorher).
const MAX_VERSUCHE = 8;
const SPERR_STUFEN_MIN = [5, 15, 30];

// opts.v >= 2: neuer Client (mitarbeiter.html vom 20.09.2026) — beim ersten
// Login MUSS der PIN zweimal eingegeben werden (opts.pinConfirm), damit ein
// Tippfehler nicht unbemerkt der "gültige" PIN wird. Alte, noch geöffnete
// Clients senden kein v und behalten das bisherige Verhalten (PIN sofort
// übernehmen), damit beim Ausrollen niemand plötzlich einen Fehler sieht.
async function employeeLogin(pid, pin, opts) {
  opts = opts || {};
  if (!pid || typeof pid !== 'string') { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!pin || !PIN_REGEX.test(pin)) { const e = new Error('pin_format'); e.status = 400; throw e; }

  const db = getDb();
  const ref = db.collection('emps').doc(pid);
  const doc = await ref.get();
  if (!doc.exists) { const e = new Error('not_found'); e.status = 404; throw e; }
  const d = doc.data() || {};
  if (d.active === false) { const e = new Error('inactive'); e.status = 403; throw e; }

  const now = Date.now();
  const lockedUntilMs = d.pinLockedUntil && d.pinLockedUntil.toMillis ? d.pinLockedUntil.toMillis() : 0;
  if (lockedUntilMs > now) {
    const e = new Error('locked'); e.status = 429;
    e.retryAfterMin = Math.max(1, Math.ceil((lockedUntilMs - now) / 60000));
    throw e;
  }

  let isNewPin = false;
  if (!d.pinHash) {
    // Erste Anmeldung überhaupt (oder Admin hat den PIN zurückgesetzt) — der
    // gerade eingegebene PIN wird als der neue, gültige PIN übernommen.
    if (opts.v >= 2) {
      if (typeof opts.pinConfirm !== 'string') { const e = new Error('pin_setup_required'); e.status = 409; throw e; }
      if (opts.pinConfirm !== pin) { const e = new Error('pin_mismatch'); e.status = 400; throw e; }
    }
    isNewPin = true;
    const hash = await bcrypt.hash(pin, 10);
    await ref.update({
      pinHash: hash, pinSetAt: admin.firestore.FieldValue.serverTimestamp(),
      pinFailCount: 0, pinLockedUntil: admin.firestore.FieldValue.delete(),
      pinLockCount: admin.firestore.FieldValue.delete(),
    });
  } else {
    const ok = await bcrypt.compare(pin, d.pinHash);
    if (!ok) {
      const failCount = (d.pinFailCount || 0) + 1;
      if (failCount >= MAX_VERSUCHE) {
        const stufe = d.pinLockCount || 0;
        const minuten = SPERR_STUFEN_MIN[Math.min(stufe, SPERR_STUFEN_MIN.length - 1)];
        await ref.update({
          pinFailCount: 0, pinLockCount: stufe + 1,
          pinLockedUntil: admin.firestore.Timestamp.fromMillis(now + minuten * 60 * 1000),
        });
        // Direkt "gesperrt" melden (statt einem letzten "falsch"), damit der
        // Mitarbeiter sofort die richtige Wartezeit sieht.
        const e = new Error('locked'); e.status = 429; e.retryAfterMin = minuten; throw e;
      }
      await ref.update({ pinFailCount: failCount });
      const e = new Error('wrong_pin'); e.status = 401;
      e.attemptsLeft = MAX_VERSUCHE - failCount;
      throw e;
    }
    if (d.pinFailCount || d.pinLockCount || d.pinLockedUntil) {
      await ref.update({
        pinFailCount: 0,
        pinLockCount: admin.firestore.FieldValue.delete(),
        pinLockedUntil: admin.firestore.FieldValue.delete(),
      });
    }
  }

  const token = await admin.auth().createCustomToken('emp_' + pid, { pid: pid });
  return { token, isNewPin };
}

module.exports = { employeeLogin, MAX_VERSUCHE, SPERR_STUFEN_MIN };
