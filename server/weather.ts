// server/weather.ts — Fetch current weather + forecast from Open-Meteo (free, no API key)
// Uses hive/apiary GPS coordinates to provide location-aware inspection weather guidance.

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

export interface CurrentWeather {
  temperature: number;        // °F
  apparentTemp: number;       // °F (feels like)
  humidity: number;            // %
  windSpeed: number;           // mph
  windGusts: number;           // mph
  precipitation: number;       // inches (current hour)
  weatherCode: number;         // WMO code
  isDay: boolean;
  uvIndex: number;
}

export interface HourlyForecast {
  time: string;               // ISO
  temperature: number;        // °F
  apparentTemp: number;       // °F
  precipitation: number;      // inches
  precipitationProbability: number; // %
  windSpeed: number;          // mph
  windGusts: number;          // mph
  humidity: number;            // %
  weatherCode: number;         // WMO code
  isDay: boolean;
}

export interface DailyForecast {
  date: string;               // ISO date
  tempMax: number;             // °F
  tempMin: number;             // °F
  precipitation: number;      // inches
  precipitationProbability: number; // %
  windSpeedMax: number;       // mph
  windGustsMax: number;       // mph
  weatherCode: number;         // WMO code
  sunrise: string;             // ISO
  sunset: string;               // ISO
}

export interface WeatherResponse {
  latitude: number;
  longitude: number;
  current: CurrentWeather;
  hourly: HourlyForecast[];    // next 48 hours
  daily: DailyForecast[];      // next 7 days
  inspectionWindow: InspectionWindow;
}

export interface InspectionWindow {
  // "go" = good conditions, "caution" = marginal, "no-go" = poor
  status: 'go' | 'caution' | 'no-go';
  summary: string;
  // Best time windows in the next 48h where conditions are favorable
  bestWindows: { start: string; end: string; temp: number; wind: number; precip: number }[];
  // Next 7 days, rated for inspection suitability
  dailyRating: { date: string; rating: 'good' | 'ok' | 'poor'; reason: string; tempMax: number; precip: number; wind: number }[];
}

/** WMO weather code → human description */
export function wmoDescription(code: number): string {
  const map: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
  };
  return map[code] ?? 'Unknown (' + code + ')';
}

/** Convert °C to °F */
function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

/**
 * Fetch weather for a given lat/lng from Open-Meteo.
 * Returns current conditions + 48h hourly + 7-day daily forecast.
 */
export async function getWeather(lat: number, lng: number): Promise<WeatherResponse> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,weather_code,is_day,uv_index',
    hourly: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '7',
    forecast_hours: '48',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    temperature_unit: 'fahrenheit',
  });

  const url = WEATHER_URL + '?' + params.toString();
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Weather API ' + resp.status + ': ' + txt.slice(0, 200));
  }
  const data = await resp.json() as any;

  const current: CurrentWeather = {
    temperature: data.current?.temperature_2m ?? 0,
    apparentTemp: data.current?.apparent_temperature ?? 0,
    humidity: data.current?.relative_humidity_2m ?? 0,
    windSpeed: data.current?.wind_speed_10m ?? 0,
    windGusts: data.current?.wind_gusts_10m ?? 0,
    precipitation: data.current?.precipitation ?? 0,
    weatherCode: data.current?.weather_code ?? 0,
    isDay: data.current?.is_day === 1,
    uvIndex: data.current?.uv_index ?? 0,
  };

  const hourly: HourlyForecast[] = [];
  if (data.hourly?.time) {
    for (let i = 0; i < data.hourly.time.length; i++) {
      hourly.push({
        time: data.hourly.time[i],
        temperature: data.hourly.temperature_2m?.[i] ?? 0,
        apparentTemp: data.hourly.apparent_temperature?.[i] ?? 0,
        precipitation: data.hourly.precipitation?.[i] ?? 0,
        precipitationProbability: data.hourly.precipitation_probability?.[i] ?? 0,
        windSpeed: data.hourly.wind_speed_10m?.[i] ?? 0,
        windGusts: data.hourly.wind_gusts_10m?.[i] ?? 0,
        humidity: data.hourly.relative_humidity_2m?.[i] ?? 0,
        weatherCode: data.hourly.weather_code?.[i] ?? 0,
        isDay: data.hourly.is_day?.[i] === 1,
      });
    }
  }

  const daily: DailyForecast[] = [];
  if (data.daily?.time) {
    for (let i = 0; i < data.daily.time.length; i++) {
      daily.push({
        date: data.daily.time[i],
        tempMax: data.daily.temperature_2m_max?.[i] ?? 0,
        tempMin: data.daily.temperature_2m_min?.[i] ?? 0,
        precipitation: data.daily.precipitation_sum?.[i] ?? 0,
        precipitationProbability: data.daily.precipitation_probability_max?.[i] ?? 0,
        windSpeedMax: data.daily.wind_speed_10m_max?.[i] ?? 0,
        windGustsMax: data.daily.wind_gusts_10m_max?.[i] ?? 0,
        weatherCode: data.daily.weather_code?.[i] ?? 0,
        sunrise: data.daily.sunrise?.[i] ?? '',
        sunset: data.daily.sunset?.[i] ?? '',
      });
    }
  }

  const inspectionWindow = analyzeInspectionWindow(current, hourly, daily);

  return {
    latitude: data.latitude ?? lat,
    longitude: data.longitude ?? lng,
    current,
    hourly,
    daily,
    inspectionWindow,
  };
}

