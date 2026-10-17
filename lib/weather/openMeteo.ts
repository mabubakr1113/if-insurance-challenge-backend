import type { ForecastDay } from '../contract';

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_min: (number | null)[];
  temperature_2m_max: (number | null)[];
  wind_gusts_10m_max: (number | null)[];
  snowfall_sum: (number | null)[];
}

const r1 = (n: number | null | undefined) => Math.round((n ?? 0) * 10) / 10;

/** Today + 3 days for a location, Helsinki dates. Returns null on any failure (the caller keeps what it has). */
export async function fetchOpenMeteo(lat: number, lng: number): Promise<ForecastDay[] | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    '&daily=temperature_2m_min,temperature_2m_max,wind_gusts_10m_max,snowfall_sum' +
    '&wind_speed_unit=ms&timezone=Europe%2FHelsinki&forecast_days=4';
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { daily?: OpenMeteoDaily };
    const d = json.daily;
    if (!d?.time?.length) return null;
    return d.time.map((date, i) => ({
      date,
      minC: r1(d.temperature_2m_min[i]),
      maxC: r1(d.temperature_2m_max[i]),
      gustMs: r1(d.wind_gusts_10m_max[i]),
      snowCm: r1(d.snowfall_sum[i]),
    }));
  } catch {
    return null;
  }
}
