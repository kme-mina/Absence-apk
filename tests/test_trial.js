// tests/test_trial.js — يختبر بوابة النسخة التجريبية (BUILD_MODE=TRIAL) ضد الكود الحقيقي
// المُستخرج من src/admin.html (وليس تقريباً مكتوباً باليد)، بالضبط كما يفعل build-variants.js
// عند buildTrialApk(). يغطي: تشغيل أول (يوم 0)، يوم 2 (لا تزال فعّالة)، يوم 4 (منتهية مع
// رسالة التواصل الصحيحة)، إعادة تثبيت بلا نسخة احتياطية (الحد الصادق المُوثَّق: يُعاد العدّ من
// الصفر)، إعادة تثبيت مع استعادة محاكاة لـ Auto Backup for Apps (تبقى منتهية بشكل صحيح)،
// والمسار الاحتياطي بلا Capacitor (متصفح عادي، localStorage فقط).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin.html'), 'utf8');
let failures = 0;
function check(label, cond) { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) failures++; }

// نفس منطق buildTrialApk() في scripts/build-variants.js تماماً
function buildTrial(pub) {
  let out = html;
  out = out.replace('BUILD_MODE = "ADMIN"', 'BUILD_MODE = "TRIAL"');
  out = out.replace(/const LICENSE_PUBLIC_KEY = "[^"]*";/, `const LICENSE_PUBLIC_KEY = "${pub}";`);
  out = out.replace('LICENSE_CONTACT_PHONE = ""', 'LICENSE_CONTACT_PHONE = "01288848789"');
  out = out.replace(/<!--ADMIN_ONLY_START-->[\s\S]*?<!--ADMIN_ONLY_END-->/g, '');
  out = out.replace(/\/\*ADMIN_ONLY_START\*\/[\s\S]*?\/\*ADMIN_ONLY_END\*\//g, '');
  return out;
}
const demoPub = fs.readFileSync(path.join(__dirname, '..', 'keys', 'public_key.txt'), 'utf8').trim();
const trialHtml = buildTrial(demoPub);

check('TRIAL build mode set', trialHtml.includes('BUILD_MODE = "TRIAL"'));
check('TRIAL build has no admin leak (tabLicense)', !trialHtml.includes('tabLicense'));
check('TRIAL build has no admin leak (adminIssueCode)', !trialHtml.includes('adminIssueCode'));
const to = (trialHtml.match(/<div\b/g) || []).length, tc = (trialHtml.match(/<\/div>/g) || []).length;
check(`TRIAL build div balance (${to}/${tc})`, to === tc);
const trialScript = trialHtml.match(/<script>([\s\S]*)<\/script>/)[1];
fs.writeFileSync('/tmp/trial_built.js', trialScript);
try { require('child_process').execSync('node --check /tmp/trial_built.js'); check('TRIAL build syntax OK', true); } catch (e) { check('TRIAL build syntax OK', false); }

// ---------- نفس هيكل runBuild() في test_e2e.js، مع دعم SecureStoragePlugin أيضاً ----------
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
  const r = { cache, store, dcl, err: null };
  try { (0, eval)(scriptText); } catch (e) { r.err = e; }
  return r;
}
const visible = (cache, id) => cache[id] && !cache[id].classList.contains('hidden');
const DAY_MS = 24 * 60 * 60 * 1000;

// Capacitor الكامل: Device + SecureStoragePlugin (يُحاكي تخزين Keystore) مدعوم بخريطة prefsMap،
// بالإضافة إلى Preferences كاحتياطي (لا يُستخدم هنا لأن SecureStoragePlugin متاح أولاً دائماً)
function makeFullCap(prefsMap) {
  return { Plugins: {
    Device: { getId: async () => ({ identifier: 'DEVICE-TRIAL-1' }) },
    SecureStoragePlugin: {
      get: async ({ key }) => { if (!(key in prefsMap)) throw new Error('not found'); return { value: prefsMap[key] }; },
      set: async ({ key, value }) => { prefsMap[key] = value; }
    }
  } };
}

