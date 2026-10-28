// tests/test_whatsapp_queue.js — يثبت إصلاح شكوى البروفيسور مينا نجيب: "عند تحديد عدة طلاب
// غائبين يجب أن تُرسل رسائل واتساب للجميع، وليس لطالب واحد فقط"، بالإضافة إلى تحسينه
// المطلوب لاحقاً: ملخص نهاية الطابور (تم فتح المحادثة / تم تخطيه / لم تُستكمل)، مع تسمية
// دقيقة علمياً لحالة "تم فتح المحادثة" (لا "تم الإرسال") لأن فتح رابط واتساب لا يُثبت وصول
// الرسالة فعلاً — هذا تأكيد لا يملكه أي تطبيق ويب تجاه تطبيق واتساب الخارجي.
//
// جذر المشكلة الأصلية (موثَّق أيضاً في تعليق الكود فوق sendWhatsApp()): فتح نوافذ متعددة عبر
// window.open() من حلقة واحدة (حتى مع تأخير setTimeout) يفشل بنيوياً في متصفحات الويب
// الحديثة، لأن "تفعيل المستخدم العابر" الذي يسمح بفتح نافذة جديدة يُستهلَك من أول استدعاء
// ناجح؛ أي استدعاء لاحق — متزامناً أو عبر مؤقّت — يُحظَر صامتاً كنافذة منبثقة. هذا سلوك
// موثَّق رسمياً (WHATWG/MDN "Transient Activation")، وليس تخميناً.
//
// الإصلاح: طابور تفاعلي (waQueueOverlay) يطلب ضغطة زر حقيقية ومنفصلة لكل طالب، فكل ضغطة
// تملك تفعيل مستخدم خاص بها ولا تُحظَر. هذا الاختبار يُحاكي بالضبط ما يفعله المستخدم:
// يضغط "فتح محادثة" لكل طالب في الطابور على حدة، ويتحقق أن كل طالب غائب (وليس الأول فقط)
// حصل على استدعاء window.open فعلي، وعلى سطر في سجل الإشعارات (addLog)، ثم يتحقق من دقة
// عدّادات الملخص (opened/skipped/incomplete) في ثلاثة سيناريوهات: إكمال طبيعي، تخطٍّ، وإنهاء
// مبكر عبر "إنهاء الطابور الآن".
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin.html'), 'utf8');
let failures = 0;
const check = (l, c) => { console.log(c ? 'PASS' : 'FAIL', l); if (!c) failures++; };

function makeEnv(scriptText, { store = {} } = {}) {
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const cl = () => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c), toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); } }; };
  const cache = {};
  const mk = id => ({ id, value: '', textContent: '', innerHTML: '', style: {}, classList: cl(), addEventListener() { }, appendChild() { }, click() { }, remove() { }, focus() { }, setSelectionRange() { }, get valueAsDate() { return null; }, set valueAsDate(v) { } });
  global.document = { getElementById: id => cache[id] || (cache[id] = mk(id)), documentElement: { outerHTML: '<html/>' }, createElement: () => mk('x'), addEventListener() { }, body: { appendChild() { } } };
  const nav = { userAgent: 'Mozilla/5.0 (Linux; Android 13)', serviceWorker: { register: () => Promise.reject('stub') } };
  Object.defineProperty(global, 'navigator', { value: nav, configurable: true });
  const dcl = [];
  const opened = []; // كل استدعاء ناجح لـ window.open (لا حظر هنا — نحن نتحقق أن الكود "يحاول" الفتح لكل طالب)
  global.window = { addEventListener: (e, f) => { if (e === 'DOMContentLoaded') dcl.push(f); }, open: (url) => { opened.push(url); }, print() { }, matchMedia: () => ({ matches: false }), navigator: nav, Capacitor: null };
  global.alert = () => { }; global.confirm = () => true; global.prompt = () => null;
  global.URL = { createObjectURL: () => 'blob:x' }; global.Blob = function () { }; global.XLSX = {};
  const env = { store, cache, dcl, opened, err: null, set: (id, v) => { (cache[id] || (cache[id] = mk(id))).value = v; } };
  try { (0, eval)(scriptText); } catch (e) { env.err = e; }
  return env;
}
const scriptOf = h => h.match(/<script>([\s\S]*)<\/script>/)[1];
const adminScript = scriptOf(html);

