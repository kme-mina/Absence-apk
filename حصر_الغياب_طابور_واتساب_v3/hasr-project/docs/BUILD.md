# البناء والاختبار محلياً (اختياري — GitHub Actions يفعل هذا تلقائياً)

## المتطلبات
Node.js 18+ فقط لتشغيل الاختبارات وبناء `www/` و`www-trial/`. Android Studio مطلوب فقط
إذا أردت بناء APK **على جهازك أنت** بدل الاعتماد على GitHub Actions بالكامل.

## التثبيت والاختبار
```bash
npm install
npm test              # يُشغِّل كل اختبارات التفعيل/الأمان/التجربة (tests/)
```
يجب أن تنجح كل الاختبارات قبل أي بناء أو دفع (push) — GitHub Actions يرفض البناء إن فشل أي منها.

## بناء ملفات الويب فقط (بدون Android Studio)
```bash
npm run build:apk-web     # ينتج www/index.html — النسخة المدفوعة (BUILD_MODE=APK)
npm run build:trial-apk   # ينتج www-trial/index.html — النسخة التجريبية (BUILD_MODE=TRIAL، ٣ أيام)
```
لا يوجد هدف "pages" — لا يُستخدم GitHub Pages في هذا المشروع إطلاقاً؛ كل التوزيع عبر
ملفات APK (راجع `docs/QUICKSTART.md`).

## بناء APK كامل محلياً (يحتاج Android Studio مُثبَّتاً)
كل نسخة لها `appId` مختلف (عبر `write-capacitor-config.js`) لتستطيع تثبيت الاثنتين على
نفس هاتف الاختبار في آن واحد:
```bash
# النسخة المدفوعة
npm run build:apk-web
npm run config:paid      # يكتب capacitor.config.json لـ appId=com.hasralghiyab.app
npx cap add android      # أول مرة فقط (أو بعد rm -rf android عند التبديل بين النسختين)
npx cap sync android
npx cap open android     # يفتح Android Studio → Build → Generate Signed Bundle/APK

# النسخة التجريبية (كرّر بعد rm -rf android)
npm run build:trial-apk
npm run config:trial     # appId=com.hasralghiyab.trial
npx cap add android
npx cap sync android
npx cap open android
```

## ملاحظة حول مكتبة Excel (xlsx)
`npm install` يجلب مكتبة `xlsx` تلقائياً، وسكربت البناء يُضمِّنها داخل الملف الناتج
(بدل تحميلها من الإنترنت)، فتعمل ميزة استيراد Excel دون اتصال — وهذا شرط أساسي لأي
بناء APK حقيقي، لذلك يفشل `build:apk-web` عمداً إن كانت المكتبة غير مثبَّتة (إلا مع
`--allow-cdn`، للاختبار السريع المحلي فقط، **لا يجوز استخدامه للنسخة التي تُباع**).
