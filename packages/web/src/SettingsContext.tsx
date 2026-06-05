import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { getSettings, updateSettings } from "./api.ts";
import { useAuth } from "./contexts/AuthContext";
import { DEFAULTS, type OcrSettings } from "./settings.ts";

interface SettingsContextType {
  settings: OcrSettings;
  loading: boolean;
  updateSetting: <K extends keyof OcrSettings>(key: K, value: OcrSettings[K]) => Promise<void>;
  reset: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<OcrSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSettings(DEFAULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    getSettings()
      .then((s) => setSettings(s))
      .catch(() => setSettings(DEFAULTS))
      .finally(() => setLoading(false));
  }, [user]);

  const persist = useCallback(async (next: OcrSettings) => {
    const prev = settings;
    setSettings(next);
    try {
      const saved = await updateSettings(next);
      setSettings(saved);
    } catch (err) {
      setSettings(prev);
      throw err;
    }
  }, [settings]);

  const updateSetting = useCallback(
    <K extends keyof OcrSettings>(key: K, value: OcrSettings[K]) =>
      persist({ ...settings, [key]: value }),
    [settings, persist],
  );

  const reset = useCallback(() => persist({ ...DEFAULTS }), [persist]);

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}
