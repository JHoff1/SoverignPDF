import type { TextStyle } from "./editor/useDocumentEditor";
import type { StrokeStyle, ViewMode } from "./editorUiTypes";
import { clonePlain } from "./localUtils";

export type ThemePreference = "system" | "dark" | "light";

export type AppPreferences = {
  confirmOverwrite: boolean;
  defaultSaveFolder: string;
  flattenAnnotations: boolean;
  automaticBackups: boolean;
  textStyle: TextStyle;
  penStyle: StrokeStyle;
  highlightStyle: StrokeStyle;
  recentFiles: string[];
  theme: ThemePreference;
  viewMode: ViewMode;
  zoom: number;
  sidebarWidth: number;
  propertiesWidth: number;
  restoreSession: boolean;
  showExportSummary: boolean;
};

export const PREFERENCES_KEY = "sovereignpdf.preferences.v1";

export const DEFAULT_PREFERENCES: AppPreferences = {
  confirmOverwrite: false,
  defaultSaveFolder: "",
  flattenAnnotations: true,
  automaticBackups: false,
  textStyle: {
    size: 18,
    color: "#202124",
    fontFamily: "helvetica",
    bold: false,
    italic: false
  },
  penStyle: { color: "#df5b43", width: 2, opacity: 1 },
  highlightStyle: { color: "#ffe45c", width: 16, opacity: 0.35 },
  recentFiles: [],
  theme: "system",
  viewMode: "fit-page",
  zoom: 1,
  sidebarWidth: 208,
  propertiesWidth: 272,
  restoreSession: true,
  showExportSummary: true
};

export function loadPreferences(): AppPreferences {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(PREFERENCES_KEY) ?? "{}"
    ) as Partial<AppPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...stored,
      textStyle: { ...DEFAULT_PREFERENCES.textStyle, ...stored.textStyle },
      penStyle: { ...DEFAULT_PREFERENCES.penStyle, ...stored.penStyle },
      highlightStyle: {
        ...DEFAULT_PREFERENCES.highlightStyle,
        ...stored.highlightStyle
      },
      theme: stored.theme === "dark" || stored.theme === "light"
        ? stored.theme
        : "system",
      viewMode: stored.viewMode === "fit-width" || stored.viewMode === "custom"
        ? stored.viewMode
        : "fit-page",
      zoom: Math.min(4, Math.max(0.25, Number(stored.zoom) || 1)),
      sidebarWidth: Math.min(
        360,
        Math.max(168, Number(stored.sidebarWidth) || DEFAULT_PREFERENCES.sidebarWidth)
      ),
      propertiesWidth: Math.min(
        420,
        Math.max(240, Number(stored.propertiesWidth) || DEFAULT_PREFERENCES.propertiesWidth)
      ),
      recentFiles: Array.isArray(stored.recentFiles)
        ? stored.recentFiles
          .filter((path): path is string => typeof path === "string")
          .slice(0, 8)
        : []
    };
  } catch {
    return clonePlain(DEFAULT_PREFERENCES);
  }
}