/**
 * Analyze weather data to determine if conditions are suitable for hive inspection.
 *
 * Beekeeping inspection rules of thumb:
 * - Temperature: 60-95°F is ideal. Below 55°F bees can't fly and brood can be chilled.
 *   Above 95°F is too hot (bees may be agitated, wax soft).
 * - Wind: < 15 mph sustained is fine. 15-25 mph is marginal. > 25 mph is dangerous.
 * - Precipitation: < 0.1" is fine. 0.1-0.3" is marginal. > 0.3" is a no-go.
 * - No rain during the inspection window.
 * - Daytime (bees flying, can see activity).
 */
function analyzeInspectionWindow(
  current: CurrentWeather,
  hourly: HourlyForecast[],
  daily: DailyForecast[],
): InspectionWindow {
  // Find best windows in the next 48h
  const bestWindows: InspectionWindow['bestWindows'] = [];
  let windowStart: HourlyForecast | null = null;

  for (const h of hourly) {
    const good = isGoodForInspection(h.temperature, h.windSpeed, h.windGusts, h.precipitation, h.precipitationProbability, h.isDay);
    if (good && !windowStart) {
      windowStart = h;
    } else if (!good && windowStart) {
      bestWindows.push({
        start: windowStart.time,
        end: h.time,
        temp: windowStart.temperature,
        wind: windowStart.windSpeed,
        precip: windowStart.precipitation,
      });
      windowStart = null;
    }
  }
  if (windowStart) {
    bestWindows.push({
      start: windowStart.time,
      end: hourly[hourly.length - 1]?.time ?? windowStart.time,
      temp: windowStart.temperature,
      wind: windowStart.windSpeed,
      precip: windowStart.precipitation,
    });
  }

  // Rate each day
  const dailyRating: InspectionWindow['dailyRating'] = daily.map((d) => {
    const rating = rateDay(d.tempMax, d.precipitation, d.precipitationProbability, d.windSpeedMax, d.windGustsMax, d.weatherCode);
    return {
      date: d.date,
      rating: rating.rating,
      reason: rating.reason,
      tempMax: d.tempMax,
      precip: d.precipitation,
      wind: d.windSpeedMax,
    };
  });

  // Current status
  const currentGood = isGoodForInspection(
    current.temperature, current.windSpeed, current.windGusts,
    current.precipitation, 0, current.isDay,
  );
  const nextWindow = bestWindows[0];
  let status: 'go' | 'caution' | 'no-go';
  let summary: string;

  if (currentGood && current.isDay) {
    status = 'go';
    summary = 'Conditions are good for inspection right now.';
  } else if (nextWindow) {
    const hoursUntil = Math.round((new Date(nextWindow.start).getTime() - Date.now()) / 3600000);
    if (hoursUntil <= 3) {
      status = 'caution';
      summary = `Next good window in ~${hoursUntil}h (${new Date(nextWindow.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}).`;
    } else {
      status = 'no-go';
      summary = `Not ideal now. Next good window in ~${hoursUntil}h.`;
    }
  } else {
    status = 'no-go';
    const todayRating = dailyRating[0];
    if (todayRating) {
      summary = 'Poor conditions today. ' + todayRating.reason;
    } else {
      summary = 'No favorable inspection windows in the next 48 hours.';
    }
  }

  return { status, summary, bestWindows: bestWindows.slice(0, 4), dailyRating };
}

function isGoodForInspection(
  temp: number, wind: number, gusts: number,
  precip: number, precipProb: number, isDay: boolean,
): boolean {
  if (!isDay) return false;
  if (temp < 55 || temp > 95) return false;
  if (wind > 15) return false;
  if (gusts > 25) return false;
  if (precip > 0.05) return false;
  if (precipProb > 40) return false;
  return true;
}

function rateDay(
  tempMax: number, precip: number, precipProb: number,
  windMax: number, gustsMax: number, weatherCode: number,
): { rating: 'good' | 'ok' | 'poor'; reason: string } {
  const reasons: string[] = [];

  if (tempMax < 55) reasons.push('too cold (' + Math.round(tempMax) + '°F max)');
  else if (tempMax > 100) reasons.push('too hot (' + Math.round(tempMax) + '°F max)');

  if (precip > 0.3) reasons.push('heavy rain (' + precip.toFixed(1) + '")');
  else if (precip > 0.1) reasons.push('some rain (' + precip.toFixed(1) + '")');

  if (windMax > 25) reasons.push('windy (' + Math.round(windMax) + ' mph)');
  else if (windMax > 15) reasons.push('breezy (' + Math.round(windMax) + ' mph)');

  // Thunderstorm codes
  if (weatherCode >= 95) reasons.push('thunderstorms');

  if (reasons.length === 0) return { rating: 'good', reason: 'Good conditions for inspection.' };
  if (reasons.length === 1 && reasons[0].startsWith('breezy')) return { rating: 'ok', reason: 'Marginal: ' + reasons[0] + '.' };
  if (reasons.length >= 2) return { rating: 'poor', reason: 'Poor: ' + reasons.join(', ') + '.' };
  if (reasons[0].startsWith('too') || reasons[0].includes('heavy') || reasons[0].includes('thunder')) {
    return { rating: 'poor', reason: 'Poor: ' + reasons[0] + '.' };
  }
  return { rating: 'ok', reason: 'Marginal: ' + reasons[0] + '.' };
}