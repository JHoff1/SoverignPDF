import {
  CheckCircle2,
  FileOutput,
  FormInput,
  ShieldCheck,
  Tags
} from "lucide-react";
import type { ReactNode } from "react";
import { AppDialog } from "./AppDialog";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SummaryRow({
  icon,
  title,
  detail,
  warning = false
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-white/5 px-3 py-3 last:border-0">
      <span className={`mt-0.5 shrink-0 ${warning ? "text-amber-300" : "text-emerald-300"}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-200">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{detail}</p>
      </div>
    </div>
  );
}

export function ExportSummaryDialog({
  saveAs,
  annotationCount,
  flattenAnnotations,
  redactionPageCount,
  formsFlattened,
  metadataSanitized,
  estimatedSize,
  onCancel,
  onContinue
}: {
  saveAs: boolean;
  annotationCount: number;
  flattenAnnotations: boolean;
  redactionPageCount: number;
  formsFlattened: boolean;
  metadataSanitized: boolean;
  estimatedSize: number;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <AppDialog
      title="Review export"
      description="Confirm how VerityPDF will prepare this document before it is written."
      confirmLabel={saveAs ? "Continue to Save As" : "Continue to Save"}
      onCancel={onCancel}
      onConfirm={onContinue}
    >
      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/15">
        <SummaryRow
          icon={<FileOutput size={16} />}
          title="Annotations"
          detail={
            annotationCount === 0
              ? "There are no annotations to flatten."
              : flattenAnnotations
                ? `${annotationCount} annotation${annotationCount === 1 ? "" : "s"} will be flattened into permanent page content.`
                : `${annotationCount} overlay annotation${annotationCount === 1 ? "" : "s"} will not be included because flattening is disabled.`
          }
          warning={!flattenAnnotations && annotationCount > 0}
        />
        <SummaryRow
          icon={<ShieldCheck size={16} />}
          title="Secure redaction"
          detail={
            redactionPageCount
              ? `${redactionPageCount} affected page${redactionPageCount === 1 ? "" : "s"} will be rasterized so covered content cannot be recovered.`
              : "No secure redactions need to be applied."
          }
          warning={redactionPageCount > 0}
        />
        <SummaryRow
          icon={<FormInput size={16} />}
          title="Interactive forms"
          detail={formsFlattened
            ? "Form fields were flattened into permanent page content and will no longer be interactive."
            : "Interactive form fields will remain editable in the exported PDF."}
        />
        <SummaryRow
          icon={<Tags size={16} />}
          title="Metadata"
          detail={metadataSanitized
            ? "Basic title, author, subject, keyword, producer, and creator metadata has been cleared."
            : "Existing document metadata will be retained."}
        />
        <SummaryRow
          icon={<CheckCircle2 size={16} />}
          title="Estimated output size"
          detail={`Approximately ${formatSize(estimatedSize)}. Secure redaction and PDF rebuilding may change the final size.`}
        />
      </div>
    </AppDialog>
  );
}
