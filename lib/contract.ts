// lib/contract.ts — SHARED API CONTRACT for If Home Watch.
// Keep this file byte-identical in if-insurance-challenge-backend and if-insurance-challenge-frontend.

/* ---------------- enums ---------------- */
export type HomeStatus = 'invited' | 'setup' | 'active' | 'occupied' | 'sold' | 'transferred' | 'closed' | 'declined';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type BuildingType = 'detached' | 'semi_detached' | 'terraced' | 'cottage' | 'other';
export type HeatingType = 'district' | 'electric' | 'oil' | 'ground_heat_pump' | 'air_heat_pump' | 'wood' | 'unknown';
export type WaterSource = 'municipal' | 'well' | 'unknown';
export type Role = 'coordinator' | 'helper' | 'viewer';
export type Relation = 'child' | 'spouse' | 'sibling' | 'grandchild' | 'relative' | 'friend' | 'other';
export type MemberStatus = 'invited' | 'joined' | 'removed';
export type TaskStatus = 'open' | 'accepted' | 'done' | 'cancelled';
export type TaskPriority = 'urgent' | 'high' | 'normal';
export type TaskCategory = 'water' | 'heating' | 'electricity' | 'security' | 'outside' | 'admin' | 'visit' | 'appliances' | 'other';
export type TaskOrigin = 'plan' | 'weather' | 'visit_concern' | 'manual';
export type TaskFilter = 'all' | 'mine' | 'open' | 'needs_owner' | 'overdue' | 'done';
export type CheckResult = 'ok' | 'concern' | 'not_checked';
export type VisitorType = 'family' | 'partner';
export type NoteCategory = 'water' | 'heating' | 'electricity' | 'access' | 'contacts' | 'appliances' | 'other';
export type EssentialKey = 'water_main_valve' | 'water_meter' | 'fuse_box' | 'heating_controls' | 'key_location' | 'neighbour_contact' | 'well_pump';
export type PackageKey = 'check' | 'winter' | 'urgent';
export type BookingStatus = 'pending_approval' | 'requested' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'declined';
export type AccessMethod = 'key_holder_meets' | 'key_box' | 'partner_collects_key' | 'other';
export type WeatherRule = 'hard_frost' | 'frost' | 'storm' | 'heavy_snow';
export type ForecastSource = 'open-meteo' | 'simulated';
export type SupervisionState = 'no_visit_yet' | 'ok' | 'due_soon' | 'overdue';
export type NotificationChannel = 'in_app' | 'sms' | 'email';
export type TransitionStatus = 'occupied' | 'sold' | 'transferred' | 'closed';
export type DeclineReason = 'someone_lives_there' | 'not_now' | 'not_responsible';
export type ActorHeader = `member:${string}` | `partner:${string}` | 'staff';
export type ActivityType =
  | 'home_invited' | 'home_activated' | 'home_updated' | 'home_transition'
  | 'member_invited' | 'member_joined' | 'member_updated' | 'member_removed'
  | 'task_created' | 'task_accepted' | 'task_declined' | 'task_assigned' | 'task_completed'
  | 'task_reopened' | 'task_commented' | 'task_escalated' | 'task_updated' | 'task_cancelled'
  | 'visit_recorded' | 'note_saved' | 'photo_added' | 'weather_alert'
  | 'booking_requested' | 'booking_approved' | 'booking_confirmed' | 'booking_declined'
  | 'booking_started' | 'booking_completed' | 'booking_cancelled';

/* ---------------- core objects ---------------- */
export interface PersonRef { id: string; name: string }
export interface SourceRef { label: string; url: string | null }

export interface Home {
  id: string;
  status: HomeStatus;
  addressLine: string;
  postalCode: string;
  city: string;
  lat: number;
  lng: number;
  estateName: string | null;          // the person who died, e.g. "Eila Virtanen" (fictional)
  buildingType: BuildingType | null;
  yearBuilt: number | null;
  vacantSince: string | null;         // YYYY-MM-DD
  lastKnownVisit: string | null;      // YYYY-MM-DD, last visit before Home Watch
  occupancyConfirmed: boolean;        // "nobody lives here" confirmed
  authorityConfirmed: boolean;        // someone in the family can authorise access
  keyHolder: string | null;
  accessNotes: string | null;
  heatingType: HeatingType | null;
  heatingOn: YesNoUnknown | null;
  waterSource: WaterSource | null;
  waterMainClosed: YesNoUnknown | null;
  hasAlarm: YesNoUnknown | null;
  activatedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  newOwnerWantsCoverHelp: boolean | null;
}

