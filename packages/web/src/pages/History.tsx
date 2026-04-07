import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getTasks, deleteTask, type TaskListResponse } from "../api.ts";
import dayjs from "dayjs";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

  useEffect(() => {
    load();
  }, [page, source]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this record?")) return;
    await deleteTask(id);
    load();
  };

  return (
    <div className="history-page">
      <div className="history-toolbar">
        <h2>History</h2>
        <div className="filter-group">
          <button
            className={source === "" ? "active" : ""}
            onClick={() => {
              setSource("");
              setPage(1);
            }}
          >
            All
          </button>
          <button
            className={source === "web" ? "active" : ""}
            onClick={() => {
              setSource("web");
              setPage(1);
            }}
          >
            Web
          </button>
          <button
            className={source === "api" ? "active" : ""}
            onClick={() => {
              setSource("api");
              setPage(1);
            }}
          >
            API
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : !data || data.tasks.length === 0 ? (
        <div className="empty">No records yet</div>
      ) : (
        <>
          <table className="task-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Source</th>
                <th>Backend</th>
                <th>Status</th>
                <th>Size</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((t) => (
                <tr key={t.id}>
                  <td className="cell-name">
                    <Link to={`/task/${t.id}`}>{t.original_name}</Link>
                  </td>
                  <td>
                    <span className={`badge badge-${t.source}`}>
                      {t.source.toUpperCase()}
                    </span>
                  </td>
                  <td>{t.backend}</td>
                  <td>
                    <span className={`status status-${t.status}`}>
                      {STATUS_LABELS[t.status]}
                    </span>
                  </td>
                  <td>{formatSize(t.file_size)}</td>
                  <td>{dayjs(t.created_at).format("MM-DD HH:mm")}</td>
                  <td>
                    <button
                      className="btn-sm btn-danger"
                      onClick={() => handleDelete(t.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.pagination.pages > 1 && (
            <div className="pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Prev
              </button>
              <span>
                {page} / {data.pagination.pages}
              </span>
              <button
                disabled={page >= data.pagination.pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
