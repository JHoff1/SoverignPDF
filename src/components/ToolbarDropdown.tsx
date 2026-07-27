import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export const iconButton =
  "flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-300 transition duration-150 hover:bg-white/10 hover:text-white active:scale-[0.98] active:bg-white/15 focus-visible:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
export const compactToolButton =
  "toolbar-tooltip flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-zinc-300 transition duration-150 hover:bg-white/10 hover:text-white active:scale-[0.98] active:bg-white/15 focus-visible:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
export const dropdownItem =
  "toolbar-tooltip flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-zinc-300 transition duration-150 hover:bg-white/10 hover:text-white active:bg-white/15 focus-visible:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

export function ToolbarDropdown({
  label,
  tooltip,
  tooltipAlign = "center",
  icon,
  children,
  className = ""
}: {
  label: string;
  tooltip: string;
  tooltipAlign?: "start" | "center" | "end";
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeIfOutside = (event: Event) => {
      const details = detailsRef.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      details.removeAttribute("open");
    };
    const closeOnWindowBlur = () => detailsRef.current?.removeAttribute("open");
    document.addEventListener("focusin", closeIfOutside);
    document.addEventListener("pointerdown", closeIfOutside);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("focusin", closeIfOutside);
      document.removeEventListener("pointerdown", closeIfOutside);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, []);

  return (
    <details ref={detailsRef} className={`toolbar-dropdown relative ${className}`}>
      <summary data-tooltip={tooltip} data-tooltip-align={tooltipAlign} className={`${compactToolButton} cursor-pointer list-none`}>
        {icon}
        <span className="hidden min-[1200px]:inline">{label}</span>
        <ChevronDown size={12} className="text-zinc-500" />
      </summary>
      <div className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-44 rounded-lg border border-white/10 bg-[#202329] p-1.5 shadow-2xl">
        {children}
      </div>
    </details>
  );
}
