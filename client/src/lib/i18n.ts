import { useEffect, useState } from 'react'

/**
 * Languages (plan 2026-11, stage 4). A screen's words are written in English and passed through `t()`: in another
 * language the translation is shown when there is one, and the English otherwise, so a screen not translated yet
 * still works. Urdu and Arabic read right to left: the page direction follows the language.
 *
 * Translated so far: the side menu (every item and heading), the top bar's date range and account menu, the sign-in
 * page and Settings, Language. The rest of the screens are still in English.
 */

export type Lang = 'en' | 'ur' | 'ar'
export const LANGS: { key: Lang; label: string; english: string }[] = [
  { key: 'en', label: 'English', english: 'English' },
  { key: 'ur', label: 'اردو', english: 'Urdu' },
  { key: 'ar', label: 'العربية', english: 'Arabic' },
]
export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ur' || v === 'ar'
export const isRtl = (l: Lang) => l === 'ur' || l === 'ar'

// The menu, word for word (navConfig.ts). A test checks every menu label has both translations.
const UR: Record<string, string> = {
  'ADS Campaign': 'اشتہاری مہم', 'Activity Log': 'سرگرمی کا ریکارڈ', Admin: 'انتظامیہ', 'Agent Tasks': 'ایجنٹ کے کام', Analytics: 'تجزیات',
  'Ask Metra': 'میٹرا سے پوچھیں', Attendance: 'حاضری', Billing: 'بلنگ', Blogs: 'بلاگز', Brands: 'برانڈز', CRM: 'سی آر ایم', Calendar: 'کیلنڈر',
  Calls: 'کالز', Campaigns: 'مہمات', Chat: 'چیٹ', 'Company Settings': 'کمپنی کی ترتیبات', Connectors: 'کنیکٹرز', Contacts: 'رابطے',
  Content: 'مواد', 'Daily Log': 'روزانہ لاگ', 'Daily Report': 'روزانہ رپورٹ', Dashboard: 'ڈیش بورڈ', 'Deal Board': 'ڈیل بورڈ',
  'Deal Tracker': 'ڈیل ٹریکر', 'Docs & Links': 'دستاویزات اور لنکس', Ecommerce: 'ای کامرس', 'Email Marketing': 'ای میل مارکیٹنگ', Email: 'ای میل',
  Evaluate: 'جانچیں', Feedback: 'رائے', 'Financial Reports': 'مالی رپورٹس', 'Holidays & Leave': 'تعطیلات اور چھٹیاں', ITAD: 'ITAD', Import: 'درآمد',
  Inventory: 'انوینٹری', 'Jesse Inbox': 'Jesse ان باکس', 'Jesse Queue': 'Jesse قطار', 'Jesse Summary': 'Jesse خلاصہ', 'Lead Dashboard': 'لیڈ ڈیش بورڈ',
  'Lead Dialer': 'لیڈ ڈائلر', 'Lead Generation': 'لیڈ جنریشن', 'Lead Settings': 'لیڈ کی ترتیبات', Leads: 'لیڈز', Marketing: 'مارکیٹنگ',
  'Master Plan': 'ماسٹر پلان', 'Meeting Notes': 'میٹنگ نوٹس', 'Monthly Breakdown': 'ماہانہ تفصیل', 'Monthly Reports': 'ماہانہ رپورٹس',
  'My Analytics': 'میرے تجزیات', 'My Attendance': 'میری حاضری', 'My Daily Report': 'میری روزانہ رپورٹ', 'My QA Scores': 'میرے QA اسکور',
  'My Reports': 'میری رپورٹس', 'My Tasks': 'میرے کام', 'My Team': 'میری ٹیم', 'My To-Do': 'میری کاموں کی فہرست', Notes: 'نوٹس',
  'Office Networks': 'دفتر کے نیٹ ورک', 'Our tools': 'ہمارے ٹولز', People: 'لوگ', 'Profiles & Platforms': 'پروفائلز اور پلیٹ فارمز',
  'Projects Dashboard': 'پروجیکٹس ڈیش بورڈ', Projects: 'پروجیکٹس', 'QA Analytics': 'QA تجزیات', 'QA Team': 'QA ٹیم', 'Quality Assurance': 'کوالٹی کی جانچ',
  'Quotes and invoices': 'کوٹیشنز اور انوائسز', 'RDP Records': 'RDP ریکارڈ', 'Report Forms': 'رپورٹ فارم', 'Report builder': 'رپورٹ بنائیں',
  Requests: 'درخواستیں', SEO: 'SEO', Scorecards: 'اسکور کارڈ', 'Social Analytics': 'سوشل تجزیات', 'Social Media': 'سوشل میڈیا',
  'Social Planner': 'سوشل پلانر', 'Social Reports': 'سوشل رپورٹس', 'Stock Tracking': 'اسٹاک ٹریکنگ', 'System Health': 'سسٹم کی حالت', Tags: 'ٹیگز',
  Targets: 'اہداف', 'Task Board': 'کاموں کا بورڈ', 'Team Attendance': 'ٹیم کی حاضری', 'Team Reports': 'ٹیم رپورٹس', 'Team View': 'ٹیم کا جائزہ',
  Team: 'ٹیم', Users: 'صارفین',
  // The shell
  Pinned: 'پن کیے گئے', Settings: 'ترتیبات', 'Edit my menu': 'میرا مینو بدلیں', Today: 'آج', Week: 'ہفتہ', Month: 'مہینہ', '3 Months': '3 مہینے',
  Custom: 'اپنی تاریخیں', 'Log out': 'لاگ آؤٹ', Notifications: 'اطلاعات', Theme: 'تھیم',
  // Sign-in
  'Log In': 'لاگ ان', 'Logging in…': 'لاگ ان ہو رہا ہے…', 'Forgot password?': 'پاس ورڈ بھول گئے؟', 'Sign in with your company (SSO)': 'اپنی کمپنی کے ذریعے سائن ان کریں (SSO)',
  'Your work email': 'آپ کی دفتری ای میل', Continue: 'جاری رکھیں',
  // Settings, Language
  Language: 'زبان', 'The language of the menus. Screens not translated yet stay in English.': 'مینو کی زبان۔ جو صفحات ابھی ترجمہ نہیں ہوئے وہ انگریزی میں رہیں گے۔',
}

