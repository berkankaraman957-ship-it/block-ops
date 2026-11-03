'use strict';
/*
 * Builds the static web bundle for Capacitor into ./www
 *   node scripts/build-mobile.js [--server https://your.game.server]
 * Copies public/, shared/shared.js and the Socket.io client bundle, and bakes the server URL
 * into www/config.js (mobile apps are served from capacitor://localhost, so the
 * game server must be an absolute https URL).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const argIdx = process.argv.indexOf('--server');
const serverUrl = argIdx > 0 ? process.argv[argIdx + 1] : (process.env.BLOCKOPS_SERVER || '');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(path.join(ROOT, 'public'), OUT);
fs.mkdirSync(path.join(OUT, 'shared'), { recursive: true });
for (const f of ['shared.js', 'maps.js', 'cosmetics.js']) fs.copyFileSync(path.join(ROOT, 'shared', f), path.join(OUT, 'shared', f));
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
let client;
try {
  let dir = path.dirname(require.resolve('socket.io'));
  for (let i = 0; i < 4 && !client; i++) {
    const f = path.join(dir, 'client-dist', 'socket.io.min.js');
    if (fs.existsSync(f)) client = f;
    dir = path.dirname(dir);
  }
  if (!client) throw new Error('client-dist not found');
}
catch (e) { console.error('socket.io bulunamadı — önce "npm install" çalıştırın.'); process.exit(1); }
fs.copyFileSync(client, path.join(OUT, 'vendor', 'socket.io.min.js'));
fs.writeFileSync(path.join(OUT, 'config.js'),
  `window.BLOCKOPS_CONFIG = { serverUrl: ${JSON.stringify(serverUrl)} };\n`);
if (!serverUrl) console.warn('UYARI: --server verilmedi. Mobil uygulama, menüdeki "Sunucu Adresi" alanına girilen adrese bağlanır.');
console.log('www/ hazır. Sunucu:', serverUrl || '(kullanıcı girecek)');
