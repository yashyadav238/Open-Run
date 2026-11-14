export const GOOGLE_MAPS_ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];
export const GOOGLE_MAPS_MAP_ID = 'DEMO_MAP_ID';

export async function resolveGoogleMapsApiKey(): Promise<string> {
  const envKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
    (globalThis as unknown as { GOOGLE_MAPS_API_KEY?: string }).GOOGLE_MAPS_API_KEY ||
    '';
  if (envKey) return envKey;

  try {
    const res = await fetch('/api/maps-config');
    if (!res.ok) return '';
    const data = (await res.json()) as { apiKey?: string };
    return data.apiKey || '';
  } catch {
    return '';
  }
}
