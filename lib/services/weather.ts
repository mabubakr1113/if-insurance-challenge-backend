import type { ForecastDay, HomeWeather } from '@/lib/contract';
import { SYSTEM_LABEL } from '@/lib/auth';
import { THRESHOLDS } from '@/lib/catalog';
import { one, rows, type HomeRow, type TaskRow, type WeatherAlertRow } from '@/lib/db';
import { mapAlert } from '@/lib/mappers';
import { fromTemplate } from '@/lib/plan/generate';
import { WEATHER_TEMPLATES, templateByKey } from '@/lib/plan/templates';
import { db } from '@/lib/supabase';
import { DAY, HOUR, addDays, atHelsinki, fmtDate, today } from '@/lib/time';
import { fetchOpenMeteo } from '@/lib/weather/openMeteo';
import { evaluateForecast } from '@/lib/weather/rules';
import { logActivity } from './activity';
import { coordinatorIds, homeMembers, joinedIds, notify } from './notifications';
import { insertTasks, updateTask } from './tasks';

/* ---------------- reading ---------------- */

export async function buildWeather(home: HomeRow): Promise<HomeWeather> {
  const todayStr = today();
  const alerts = await rows<WeatherAlertRow>(
    db().from('weather_alerts').select('*').eq('home_id', home.id).order('created_at', { ascending: false }),
  );
  const taskIds = alerts.map((a) => a.task_id).filter((id): id is string => !!id);
  const tasks = taskIds.length ? await rows<TaskRow>(db().from('tasks').select('*').in('id', taskIds)) : [];
  const mapped = alerts.map((a) => mapAlert(a, tasks.find((t) => t.id === a.task_id)));
  const monthAgo = Date.now() - 30 * DAY;
  return {
    source: home.forecast_source ?? 'open-meteo',
    fetchedAt: home.forecast_fetched_at,
    days: (home.forecast ?? []).filter((d) => d.date >= todayStr).slice(0, 4),
    activeAlerts: mapped.filter((a) => a.forDate >= todayStr).sort((a, b) => a.forDate.localeCompare(b.forDate)),
    recentAlerts: mapped.filter((a) => new Date(a.createdAt).getTime() >= monthAgo),
    thresholds: THRESHOLDS,
  };
}

async function storeForecast(home: HomeRow, days: ForecastDay[] | null, source: HomeRow['forecast_source']): Promise<HomeRow> {
  return one<HomeRow>(
    db()
      .from('homes')
      .update({ forecast: days, forecast_source: source, forecast_fetched_at: days ? new Date().toISOString() : null })
      .eq('id', home.id)
      .select('*')
      .single(),
  );
}

/** Refetches from Open-Meteo. On failure keeps what is stored (or, when leaving a simulation, clears it). */
export async function refetch(home: HomeRow, leavingSimulation = false): Promise<HomeRow> {
  const days = await fetchOpenMeteo(home.lat, home.lng);
  if (days) return storeForecast(home, days, 'open-meteo');
  return leavingSimulation ? storeForecast(home, null, 'open-meteo') : home;
}

/** GET weather: simulated → as stored; Open-Meteo younger than 60 min → as stored; otherwise refetch + rules. */
export async function getWeather(home: HomeRow): Promise<HomeWeather> {
  if (home.status !== 'active' || home.forecast_source === 'simulated') return buildWeather(home);
  const fresh = home.forecast_fetched_at && Date.now() - new Date(home.forecast_fetched_at).getTime() < HOUR;
  if (fresh) return buildWeather(home);
  const updated = await refetch(home);
  await runRules(updated);
  return buildWeather(updated);
}

/** POST refresh: always refetches unless simulated, then runs the rules. */
export async function refreshWeather(home: HomeRow): Promise<HomeWeather> {
  if (home.status !== 'active') return buildWeather(home);
  const updated = home.forecast_source === 'simulated' ? home : await refetch(home);
  await runRules(updated);
  return buildWeather(updated);
}

export async function simulateForecast(home: HomeRow, days: ForecastDay[]): Promise<HomeWeather> {
  const updated = await storeForecast(home, days, 'simulated');
  await runRules(updated);
  return buildWeather(updated);
}

export async function backToRealForecast(home: HomeRow): Promise<HomeWeather> {
  const updated = await refetch(home, true);
  await runRules(updated);
  return buildWeather(updated);
}

/* ---------------- rules (8.7) ---------------- */

const taskLink = (t: TaskRow) => `/homes/${t.home_id}/tasks/${t.id}`;

/** The day before `forDate` at 18:00, never in the past (then now + 2 h). */
function dueBefore(forDate: string): Date {
  const target = atHelsinki(addDays(forDate, -1), '18:00');
  return target.getTime() <= Date.now() ? new Date(Date.now() + 2 * HOUR) : target;
}

async function openTask(homeId: string, templateKey: string): Promise<TaskRow | null> {
  const found = await rows<TaskRow>(
    db()
      .from('tasks')
      .select('*')
      .eq('home_id', homeId)
      .eq('template_key', templateKey)
      .in('status', ['open', 'accepted'])
      .order('due_at', { ascending: true })
      .limit(1),
  );
  return found[0] ?? null;
}

async function createWeatherTask(
  home: HomeRow,
  key: 'heating_check' | 'storm_check' | 'roof_snow_check',
  dueAt: Date,
  priority: 'urgent' | 'high',
  reason: string,
): Promise<TaskRow> {
  const template = key === 'heating_check' ? templateByKey(key) : WEATHER_TEMPLATES[key];
  if (!template) throw new Error(`Template ${key} missing`);
  const [task] = await insertTasks([fromTemplate(home.id, template, { dueAt, origin: 'weather', priority })]);
  await logActivity({
    homeId: home.id,
    type: 'task_created',
    actorLabel: SYSTEM_LABEL,
    message: `Home Watch added “${task.title}” because of the forecast: ${reason}`,
    taskId: task.id,
  });
  return task;
}

