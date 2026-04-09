import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { getTasks, deleteTask, type TaskListResponse } from "../api.ts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
      <div className="flex items-center justify-between mb-6">
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

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      ) : !data || data.tasks.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No records yet</p>
        </Card>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
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
                {data.tasks.map((t) => {
                  const status = STATUS_MAP[t.status] || STATUS_MAP.pending;
                  return (
                    <TableRow key={t.id}>
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
