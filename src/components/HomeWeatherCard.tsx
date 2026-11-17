import React, { useCallback, useEffect, useState } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Droplets,
  Loader2,
  LocateFixed,
  RefreshCw,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import type { ActiveRunningCity } from '../data/worldCities';

interface HomeWeatherCardProps {
  activeCity: ActiveRunningCity;
}

interface LiveWeatherState {
  tempC: number;
  feelsLikeC: number;
  humidityPct: number;
  windKmh: number;
  weatherCode: number;
  usAqi: number | null;
  pm25: number | null;
  locationLabel: string;
  isGps: boolean;
  updatedAt: string;
}

function describeWeatherCode(code: number): { label: string; icon: 'sun' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' } {
  if (code === 0) return { label: 'Clear Sky', icon: 'sun' };
  if (code <= 3) return { label: 'Partly Cloudy', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Foggy', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: 'snow' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'storm' };
  return { label: 'Clear', icon: 'sun' };
}

function getAqiMeta(aqi: number | null): {
  label: string;
  badgeClass: string;
  barClass: string;
} {
  if (aqi === null) {
    return {
      label: 'N/A',
      badgeClass: 'bg-[#F0EFEA] text-[#5B6B64]',
      barClass: 'bg-[#5B6B64]',
    };
  }
  if (aqi <= 50) {
    return {
      label: 'Good',
      badgeClass: 'bg-emerald-100 text-emerald-900',
      barClass: 'bg-emerald-600',
    };
  }
  if (aqi <= 100) {
    return {
      label: 'Moderate',
      badgeClass: 'bg-amber-100 text-amber-900',
      barClass: 'bg-amber-500',
    };
  }
  if (aqi <= 150) {
    return {
      label: 'Sensitive',
      badgeClass: 'bg-orange-100 text-orange-900',
      barClass: 'bg-orange-500',
    };
  }
  if (aqi <= 200) {
    return {
      label: 'Unhealthy',
      badgeClass: 'bg-red-100 text-red-900',
      barClass: 'bg-red-600',
    };
  }
  return {
    label: 'Very Poor',
    badgeClass: 'bg-purple-100 text-purple-900',
    barClass: 'bg-purple-700',
  };
}

function getRunConditionTip(w: LiveWeatherState): string {
  if (w.usAqi !== null && w.usAqi > 150) {
    return 'High AQI — consider an easy indoor workout or shorter outdoor session.';
  }
  if (w.tempC >= 33) {
    return 'Hot outside — hydrate extra and keep your pace relaxed.';
  }
  if (w.humidityPct >= 75) {
    return 'High humidity — expect higher sweat loss, carry water.';
  }
  if (w.usAqi !== null && w.usAqi <= 50 && w.tempC >= 12 && w.tempC <= 26) {
    return 'Ideal running weather — clean air and comfortable temperature.';
  }
  return 'Good conditions for an outdoor session — enjoy your run!';
}

export const HomeWeatherCard: React.FC<HomeWeatherCardProps> = ({ activeCity }) => {
  const [weather, setWeather] = useState<LiveWeatherState | null>(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; label: string; isGps: boolean }>({
    lat: activeCity.lat,
    lng: activeCity.lng,
    label: activeCity.name,
    isGps: false,
  });

  useEffect(() => {
    setCoords((prev) =>
      prev.isGps
        ? prev
        : {
            lat: activeCity.lat,
            lng: activeCity.lng,
            label: activeCity.name,
            isGps: false,
          }
    );
  }, [activeCity.lat, activeCity.lng, activeCity.name]);

  const fetchWeatherAndAqi = useCallback(
    async (lat: number, lng: number, label: string, isGps: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`;
        const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=us_aqi,pm2_5`;

        const [wRes, aRes] = await Promise.all([fetch(weatherUrl), fetch(aqiUrl)]);
        if (!wRes.ok) throw new Error('Weather service unavailable');
        const wJson = (await wRes.json()) as {
          current?: {
            temperature_2m?: number;
            relative_humidity_2m?: number;
            apparent_temperature?: number;
            weather_code?: number;
            wind_speed_10m?: number;
          };
        };
        const aJson = aRes.ok
          ? ((await aRes.json()) as {
              current?: { us_aqi?: number; pm2_5?: number };
            })
          : null;

        const cur = wJson.current;
        if (!cur || typeof cur.temperature_2m !== 'number') {
          throw new Error('Incomplete weather data');
        }

        setWeather({
          tempC: Math.round(cur.temperature_2m),
          feelsLikeC: Math.round(cur.apparent_temperature ?? cur.temperature_2m),
          humidityPct: Math.round(cur.relative_humidity_2m ?? 50),
          windKmh: Math.round(cur.wind_speed_10m ?? 0),
          weatherCode: cur.weather_code ?? 0,
          usAqi: typeof aJson?.current?.us_aqi === 'number' ? Math.round(aJson.current.us_aqi) : null,
          pm25: typeof aJson?.current?.pm2_5 === 'number' ? Number(aJson.current.pm2_5.toFixed(1)) : null,
          locationLabel: label,
          isGps,
          updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      } catch {
        setError('Unable to load live weather right now.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Try silent GPS once on mount if permission is already granted, else load activeCity immediately
  useEffect(() => {
    void fetchWeatherAndAqi(coords.lat, coords.lng, coords.label, coords.isGps);
  }, [coords.lat, coords.lng, coords.label, coords.isGps, fetchWeatherAndAqi]);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'Current GPS Location',
          isGps: true,
        });
      },
      () => {
        setLocating(false);
        setError('Location permission denied — showing weather for ' + activeCity.name + '.');
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const renderWeatherIcon = (icon: ReturnType<typeof describeWeatherCode>['icon']) => {
    const cls = 'h-5 w-5 text-[#172D27]';
    switch (icon) {
      case 'sun':
        return <Sun className={cls} />;
      case 'cloud':
        return <Cloud className={cls} />;
      case 'fog':
        return <CloudFog className={cls} />;
      case 'drizzle':
        return <CloudDrizzle className={cls} />;
      case 'rain':
        return <CloudRain className={cls} />;
      case 'snow':
        return <CloudSnow className={cls} />;
      case 'storm':
        return <CloudLightning className={cls} />;
    }
  };

  const desc = weather ? describeWeatherCode(weather.weatherCode) : null;
  const aqiMeta = getAqiMeta(weather?.usAqi ?? null);

  return (
    <section className="rounded-2xl border border-[#E5E3DC] bg-white p-4 sm:p-5 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EBF5EE]">
            {desc ? renderWeatherIcon(desc.icon) : <Sun className="h-5 w-5 text-[#172D27]" />}
          </div>
          <div>
            <h2 className="font-display text-sm font-bold text-[#141F1B]">
              Local Running Weather &amp; AQI
            </h2>
            <p className="text-[11px] text-[#5B6B64]">
              {weather?.locationLabel || coords.label}
              {desc ? ` · ${desc.label}` : ''}
              {weather ? ` · Updated ${weather.updatedAt}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={locating || loading}
            onClick={handleUseMyLocation}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-[#D9D7CE] bg-[#F6F5F0] px-2.5 text-[11px] font-semibold text-[#172D27] hover:bg-[#EBF5EE] disabled:opacity-50"
          >
            {locating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LocateFixed className="h-3.5 w-3.5" />
            )}
            {locating ? 'Locating...' : 'My GPS'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchWeatherAndAqi(coords.lat, coords.lng, coords.label, coords.isGps)}
            aria-label="Refresh weather"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-xl border border-[#D9D7CE] bg-white text-[#5B6B64] hover:bg-[#F6F5F0] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="text-xs font-semibold text-amber-800">{error}</p>}

      {loading && !weather ? (
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-[#F6F5F0]" />
          ))}
        </div>
      ) : weather ? (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            {/* Temperature */}
            <div className="rounded-xl bg-[#F6F5F0] p-3">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#5B6B64]">
                <Thermometer className="h-3 w-3 text-[#172D27]" />
                Temp
              </div>
              <p className="mt-1 font-mono text-xl font-extrabold text-[#141F1B] tabular-nums">
                {weather.tempC}°C
              </p>
              <p className="text-[10px] text-[#5B6B64]">Feels {weather.feelsLikeC}°C</p>
            </div>

            {/* Humidity */}
            <div className="rounded-xl bg-[#F6F5F0] p-3">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#5B6B64]">
                <Droplets className="h-3 w-3 text-[#172D27]" />
                Humidity
              </div>
              <p className="mt-1 font-mono text-xl font-extrabold text-[#141F1B] tabular-nums">
                {weather.humidityPct}%
              </p>
              <p className="inline-flex items-center gap-1 text-[10px] text-[#5B6B64]">
                <Wind className="h-2.5 w-2.5" />
                {weather.windKmh} km/h
              </p>
            </div>

            {/* AQI */}
            <div className="rounded-xl bg-[#F6F5F0] p-3">
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-[#5B6B64]">
                <span>AQI</span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${aqiMeta.badgeClass}`}>
                  {aqiMeta.label}
                </span>
              </div>
              <p className="mt-1 font-mono text-xl font-extrabold text-[#141F1B] tabular-nums">
                {weather.usAqi !== null ? weather.usAqi : '—'}
              </p>
              <p className="text-[10px] text-[#5B6B64]">
                {weather.pm25 !== null ? `PM2.5: ${weather.pm25}` : 'US AQI'}
              </p>
            </div>
          </div>

          <p className="rounded-xl bg-[#EBF5EE]/70 px-3 py-2 text-xs font-medium text-[#172D27]">
            {getRunConditionTip(weather)}
          </p>
        </>
      ) : null}
    </section>
  );
};
