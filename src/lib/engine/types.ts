// أنواع محرك احتساب الإنجاز — مستقلة عن قاعدة البيانات والواجهة

export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold';
export type PlanStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'archived';
export type ActivityKind = 'project' | 'planning' | 'construction' | 'recurring' | 'admin' | 'other';

export interface WeekBoundary {
  weekIndex: number; // 1..12 داخل الربع
  month: number;
  weekOfMonth: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export interface StepFact {
  id: string;
  weight: number; // نسبة من النشاط (0..100)
  progress: number; // 0..100 (محسوب في قاعدة البيانات من الحالة أو المراحل الفرعية)
  status: StepStatus;
  weeks: number[];
  lastUpdateAt?: string | null;
  actualEnd?: string | null;
}

export interface ActivityFact {
  id: string;
  weight: number; // نسبة من خطة الإدارة (0..100)
  kind?: ActivityKind;
  steps: StepFact[];
}

export interface PlanFact {
  id: string;
  departmentId: string;
  quarter: number;
  status: PlanStatus;
  version?: number;
  activities: ActivityFact[];
}

export interface DeptWeight {
  departmentId: string;
  weight: number; // 0..100
}

/** حالة توفر بيانات الإدارة — للتمييز بين الصفر المؤكد وغياب البيانات */
export type DataState =
  | 'no_plan' // لا توجد خطة
  | 'not_approved' // خطة غير معتمدة بعد
  | 'not_updated' // معتمدة ولم يسجل أي تحديث رغم وجود أعمال مستحقة
  | 'stale' // آخر تحديث أقدم من الحد المسموح
  | 'ok';

export type ActivityState = 'completed' | 'stalled' | 'late' | 'in_progress' | 'not_started' | 'upcoming';

export interface StepEval {
  id: string;
  progress: number;
  planned: number; // الإنجاز المخطط حتى التاريخ (0..100)
  dueDate: string | null;
  startDate: string | null;
  isLate: boolean;
  daysLate: number;
  isCurrentWeek: boolean;
}

export interface ActivityEval {
  id: string;
  progress: number;
  planned: number;
  state: ActivityState;
  stepsTotal: number;
  stepsCompleted: number;
  lateSteps: number;
  dueDate: string | null;
  weightIssue: boolean;
  steps: StepEval[];
}

export interface DeptEval {
  departmentId: string;
  planId: string | null;
  planStatus: PlanStatus | null;
  dataState: DataState;
  /** null عندما لا توجد خطة معتمدة — لا يعرض كصفر */
  progress: number | null;
  planned: number | null;
  activitiesTotal: number;
  activitiesCompleted: number;
  activitiesLate: number;
  activitiesInProgress: number;
  activitiesStalled: number;
  activitiesNotStarted: number;
  lastUpdateAt: string | null;
  weightIssue: boolean;
  activities: ActivityEval[];
}

export interface OrgEval {
  /** الإنجاز الإجمالي؛ null إذا كانت الخطة العامة غير قابلة للاحتساب */
  progress: number | null;
  computable: boolean;
  /** مؤشر جزئي على الإدارات ذات الخطط المعتمدة فقط (موزون ومُعاد تطبيعه) */
  partialProgress: number | null;
  planned: number | null;
  coveredWeight: number; // مجموع أوزان الإدارات المحتسبة
  missingDepartments: string[];
  departments: DeptEval[];
}