export interface MemberStats { openTasks: number; doneTasks: number; visits: number; lastVisitAt: string | null }

export interface Member {
  id: string;
  homeId: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  relation: Relation;                 // relationship to the person who died (Home.estateName)
  role: Role;
  canAuthorise: boolean;
  status: MemberStatus;
  joinedAt: string | null;
  stats: MemberStats;
}

export interface Partner {
  id: string;
  name: string;
  area: string;
  phone: string | null;
  email: string | null;
  description: string | null;
}

export interface Photo { id: string; url: string; caption: string | null; uploadedByLabel: string; createdAt: string }

export interface Task {
  id: string;
  homeId: string;
  templateKey: string | null;
  title: string;
  why: string | null;
  how: string[];
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  assignee: PersonRef | null;
  dueAt: string | null;
  isOverdue: boolean;                 // open/accepted and dueAt < now
  needsOwner: boolean;                // open, no assignee, no active booking, and urgent or due within 48 h
  recurrenceDays: number | null;
  origin: TaskOrigin;
  source: SourceRef | null;
  needsInfo: string | null;           // an unconfirmed detail, shown as "Not confirmed: ..."
  declinedBy: PersonRef[];
  bookingId: string | null;           // an active local visit covers this task
  completedAt: string | null;
  completedByLabel: string | null;
  completionNote: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  actorLabel: string;                 // "Aino Virtanen", "Talonvahti Demo Oy", "Home Watch"
  message: string;                    // ready-to-show sentence
  taskId: string | null;
  visitId: string | null;
  bookingId: string | null;
  createdAt: string;
}

export interface CheckItem { key: string; label: string; help: string }
export interface VisitCheck { key: string; label: string; result: CheckResult; note: string | null }

export interface Visit {
  id: string;
  homeId: string;
  visitorType: VisitorType;
  visitorName: string;
  memberId: string | null;
  partnerId: string | null;
  bookingId: string | null;
  visitedAt: string;
  indoorTempC: number | null;
  checks: VisitCheck[];
  notes: string | null;
  photos: Photo[];
  okCount: number;
  concernCount: number;
  completedTasks: PersonRef[];        // { id: taskId, name: task title } closed by this visit
  followUpTasks: Task[];              // tasks created from this visit's concerns
  createdAt: string;
}

export interface VisitSummary {
  id: string;
  visitorType: VisitorType;
  visitorName: string;
  visitedAt: string;
  indoorTempC: number | null;
  okCount: number;
  concernCount: number;
  photoCount: number;
  bookingId: string | null;
}

export interface Note {
  id: string;
  homeId: string;
  category: NoteCategory;
  title: string;
  body: string;
  essentialKey: EssentialKey | null;
  confirmed: boolean;
  photos: Photo[];
  updatedByLabel: string;
  updatedAt: string;
}

export interface EssentialStatus { key: EssentialKey; label: string; why: string; category: NoteCategory; noteId: string | null; confirmed: boolean; hasPhoto: boolean }

export interface ForecastDay { date: string; minC: number; maxC: number; gustMs: number; snowCm: number }

export interface WeatherAlert {
  id: string;
  rule: WeatherRule;
  forDate: string;                    // the day the weather is forecast for
  message: string;
  taskId: string | null;
  taskStatus: TaskStatus | null;
  actionedBeforeDate: boolean;        // the linked task was done before forDate
  source: ForecastSource;
  createdAt: string;
}

export interface WeatherThresholds { hardFrostC: number; frostC: number; stormGustMs: number; heavySnowCm: number }

export interface HomeWeather {
  source: ForecastSource;
  fetchedAt: string | null;
  days: ForecastDay[];                // today + next 3 days, Europe/Helsinki dates
  activeAlerts: WeatherAlert[];       // alerts whose forDate is today or later
  recentAlerts: WeatherAlert[];       // last 30 days, newest first
  thresholds: WeatherThresholds;
}

export interface Supervision {
  state: SupervisionState;
  lastVisitAt: string | null;
  lastVisitorName: string | null;
  daysSinceLastVisit: number | null;
  nextDueAt: string;
  ruleLabel: string;                  // "If's home terms describe supervision of an empty home as a visit at least monthly."
  source: SourceRef;
}

