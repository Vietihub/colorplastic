/**
 * ColorPlastic – Firebase Cloud Functions
 * Push notifikace při změnách dat
 *
 * Deploy: firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
admin.initializeApp();

const db = admin.database();

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER: Načte FCM tokeny pro zadané role
// ─────────────────────────────────────────────────────────────────────────────
async function getTokensForRoles(roles) {
  const snap = await db.ref('fcmTokens').once('value');
  const tokens = [];
  if (!snap.exists()) return tokens;
  snap.forEach(child => {
    const d = child.val();
    if (d && d.token && roles.includes(d.role)) {
      tokens.push(d.token);
    }
  });
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER: Odešle FCM multicast (max 500 tokenů na batch)
// ─────────────────────────────────────────────────────────────────────────────
async function sendPush(tokens, title, body, data = {}) {
  if (!tokens || !tokens.length) {
    console.log(`[FCM] Žádné tokeny pro: ${title}`);
    return;
  }
  // Stringify všechny data hodnoty (FCM vyžaduje string)
  const safeData = {};
  Object.keys(data).forEach(k => { safeData[k] = String(data[k] || ''); });

  const batches = [];
  for (let i = 0; i < tokens.length; i += 500) {
    batches.push(tokens.slice(i, i + 500));
  }
  for (const batch of batches) {
    try {
      const result = await admin.messaging().sendEachForMulticast({
        notification: { title, body },
        data:         safeData,
        tokens:       batch,
        android: {
          notification: {
            sound: 'default',
            channelId: 'colorplastic_main'
          }
        },
        apns: {
          payload: { aps: { sound: 'default' } }
        }
      });
      console.log(`[FCM] Odesláno: ${result.successCount} OK, ${result.failureCount} chyb`);
    } catch (err) {
      console.error('[FCM] Chyba odeslání:', err);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  1. PLÁN VÝROBY – změna → notifikuje mistra + seřizovače
// ═════════════════════════════════════════════════════════════════════════════
exports.onPlanChange = functions
  .region('europe-west1')
  .database.ref('/plan/{planKey}')
  .onWrite(async (change, context) => {
    const after  = change.after.val();
    const before = change.before.val();

    if (!after) return null; // smazání – nekomunikujeme

    const forma = after.forma || '';
    const mat   = after.mat   || '';
    const qty   = after.qty   || '';
    const cas   = after.cas   || '';

    let body;
    if (!before) {
      body = `Nový záznam: ${forma}${mat ? ' · ' + mat : ''}${qty ? ' · ' + qty + ' ks' : ''}${cas ? ' · ' + cas : ''}`;
    } else {
      // Pokud se změnil jen updatedAt, ignorujeme
      const relevantChange =
        before.forma !== after.forma ||
        before.mat   !== after.mat   ||
        before.qty   !== after.qty   ||
        before.cas   !== after.cas   ||
        before.susen !== after.susen;
      if (!relevantChange) return null;
      body = `Aktualizace: ${forma}${mat ? ' · ' + mat : ''}${qty ? ' · ' + qty + ' ks' : ''}${after.susen && !before.susen ? ' 🔥 SUŠIT' : ''}`;
    }

    const tokens = await getTokensForRoles(['mistr', 'serizovac']);
    await sendPush(tokens, '📋 Plán výroby', body, {
      type:    'plan',
      planKey: context.params.planKey
    });
    return null;
  });

// ═════════════════════════════════════════════════════════════════════════════
//  2. SUŠENÍ MATERIÁLU – nová notifikace → notifikuje mistra + seřizovače
// ═════════════════════════════════════════════════════════════════════════════
exports.onSusenNotification = functions
  .region('europe-west1')
  .database.ref('/notifications/{key}')
  .onCreate(async (snap, context) => {
    const n = snap.val();
    if (!n || n.typ !== 'susen') return null;

    const tokens = await getTokensForRoles(['mistr', 'serizovac']);
    await sendPush(tokens, 'Nutno sušit materiál 🔥', n.msg || '', {
      type: 'susen',
      key:  context.params.key
    });
    return null;
  });

// ═════════════════════════════════════════════════════════════════════════════
//  3. NOVÁ OBJEDNÁVKA → notifikuje vedoucího
// ═════════════════════════════════════════════════════════════════════════════
exports.onNewObjednavka = functions
  .region('europe-west1')
  .database.ref('/objednavky/{key}')
  .onCreate(async (snap, context) => {
    const o = snap.val();
    if (!o) return null;

    const body = `${o.item || 'Položka'} – ${o.qty || ''} ${o.unit || ''} (podal: ${o.podal || '–'})`;
    const tokens = await getTokensForRoles(['vedouci']);
    await sendPush(tokens, 'Nová objednávka', body, { type: 'objednavka' });
    return null;
  });

// ═════════════════════════════════════════════════════════════════════════════
//  4. ŽÁDOST O DOVOLENOU → notifikuje vedoucího
// ═════════════════════════════════════════════════════════════════════════════
exports.onNewDovolena = functions
  .region('europe-west1')
  .database.ref('/dovolene/{key}')
  .onCreate(async (snap, context) => {
    if (await isAlreadyProcessed(context.eventId)) return null;
    const d = snap.val();
    if (!d || d.status !== 'pending') return null;

    const typLbl = DOV_TYP[d.typ] || d.typ || '–';
    const body = `${d.jmeno || '–'} · ${typLbl}\n${fmtDate(d.od)} – ${fmtDate(d.doo)}`;
    const tokens = await getTokensForRoles(['vedouci']);
    await sendPush(tokens, 'Žádost o dovolenou', body, { type: 'dovolena' });
    return null;
  });

// ═════════════════════════════════════════════════════════════════════════════
//  5. SCHVÁLENÍ / ZAMÍTNUTÍ DOVOLENÉ → notifikuje mistra + seřizovače
// ═════════════════════════════════════════════════════════════════════════════
exports.onDovolenaStatusChange = functions
  .region('europe-west1')
  .database.ref('/dovolene/{key}/status')
  .onWrite(async (change, context) => {
    if (await isAlreadyProcessed(context.eventId)) return null;
    const after  = change.after.val();
    const before = change.before.val();

    if (!before || !after || after === before) return null;
    if (after === 'pending') return null;

    const snap = await db.ref(`dovolene/${context.params.key}`).once('value');
    const d    = snap.val();
    if (!d) return null;

    const statusLabel = after === 'approved' ? 'schválena ✅' : 'zamítnuta ❌';
    const typLbl = DOV_TYP[d.typ] || d.typ || '–';
    const body = `${d.jmeno || '–'} · ${typLbl}\n${fmtDate(d.od)} – ${fmtDate(d.doo)}`;
    const tokens = await getTokensForRoles(['mistr', 'serizovac']);
    await sendPush(tokens, `ColorPlastic – Dovolená ${statusLabel}`, body, { type: 'dovolena_status' });
    return null;
  });

// ═════════════════════════════════════════════════════════════════════════════
//  6. PŘESEŘÍZENÍ FORMY → notifikuje mistra + seřizovače
// ═════════════════════════════════════════════════════════════════════════════
exports.onFormaChange = functions
  .region('europe-west1')
  .database.ref('/formaChanges/{key}')
  .onCreate(async (snap, context) => {
    const f = snap.val();
    if (!f) return null;

    const body = `${f.machine || '–'}: ${f.formOff || '–'} → ${f.formOn || '–'} v ${f.changeTime || '–'}${f.dry ? ' 🔥' : ''}`;
    const tokens = await getTokensForRoles(['mistr', 'serizovac']);
    await sendPush(tokens, 'Přeseřízení formy', body, {
      type:    'forma',
      machine: f.machine || ''
    });
    return null;
  });

// ═════════════════════════════════════════════════════════════════════════════
//  7. SKLAD – požadavek na materiál → notifikuje vedoucího + skladníka
// ═════════════════════════════════════════════════════════════════════════════
// Formátování data: 2026-04-08 → 8.4.2026
function fmtDate(d) {
  if (!d) return '–';
  const p = String(d).split('-');
  if (p.length === 3) return `${parseInt(p[2])}.${parseInt(p[1])}.${p[0]}`;
  return d;
}

// Deduplikace – zabrání dvojímu odeslání stejné notifikace
async function isAlreadyProcessed(eventId) {
  const ref = db.ref(`_processedEvents/${eventId}`);
  const snap = await ref.once('value');
  if (snap.exists()) return true;
  await ref.set(Date.now());
  // Automaticky smaž po 10 minutách
  setTimeout(() => ref.remove().catch(() => {}), 600000);
  return false;
}

// Překlad typů dovolené
const DOV_TYP = {
  d: 'Dovolená',
  l: 'K lékaři',
  n: 'Nemocenská',
  v: 'Náhradní volno',
  j: 'Jiné'
};

// Překlad rolí
const ROLE_LABELS = {
  vedouci:   'Vedoucí',
  mistr:     'Mistr',
  serizovac: 'Seřizovač',
  kontrolor: 'Kontrolor',
  skladnik:  'Skladník',
  obsluha:   'Obsluha'
};

// Překlad stavů
const STATUS_LABELS = {
  pending:     '⏳ Čeká',
  ready:       '✅ Připraveno',
  unavailable: '❌ Nedostupné',
  searching:   '🔍 Hledá se',
  issued:      '📦 Vydáno',
  ordered:     '🔄 Objednáno',
  done:        '✅ Hotovo',
  cancelled:   '❌ Zrušeno',
  approved:    '✅ Schváleno',
  rejected:    '❌ Zamítnuto'
};

exports.onNewRequest = functions
  .region('europe-west1')
  .database.ref('/requests/{key}')
  .onCreate(async (snap, context) => {
    if (await isAlreadyProcessed(context.eventId)) return null;
    const r = snap.val();
    if (!r) return null;

    const worker = r.worker || '–';
    const urgent = r.priority === 'urgent' || r.priority === 'high';
    const body = `${r.material || '–'} · ${r.qty || ''} kg · ${r.machine || '–'}${urgent ? ' 🔴 Urgentní' : ''}\nZadal: ${worker}`;
    const tokens = await getTokensForRoles(['vedouci', 'skladnik']);
    await sendPush(tokens, '📩 Nový požadavek na materiál', body, { type: 'request' });
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
//  7b. Změna stavu požadavku → notifikuje mistra + seřizovače
// ─────────────────────────────────────────────────────────────────────────────
exports.onRequestStatusChange = functions
  .region('europe-west1')
  .database.ref('/requests/{key}/status')
  .onWrite(async (change, context) => {
    if (await isAlreadyProcessed(context.eventId)) return null;
    const after  = change.after.val();
    const before = change.before.val();

    // Přeskočit: vytvoření nového záznamu (before je null) nebo beze změny
    if (!before || !after || after === before) return null;
    if (after === 'pending') return null;

    const snap = await db.ref(`requests/${context.params.key}`).once('value');
    const r    = snap.val();
    if (!r) return null;

    const statusCz = STATUS_LABELS[after] || after;
    const body = `${r.material || '–'} · ${r.qty || ''} kg · ${r.machine || '–'}\nStav: ${statusCz}`;
    const tokens = await getTokensForRoles(['mistr', 'serizovac', 'vedouci']);
    await sendPush(tokens, 'Stav požadavku', body, { type: 'request_status' });
    return null;
  });

// ═════════════════════════════════════════════════════════════════════════════
//  8. SKLAD – alert (nízká zásoba) → notifikuje mistra + seřizovače + vedoucího
// ═════════════════════════════════════════════════════════════════════════════
exports.onSkladAlert = functions
  .region('europe-west1')
  .database.ref('/skladAlerts/{key}')
  .onCreate(async (snap, context) => {
    const a = snap.val();
    if (!a) return null;

    const body = `${a.material || '–'} · ${a.qty || ''} ks · ${a.machine || '–'}${a.note ? ' · ' + a.note : ''}`;
    const tokens = await getTokensForRoles(['mistr', 'serizovac', 'vedouci', 'skladnik']);
    await sendPush(tokens, 'Upozornění sklad', body, { type: 'sklad' });
    return null;
  });
