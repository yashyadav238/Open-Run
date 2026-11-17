export type AppThemeId = 'light' | 'dark' | 'ocean' | 'sunset' | 'violet' | 'crimson';

export interface AppThemeMeta {
  id: AppThemeId;
  name: string;
  mode: 'light' | 'dark';
  description: string;
  swatches: {
    canvas: string;
    surface: string;
    brand: string;
    accent: string;
  };
}

export const APP_THEMES: AppThemeMeta[] = [
  {
    id: 'light',
    name: 'Open Forest',
    mode: 'light',
    description: 'Clean warm light canvas with deep pine & lime',
    swatches: {
      canvas: '#F6F5F0',
      surface: '#FFFFFF',
      brand: '#172D27',
      accent: '#9AE62E',
    },
  },
  {
    id: 'dark',
    name: 'Midnight Track',
    mode: 'dark',
    description: 'High-contrast dark mode with electric lime',
    swatches: {
      canvas: '#0B1210',
      surface: '#131E1B',
      brand: '#1E3831',
      accent: '#9AE62E',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean Pace',
    mode: 'light',
    description: 'Crisp coastal light theme with navy & sky cyan',
    swatches: {
      canvas: '#F1F6FA',
      surface: '#FFFFFF',
      brand: '#0F2942',
      accent: '#38BDF8',
    },
  },
  {
    id: 'sunset',
    name: 'Track Sunset',
    mode: 'light',
    description: 'Warm sand canvas with espresso & ember orange',
    swatches: {
      canvas: '#FAF5F0',
      surface: '#FFFFFF',
      brand: '#2D1A14',
      accent: '#FB923C',
    },
  },
  {
    id: 'violet',
    name: 'Neon Stride',
    mode: 'dark',
    description: 'Deep midnight indigo with neon violet accent',
    swatches: {
      canvas: '#0E0B1A',
      surface: '#17132B',
      brand: '#2A1F4D',
      accent: '#C084FC',
    },
  },
  {
    id: 'crimson',
    name: 'Brutal Red',
    mode: 'dark',
    description: 'Obsidian dark mode with racing crimson accent',
    swatches: {
      canvas: '#110C0D',
      surface: '#1C1315',
      brand: '#3B151A',
      accent: '#FF5A5F',
    },
  },
];

const THEME_STORAGE_KEY = 'open_run_ui_theme_v1';

export function isValidThemeId(raw: unknown): raw is AppThemeId {
  return typeof raw === 'string' && APP_THEMES.some((t) => t.id === raw);
}

export function loadSavedTheme(): AppThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidThemeId(raw)) return raw;
  } catch {
    // ignore storage errors
  }
  return 'light';
}

export function applyAppTheme(themeId: AppThemeId): void {
  const meta = APP_THEMES.find((t) => t.id === themeId) || APP_THEMES[0];
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', meta.id);
    document.documentElement.style.colorScheme = meta.mode;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, meta.id);
  } catch {
    // ignore storage errors
  }
}
