import { z } from 'zod';
import { zComment, zIsoDate, zName, zNullableText, zOptionalText, zTemp, zUuid, zYmd } from './http';

/* Request schemas: one per contract body type (7.2). Strings are trimmed; limits follow section 13. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optionalEmail = zOptionalText(200).refine((v) => !v || EMAIL.test(v), 'Enter a valid email address');
const nullableEmail = zNullableText(200).refine((v) => !v || EMAIL.test(v), 'Enter a valid email address');

export const relation = z.enum(['child', 'spouse', 'sibling', 'grandchild', 'relative', 'friend', 'other']);
export const role = z.enum(['coordinator', 'helper', 'viewer']);
const yesNo = z.enum(['yes', 'no', 'unknown']);
const taskCategory = z.enum(['water', 'heating', 'electricity', 'security', 'outside', 'admin', 'visit', 'appliances', 'other']);
const taskPriority = z.enum(['urgent', 'high', 'normal']);
const noteCategory = z.enum(['water', 'heating', 'electricity', 'access', 'contacts', 'appliances', 'other']);
const essentialKey = z.enum(['water_main_valve', 'water_meter', 'fuse_box', 'heating_controls', 'key_location', 'neighbour_contact', 'well_pump']);
const photoIds = z.array(zUuid).max(20).optional();
const reason = z.string().trim().min(1, 'Give a reason').max(1000);
const title = z.string().trim().min(1).max(120);

export const acceptInviteBody = z.object({
  name: zName,
  relation,
  email: optionalEmail,
  phone: zOptionalText(40),
  city: zOptionalText(80),
});

export const declineInviteBody = z.object({ reason: z.enum(['someone_lives_there', 'not_now', 'not_responsible']) });

export const homeSetupPatch = z.object({
  occupancyConfirmed: z.boolean().optional(),
  vacantSince: zYmd.nullable().optional(),
  lastKnownVisit: zYmd.nullable().optional(),
  authorityConfirmed: z.boolean().optional(),
  keyHolder: zNullableText(200),
  accessNotes: zNullableText(2000),
  buildingType: z.enum(['detached', 'semi_detached', 'terraced', 'cottage', 'other']).nullable().optional(),
  yearBuilt: z.number().int().min(1700).max(2100).nullable().optional(),
  heatingType: z.enum(['district', 'electric', 'oil', 'ground_heat_pump', 'air_heat_pump', 'wood', 'unknown']).nullable().optional(),
  heatingOn: yesNo.nullable().optional(),
  waterSource: z.enum(['municipal', 'well', 'unknown']).nullable().optional(),
  waterMainClosed: yesNo.nullable().optional(),
  hasAlarm: yesNo.nullable().optional(),
});

export const transitionBody = z.object({
  status: z.enum(['occupied', 'sold', 'transferred', 'closed']),
  note: zOptionalText(2000),
  newOwnerWantsCoverHelp: z.boolean().optional(),
});

export const inviteMemberBody = z.object({
  name: zName,
  relation,
  role,
  canAuthorise: z.boolean(),
  email: optionalEmail,
  phone: zOptionalText(40),
  city: zOptionalText(80),
});

export const memberPatch = z.object({
  name: zName.optional(),
  email: nullableEmail,
  phone: zNullableText(40),
  city: zNullableText(80),
  role: role.optional(),
  canAuthorise: z.boolean().optional(),
});

export const createTaskBody = z.object({
  title,
  why: zOptionalText(2000),
  category: taskCategory,
  priority: taskPriority,
  dueAt: zIsoDate.nullable().optional(),
  assigneeId: zUuid.nullable().optional(),
});

export const taskPatch = z.object({
  title: title.optional(),
  why: zNullableText(2000),
  priority: taskPriority.optional(),
  dueAt: zIsoDate.nullable().optional(),
  status: z.literal('cancelled').optional(),
});

export const reasonBody = z.object({ reason });
export const assignTaskBody = z.object({ memberId: zUuid.nullable() });
export const completeTaskBody = z.object({ note: zOptionalText(2000), photoIds });
export const commentBody = z.object({ body: zComment });

const checkInput = z.object({
  key: z.string().trim().min(1).max(40),
  result: z.enum(['ok', 'concern', 'not_checked']),
  note: zOptionalText(2000),
});

export const recordVisitBody = z.object({
  visitedAt: zIsoDate.refine((v) => new Date(v).getTime() <= Date.now() + 60 * 60 * 1000, "A visit can't be more than an hour in the future"),
  indoorTempC: zTemp.nullable().optional(),
  checks: z.array(checkInput).max(30),
  notes: zOptionalText(2000),
  photoIds,
});

export const noteBody = z.object({
  category: noteCategory,
  title,
  body: z.string().trim().max(2000),
  essentialKey: essentialKey.nullable().optional(),
  confirmed: z.boolean(),
  photoIds,
});

export const notePatch = noteBody.partial();

export const createBookingBody = z.object({
  packageKey: z.enum(['check', 'winter', 'urgent']),
  slotStart: zIsoDate,
  accessMethod: z.enum(['key_holder_meets', 'key_box', 'partner_collects_key', 'other']),
  accessDetails: zOptionalText(1000),
  notes: zOptionalText(2000),
  taskId: zUuid.nullable().optional(),
  confirmAuthority: z.boolean().optional(),
});

export const partnerReportBody = z.object({
  indoorTempC: zTemp.nullable(),
  checks: z.array(checkInput).max(30),
  notes: zOptionalText(2000),
  photoIds,
});

export const markReadBody = z.object({ ids: z.array(zUuid).max(200).optional() });

/* ---------------- queries ---------------- */

export const taskFilterQuery = z.object({
  filter: z.enum(['all', 'mine', 'open', 'needs_owner', 'overdue', 'done']).default('all'),
});
export const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
export const partnerJobsQuery = z.object({ status: z.enum(['open', 'scheduled', 'done']).default('open') });
export const bookingOptionsQuery = z.object({ taskId: z.string().optional() });
