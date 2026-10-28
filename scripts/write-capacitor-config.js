#!/usr/bin/env node
/*
 * write-capacitor-config.js — يكتب capacitor.config.json حسب النسخة المطلوبة.
 *
 *   node scripts/write-capacitor-config.js --variant=paid    (appId: com.hasralghiyab.app,   webDir: www)
 *   node scripts/write-capacitor-config.js --variant=trial   (appId: com.hasralghiyab.trial, webDir: www-trial)
 *
 * السبب في appId مختلف لكل نسخة: Android يرفض تثبيت تطبيقين بنفس appId لكن بتوقيعين
 * مختلفين (أو حتى نفس التوقيع في بعض السيناريوهات) على نفس الجهاز في آن واحد. لاختبار
 * المسار الكامل (تجريبية ثم مدفوعة) على نفس هاتف الاختبار دون إزالة النسخة التجريبية
 * أولاً، لا بد أن يكون لكل نسخة appId خاص بها — وهذا ما يفعله هذا السكريبت.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const variantArg = args.find(a => a.startsWith('--variant='));
const variant = variantArg ? variantArg.split('=')[1] : null;

function fail(msg) { console.error('❌ فشل: ' + msg); process.exit(1); }

const VARIANTS = {
  paid: {
    appId: 'com.hasralghiyab.app',
    appName: 'حصر الغياب والتواصل الذكي مع أولياء الأمور',
    webDir: 'www'
  },
  trial: {
    appId: 'com.hasralghiyab.trial',
    appName: 'حصر الغياب — نسخة تجريبية (٣ أيام)',
    webDir: 'www-trial'
  }
};

if (!variant || !VARIANTS[variant]) {
  fail(`يجب تمرير --variant=paid أو --variant=trial (تم استلام: "${variant}")`);
}

const cfg = {
  appId: VARIANTS[variant].appId,
  appName: VARIANTS[variant].appName,
  webDir: VARIANTS[variant].webDir,
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false }
};

fs.writeFileSync(path.join(ROOT, 'capacitor.config.json'), JSON.stringify(cfg, null, 2) + '\n');
console.log(`✅ capacitor.config.json ← نسخة "${variant}" (appId: ${cfg.appId}, webDir: ${cfg.webDir})`);
