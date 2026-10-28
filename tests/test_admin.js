const fs = require('fs');
const htmlPath = process.argv[2] || '' + require('path').join(__dirname,'..','src','admin.html') + '';
const html = fs.readFileSync(htmlPath, 'utf8');
const demoPriv = fs.readFileSync('' + require('path').join(__dirname,'..','admin-tools','DEMO_ONLY_private_key.txt') + '', 'utf8').trim();
const demoPub = fs.readFileSync('' + require('path').join(__dirname,'..','keys','public_key.txt') + '', 'utf8').trim();
let failures = 0;
const check = (l, c) => { console.log(c ? 'PASS' : 'FAIL', l); if (!c) failures++; };

function makeEnv(scriptText, { htmlSnapshot, capacitor, store = {}, values = {} } = {}) {
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const cl = () => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c), toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); } }; };
  const cache = {};
  const mk = id => ({ id, value: values[id] || '', textContent: '', innerHTML: '', style: {}, classList: cl(), addEventListener() { }, appendChild() { }, click() { }, remove() { }, focus() { }, setSelectionRange() { }, get valueAsDate() { return null; }, set valueAsDate(v) { } });
  const downloads = [];
  global.document = { getElementById: id => cache[id] || (cache[id] = mk(id)), documentElement: { outerHTML: htmlSnapshot || '<html/>' }, createElement: () => ({ ...mk('a'), click() { downloads.push(this.download); } }), addEventListener() { }, body: { appendChild() { } } };
  const nav = { userAgent: 'Mozilla/5.0 (Linux; Android 13)', serviceWorker: { register: () => Promise.reject('stub') } };
  Object.defineProperty(global, 'navigator', { value: nav, configurable: true });
  const dcl = [];
  global.window = { addEventListener: (e, f) => { if (e === 'DOMContentLoaded') dcl.push(f); }, open() { }, print() { }, matchMedia: () => ({ matches: false }), navigator: nav, Capacitor: capacitor || null };
  global.alert = () => { }; global.confirm = () => true; global.prompt = () => null;
  const blobs = [];
  global.URL = { createObjectURL: () => 'blob:x' };
  global.Blob = function (parts) { blobs.push(parts.join('')); };
  global.XLSX = {};
  const env = { store, cache, dcl, blobs, downloads, err: null, set: (id, v) => { (cache[id] || (cache[id] = mk(id))).value = v; }, get: id => (cache[id] || (cache[id] = mk(id))) };
  try { (0, eval)(scriptText); } catch (e) { env.err = e; }
  return env;
}
const scriptOf = h => h.match(/<script>([\s\S]*)<\/script>/)[1];
const settle = () => new Promise(r => setTimeout(r, 30));

