// المصطلحات الموحدة للواجهة
import type { ActivityState, DataState, PlanStatus, StepStatus } from './engine/types';
import type { KpiStatus } from './engine/kpi';

export const ROLE_LABELS: Record<string, string> = {
  executive_director: 'المدير التنفيذي',
  dept_manager: 'مدير إدارة',
  employee: 'موظف مفوض',
  board_member: 'عضو مجلس الإدارة',
  system_admin: 'مسؤول النظام',
};

export const PLAN_STATUS: Record<PlanStatus, string> = {
  draft: 'مسودة',
  submitted: 'بانتظار الاعتماد',
  returned: 'معادة للتعديل',
  approved: 'معتمدة',
  archived: 'مؤرشفة',
};

export const STEP_STATUS: Record<StepStatus, string> = {
  not_started: 'لم تبدأ',
  in_progress: 'جارية',
  completed: 'مكتملة',
  on_hold: 'معلّقة',
};

export const ACTIVITY_STATE: Record<ActivityState, string> = {
  completed: 'مكتمل',
  stalled: 'متعثر',
  late: 'متأخر',
  in_progress: 'جارٍ',
  not_started: 'لم يبدأ',
  upcoming: 'قادم',
};

export const DATA_STATE: Record<DataState, string> = {
  no_plan: 'لا توجد خطة',
  not_approved: 'الخطة غير معتمدة',
  not_updated: 'لم تُحدّث البيانات',
  stale: 'بيانات قديمة',
  ok: 'محدّثة',
};

export const KPI_STATUS: Record<KpiStatus, string> = {
  achieved: 'متحقق',
  on_track: 'في المسار',
  at_risk: 'يحتاج انتباهًا',
  off_track: 'منحرف',
  no_data: 'لا توجد قياسات',
  no_target: 'بلا مستهدف',
};

export const QUARTER_LABEL = ['', 'الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع'];
export const MONTHS = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const FREQUENCY: Record<string, string> = { monthly: 'شهري', quarterly: 'ربعي', semiannual: 'نصف سنوي', annual: 'سنوي' };
export const KPI_TYPE: Record<string, string> = { numeric: 'عددي', percentage: 'نسبة', financial: 'مالي', qualitative: 'نوعي' };
export const DIRECTIVE_STATUS: Record<string, string> = { open: 'مفتوح', in_progress: 'قيد المعالجة', closed: 'مغلق' };
export const REPORT_TYPE: Record<string, string> = { monthly: 'شهري', quarterly: 'ربعي', annual: 'سنوي' };

export function weekLabel(month: number, weekOfMonth: number) {
  return `${MONTHS[month]} · الأسبوع ${weekOfMonth}`;
}