export interface VisitPackage {
  key: PackageKey;
  name: string;
  durationMin: number;
  includes: string[];
  partnerPriceCents: number;
  ifFeeCents: number;
  totalCents: number;
  leadTime: string;                   // "Next 3 days" | "Within 24 hours"
}

export interface Slot { start: string; end: string }

export interface Booking {
  id: string;
  homeId: string;
  status: BookingStatus;
  package: VisitPackage;
  partner: Partner;
  slotStart: string;
  slotEnd: string;
  accessMethod: AccessMethod;
  accessDetails: string | null;
  notes: string | null;
  taskId: string | null;
  taskTitle: string | null;
  requestedBy: PersonRef | null;
  approvedBy: PersonRef | null;
  createdAt: string;
  approvedAt: string | null;
  confirmedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  visitId: string | null;
}

export interface Notification {
  id: string;
  homeId: string | null;
  channel: NotificationChannel;       // sms/email are simulated: shown in-app only
  title: string;
  body: string;
  link: string | null;                // frontend path, e.g. "/homes/<id>/tasks/<id>"
  readAt: string | null;
  createdAt: string;
}

/* ---------------- composite responses ---------------- */
export interface Persona { actor: ActorHeader; label: string; subtitle: string; homeId: string | null; landing: string }
export interface PersonasResponse { groups: { title: string; description: string; personas: Persona[] }[]; inviteUrl: string }

export interface DemoState {
  mainHomeId: string;
  mainHomeStatus: HomeStatus;
  exampleHomeId: string;
  latestBooking: { id: string; homeId: string; status: BookingStatus } | null;
  forecastSource: ForecastSource;
}

export type MeResponse =
  | { kind: 'member'; member: Member; home: { id: string; addressLine: string; city: string; estateName: string | null; status: HomeStatus }; unread: number }
  | { kind: 'partner'; partner: Partner; unread: number }
  | { kind: 'staff'; label: string; unread: number };

export interface InviteView {
  token: string;
  status: HomeStatus;
  home: { id: string; addressLine: string; postalCode: string; city: string; estateName: string | null };
  fromLabel: string;                  // "If estate support"
  message: string;
  alreadyAcceptedBy: PersonRef | null;
}

export interface JoinView {
  member: Member;
  home: { id: string; addressLine: string; city: string; estateName: string | null };
  invitedBy: string | null;
}

export interface ActorGrant { homeId: string | null; memberId: string | null; actor: ActorHeader }

export interface Dashboard {
  home: Home;
  me: Member;
  supervision: Supervision;
  weather: HomeWeather;
  needsAttention: Task[];             // max 6: needsOwner, then overdue, then urgent, then soonest due
  myTasks: Task[];                    // my open/accepted tasks, soonest due first
  nextVisitTask: Task | null;         // open/accepted monthly_visit or first_walkthrough
  counts: { open: number; overdue: number; needsOwner: number; doneLast30d: number; openConcerns: number };
  members: Member[];
  essentialsMissing: EssentialStatus[];
  activeBooking: Booking | null;      // newest booking not completed/cancelled/declined
  recentActivity: Activity[];         // last 8
}

export interface PlanResponse {
  tasks: Task[];
  counts: { all: number; mine: number; open: number; needsOwner: number; overdue: number; done: number };
}

export interface TaskDetail { task: Task; activity: Activity[]; photos: Photo[]; booking: Booking | null; canEdit: boolean }

export interface NotesResponse { notes: Note[]; essentials: EssentialStatus[] }

export interface BookingOptions {
  packages: VisitPackage[];
  partner: Partner;
  slots: Record<PackageKey, Slot[]>;
  accessMethods: { key: AccessMethod; label: string }[];
  canApprove: boolean;                // the current member can approve (canAuthorise)
  authorisedMembers: PersonRef[];
  task: Task | null;                  // the task from ?taskId=, if any
  keyHolder: string | null;
}

export interface BookingDetail { booking: Booking; timeline: Activity[]; visit: Visit | null; canApprove: boolean; canCancel: boolean }

export interface PartnerJob {
  booking: Booking;
  home: { id: string; addressLine: string; postalCode: string; city: string; estateName: string | null };
  coordinator: { name: string; phone: string | null } | null;
}

