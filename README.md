# grade-justification (تصحيح هجين مجاني)
1. نفّذ supabase/exams.sql في SQL Editor.
2. الأسرار (Project Settings ← Edge Functions ← Secrets، أو CLI):
   `supabase secrets set LLM_API_KEY=مفتاح_مزوّدك_المجاني CRON_SECRET=نص_عشوائي_طويل`
3. انشر: `supabase functions deploy grade-justification --no-verify-jwt`
4. من التطبيق (حساب المدير الرئيسي) ← التواصل ← الاختبارات ← ⚙ إعدادات النموذج: الرابط (…/chat/completions) واسم النموذج والحد اليومي.
   بدون هذه الإعدادات يعمل التصحيح بالقواعد فقط، والملتبس يصل إلى لوحة المراجعة.
5. (اختياري) جدولة إعادة المحاولة: التعليمات في آخر exams.sql.
اختبار محلي: `node --experimental-strip-types --no-warnings test.mts` — وتشغيل العيّنات بمفتاحك: run-samples.mts
