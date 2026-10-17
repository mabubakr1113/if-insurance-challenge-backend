import type { ForecastDay } from '../contract';
import { addDays } from '../time';

/** Demo: a −18 °C night tomorrow (11). */
export function coldNightForecast(today: string): ForecastDay[] {
  return [
    { date: today, minC: -6, maxC: -2, gustMs: 6, snowCm: 0 },
    { date: addDays(today, 1), minC: -18, maxC: -11, gustMs: 6, snowCm: 1 },
    { date: addDays(today, 2), minC: -15, maxC: -9, gustMs: 6, snowCm: 2 },
    { date: addDays(today, 3), minC: -8, maxC: -3, gustMs: 6, snowCm: 0 },
  ];
}

/** Demo: 26 m/s gusts tomorrow; the other days are calm (11). */
export function stormForecast(today: string): ForecastDay[] {
  return [
    { date: today, minC: 3, maxC: 7, gustMs: 8, snowCm: 0 },
    { date: addDays(today, 1), minC: 1, maxC: 5, gustMs: 26, snowCm: 0 },
    { date: addDays(today, 2), minC: 2, maxC: 6, gustMs: 9, snowCm: 0 },
    { date: addDays(today, 3), minC: 0, maxC: 4, gustMs: 7, snowCm: 0 },
  ];
}
