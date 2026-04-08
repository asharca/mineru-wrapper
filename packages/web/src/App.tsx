import { Routes, Route, NavLink } from "react-router-dom";
import { Upload, History, Settings, FileText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
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
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-border h-14 px-6 flex items-center gap-8 shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-primary">OCR Center</h1>
        </div>
        <nav className="flex gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-slate-900"
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto">
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-slate-900 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            API Docs
          </a>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[1400px] mx-auto p-6">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/task/:id" element={<TaskDetail />} />
        </Routes>
      </main>
    </div>
  );
}
