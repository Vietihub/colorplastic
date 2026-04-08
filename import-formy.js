/**
 * Import forem a materiálů do Firebase Realtime Database
 *
 * Požadavky:
 *   - Nainstalovaný Firebase CLI (npm install -g firebase-tools)
 *   - Přihlášení: firebase login
 *
 * Spuštění z adresáře colorplastic:
 *   firebase database:set /formy formy.json --project colorplastic-87a1c
 *
 * Případně přes Node.js z adresáře functions:
 *   node ../import-formy.js
 */

// === Node.js varianta (spustit z adresáře functions) ===
const admin = require('firebase-admin');
const path  = require('path');
const formy = require(path.join(__dirname, 'formy.json'));

admin.initializeApp({
  databaseURL: 'https://colorplastic-87a1c-default-rtdb.europe-west1.firebasedatabase.app'
});

const db = admin.database();
console.log(`Importuji ${Object.keys(formy).length} forem do /formy ...`);

db.ref('/formy').set(formy)
  .then(function() {
    console.log('✅ Hotovo! Formy jsou v databázi.');
    process.exit(0);
  })
  .catch(function(err) {
    console.error('❌ Chyba:', err.message);
    process.exit(1);
  });