export interface PartnerJobDetail extends PartnerJob {
  checklist: CheckItem[];
  essentials: Note[];                 // notes with an essentialKey
  keyHolder: string | null;
  accessNotes: string | null;
}

export interface NotificationsResponse { items: Notification[]; unread: number }

export interface HomeRecord {
  home: Home;
  generatedAt: string;
  members: Member[];
  visits: Visit[];
  completedTasks: Task[];
  openTasks: Task[];
  bookings: Booking[];
  alerts: WeatherAlert[];
  activity: Activity[];
  disclaimer: string;
}

export interface Insights {
  generatedAt: string;
  dataNote: string;                   // "Demo data: 2 story homes + 12 generated background homes"
  homes: { invited: number; setupStarted: number; active: number; closed: number; declined: number; setupCompletionRate: number };
  family: { avgMembersPerHome: number; joinedRate: number };
  tasks: { acceptedWithin48hRate: number; avgHoursToFirstAccepted: number | null; overdueNow: number; needsOwnerNow: number; completedLast30d: number };
  supervision: { onTimeRate: number; overdueHomes: number };
  weather: { alertsLast30d: number; actionedBeforeDateRate: number };
  visits: { familyLast30d: number; partnerLast30d: number };
  paidVisits: { requested: number; completed: number; conversionRate: number; serviceRevenueCents: number; avgIfFeeCents: number };
  transitions: { occupied: number; sold: number; transferred: number; closed: number; coverHelpRequested: number };
  funnel: { stage: string; count: number }[];
  homesTable: { id: string; city: string; status: HomeStatus; daysActive: number | null; supervision: SupervisionState | null; openTasks: number; paidVisits: number }[];
  assumptions: { label: string; value: string }[];
}

/* ---------------- request bodies ---------------- */
export interface AcceptInviteBody { name: string; relation: Relation; email?: string; phone?: string; city?: string }
export interface DeclineInviteBody { reason: DeclineReason }
export interface HomeSetupPatch {
  occupancyConfirmed?: boolean;
  vacantSince?: string | null;
  lastKnownVisit?: string | null;
  authorityConfirmed?: boolean;
  keyHolder?: string | null;
  accessNotes?: string | null;
  buildingType?: BuildingType | null;
  yearBuilt?: number | null;
  heatingType?: HeatingType | null;
  heatingOn?: YesNoUnknown | null;
  waterSource?: WaterSource | null;
  waterMainClosed?: YesNoUnknown | null;
  hasAlarm?: YesNoUnknown | null;
}
export interface TransitionBody { status: TransitionStatus; note?: string; newOwnerWantsCoverHelp?: boolean }
export interface InviteMemberBody { name: string; relation: Relation; role: Role; canAuthorise: boolean; email?: string; phone?: string; city?: string }
export interface MemberPatch { name?: string; email?: string | null; phone?: string | null; city?: string | null; role?: Role; canAuthorise?: boolean }
export interface CreateTaskBody { title: string; why?: string; category: TaskCategory; priority: TaskPriority; dueAt?: string | null; assigneeId?: string | null }
export interface TaskPatch { title?: string; why?: string | null; priority?: TaskPriority; dueAt?: string | null; status?: 'cancelled' }
export interface DeclineTaskBody { reason: string }
export interface AssignTaskBody { memberId: string | null }
export interface CompleteTaskBody { note?: string; photoIds?: string[] }
export interface CommentBody { body: string }
export interface CheckInput { key: string; result: CheckResult; note?: string }
export interface RecordVisitBody { visitedAt: string; indoorTempC?: number | null; checks: CheckInput[]; notes?: string; photoIds?: string[] }
export interface NoteBody { category: NoteCategory; title: string; body: string; essentialKey?: EssentialKey | null; confirmed: boolean; photoIds?: string[] }
export interface CreateBookingBody { packageKey: PackageKey; slotStart: string; accessMethod: AccessMethod; accessDetails?: string; notes?: string; taskId?: string | null; confirmAuthority?: boolean }
export interface CancelBookingBody { reason: string }
export interface PartnerDeclineBody { reason: string }
export interface PartnerReportBody { indoorTempC: number | null; checks: CheckInput[]; notes?: string; photoIds?: string[] }
export interface MarkReadBody { ids?: string[] }
