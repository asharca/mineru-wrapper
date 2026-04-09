import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useNavigate } from "react-router-dom";
import { Upload, Loader2, FileUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
    <div className="max-w-2xl mx-auto mt-16">
      <div className="text-center mb-8">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 mb-4">
          <FileUp className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Upload Document</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          Drag & drop a PDF or image to extract text with OCR
        </p>
      </div>

      <Card
        className={`
          cursor-pointer transition-all duration-200
          ${isDragActive ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-dashed hover:border-primary/50 hover:bg-muted/50"}
          ${uploading ? "opacity-60 cursor-not-allowed" : ""}
        `}
      >
        <CardContent {...getRootProps()} className="py-16">
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            {uploading ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Loader2 className="h-7 w-7 text-primary animate-spin" />
                </div>
                <div className="text-center">
                  <p className="font-medium">Uploading & processing...</p>
                  <p className="text-sm text-muted-foreground mt-1">This may take a moment</p>
                </div>
              </>
            ) : isDragActive ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Upload className="h-7 w-7 text-primary" />
                </div>
                <p className="text-lg font-medium">Drop file here</p>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Upload className="h-7 w-7 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="font-medium">Drag & drop your file here</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    or click to browse &middot; PDF, PNG, JPG, TIFF, BMP, GIF
                  </p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
