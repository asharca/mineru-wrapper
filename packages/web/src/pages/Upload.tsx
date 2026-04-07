import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useNavigate } from "react-router-dom";
import { uploadFile } from "../api.ts";

const BACKENDS = [
  { value: "pipeline", label: "Pipeline (通用多语言)" },
  { value: "vlm-auto-engine", label: "VLM Auto (中英高精度)" },
  { value: "hybrid-auto-engine", label: "Hybrid Auto (新一代高精度)" },
];

const LANGS = [
  { value: "ch", label: "中文/英文" },
  { value: "en", label: "English" },
  { value: "japan", label: "日本語" },
  { value: "korean", label: "한국어" },
  { value: "latin", label: "Latin languages" },
  { value: "arabic", label: "Arabic" },
  { value: "cyrillic", label: "Cyrillic" },
  { value: "devanagari", label: "Devanagari" },
];

export default function UploadPage() {
  const navigate = useNavigate();
  const [backend, setBackend] = useState("pipeline");
  const [lang, setLang] = useState("ch");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError("");
      try {
        const result = await uploadFile(files[0], { backend, lang });
        navigate(`/task/${result.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [backend, lang, navigate]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/*": [".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif"],
    },
    multiple: false,
    disabled: uploading,
  });

  return (
    <div className="upload-page">
      <div className="options-bar">
        <label>
          <span>Backend</span>
          <select value={backend} onChange={(e) => setBackend(e.target.value)}>
            {BACKENDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? "active" : ""} ${uploading ? "disabled" : ""}`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="drop-content">
            <div className="spinner" />
            <p>Uploading & processing...</p>
          </div>
        ) : isDragActive ? (
          <div className="drop-content">
            <p className="drop-icon">+</p>
            <p>Drop file here</p>
          </div>
        ) : (
          <div className="drop-content">
            <p className="drop-icon">&#128196;</p>
            <p>Drag & drop PDF or image here</p>
            <p className="drop-hint">or click to select</p>
          </div>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}
    </div>
  );
}