check('مصدر sendWhatsApp لم يعد يستخدم setTimeout (الآلية القديمة المسبِّبة للحظر)', !/function sendWhatsApp[\s\S]*?setTimeout/.test(adminScript.match(/function sendWhatsApp\(\)[\s\S]*?\n\}/)[0]));
check('يوجد طابور إرسال تفاعلي (waQueueSendCurrent)', adminScript.includes('function waQueueSendCurrent'));
check('يوجد زر/دالة "إنهاء الطابور الآن" (waQueueFinishNow)', adminScript.includes('function waQueueFinishNow'));
check('زر فتح المحادثة لا يستخدم لفظ "إرسال" الموحي بتأكيد الوصول', html.includes('فتح محادثة واتساب لهذا الطالب') && !html.includes('إرسال لهذا الطالب'));
check('لا يوجد أي نص "تم إرسال" في ملخص الطابور (التسمية القديمة المُستبدَلة)', !/تم إرسال <b/.test(html));
check('الملخص يستخدم تسمية "تم فتح المحادثة" وليس "تم الإرسال"', html.includes('تم فتح المحادثة'));

// ---------- تجهيز بيانات فصل بثلاثة طلاب، اثنان منهم غائبان ولديهما هاتف ----------
const cls = '1/1';
const date = '2026-10-12';
const classesDb = { [cls]: [
  { id: 's1', name: 'أحمد علي', phone: '201001111111' },
  { id: 's2', name: 'محمد سعيد', phone: '201002222222' },
  { id: 's3', name: 'يوسف كريم', phone: '201003333333' },
] };
const attendanceDb = { [`${date}_${cls}`]: { s1: false, s2: false, s3: true } }; // s1 و s2 غائبان، s3 حاضر

const store = {
  kme_classes_db: JSON.stringify(classesDb),
  kme_attendance_records: JSON.stringify(attendanceDb),
};

let E = makeEnv(adminScript, { store });
check('تحميل السكريبت بلا أخطاء', !E.err);
E.dcl.forEach(f => f());
E.set('selectClass', cls);
E.set('dateInput', date);

console.log('\n--- استدعاء sendWhatsApp(): يجب أن يفتح الطابور بطالبين غائبين، بلا أي فتح تلقائي بعد ---');
global.sendWhatsApp();
check('الطابور مفتوح (waQueueOverlay ليس hidden)', !E.cache['waQueueOverlay'].classList.contains('hidden'));
check('لا يوجد أي فتح تلقائي عند مجرد بناء الطابور (الفتح يتطلب ضغطة لكل طالب)', E.opened.length === 0);
check('شريط التقدّم يعرض "الطالب 1 من 2"', E.cache['waQueueProgress'].textContent === 'الطالب 1 من 2');
check('اسم الطالب الأول المعروض صحيح', E.cache['waQueueName'].textContent === 'أحمد علي');

console.log('\n--- ضغطة "إرسال" للطالب الأول (محاكاة نقرة فعلية) ---');
global.waQueueSendCurrent();
check('فُتحت نافذة واتساب للطالب الأول', E.opened.length === 1);
check('الرابط يحوي رقم هاتف الطالب الأول', E.opened[0].includes('201001111111'));
check('التقدّم انتقل للطالب الثاني', E.cache['waQueueProgress'].textContent === 'الطالب 2 من 2');
check('اسم الطالب الثاني المعروض صحيح الآن', E.cache['waQueueName'].textContent === 'محمد سعيد');

