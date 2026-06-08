import { Check, Copy, Eye, EyeOff, KeyRound, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { type ApiKey, createApiKey, listApiKeys, revokeApiKey } from "../api.ts";
import { useSettings } from "../SettingsContext.tsx";
import { BACKENDS, LANGS, PARSE_METHODS } from "../settings.ts";

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
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {name}
        </Label>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, updateSetting, reset } = useSettings();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const update = useCallback(
    <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
      setError("");
      updateSetting(key, value)
        .then(() => setSaved(true))
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to save"));
    },
    [updateSetting],
  );

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [saved]);

  const handleReset = () => {
    setError("");
    reset()
      .then(() => setSaved(true))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to reset"));
  };

  // API Key state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const keys = await listApiKeys();
      setApiKeys(keys);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreateKey = async () => {
    setApiKeyLoading(true);
    try {
      const result = await createApiKey(newKeyName || undefined);
      setNewKeyValue(result.key);
      setNewKeyName("");
      await loadKeys();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setApiKeyLoading(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm("Are you sure you want to revoke this API key?")) return;
    try {
      await revokeApiKey(id);
      await loadKeys();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revoke API key");
    }
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
          {error && <span className="text-xs text-destructive font-medium">{error}</span>}
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
              <SettingRow
                name="MineRU API URL"
                hint="Leave empty to use server default"
                htmlFor="mineru-url"
              >
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
                <Select
                  value={settings.backend}
                  onValueChange={(v) => {
                    if (v) update("backend", v);
                  }}
                >
                  <SelectTrigger className="min-w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BACKENDS.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <Separator />
              <SettingRow name="Language" hint="Primary document language">
                <Select
                  value={settings.lang}
                  onValueChange={(v) => {
                    if (v) update("lang", v);
                  }}
                >
                  <SelectTrigger className="min-w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <Separator />
              <SettingRow name="Parse Method" hint="How to extract content">
                <Select
                  value={settings.parse_method}
                  onValueChange={(v) => {
                    if (v) update("parse_method", v);
                  }}
                >
                  <SelectTrigger className="min-w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARSE_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

        {/* API Keys */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            API Keys
          </h3>
          <Card>
            <CardContent className="px-5 py-4 space-y-4">
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Key name (optional)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="min-w-[200px]"
                />
                <Button onClick={handleCreateKey} loading={apiKeyLoading} className="gap-1.5">
                  {!apiKeyLoading && <KeyRound className="h-4 w-4" />}
                  Create Key
                </Button>
              </div>

              {newKeyValue && (
                <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                  <p className="text-sm font-medium text-destructive">
                    Copy this key now — you won't be able to see it again!
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={newKeyValue}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button variant="ghost" size="icon" onClick={() => setShowKey((v) => !v)}>
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigator.clipboard.writeText(newKeyValue)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setNewKeyValue(null)}>
                    Done
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                {apiKeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No API keys yet.</p>
                ) : (
                  apiKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-mono">{key.key_prefix}</span>
                        {key.name && (
                          <span className="text-xs text-muted-foreground">{key.name}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          Created {new Date(key.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => handleRevokeKey(key.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
