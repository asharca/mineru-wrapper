import { useState, useEffect, useCallback } from "react";
import { RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  BACKENDS,
  LANGS,
  PARSE_METHODS,
  loadSettings,
  saveSettings,
  type OcrSettings,
} from "../settings.ts";

const DEFAULTS: OcrSettings = {
  backend: "hybrid-auto-engine",
  lang: "ch",
  parse_method: "auto",
  formula_enable: true,
  table_enable: true,
  auto_rotate: false,
  mineru_url: "",
};

interface SettingRowProps {
  name: string;
  hint: string;
  htmlFor?: string;
  children: React.ReactNode;
}

function SettingRow({ name, hint, htmlFor, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium">{name}</Label>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<OcrSettings>(loadSettings);
  const [saved, setSaved] = useState(false);

  const update = useCallback(<K extends keyof OcrSettings>(key: K, value: OcrSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
    setSaved(true);
  }, []);

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
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure default OCR options. Changes are saved automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-success font-medium animate-in fade-in">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {/* Service */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Service
          </h3>
          <Card>
            <CardContent className="px-5 py-1">
              <SettingRow name="MineRU API URL" hint="Leave empty to use server default" htmlFor="mineru-url">
                <Input
                  id="mineru-url"
                  type="text"
                  placeholder="http://10.0.10.2:8001"
                  value={settings.mineru_url}
                  onChange={(e) => update("mineru_url", e.target.value.trim())}
                  className="min-w-[280px]"
                />
              </SettingRow>
            </CardContent>
          </Card>
        </div>

        {/* Recognition */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Recognition
          </h3>
          <Card>
            <CardContent className="px-5 py-1">
              <SettingRow name="Backend" hint="OCR recognition engine">
                <Select value={settings.backend} onValueChange={(v) => { if (v) update("backend", v); }}>
                  <SelectTrigger className="min-w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BACKENDS.map((b) => (
                      <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <Separator />
              <SettingRow name="Language" hint="Primary document language">
                <Select value={settings.lang} onValueChange={(v) => { if (v) update("lang", v); }}>
                  <SelectTrigger className="min-w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <Separator />
              <SettingRow name="Parse Method" hint="How to extract content">
                <Select value={settings.parse_method} onValueChange={(v) => { if (v) update("parse_method", v); }}>
                  <SelectTrigger className="min-w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARSE_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </CardContent>
          </Card>
        </div>

        {/* Preprocessing */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Preprocessing
          </h3>
          <Card>
            <CardContent className="px-5 py-1">
              <SettingRow
                name="Auto Rotate"
                hint="Detect and correct image orientation via MineRU probing"
                htmlFor="auto-rotate"
              >
                <div className="flex items-center gap-3">
                  <Switch
                    id="auto-rotate"
                    checked={settings.auto_rotate}
                    onCheckedChange={(v) => update("auto_rotate", v)}
                  />
                  <span className="text-xs text-muted-foreground w-8">
                    {settings.auto_rotate ? "On" : "Off"}
                  </span>
                </div>
              </SettingRow>
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Features
          </h3>
          <Card>
            <CardContent className="px-5 py-1">
              <SettingRow
                name="Formula Recognition"
                hint="Detect and parse mathematical formulas"
                htmlFor="formula"
              >
                <div className="flex items-center gap-3">
                  <Switch
                    id="formula"
                    checked={settings.formula_enable}
                    onCheckedChange={(v) => update("formula_enable", v)}
                  />
                  <span className="text-xs text-muted-foreground w-8">
                    {settings.formula_enable ? "On" : "Off"}
                  </span>
                </div>
              </SettingRow>
              <Separator />
              <SettingRow
                name="Table Recognition"
                hint="Detect and parse table structures"
                htmlFor="table"
              >
                <div className="flex items-center gap-3">
                  <Switch
                    id="table"
                    checked={settings.table_enable}
                    onCheckedChange={(v) => update("table_enable", v)}
                  />
                  <span className="text-xs text-muted-foreground w-8">
                    {settings.table_enable ? "On" : "Off"}
                  </span>
                </div>
              </SettingRow>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