console.log('\n--- ضغطة "إرسال" للطالب الثاني (هذه هي النقطة التي كانت تفشل في الكود القديم) ---');
global.waQueueSendCurrent();
check('فُتحت نافذة واتساب للطالب الثاني أيضاً (وليس فقط الأول)', E.opened.length === 2);
check('الرابط الثاني يحوي رقم هاتف الطالب الثاني (رقم مختلف عن الأول)', E.opened[1].includes('201002222222'));
check('الطابور انتهى (شاشة "انتهى الطابور" ظاهرة، وجسم الطابور مخفي)', !E.cache['waQueueDone'].classList.contains('hidden') && E.cache['waQueueBody'].classList.contains('hidden'));
// ملاحظة: textContent في DOM الحقيقي يُحوَّل تلقائياً إلى نص؛ محاكاة العنصر هنا (mk()) لا
// تقوم بهذا التحويل، فنقارن بعد تحويل صريح لتفادي فشل اختبار بسبب قيد في المحاكاة لا في التطبيق
check('إكمال طبيعي: عدّاد "تم فتح المحادثة" = 2', String(E.cache['waQueueOpenedCount'].textContent) === '2');
check('إكمال طبيعي: عدّاد "تم تخطيه" = 0', String(E.cache['waQueueSkippedCount'].textContent) === '0');
check('إكمال طبيعي: عدّاد "لم تُستكمل" = 0 (كل الطلاب اتُّخذ لهم قرار)', String(E.cache['waQueueIncompleteCount'].textContent) === '0');

const log = JSON.parse(E.store['kme_log_db'] || '[]'); // LS_LOG الفعلي في admin.html
const loggedNames = log.map(r => r.name);
check('سجل الإشعارات يحوي الطالبين كليهما (أحمد علي ومحمد سعيد)', loggedNames.includes('أحمد علي') && loggedNames.includes('محمد سعيد'));

// ---------- التحقق من زر "تخطي" ----------
console.log('\n--- التحقق من زر "تخطي هذا الطالب" (لا يفتح نافذة، فقط ينتقل للتالي) ---');
E = makeEnv(adminScript, { store: { kme_classes_db: JSON.stringify(classesDb), kme_attendance_records: JSON.stringify(attendanceDb) } });
E.dcl.forEach(f => f());
E.set('selectClass', cls);
E.set('dateInput', date);
global.sendWhatsApp();
global.waQueueSkipCurrent();
check('التخطي لا يفتح أي نافذة', E.opened.length === 0);
check('التخطي ينتقل للطالب التالي', E.cache['waQueueProgress'].textContent === 'الطالب 2 من 2');
global.waQueueSendCurrent();
check('بعد التخطي، إرسال الطالب الثاني يعمل بشكل طبيعي', E.opened.length === 1 && E.opened[0].includes('201002222222'));
check('سيناريو التخطي: الملخص يُظهر تخطٍّ=1 وفتح محادثة=1 ولا شيء غير مكتمل', String(E.cache['waQueueSkippedCount'].textContent) === '1' && String(E.cache['waQueueOpenedCount'].textContent) === '1' && String(E.cache['waQueueIncompleteCount'].textContent) === '0');

