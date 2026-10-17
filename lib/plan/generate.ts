import type { TaskOrigin, TaskPriority } from '../contract';
import type { HomeRow, TaskRow } from '../db';
import { dueAfter } from '../time';
import { PLAN_TEMPLATES, type TaskTemplate } from './templates';

/** The insertable shape of a task row. Ids and timestamps can be set explicitly (the seed does). */
export type TaskInsert = Partial<TaskRow> & Pick<TaskRow, 'home_id' | 'title' | 'category'>;

type TemplateFields = Pick<TaskTemplate, 'key' | 'title' | 'category' | 'priority' | 'recurrenceDays' | 'source' | 'why' | 'how'>;

/** The columns a task copies from its template. Recurring occurrences reuse them. */
export function fromTemplate(
  homeId: string,
  t: TemplateFields,
  opts: { dueAt: Date; origin?: TaskOrigin; priority?: TaskPriority; needsInfo?: string | null },
): TaskInsert {
  return {
    home_id: homeId,
    template_key: t.key,
    title: t.title,
    why: t.why,
    how: t.how,
    category: t.category,
    priority: opts.priority ?? t.priority,
    status: 'open',
    due_at: opts.dueAt.toISOString(),
    recurrence_days: t.recurrenceDays,
    origin: opts.origin ?? 'plan',
    source_label: t.source?.label ?? null,
    source_url: t.source?.url ?? null,
    needs_info: opts.needsInfo ?? null,
    created_by_label: 'Home Watch',
  };
}

/** One task per matching template, due at activation date + dueDays at 18:00 Helsinki (8.2). */
export function generatePlan(home: HomeRow, activatedAt: Date): TaskInsert[] {
  return PLAN_TEMPLATES.filter((t) => t.condition(home)).map((t) =>
    fromTemplate(home.id, t, { dueAt: dueAfter(activatedAt, t.dueDays), needsInfo: t.needsInfo?.(home) ?? null }),
  );
}