(async () => {
  console.log('\n--- A) تشغيل أول (يوم 0): الفترة فعّالة، يُسجَّل وقت أول تشغيل ---');
  let prefsA = {};
  let r = runBuild(trialScript, { capacitor: makeFullCap(prefsA) });
  check('TRIAL top-level clean', !r.err);
  r.dcl.forEach(f => f());
  await new Promise(res => setTimeout(res, 50));
  check('التطبيق ظاهر عند أول تشغيل', visible(r.cache, 'appRoot'));
  check('شاشة الانتهاء مخفية عند أول تشغيل', !visible(r.cache, 'licenseGateScreen'));
  check('تم تسجيل وقت أول تشغيل في SecureStoragePlugin', 'kme_trial_first_run_ts' in prefsA);

  console.log('\n--- B) إعادة تشغيل في اليوم الثاني: لا تزال فعّالة ---');
  let prefsB = { kme_trial_first_run_ts: String(Date.now() - 2 * DAY_MS) };
  r = runBuild(trialScript, { capacitor: makeFullCap(prefsB) });
  r.dcl.forEach(f => f());
  await new Promise(res => setTimeout(res, 50));
  check('التطبيق ظاهر في اليوم الثاني', visible(r.cache, 'appRoot'));

  console.log('\n--- C) إعادة تشغيل في اليوم الرابع: منتهية، برسالة التواصل الصحيحة ---');
  let prefsC = { kme_trial_first_run_ts: String(Date.now() - 4 * DAY_MS) };
  r = runBuild(trialScript, { capacitor: makeFullCap(prefsC) });
  r.dcl.forEach(f => f());
  await new Promise(res => setTimeout(res, 50));
  check('التطبيق مخفي في اليوم الرابع', !visible(r.cache, 'appRoot'));
  check('شاشة الانتهاء ظاهرة في اليوم الرابع', visible(r.cache, 'licenseGateScreen'));
  const msg = r.cache['licenseGateMsg'] ? r.cache['licenseGateMsg'].textContent : '';
  check('رسالة الانتهاء تحتوي على رقم التواصل', msg.includes('01288848789'));
  check('رسالة الانتهاء تذكر عدد أيام الفترة التجريبية', msg.includes('3'));

  console.log('\n--- D) إعادة تثبيت بلا نسخة احتياطية (الحد الصادق الموثَّق): يُعاد العدّ من الصفر ---');
  // محاكاة واقعية: إزالة التثبيت تحذف مفاتيح Android Keystore (SecureStoragePlugin) بالكامل،
  // فنُمثّل ذلك بخريطة prefsMap فارغة تماماً من جديد — تماماً كجهاز "نظيف" بعد إعادة التثبيت.
  let prefsD = {};
  r = runBuild(trialScript, { capacitor: makeFullCap(prefsD) });
  r.dcl.forEach(f => f());
  await new Promise(res => setTimeout(res, 50));
  check('إعادة التثبيت بلا نسخة احتياطية: التطبيق يعمل من جديد (حد حقيقي موثَّق، غير مُسوَّق كغير قابل للتجاوز)', visible(r.cache, 'appRoot'));

  console.log('\n--- E) إعادة تثبيت مع استعادة Auto Backup for Apps (محاكاة): تبقى منتهية بشكل صحيح ---');
  // محاكاة النجاح المحتمل (غير مضمون) لميزة أندرويد Auto Backup for Apps: القيمة القديمة
  // (من يوم 4، أي منتهية) تُستعاد تلقائياً قبل أول قراءة بعد إعادة التثبيت.
  let prefsE = { kme_trial_first_run_ts: String(Date.now() - 4 * DAY_MS) };
  r = runBuild(trialScript, { capacitor: makeFullCap(prefsE) });
  r.dcl.forEach(f => f());
  await new Promise(res => setTimeout(res, 50));
  check('مع استعادة Auto Backup: تبقى الفترة منتهية (لا تُعاد من الصفر)', !visible(r.cache, 'appRoot') && visible(r.cache, 'licenseGateScreen'));

  console.log('\n--- F) بلا Capacitor إطلاقاً (اختبار متصفح عادي): يعمل عبر localStorage فقط ---');
  let storeF = {};
  r = runBuild(trialScript, { capacitor: null, store: storeF });
  r.dcl.forEach(f => f());
  await new Promise(res => setTimeout(res, 50));
  check('بلا Capacitor: التطبيق يعمل عبر localStorage (يوم 0)', visible(r.cache, 'appRoot'));
  check('بلا Capacitor: تم حفظ وقت أول تشغيل في localStorage', 'kme_trial_first_run_ts' in storeF);

  console.log(`\n${failures === 0 ? '✅ كل اختبارات test_trial.js نجحت' : `❌ ${failures} اختبار فشل في test_trial.js`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
