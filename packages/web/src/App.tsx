import { Routes, Route, NavLink } from "react-router-dom";
import { Upload, History, Settings, FileText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import UploadPage from "./pages/Upload.tsx";
import HistoryPage from "./pages/History.tsx";
import TaskDetail from "./pages/TaskDetail.tsx";
import SettingsPage from "./pages/Settings.tsx";

const NAV_ITEMS: { to: string; label: string; icon: typeof Upload; end?: boolean }[] = [
  { to: "/", label: "Upload", icon: Upload, end: true },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-6 px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="h-4 w-4" />
            </div>
            <h1 className="text-base font-semibold tracking-tight">OCR Center</h1>
          </div>

          <Separator orientation="vertical" className="h-6" />

          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end}>
                {({ isActive }) => (
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    className={cn(
                      "gap-1.5",
                      !isActive && "text-muted-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Button>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto">
            <a href="/docs" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <BookOpen className="h-4 w-4" />
                API Docs
              </Button>
            </a>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/task/:id" element={
          <main className="flex-1 w-full">
            <TaskDetail />
          </main>
        } />
        <Route path="*" element={
          <main className="flex-1 w-full max-w-[1400px] mx-auto p-6">
            <Routes>
              <Route path="/" element={<UploadPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        } />
      </Routes>
    </div>
  );
}
