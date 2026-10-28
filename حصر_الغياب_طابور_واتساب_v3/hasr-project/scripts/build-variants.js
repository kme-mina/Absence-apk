#!/usr/bin/env node
/*
 * build-variants.js — يبني كل نسخ التطبيق من مصدر واحد (src/admin.html)
 *
 *   node scripts/build-variants.js apk         -> www/        (العميل المدفوع، BUILD_MODE=APK، تفعيل Ed25519 + ربط بالجهاز)
 *   node scripts/build-variants.js trial-apk    -> www-trial/  (النسخة التجريبية، BUILD_MODE=TRIAL، ٣ أيام من أول تشغيل)
 *   node scripts/build-variants.js all          -> يبني الاثنين معاً
 *
 * ملاحظة مهمة: لا يوجد هدف "pages" — لم نعد نستخدم GitHub Pages لتوزيع أي نسخة. التوزيع
 * الآن يتم بالكامل عبر ملفات APK (نسخة تجريبية ونسخة مدفوعة)، تُبنى هنا ثم تُغلَّف داخل
 * Capacitor لكل منصة Android (راجع write-capacitor-config.js و docs/QUICKSTART.md).
 *
 * خيارات: --allow-cdn  (للاختبار المحلي فقط: لا يشترط وجود مكتبة xlsx محلية)
 * متغيرات بيئة: CONTACT_PHONE (افتراضي 01288848789)
 *
 * القواعد الأمنية: كل كتلة ADMIN_ONLY تُحذف، والمفتاح الخاص لا يدخل هذه العملية أصلاً
 * (لا يوجد في المستودع)، وتوجد فحوص تسرب إلزامية تُفشل البناء عند أي مخالفة.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'admin.html');
const PUBKEY_FILE = path.join(ROOT, 'keys', 'public_key.txt');
const CONTACT = process.env.CONTACT_PHONE || '01288848789';
const CDN_TAG = '<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>';
const args = process.argv.slice(2);
const allowCdn = args.includes('--allow-cdn');
const target = args.find(a => !a.startsWith('--')) || 'all';

function fail(msg) { console.error('❌ BUILD FAILED: ' + msg); process.exit(1); }
function stripAdmin(html) {
  return html
    .replace(/<!--ADMIN_ONLY_START-->[\s\S]*?<!--ADMIN_ONLY_END-->/g, '')
    .replace(/\/\*ADMIN_ONLY_START\*\/[\s\S]*?\/\*ADMIN_ONLY_END\*\//g, '');
}
function mustReplace(html, from, to, label) {
  // نتحقق من وجود النمط نفسه (وليس من تغيّر النص): الاستبدال قد يكون مطابقاً للقيمة الموجودة أصلاً
  const found = typeof from === 'string' ? html.includes(from) : from.test(html);
  if (!found) fail(`لم يتم العثور على «${label}» في المصدر — تغيّر شكل الملف؟`);
  return html.replace(from, to);
}
function leakCheck(html, label) {
  const forbidden = ['generateClientVersion', 'generateTrialVersion', 'adminExportApkSource', 'adminIssueCode',
    'adminGenerateKeypair', 'adminImportPrivateKey', 'adminWhatsapp', 'tabLicense', 'viewLicense',
    'kme_admin_private_key_b64', 'kme_admin_issued_codes', 'PRIVATE KEY'];
  const hit = forbidden.find(n => html.includes(n));
  if (hit) fail(`تسرب أدوات المسؤول في نسخة ${label}: «${hit}»`);
  // أي سلسلة تشبه مفتاحاً خاصاً بصيغة PKCS8 لـ Ed25519 (تبدأ بـ MC4CAQAwBQYDK2VwBCIEI)
  if (/MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/=]{20,}/.test(html)) fail(`مفتاح خاص ظاهر داخل نسخة ${label}`);
}
function bundleXlsx(html, outDir) {
  const lib = path.join(ROOT, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
  if (!html.includes(CDN_TAG)) fail('وسم تحميل xlsx من CDN غير موجود في المصدر');
  if (fs.existsSync(lib)) {
    fs.copyFileSync(lib, path.join(outDir, 'xlsx.full.min.js'));
    return html.replace(CDN_TAG, '<script src="xlsx.full.min.js"></script>');
  }
  if (allowCdn) { console.warn('⚠️ xlsx غير مُثبَّتة محلياً — تم إبقاء CDN (للاختبار المحلي فقط!)'); return html; }
  fail('مكتبة xlsx غير موجودة. شغّل: npm install (لازمة لاستيراد Excel دون إنترنت)');
  return html;
}
function common(html, mode) {
  const pub = fs.readFileSync(PUBKEY_FILE, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(pub)) fail('keys/public_key.txt ليس مفتاح Ed25519 عاماً صالحاً (43 محرفاً Base64URL)');
  html = mustReplace(html, 'BUILD_MODE = "ADMIN"', `BUILD_MODE = "${mode}"`, 'BUILD_MODE');
  html = mustReplace(html, /const LICENSE_PUBLIC_KEY = "[^"]*";/, `const LICENSE_PUBLIC_KEY = "${pub}";`, 'LICENSE_PUBLIC_KEY');
  html = mustReplace(html, 'LICENSE_CONTACT_PHONE = ""', `LICENSE_CONTACT_PHONE = "${CONTACT}"`, 'LICENSE_CONTACT_PHONE');
  return stripAdmin(html);
}
function ensureDir(d) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }

// النسخة المدفوعة: BUILD_MODE=APK — تفعيل بكود Ed25519 مرتبط بالجهاز، Offline بالكامل بعد التفعيل.
function buildApk() {
  const out = path.join(ROOT, 'www');
  ensureDir(out);
  let html = common(fs.readFileSync(SRC, 'utf8'), 'APK');
  html = bundleXlsx(html, out);
  leakCheck(html, 'APK');
  if (!html.includes('BUILD_MODE = "APK"')) fail('BUILD_MODE لم يُضبط');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  console.log('✅ www/index.html (APK — مدفوعة) — ' + html.length + ' bytes');
}

// النسخة التجريبية: BUILD_MODE=TRIAL — بلا دخول، ٣ أيام من أول تشغيل فعلي، تُغلَّف أيضاً
// كـ APK مستقل (appId مختلف — راجع write-capacitor-config.js) بدل نشرها على الويب.
function buildTrialApk() {
  const out = path.join(ROOT, 'www-trial');
  ensureDir(out);
  let html = common(fs.readFileSync(SRC, 'utf8'), 'TRIAL');
  html = bundleXlsx(html, out);
  leakCheck(html, 'TRIAL-APK');
  if (!html.includes('BUILD_MODE = "TRIAL"')) fail('BUILD_MODE لم يُضبط');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  console.log('✅ www-trial/index.html (APK — تجريبية ٣ أيام) — ' + html.length + ' bytes');
}

if (!fs.existsSync(SRC)) fail('src/admin.html غير موجود');
if (target === 'apk' || target === 'all') buildApk();
if (target === 'trial-apk' || target === 'all') buildTrialApk();
if (target !== 'apk' && target !== 'trial-apk' && target !== 'all') {
  fail(`هدف غير معروف: "${target}". الأهداف المتاحة: apk | trial-apk | all`);
}
