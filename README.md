# منصة إنجاز — مشروع Netlify

منصة تساعد العملاء في قطر على الوصول إلى فني صيانة منزلية مناسب (التكييف، السباكة، الكهرباء، النجارة)، مرتّبين حسب تقييمات العملاء، والتواصل معه عبر واتساب.

## محتويات المشروع

```
enjaz-netlify/
├── public/
│   ├── index.html          ← منصة إنجاز (العملاء)
│   ├── admin.html          ← إدارة إنجاز (تُفتح على /admin)
│   └── styles.css          ← التصميم المشترك
├── netlify/
│   ├── functions/api.mjs   ← واجهة API (كل المسارات تحت /api/)
│   ├── lib/http.mjs        ← الجلسات والتحقق والأخطاء
│   └── database/migrations/
│       └── 0001_enjaz_schema.sql   ← الجداول الخمسة (تُطبَّق تلقائياً عند النشر)
├── seed/sample_data.sql    ← بيانات تجريبية اختيارية (لا تُطبَّق تلقائياً)
├── netlify.toml
├── package.json
└── .env.example
```

## خطوات النشر

1. **ارفع المشروع إلى GitHub** (مستودع جديد)، ثم في Netlify اختر **Add new project → Import an existing project** واربطه بالمستودع.
   > السحب والإفلات (Drag & drop) لا يكفي لأن المشروع يحتاج تثبيت الحزم وتشغيل الدوال.
2. **اضبط متغيرات البيئة** من **Site configuration → Environment variables**:
   | المتغير | القيمة |
   |---|---|
   | `ADMIN_PASSWORD` | كلمة مرور لوحة الإدارة |
   | `SESSION_SECRET` | نص عشوائي طويل (32 حرفاً على الأقل)، مثلاً ناتج `openssl rand -hex 32` |
3. **قاعدة البيانات**: تُنشئها Netlify تلقائياً في أول نشر لأن المشروع يستخدم حزمة `@netlify/database`، ويمكنك أيضاً إنشاؤها يدوياً من **Data & Storage → Database**. تحتاج خطة Netlify بنظام الرصيد (credit-based).
4. **انشر (Deploy)**. تطبّق Netlify ملف `0001_enjaz_schema.sql` تلقائياً قبل نشر الموقع، فتُنشأ الجداول والخدمات الأربع.
5. افتح `https://موقعك/admin`، ادخل بكلمة المرور، وأضف الفنيين.

### بيانات تجريبية (اختياري)
لتجربة الترتيب والتقييمات قبل إضافة فنيين حقيقيين:
```bash
psql "<رابط الاتصال من Netlify>" -f seed/sample_data.sql
```
يُفضَّل تشغيلها على فرع تجريبي (deploy preview) لا على قاعدة الإنتاج.

## التشغيل محلياً

```bash
npm install
npm install -g netlify-cli
netlify link            # ربط المجلد بموقعك على Netlify
netlify dev             # يشغّل الموقع والدوال وقاعدة Postgres محلية
```

## واجهة API

| المسار | الوصف | الصلاحية |
|---|---|---|
| `GET /api/services` | الخدمات المفعّلة | عام |
| `GET /api/technicians?service=ac&sort=cost` | الفنيون مع متوسطاتهم. `sort` = `cost` (الافتراضي) أو `quality` أو `speed` | عام |
| `POST /api/login` | `{whatsapp, name?, remember}` تسجيل العميل | عام |
| `GET /api/me/orders` | طلبات العميل | عميل |
| `POST /api/orders` | `{technicianId}` إنشاء طلب «قيد الاتفاق» | عميل |
| `POST /api/orders/:id/complete` | `{cost, costScore, qualityScore, speedScore}` إغلاق الطلب وتقييمه | عميل (صاحب الطلب فقط) |
| `POST /api/admin/login` | `{password}` | عام |
| `GET /api/admin/summary` · `services` · `technicians` · `customers` · `orders` · `ratings` | جداول الإدارة | إدارة |
| `POST /api/admin/technicians` | `{name, serviceId, whatsapp}` إضافة فني | إدارة |
| `PATCH /api/admin/technicians/:id` · `services/:id` | `{isActive}` إيقاف أو تفعيل | إدارة |
| `DELETE /api/admin/technicians/:id` | حذف فني ليس له طلبات | إدارة |

## قواعد الأعمال المطبّقة

- الترتيب الافتراضي للفنيين: متوسط تقييم التكلفة تنازلياً، ثم عدد التقييمات.
- الضغط على «تواصل عبر واتساب» يفتح المحادثة وينشئ طلباً بحالة «قيد الاتفاق»؛ وإن لم يكن العميل مسجّلاً يُنقل أولاً لشاشة التسجيل.
- تقييم واحد لكل طلب، ولا يُقيَّم إلا طلب مكتمل، ولا يغلق الطلب إلا صاحبه.
- عناصر التقييم من 1 إلى 5 (5 = أوافق بشدة).
- الفني الذي له طلبات لا يُحذف بل يُوقف، حفاظاً على سجل التقييمات.

## قبل الإطلاق العام

- **التحقق من رقم واتساب**: التسجيل الحالي لا يتحقق من ملكية الرقم. يُنصح بإضافة رمز تحقق (OTP) عبر WhatsApp Business API أو مزوّد رسائل.
- **الحد من التكرار (Rate limiting)** على `/api/login` و`/api/orders`، مثلاً عبر Netlify Edge Functions أو Firewall rules.
- غيّر `ADMIN_PASSWORD` بانتظام، واستخدم كلمة مرور قوية.
