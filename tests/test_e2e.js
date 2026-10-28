const fs = require('fs');
const html = fs.readFileSync('' + require('path').join(__dirname,'..','src','admin.html') + '', 'utf8');
let failures = 0;
function check(label, cond) { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) failures++; }

// ---------- structure ----------
const o = (html.match(/<div\b/g) || []).length, c = (html.match(/<\/div>/g) || []).length;
check(`div balance (${o}/${c})`, o === c);
const scriptSrc = html.match(/<script>([\s\S]*)<\/script>/)[1];
fs.writeFileSync('/tmp/e2e_script.js', scriptSrc);
try { require('child_process').execSync('node --check /tmp/e2e_script.js'); check('syntax OK', true); } catch (e) { check('syntax OK', false); }

// ---------- simulate exactly what adminExportApkSource() does ----------
function buildApk(pub) {
  let out = html;
  out = out.replace('BUILD_MODE = "ADMIN"', 'BUILD_MODE = "APK"');
  out = out.replace(/const LICENSE_PUBLIC_KEY = "[^"]*";/, `const LICENSE_PUBLIC_KEY = "${pub}";`);
  out = out.replace('LICENSE_CONTACT_PHONE = ""', 'LICENSE_CONTACT_PHONE = "01288848789"');
  out = out.replace(/<!--ADMIN_ONLY_START-->[\s\S]*?<!--ADMIN_ONLY_END-->/g, '');
  out = out.replace(/\/\*ADMIN_ONLY_START\*\/[\s\S]*?\/\*ADMIN_ONLY_END\*\//g, '');
  return out;
}
const demoPub = fs.readFileSync('' + require('path').join(__dirname,'..','keys','public_key.txt') + '', 'utf8').trim();
const demoPriv = fs.readFileSync('' + require('path').join(__dirname,'..','admin-tools','DEMO_ONLY_private_key.txt') + '', 'utf8').trim();
const apkHtml = buildApk(demoPub);

for (const leaked of ['generateClientVersion', 'generateTrialVersion', 'adminExportApkSource', 'adminIssueCode', 'adminGenerateKeypair', 'adminImportPrivateKey', 'tabLicense', 'viewLicense', 'kme_admin_private_key_b64', 'adminPrivKeyBox', demoPriv]) {
  check(`APK build has no leak of "${leaked.slice(0, 30)}"`, !apkHtml.includes(leaked));
}
check('APK build mode set', apkHtml.includes('BUILD_MODE = "APK"'));
check('APK build keeps verifyLicenseCode', apkHtml.includes('async function verifyLicenseCode'));
check('APK build keeps activation screen', apkHtml.includes('id="apkActivationScreen"'));
const apkScript = apkHtml.match(/<script>([\s\S]*)<\/script>/)[1];
fs.writeFileSync('/tmp/apk_built.js', apkScript);
try { require('child_process').execSync('node --check /tmp/apk_built.js'); check('APK build syntax OK', true); } catch (e) { check('APK build syntax OK', false); }
const ao = (apkHtml.match(/<div\b/g) || []).length, ac = (apkHtml.match(/<\/div>/g) || []).length;
check(`APK build div balance (${ao}/${ac})`, ao === ac);

// ---------- runtime harness for a given built script ----------
function runBuild(scriptText, opts = {}) {
  const store = opts.store || {};
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const cl = () => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c), toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); } }; };
  const cache = {};
  const mk = id => ({ id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, classList: cl(), addEventListener() { }, appendChild() { }, click() { }, remove() { }, focus() { }, setSelectionRange() { }, get valueAsDate() { return null; }, set valueAsDate(v) { } });
  global.document = { getElementById: id => cache[id] || (cache[id] = mk(id)), documentElement: { outerHTML: '<html/>' }, createElement: () => mk('x'), addEventListener() { }, body: { appendChild() { } } };
  const nav = { userAgent: 'Mozilla/5.0 (Linux; Android 13)', serviceWorker: { register: () => Promise.reject('stub') } };
  Object.defineProperty(global, 'navigator', { value: nav, configurable: true });
  const dcl = [];
  global.window = { addEventListener: (e, f) => { if (e === 'DOMContentLoaded') dcl.push(f); }, open() { }, print() { }, matchMedia: () => ({ matches: false }), navigator: nav, Capacitor: opts.capacitor || null };
  global.alert = () => { }; global.confirm = () => true; global.prompt = () => null;
  global.URL = { createObjectURL: () => 'blob:x' }; global.Blob = function () { }; global.XLSX = {};
  // eslint-disable-next-line no-eval
  const r = { cache, store, dcl, err: null };
  try { (0, eval)(scriptText); } catch (e) { r.err = e; }
  return r;
}
const E = (r, id) => r.cache[id] || global.document.getElementById(id);
const visible = (cache, id) => cache[id] && !cache[id].classList.contains('hidden');