const AR: Record<string, string> = {
  'ADS Campaign': 'حملة إعلانية', 'Activity Log': 'سجل النشاط', Admin: 'الإدارة', 'Agent Tasks': 'مهام الوكلاء', Analytics: 'التحليلات',
  'Ask Metra': 'اسأل ميترا', Attendance: 'الحضور', Billing: 'الفوترة', Blogs: 'المدونات', Brands: 'العلامات التجارية', CRM: 'إدارة العملاء', Calendar: 'التقويم',
  Calls: 'المكالمات', Campaigns: 'الحملات', Chat: 'الدردشة', 'Company Settings': 'إعدادات الشركة', Connectors: 'الموصلات', Contacts: 'جهات الاتصال',
  Content: 'المحتوى', 'Daily Log': 'السجل اليومي', 'Daily Report': 'التقرير اليومي', Dashboard: 'لوحة التحكم', 'Deal Board': 'لوحة الصفقات',
  'Deal Tracker': 'متتبع الصفقات', 'Docs & Links': 'المستندات والروابط', Ecommerce: 'التجارة الإلكترونية', 'Email Marketing': 'التسويق عبر البريد', Email: 'البريد الإلكتروني',
  Evaluate: 'تقييم', Feedback: 'الآراء', 'Financial Reports': 'التقارير المالية', 'Holidays & Leave': 'العطلات والإجازات', ITAD: 'ITAD', Import: 'استيراد',
  Inventory: 'المخزون', 'Jesse Inbox': 'صندوق Jesse', 'Jesse Queue': 'قائمة Jesse', 'Jesse Summary': 'ملخص Jesse', 'Lead Dashboard': 'لوحة العملاء المحتملين',
  'Lead Dialer': 'الاتصال بالعملاء المحتملين', 'Lead Generation': 'توليد العملاء المحتملين', 'Lead Settings': 'إعدادات العملاء المحتملين', Leads: 'العملاء المحتملون', Marketing: 'التسويق',
  'Master Plan': 'الخطة الرئيسية', 'Meeting Notes': 'محاضر الاجتماعات', 'Monthly Breakdown': 'التفصيل الشهري', 'Monthly Reports': 'التقارير الشهرية',
  'My Analytics': 'تحليلاتي', 'My Attendance': 'حضوري', 'My Daily Report': 'تقريري اليومي', 'My QA Scores': 'درجات الجودة الخاصة بي',
  'My Reports': 'تقاريري', 'My Tasks': 'مهامي', 'My Team': 'فريقي', 'My To-Do': 'قائمة مهامي', Notes: 'المذكرات',
  'Office Networks': 'شبكات المكتب', 'Our tools': 'أدواتنا', People: 'الأشخاص', 'Profiles & Platforms': 'الحسابات والمنصات',
  'Projects Dashboard': 'لوحة المشاريع', Projects: 'المشاريع', 'QA Analytics': 'تحليلات الجودة', 'QA Team': 'فريق الجودة', 'Quality Assurance': 'ضمان الجودة',
  'Quotes and invoices': 'عروض الأسعار والفواتير', 'RDP Records': 'سجلات RDP', 'Report Forms': 'نماذج التقارير', 'Report builder': 'منشئ التقارير',
  Requests: 'الطلبات', SEO: 'SEO', Scorecards: 'بطاقات التقييم', 'Social Analytics': 'تحليلات التواصل الاجتماعي', 'Social Media': 'التواصل الاجتماعي',
  'Social Planner': 'مخطط التواصل الاجتماعي', 'Social Reports': 'تقارير التواصل الاجتماعي', 'Stock Tracking': 'تتبع المخزون', 'System Health': 'حالة النظام', Tags: 'الوسوم',
  Targets: 'الأهداف', 'Task Board': 'لوحة المهام', 'Team Attendance': 'حضور الفريق', 'Team Reports': 'تقارير الفريق', 'Team View': 'عرض الفريق',
  Team: 'الفريق', Users: 'المستخدمون',
  // The shell
  Pinned: 'المثبتة', Settings: 'الإعدادات', 'Edit my menu': 'تعديل قائمتي', Today: 'اليوم', Week: 'الأسبوع', Month: 'الشهر', '3 Months': '3 أشهر',
  Custom: 'فترة مخصصة', 'Log out': 'تسجيل الخروج', Notifications: 'الإشعارات', Theme: 'المظهر',
  // Sign-in
  'Log In': 'تسجيل الدخول', 'Logging in…': 'جارٍ تسجيل الدخول…', 'Forgot password?': 'نسيت كلمة المرور؟', 'Sign in with your company (SSO)': 'تسجيل الدخول عبر شركتك (SSO)',
  'Your work email': 'بريد العمل الخاص بك', Continue: 'متابعة',
  // Settings, Language
  Language: 'اللغة', 'The language of the menus. Screens not translated yet stay in English.': 'لغة القوائم. الصفحات التي لم تُترجم بعد تبقى بالإنجليزية.',
}

export const DICT: Record<Exclude<Lang, 'en'>, Record<string, string>> = { ur: UR, ar: AR }

const KEY = 'pt-lang'
let current: Lang = (() => { try { const v = localStorage.getItem(KEY); return isLang(v) ? v : 'en' } catch { return 'en' } })()
const listeners = new Set<() => void>()

function apply(l: Lang) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = l
  document.documentElement.dir = isRtl(l) ? 'rtl' : 'ltr'
}
apply(current)

export const getLang = (): Lang => current

/** Show Metriq in this language from now on (this browser keeps it too, so the sign-in page opens in it). */
export function setLang(l: Lang): void {
  if (l === current) return
  current = l
  try { localStorage.setItem(KEY, l) } catch { /* private window: this visit only */ }
  apply(l)
  listeners.forEach((f) => f())
}

/** The words in the chosen language, or as written when there is no translation yet. */
export function t(text: string): string {
  return current === 'en' ? text : DICT[current][text] ?? text
}

/** Re-draw when the language changes. */
export function useLang(): Lang {
  const [, setN] = useState(0)
  useEffect(() => { const f = () => setN((x) => x + 1); listeners.add(f); return () => { listeners.delete(f) } }, [])
  return current
}