(async () => {
  const adminScript = scriptOf(html);

  console.log('--- ADMIN: import private key -> derive public key ---');
  let A = makeEnv(adminScript, { htmlSnapshot: html });
  check('admin build loads', !A.err);
  A.dcl.forEach(f => f());
  A.set('adminPrivKeyBox', demoPriv);
  await global.adminImportPrivateKey();
  check('derived public key equals demo public key', A.store['kme_admin_public_key_b64url'] === demoPub);
  check('private key stored', A.store['kme_admin_private_key_b64'] === demoPriv);

  console.log('\n--- ADMIN: issue codes ---');
  A.set('adminIssueRef', '01012345678'); A.set('adminIssueYear', '2026');
  await global.adminIssueCode();
  const code1 = A.get('adminIssuedCodeBox').value;
  check('code produced', code1.split('.').length === 2);
  const v1 = await global.verifyLicenseCode(code1);
  check('issued code verifies with app verifier', v1.valid && v1.customerRef === '01012345678' && v1.startDate === '2026-09-01' && v1.endDate === '2027-08-31');
  check('ledger has 1 entry', JSON.parse(A.store['kme_admin_issued_codes']).length === 1);

  A.set('adminIssueStart', '2026-10-01'); A.set('adminIssueEnd', '2026-12-31');
  await global.adminIssueCode();
  const v2 = await global.verifyLicenseCode(A.get('adminIssuedCodeBox').value);
  check('custom validity dates honoured', v2.valid && v2.startDate === '2026-10-01' && v2.endDate === '2026-12-31');

  A.set('adminIssueStart', '2027-01-01'); A.set('adminIssueEnd', '2026-01-01');
  const before = JSON.parse(A.store['kme_admin_issued_codes']).length;
  await global.adminIssueCode();
  check('start>end rejected (no new ledger entry)', JSON.parse(A.store['kme_admin_issued_codes']).length === before);

  A.set('adminIssueStart', ''); A.set('adminIssueEnd', ''); A.set('adminIssueRef', 'bad|ref');
  await global.adminIssueCode();
  check('ref containing | rejected', JSON.parse(A.store['kme_admin_issued_codes']).length === before);

  console.log('\n--- ADMIN: generate NEW keypair -> issue -> export APK -> activate in exported build ---');
  await global.adminGenerateKeypair();
  const newPub = A.store['kme_admin_public_key_b64url'];
  check('new public key differs from demo', newPub && newPub !== demoPub);
  A.set('adminIssueRef', 'مدرسة النور'); A.set('adminIssueYear', '2026');
  await global.adminIssueCode();
  const newCode = A.get('adminIssuedCodeBox').value;
  check('code issued with new key', newCode.split('.').length === 2);
  const vOld = await global.verifyLicenseCode(newCode);
  check('new-key code REJECTED by builds embedding the OLD demo key', vOld.valid === false && vOld.reason === 'bad-signature');

  A.blobs.length = 0;
  A.set('apkContactPhone', '01288848789');
  global.adminExportApkSource();
  check('export produced a file', A.blobs.length === 1 && A.downloads.includes('index.html'));
  const exported = A.blobs[0];
  check('export: APK mode + new public key injected', exported.includes('BUILD_MODE = "APK"') && exported.includes(`LICENSE_PUBLIC_KEY = "${newPub}"`));
  check('export: private key not present', !exported.includes(A.store['kme_admin_private_key_b64']));
  check('export: no admin tooling', !/adminIssueCode|adminGenerateKeypair|tabLicense|generateClientVersion/.test(exported));

  // run the exported build as an APK and activate with the code issued by the new key
  const prefs = {};
  const cap = { Plugins: { Device: { getId: async () => ({ identifier: 'PHONE-1' }) }, Preferences: { get: async ({ key }) => ({ value: prefs[key] ?? null }), set: async ({ key, value }) => { prefs[key] = value; } } } };
  const P = makeEnv(scriptOf(exported), { capacitor: cap });
  check('exported APK loads', !P.err);
  P.dcl.forEach(f => f()); await settle();
  P.set('apkActivationCode', newCode);
  await global.attemptApkActivation();
  const appVisible = !P.get('appRoot').classList.contains('hidden');
  check('FULL LOOP: exported APK activates with newly issued code', appVisible);

  console.log('\n--- HARDENING: fail-closed when Device plugin unavailable (APK mode) ---');
  const Q = makeEnv(scriptOf(exported), { capacitor: { Plugins: { Preferences: cap.Plugins.Preferences } } });
  Q.dcl.forEach(f => f()); await settle();
  Q.set('apkActivationCode', newCode);
  await global.attemptApkActivation();
  check('no device id => activation refused', Q.get('appRoot').classList.contains('hidden'));
  check('refusal message shown', /معرّف الجهاز/.test(Q.get('apkActivationError').textContent));

  console.log('\n--- HARDENING: Keystore-backed SecureStoragePlugin preferred over Preferences ---');
  const secure = {}, prefs2 = {};
  const cap2 = { Plugins: {
    Device: { getId: async () => ({ identifier: 'PHONE-2' }) },
    SecureStoragePlugin: { get: async ({ key }) => { if (!(key in secure)) throw new Error('Item with given key does not exist'); return { value: secure[key] }; }, set: async ({ key, value }) => { secure[key] = value; return { value: true }; } },
    Preferences: { get: async ({ key }) => ({ value: prefs2[key] ?? null }), set: async ({ key, value }) => { prefs2[key] = value; } } } };
  const S = makeEnv(scriptOf(exported), { capacitor: cap2 });
  S.dcl.forEach(f => f()); await settle();
  check('fresh: activation screen (secure get throws => treated as missing)', !S.get('apkActivationScreen').classList.contains('hidden'));
  S.set('apkActivationCode', newCode);
  await global.attemptApkActivation();
  check('stored in secure storage', !!secure['kme_apk_activation_v1']);
  check('NOT written to plain Preferences', !prefs2['kme_apk_activation_v1']);
  const S2 = makeEnv(scriptOf(exported), { capacitor: cap2 });
  S2.dcl.forEach(f => f()); await settle();
  check('relaunch reads from secure storage and opens app', !S2.get('appRoot').classList.contains('hidden'));

  console.log('\n--- HARDENING: openExternal uses Browser plugin when present ---');
  let opened = null;
  const B = makeEnv(scriptOf(exported), { capacitor: { Plugins: { Browser: { open: ({ url }) => { opened = url; } } } } });
  global.openExternal('https://wa.me/201000000000?text=x');
  check('WhatsApp link opened through Capacitor Browser', opened === 'https://wa.me/201000000000?text=x');

  console.log(failures ? `\n=== ${failures} FAILURE(S) ===` : '\n=== ALL ADMIN/HARDENING CHECKS PASSED ===');
  process.exit(failures ? 1 : 0);
})();
