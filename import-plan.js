/**
 * Smazání demo dat a import reálného plánu KW15 do Firebase Realtime Database
 *
 * Spuštění z adresáře colorplastic:
 *   node import-plan.js
 *
 * Nebo přes Firebase CLI (pouze import bez mazání):
 *   firebase database:set /plan plan.json --project colorplastic-87a1c
 */

const admin = require('firebase-admin');
const path  = require('path');
const plan  = require(path.join(__dirname, 'plan.json'));

admin.initializeApp({
  databaseURL: 'https://colorplastic-87a1c-default-rtdb.europe-west1.firebasedatabase.app'
});

const db = admin.database();

console.log('🗑️  Mažu demo data z /plan ...');

db.ref('/plan').remove()
  .then(function() {
    console.log('✅ Demo data smazána.');
    console.log(`📥 Importuji ${Object.keys(plan).length} záznamů KW15 do /plan ...`);
    return db.ref('/plan').set(plan);
  })
  .then(function() {
    console.log('✅ Hotovo! Plán KW15 je v databázi.');
    process.exit(0);
  })
  .catch(function(err) {
    console.error('❌ Chyba:', err.message);
    process.exit(1);
  });