// ---------- التحقق من "إنهاء الطابور الآن" (إنهاء مبكر، قبل اتخاذ قرار بشأن كل الطلاب) ----------
console.log('\n--- سيناريو ثالث: فصل بثلاثة غائبين، يُنهي المستخدم الطابور مبكراً بعد الطالب الأول فقط ---');
const cls3 = '2/3';
const classesDb3 = { [cls3]: [
  { id: 'x1', name: 'سارة فؤاد', phone: '201005551111' },
  { id: 'x2', name: 'كريم حسن', phone: '201005552222' },
  { id: 'x3', name: 'عمر طارق', phone: '201005553333' },
] };
const attendanceDb3 = { [`${date}_${cls3}`]: { x1: false, x2: false, x3: false } }; // الثلاثة غائبون
E = makeEnv(adminScript, { store: { kme_classes_db: JSON.stringify(classesDb3), kme_attendance_records: JSON.stringify(attendanceDb3) } });
E.dcl.forEach(f => f());
E.set('selectClass', cls3);
E.set('dateInput', date);
global.sendWhatsApp();
global.waQueueSendCurrent(); // يُفتح للطالب الأول فقط
check('قبل الإنهاء المبكر: فُتحت محادثة واحدة فقط', E.opened.length === 1);
global.waQueueFinishNow(); // المستخدم ينهي الطابور الآن بدل إكمال الطالبين المتبقيين
check('الإنهاء المبكر يعرض شاشة الملخص فوراً', !E.cache['waQueueDone'].classList.contains('hidden'));
check('الإنهاء المبكر: "تم فتح المحادثة" = 1', String(E.cache['waQueueOpenedCount'].textContent) === '1');
check('الإنهاء المبكر: "تم تخطيه" = 0 (لم يُضغط تخطي لأي طالب)', String(E.cache['waQueueSkippedCount'].textContent) === '0');
check('الإنهاء المبكر: "لم تُستكمل" = 2 (الطالبان المتبقيان لم يُتَّخذ لهما قرار)', String(E.cache['waQueueIncompleteCount'].textContent) === '2');
check('الإنهاء المبكر لا يفتح أي نافذة إضافية من تلقاء نفسه', E.opened.length === 1);


// ---------- طالب بلا رقم: يظهر في الطابور، الزر معطَّل، ويُحتسب "بلا رقم صالح" عند التخطي ----------
console.log('\n--- سيناريو رابع: غائبان أحدهما بلا رقم ---');
const cls4 = '3/1';
const classesDb4 = { [cls4]: [ { id: 'n1', name: 'هاني سمير', phone: '' }, { id: 'n2', name: 'ياسر منير', phone: '201007771111' } ] };
const attendanceDb4 = { [`${date}_${cls4}`]: { n1: false, n2: false } };
E = makeEnv(adminScript, { store: { kme_classes_db: JSON.stringify(classesDb4), kme_attendance_records: JSON.stringify(attendanceDb4) } });
E.dcl.forEach(f => f());
E.set('selectClass', cls4); E.set('dateInput', date);
global.sendWhatsApp();
check('الطابور يضم الغائبَين معاً (2) رغم أن أحدهما بلا رقم', E.cache['waQueueProgress'].textContent === 'الطالب 1 من 2');
check('تحذير "لا يوجد رقم" ظاهر وزر الفتح معطَّل للطالب بلا رقم', !E.cache['waQueueNoPhoneWarn'].classList.contains('hidden') && E.cache['waQueueSendBtn'].disabled === true);
global.waQueueSendCurrent();
check('محاولة الفتح لطالب بلا رقم لا تفتح أي نافذة', E.opened.length === 0);
global.waQueueSkipCurrent();
check('بعد التخطي: الزر مفعَّل والتحذير مخفي للطالب صاحب الرقم', E.cache['waQueueSendBtn'].disabled === false && E.cache['waQueueNoPhoneWarn'].classList.contains('hidden'));
global.waQueueSendCurrent();
check('فُتحت محادثة صاحب الرقم فقط', E.opened.length === 1 && E.opened[0].includes('201007771111'));
check('الملخص: فتح=1، تخطٍّ واعٍ=0، بلا رقم=1، غير مكتمل=0', ['waQueueOpenedCount','waQueueSkippedCount','waQueueNoPhoneCount','waQueueIncompleteCount'].map(i => String(E.cache[i].textContent)).join(',') === '1,0,1,0');

console.log(`\n${failures === 0 ? '✅ كل اختبارات test_whatsapp_queue.js نجحت' : `❌ ${failures} اختبار فشل في test_whatsapp_queue.js`}`);
process.exit(failures === 0 ? 0 : 1);
