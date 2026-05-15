import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DownloadButtonProps {
  content: string;
  filename: string;
  label: string;
  mimeType: string;
}

export function DownloadButton({ content, filename, label, mimeType }: DownloadButtonProps) {
  const handleDownload = () => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px] gap-1"
          onClick={handleDownload}
        >
          <Download className="h-3 w-3" />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Download as file</TooltipContent>
    </Tooltip>
  );
}