/** hard_frost: make the heating check urgent and due before the cold day, or create one. */
async function escalateHeating(home: HomeRow, alert: WeatherAlertRow): Promise<TaskRow> {
  const target = dueBefore(alert.for_date);
  const existing = await openTask(home.id, 'heating_check');
  if (!existing) return createWeatherTask(home, 'heating_check', target, 'urgent', alert.message);
  const patch: Partial<TaskRow> = {};
  if (existing.priority !== 'urgent') patch.priority = 'urgent';
  if (!existing.due_at || target.getTime() < new Date(existing.due_at).getTime()) patch.due_at = target.toISOString();
  if (Object.keys(patch).length === 0) return existing;
  const updated = await updateTask(existing.id, patch);
  await logActivity({
    homeId: home.id,
    type: 'task_escalated',
    actorLabel: SYSTEM_LABEL,
    message: `“${existing.title}” is now urgent: ${alert.message}`,
    taskId: existing.id,
  });
  return updated;
}

/**
 * Runs the rules over the stored forecast for active homes. Each rule fires once per (home, rule, date);
 * side effects run only for newly inserted alerts. Within one run, each kind of weather notifies the family
 * once (for its earliest new day), and a hard frost replaces the frost message, so a cold spell is one message.
 */
export async function runRules(home: HomeRow): Promise<void> {
  if (home.status !== 'active' || !home.forecast?.length) return;
  const candidates = evaluateForecast(home.forecast, today());
  if (candidates.length === 0) return;
  const source = home.forecast_source ?? 'open-meteo';
  const inserted = await rows<WeatherAlertRow>(
    db()
      .from('weather_alerts')
      .upsert(
        candidates.map((c) => ({
          home_id: home.id,
          rule: c.rule,
          for_date: c.forDate,
          message: c.message,
          min_temp_c: c.minC,
          gust_ms: c.gustMs,
          snow_cm: c.snowCm,
          source,
        })),
        { onConflict: 'home_id,rule,for_date', ignoreDuplicates: true },
      )
      .select('*'),
  );
  if (inserted.length === 0) return;

  const members = await homeMembers(home.id);
  const everyone = joinedIds(members);
  const hasHardFrost = inserted.some((a) => a.rule === 'hard_frost');
  const notified = new Set<string>();
  const order = { hard_frost: 0, frost: 1, storm: 2, heavy_snow: 3 };
  inserted.sort((a, b) => a.for_date.localeCompare(b.for_date) || order[a.rule] - order[b.rule]);

  for (const alert of inserted) {
    let task: TaskRow;
    if (alert.rule === 'hard_frost') {
      task = await escalateHeating(home, alert);
    } else if (alert.rule === 'frost') {
      task = (await openTask(home.id, 'heating_check')) ?? (await createWeatherTask(home, 'heating_check', dueBefore(alert.for_date), 'high', alert.message));
    } else if (alert.rule === 'storm') {
      task = (await openTask(home.id, 'storm_check')) ??
        (await createWeatherTask(home, 'storm_check', atHelsinki(addDays(alert.for_date, 1), '18:00'), 'high', alert.message));
    } else {
      task = (await openTask(home.id, 'roof_snow_check')) ??
        (await createWeatherTask(home, 'roof_snow_check', atHelsinki(addDays(alert.for_date, 2), '18:00'), 'high', alert.message));
    }

    await db().from('weather_alerts').update({ task_id: task.id }).eq('id', alert.id);
    await logActivity({ homeId: home.id, type: 'weather_alert', actorLabel: SYSTEM_LABEL, message: alert.message, taskId: task.id });

    const date = fmtDate(alert.for_date);
    if (alert.rule === 'hard_frost' && !notified.has('cold')) {
      notified.add('cold');
      const temp = alert.message.split(' forecast')[0];
      await notify(
        { memberIds: everyone },
        { homeId: home.id, channel: 'sms', title: `Cold night on ${date}`, body: `Cold night on ${date}: ${temp} forecast. The heating check is urgent.`, link: taskLink(task) },
      );
      if (!task.assignee_id && !task.booking_id) {
        await notify(
          { memberIds: coordinatorIds(members) },
          {
            homeId: home.id,
            channel: 'in_app',
            title: 'Nobody has accepted the heating check yet',
            body: `The cold night is on ${date}. Ask someone in the family, or request a local visit.`,
            link: `/homes/${home.id}/help?taskId=${task.id}`,
          },
        );
      }
    } else if (alert.rule === 'frost' && !hasHardFrost && !notified.has('cold')) {
      notified.add('cold');
      await notify(
        { memberIds: everyone },
        { homeId: home.id, channel: 'in_app', title: `Frost on ${date}`, body: `${alert.message}. Check the heating is on.`, link: taskLink(task) },
      );
    } else if (alert.rule === 'storm' && !notified.has('storm')) {
      notified.add('storm');
      await notify(
        { memberIds: everyone },
        { homeId: home.id, channel: 'sms', title: `Storm on ${date}`, body: `${alert.message}. Check the house after the storm.`, link: taskLink(task) },
      );
    } else if (alert.rule === 'heavy_snow' && !notified.has('snow')) {
      notified.add('snow');
      await notify(
        { memberIds: everyone },
        { homeId: home.id, channel: 'in_app', title: 'Heavy snow forecast', body: `${alert.message}. Check the roof from the ground.`, link: taskLink(task) },
      );
    }
  }
}
