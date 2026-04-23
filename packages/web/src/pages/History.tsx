import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Trash2, ChevronLeft, ChevronRight, Search, X, AlertCircle } from "lucide-react";
import { getTasks, deleteTask, batchDeleteTasks, type TaskListResponse } from "../api.ts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import dayjs from "dayjs";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  processing: { label: "Processing", variant: "outline" },
  completed: { label: "Completed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILTERS = [
  { value: "", label: "All" },
  { value: "web", label: "Web" },
  { value: "api", label: "API" },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function HistoryPage() {
  const [data, setData] = useState<TaskListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const search = useDebounce(searchInput, 350);

  // Load data whenever page/source/search changes
  useEffect(() => {
    let cancelled = false;
    const doLoad = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await getTasks(page, 20, source || undefined, search || undefined);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    doLoad();
    return () => { cancelled = true; };
  }, [page, source, search]);

  // Reset to page 1 and clear selection when search/source changes
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [search, source]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this record?")) return;
    try {
      await deleteTask(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Refresh current page
      const res = await getTasks(page, 20, source || undefined, search || undefined);
      setData(res);
      if (res.tasks.length === 0 && page > 1) {
        setPage(page - 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} selected record(s)?`)) return;
    setBulkDeleting(true);
    setError("");
    try {
      await batchDeleteTasks([...selected]);
      setSelected(new Set());
      // Refresh and handle empty page
      const res = await getTasks(page, 20, source || undefined, search || undefined);
      setData(res);
      if (res.tasks.length === 0 && page > 1) {
        setPage(page - 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBulkDeleting(false);
    }
  };

  const tasks = data?.tasks ?? [];
  const allIds = tasks.map((t) => t.id);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = allIds.some((id) => selected.has(id)) && !allChecked;

  const toggleAll = () => {
    if (allChecked) {
      // All checked -> deselect all on this page
      setSelected((prev) => {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // None or some checked -> select all on this page
      setSelected((prev) => new Set([...prev, ...allIds]));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearError = () => setError("");

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">History</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            View and manage your OCR processing history
          </p>
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={source === f.value ? "default" : "outline"}
              size="sm"
              onClick={() => { setSource(f.value); setPage(1); }}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={searchRef}
          placeholder="Search by filename…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      <div
        className={cn(
          "flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg border bg-muted/60 transition-all duration-200 overflow-hidden",
          selected.size > 0 ? "opacity-100 max-h-16" : "opacity-0 max-h-0 py-0 border-transparent"
        )}
      >
        <span className="text-sm font-medium">{selected.size} selected</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setSelected(new Set())}
        >
          Clear
        </Button>
        <div className="flex-1" />
        <Button
          variant="destructive"
          size="sm"
          disabled={bulkDeleting}
          onClick={handleBulkDelete}
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {bulkDeleting ? "Deleting…" : `Delete ${selected.size}`}
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      ) : !data || tasks.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">{search ? `No results for "${search}"` : "No records yet"}</p>
        </Card>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Backend</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => {
                  const status = STATUS_MAP[t.status] || STATUS_MAP.pending;
                  const isChecked = selected.has(t.id);
                  return (
                    <TableRow
                      key={t.id}
                      data-state={isChecked ? "selected" : undefined}
                      className={cn(isChecked && "bg-muted/40")}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleOne(t.id)}
                          aria-label={`Select ${t.original_name}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate font-medium">
                        <Link to={`/task/${t.id}`} className="text-primary hover:underline">
                          {t.original_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.source === "web" ? "secondary" : "outline"} className="text-[11px]">
                          {t.source.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{t.backend}</TableCell>
                      <TableCell>
                        <Badge
                          variant={status.variant}
                          className={cn(
                            t.status === "processing" && "border-warning text-warning",
                            t.status === "completed" && "border-success text-success bg-success/10"
                          )}
                        >
                          {status.label}
                          {t.status === "processing" && t.progress && (() => {
                            try {
                              const p = JSON.parse(t.progress) as { message?: string };
                              if (p.message) return <span className="ml-1 opacity-70">{p.message}</span>;
                            } catch { /* ignore */ }
                            return null;
                          })()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatSize(t.file_size)}</TableCell>
                      <TableCell className="text-muted-foreground">{dayjs(t.created_at).format("MM-DD HH:mm")}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(t.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {data.pagination.pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums min-w-[60px] text-center">
                {page} / {data.pagination.pages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= data.pagination.pages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
