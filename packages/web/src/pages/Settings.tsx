import { useState, useEffect, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import {
  BACKENDS,
  LANGS,
  PARSE_METHODS,
  loadSettings,
  saveSettings,
  type OcrSettings,
} from "../settings.ts";

const DEFAULTS: OcrSettings = {
  backend: "pipeline",
  lang: "ch",
  parse_method: "auto",
  formula_enable: true,
  table_enable: true,
  auto_rotate: false,
  mineru_url: "",
};

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0
        ${checked ? "bg-primary" : "bg-slate-200"}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 rounded-full bg-white transition-transform shadow-sm
          ${checked ? "translate-x-6" : "translate-x-1"}
        `}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

interface SettingRowProps {
  name: string;
  hint: string;
  children: React.ReactNode;
}

function SettingRow({ name, hint, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-border last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-6 mb-2 first:mt-0">
      {children}
    </h3>
  );
}

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 border border-border rounded-lg text-sm bg-muted min-w-[280px]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<OcrSettings>(loadSettings);
  const [saved, setSaved] = useState(false);

  // Auto-save on change
  const update = useCallback(<K extends keyof OcrSettings>(key: K, value: OcrSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
    setSaved(true);
  }, []);

  // Clear "saved" indicator after delay
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [saved]);

  const handleReset = () => {
    setSettings({ ...DEFAULTS });
    saveSettings({ ...DEFAULTS });
    setSaved(true);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold">Settings</h2>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs text-success font-medium animate-in fade-in">
              Saved
            </span>
          )}
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Configure default OCR options. Changes are saved automatically.
      </p>

      <SectionTitle>Service</SectionTitle>
      <div className="bg-white border border-border rounded-lg">
        <SettingRow name="MineRU API URL" hint="Leave empty to use server default">
          <input
            type="text"
            placeholder="http://10.0.10.2:8001"
            value={settings.mineru_url}
            onChange={(e) => update("mineru_url", e.target.value.trim())}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-muted min-w-[280px] placeholder:text-muted-foreground/60"
          />
        </SettingRow>
      </div>

      <SectionTitle>Recognition</SectionTitle>
      <div className="bg-white border border-border rounded-lg">
        <SettingRow name="Backend" hint="OCR recognition engine">
          <SelectField value={settings.backend} onChange={(v) => update("backend", v)} options={BACKENDS} />
        </SettingRow>
        <SettingRow name="Language" hint="Primary document language">
          <SelectField value={settings.lang} onChange={(v) => update("lang", v)} options={LANGS} />
        </SettingRow>
        <SettingRow name="Parse Method" hint="How to extract content">
          <SelectField value={settings.parse_method} onChange={(v) => update("parse_method", v)} options={PARSE_METHODS} />
        </SettingRow>
      </div>

      <SectionTitle>Preprocessing</SectionTitle>
      <div className="bg-white border border-border rounded-lg">
        <SettingRow name="Auto Rotate" hint="Detect and correct image orientation (0/90/180/270) via MineRU probing">
          <div className="flex items-center gap-2.5">
            <Toggle checked={settings.auto_rotate} onChange={(v) => update("auto_rotate", v)} label="Auto Rotate" />
            <span className="text-xs text-muted-foreground w-12">{settings.auto_rotate ? "On" : "Off"}</span>
          </div>
        </SettingRow>
      </div>

      <SectionTitle>Features</SectionTitle>
      <div className="bg-white border border-border rounded-lg">
        <SettingRow name="Formula Recognition" hint="Detect and parse mathematical formulas">
          <div className="flex items-center gap-2.5">
            <Toggle checked={settings.formula_enable} onChange={(v) => update("formula_enable", v)} label="Formula" />
            <span className="text-xs text-muted-foreground w-12">{settings.formula_enable ? "On" : "Off"}</span>
          </div>
        </SettingRow>
        <SettingRow name="Table Recognition" hint="Detect and parse table structures">
          <div className="flex items-center gap-2.5">
            <Toggle checked={settings.table_enable} onChange={(v) => update("table_enable", v)} label="Table" />
            <span className="text-xs text-muted-foreground w-12">{settings.table_enable ? "On" : "Off"}</span>
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