(async () => {
  // Issue a REAL code with the demo private key, using the SAME code path as adminIssueCode
  const privKey = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(demoPriv), ch => ch.charCodeAt(0)), 'Ed25519', false, ['sign']);
  async function issue(ref, start, end) {
    const b64url = bytes => { let b = ''; new Uint8Array(bytes).forEach(x => b += String.fromCharCode(x)); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const payload = new TextEncoder().encode(['v1', ref, start, end, Date.now()].join('|'));
    const sig = await crypto.subtle.sign('Ed25519', privKey, payload);
    return b64url(payload) + '.' + b64url(sig);
  }
  const goodCode = await issue('01099998888', '2026-09-01', '2027-08-31');
  const expiredCode = await issue('01011112222', '2020-09-01', '2021-08-31');

  // Capacitor mock: device plugin whose id we can change to simulate another device, prefs plugin backed by a map
  function makeCap(deviceId, prefsMap) {
    return { Plugins: { Device: { getId: async () => ({ identifier: deviceId }) }, Preferences: { get: async ({ key }) => ({ value: key in prefsMap ? prefsMap[key] : null }), set: async ({ key, value }) => { prefsMap[key] = value; } } } };
  }
  const settle = () => new Promise(r => setTimeout(r, 50));

  console.log('\n--- A) fresh install: shows activation screen, no app ---');
  let prefs = {};
  let r = runBuild(apkScript, { capacitor: makeCap('DEVICE-A', prefs) });
  check('APK top-level clean', !r.err);
  r.dcl.forEach(f => f()); await settle();
  check('activation screen visible on fresh install', visible(r.cache, 'apkActivationScreen'));
  check('app hidden on fresh install', !visible(r.cache, 'appRoot'));

  console.log('\n--- B) wrong code: rejected, not activated ---');
  E(r, 'apkActivationCode').value = 'garbage-code';
  await attempt(r);
  check('error shown for garbage', E(r, 'apkActivationError').textContent.length > 0);
  check('nothing stored', Object.keys(prefs).length === 0);

  console.log('\n--- C) correct code: activates and opens app ---');
  E(r, 'apkActivationCode').value = goodCode;
  await attempt(r);
  check('app visible after correct activation', visible(r.cache, 'appRoot'));
  check('activation stored', !!prefs['kme_apk_activation_v1']);

  console.log('\n--- D) relaunch same device / airplane mode (no network APIs used): opens app directly ---');
  let r2 = runBuild(apkScript, { capacitor: makeCap('DEVICE-A', prefs) });
  global.fetch = () => { throw new Error('NETWORK USED!'); };
  r2.dcl.forEach(f => f()); await settle();
  check('relaunch opens app without activation, without network', visible(r2.cache, 'appRoot'));

  console.log('\n--- E) copy activation data to ANOTHER device: blocked ---');
  let r3 = runBuild(apkScript, { capacitor: makeCap('DEVICE-B', prefs) }); // same prefs content, different device id
  r3.dcl.forEach(f => f()); await settle();
  check('app NOT visible on copied data', !visible(r3.cache, 'appRoot'));
  check('blocked screen shown', visible(r3.cache, 'licenseGateScreen'));
  check('message mentions other device', /جهاز آخر/.test(E(r3, 'licenseGateMsg').textContent));

  console.log('\n--- F) reinstall (prefs wiped): asks for activation, same code works again ---');
  let prefs2 = {};
  let r4 = runBuild(apkScript, { capacitor: makeCap('DEVICE-A-NEW-INSTALL', prefs2) });
  r4.dcl.forEach(f => f()); await settle();
  check('activation required after reinstall', visible(r4.cache, 'apkActivationScreen'));
  E(r4, 'apkActivationCode').value = goodCode;
  await attempt(r4);
  check('same code re-activates after reinstall', visible(r4.cache, 'appRoot'));

  console.log('\n--- G) expired code: rejected at activation ---');
  let prefs3 = {};
  let r5 = runBuild(apkScript, { capacitor: makeCap('DEVICE-C', prefs3) });
  r5.dcl.forEach(f => f()); await settle();
  E(r5, 'apkActivationCode').value = expiredCode;
  await attempt(r5);
  check('expired rejected', !visible(r5.cache, 'appRoot') && /منتهي/.test(E(r5, 'apkActivationError').textContent));

  console.log('\n--- H) tampered local record (edit stored dates/code): rejected ---');
  const rec = JSON.parse(prefs['kme_apk_activation_v1']);
  const forged = { ...rec, code: rec.code.slice(0, 25) + (rec.code[25] === 'A' ? 'B' : 'A') + rec.code.slice(26) };
  let prefs4 = { 'kme_apk_activation_v1': JSON.stringify(forged) };
  let r6 = runBuild(apkScript, { capacitor: makeCap('DEVICE-A', prefs4) });
  r6.dcl.forEach(f => f()); await settle();
  check('tampered record does not open app', !visible(r6.cache, 'appRoot'));

  console.log('\n--- I) other modes still load correctly ---');
  for (const mode of ['ADMIN', 'CLIENT', 'TRIAL']) {
    const s = scriptSrc.replace('BUILD_MODE = "ADMIN"', `BUILD_MODE = "${mode}"`);
    const rr = runBuild(s);
    let dclErr = null; rr.dcl.forEach(f => { try { f(); } catch (e) { dclErr = e; } });
    check(`${mode} mode loads (top-level + DOMContentLoaded)`, !rr.err && !dclErr);
    if (dclErr) console.log(dclErr.stack);
  }
  // stripped CLIENT/TRIAL builds must also load (admin-only functions absent)
  for (const mode of ['CLIENT', 'TRIAL']) {
    let out = html.replace('BUILD_MODE = "ADMIN"', `BUILD_MODE = "${mode}"`);
    out = out.replace(/<!--ADMIN_ONLY_START-->[\s\S]*?<!--ADMIN_ONLY_END-->/g, '').replace(/\/\*ADMIN_ONLY_START\*\/[\s\S]*?\/\*ADMIN_ONLY_END\*\//g, '');
    const s = out.match(/<script>([\s\S]*)<\/script>/)[1];
    const rr = runBuild(s);
    let dclErr = null; rr.dcl.forEach(f => { try { f(); } catch (e) { dclErr = e; } });
    check(`stripped ${mode} build loads`, !rr.err && !dclErr);
    if (rr.err) console.log(rr.err.stack);
    if (dclErr) console.log(dclErr.stack);
  }

  console.log(failures ? `\n=== ${failures} FAILURE(S) ===` : '\n=== ALL E2E CHECKS PASSED ===');
  process.exit(failures ? 1 : 0);
})();

async function attempt(r) {
  // call the built script's attemptApkActivation (defined in global scope by indirect eval)
  await global.attemptApkActivation();
}
