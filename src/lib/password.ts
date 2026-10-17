// سياسة كلمات المرور: طول كافٍ، حروف وأرقام، وليست شائعة ولا مشتقة من البريد.
// لا تُخزن كلمات المرور في المنصة إطلاقًا — Supabase Auth يحفظها مجزأة (bcrypt).

const COMMON = ['password', '12345678', '123456789', '1234567890', 'qwerty', 'rawasim', 'rwasim', 'admin', 'welcome', 'p@ssw0rd', 'abc123', '11111111', '00000000'];

export function passwordProblem(pw: string, email?: string | null): string | null {
  if (pw.length < 10) return 'كلمة المرور 10 أحرف على الأقل';
  if (pw.length > 72) return 'كلمة المرور طويلة جدًا';
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return 'استخدم حروفًا وأرقامًا معًا';
  const low = pw.toLowerCase();
  if (COMMON.some((c) => low.includes(c))) return 'كلمة المرور شائعة أو سهلة التخمين';
  if (/^(.)\1+$/.test(pw)) return 'كلمة المرور سهلة التخمين';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && low.includes(local)) return 'لا تستخدم اسم بريدك في كلمة المرور';
  return null;
}
