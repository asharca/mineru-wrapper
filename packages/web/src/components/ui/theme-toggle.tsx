import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <fieldset className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background/60 p-0.5">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        const id = `theme-${value}`;
        return (
          <div key={value} className="relative h-6 w-6">
            <input
              type="radio"
              id={id}
              name="theme"
              value={value}
              checked={active}
              onChange={() => setTheme(value)}
              className="sr-only"
              aria-label={label}
            />
            <label
              htmlFor={id}
              title={label}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer absolute inset-0",
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}
