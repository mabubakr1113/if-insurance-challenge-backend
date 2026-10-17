import type { ForecastDay, WeatherRule } from '../contract';
import { THRESHOLDS } from '../catalog';
import { fmtDate, fmtTemp } from '../time';

export interface AlertCandidate {
  rule: WeatherRule;
  forDate: string;
  message: string;
  minC: number | null;
  gustMs: number | null;
  snowCm: number | null;
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Which rules (8.7) the forecast triggers, for each day from today on. */
export function evaluateForecast(days: ForecastDay[], today: string): AlertCandidate[] {
  const upcoming = days.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const out: AlertCandidate[] = [];
  for (const d of upcoming) {
    if (d.minC <= THRESHOLDS.hardFrostC || d.minC <= THRESHOLDS.frostC) {
      out.push({
        rule: d.minC <= THRESHOLDS.hardFrostC ? 'hard_frost' : 'frost',
        forDate: d.date,
        message: `${fmtTemp(d.minC)} forecast for ${fmtDate(d.date)}`,
        minC: d.minC,
        gustMs: null,
        snowCm: null,
      });
    }
    if (d.gustMs >= THRESHOLDS.stormGustMs) {
      out.push({
        rule: 'storm',
        forDate: d.date,
        message: `Gusts of ${num(d.gustMs)} m/s forecast for ${fmtDate(d.date)}`,
        minC: null,
        gustMs: d.gustMs,
        snowCm: null,
      });
    }
  }
  const snowDays = upcoming.filter((d) => d.snowCm > 0);
  const totalSnow = Math.round(upcoming.reduce((sum, d) => sum + d.snowCm, 0) * 10) / 10;
  if (totalSnow >= THRESHOLDS.heavySnowCm && snowDays.length) {
    out.push({
      rule: 'heavy_snow',
      forDate: snowDays[0].date,
      message: `${num(totalSnow)} cm of snow forecast by ${fmtDate(snowDays[snowDays.length - 1].date)}`,
      minC: null,
      gustMs: null,
      snowCm: totalSnow,
    });
  }
  return out;
}
