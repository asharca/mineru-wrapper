import { BookOpen, ChevronDown, FileText, History, LogOut, Settings, Upload } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import HistoryPage from "./pages/History.tsx";
import LoginPage from "./pages/Login.tsx";
import RegisterPage from "./pages/Register.tsx";
import SettingsPage from "./pages/Settings.tsx";
import TaskDetail from "./pages/TaskDetail.tsx";
import UploadPage from "./pages/Upload.tsx";

const NAV_ITEMS: { to: string; label: string; icon: typeof Upload; end?: boolean }[] = [
  { to: "/", label: "Upload", icon: Upload, end: true },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <div className="flex-1 flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function UserMenu({ email, onLogout }: { email: string; onLogout: () => void }) {
  const initial = email.charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1 text-sm transition-colors hover:bg-muted aria-expanded:bg-muted">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-chart-5 text-xs font-semibold text-primary-foreground">
          {initial}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.open("/docs", "_blank", "noopener,noreferrer")}>
          <BookOpen />
          API Docs
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onLogout}>
          <LogOut />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AuthHeader() {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      {user ? (
        <UserMenu email={user.email} onLogout={logout} />
      ) : (
        <NavLink to="/login">
          <Button variant="ghost" size="sm">
            Sign In
          </Button>
        </NavLink>
      )}
    </div>
  );
}

function AppHeader() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-6 px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="h-4 w-4" />
          </div>
          <h1 className="text-base font-semibold tracking-tight">OCR Center</h1>
        </div>

        {user && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}>
                  {({ isActive }) => (
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      className={cn("gap-1.5", !isActive && "text-muted-foreground")}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Button>
                  )}
                </NavLink>
              ))}
            </nav>
          </>
        )}

        <div className="ml-auto">
          <AuthHeader />
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {user && <AppHeader />}

      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/task/:id"
          element={
            <ProtectedRoute>
              <main className="flex-1 w-full">
                <TaskDetail />
              </main>
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <main className="flex-1 w-full max-w-[1400px] mx-auto p-6">
                <Routes>
                  <Route path="/" element={<UploadPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </main>
            </ProtectedRoute>
          }
        />
      </Routes>
    </div>
  );
}
