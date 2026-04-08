import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { getTasks, deleteTask, type TaskListResponse } from "../api.ts";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-muted-foreground" },
  processing: { label: "Processing", className: "text-warning" },
  completed: { label: "Completed", className: "text-success" },
  failed: { label: "Failed", className: "text-destructive" },
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

export default function HistoryPage() {
  const [data, setData] = useState<TaskListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getTasks(page, 20, source || undefined);
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, source]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this record?")) return;
    await deleteTask(id);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">History</h2>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setSource(f.value); setPage(1); }}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md border transition-colors",
                source === f.value
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : !data || data.tasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No records yet</div>
      ) : (
        <>
          <div className="bg-white border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">File</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Source</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Backend</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Size</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Created</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground" />
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => {
                  const status = STATUS_MAP[t.status] || STATUS_MAP.pending;
                  return (
                    <tr key={t.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-2.5 max-w-[200px] truncate">
                        <Link to={`/task/${t.id}`} className="text-primary hover:underline text-sm">
                          {t.original_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold",
                          t.source === "web" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        )}>
                          {t.source.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm">{t.backend}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-sm font-medium", status.className)}>{status.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{formatSize(t.file_size)}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{dayjs(t.created_at).format("MM-DD HH:mm")}</td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.pagination.pages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="p-2 rounded-md border border-border bg-white disabled:opacity-40 hover:bg-muted transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-muted-foreground">
                {page} / {data.pagination.pages}
              </span>
              <button
                disabled={page >= data.pagination.pages}
                onClick={() => setPage(page + 1)}
                className="p-2 rounded-md border border-border bg-white disabled:opacity-40 hover:bg-muted transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
