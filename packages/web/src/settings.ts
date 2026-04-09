const STORAGE_KEY = "ocr-settings";

export const BACKENDS = [
  { value: "hybrid-auto-engine", label: "Hybrid Auto (新一代多语言高精度)" },
  { value: "hybrid-http-client", label: "Hybrid HTTP (远程高精度)" },
  { value: "pipeline", label: "Pipeline (通用多语言)" },
  { value: "vlm-auto-engine", label: "VLM Auto (中英高精度)" },
  { value: "vlm-http-client", label: "VLM HTTP (远程中英高精度)" },
] as const;

export const LANGS = [
  { value: "ch", label: "中文/英文" },
  { value: "en", label: "English" },
  { value: "japan", label: "日本語" },
  { value: "korean", label: "한국어" },
  { value: "latin", label: "Latin languages" },
  { value: "arabic", label: "Arabic" },
  { value: "cyrillic", label: "Cyrillic" },
  { value: "devanagari", label: "Devanagari" },
] as const;

export const PARSE_METHODS = [
  { value: "auto", label: "Auto (自动)" },
  { value: "ocr", label: "OCR (强制 OCR)" },
  { value: "txt", label: "TXT (文本提取)" },
] as const;

export interface OcrSettings {
  backend: string;
  lang: string;
  parse_method: string;
  formula_enable: boolean;
  table_enable: boolean;
  auto_rotate: boolean;
  mineru_url: string;
}

const DEFAULTS: OcrSettings = {
  backend: "hybrid-auto-engine",
  lang: "ch",
  parse_method: "auto",
  formula_enable: true,
  table_enable: true,
  auto_rotate: false,
  mineru_url: "",
};

export function loadSettings(): OcrSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveSettings(settings: OcrSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
