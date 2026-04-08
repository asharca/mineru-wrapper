import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useNavigate } from "react-router-dom";
import { Upload, Loader2 } from "lucide-react";
import { uploadFile } from "../api.ts";
import { loadSettings } from "../settings.ts";

export default function UploadPage() {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError("");
      try {
        const settings = loadSettings();
        const result = await uploadFile(files[0], {
          backend: settings.backend,
          lang: settings.lang,
          parse_method: settings.parse_method === "auto" ? undefined : settings.parse_method,
          formula_enable: settings.formula_enable,
          table_enable: settings.table_enable,
          auto_rotate: settings.auto_rotate,
          mineru_url: settings.mineru_url || undefined,
        });
        navigate(`/task/${result.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [navigate]
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
    <div className="max-w-2xl mx-auto mt-12">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-16 text-center cursor-pointer
          transition-all bg-white
          ${isDragActive ? "border-primary bg-blue-50" : "border-border hover:border-primary hover:bg-blue-50/50"}
          ${uploading ? "opacity-60 cursor-not-allowed" : ""}
        `}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-muted-foreground">Uploading & processing...</p>
          </div>
        ) : isDragActive ? (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-primary" />
            <p className="text-lg font-medium">Drop file here</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-muted-foreground" />
            <p className="text-lg font-medium">Drag & drop PDF or image here</p>
            <p className="text-sm text-muted-foreground">or click to select</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
