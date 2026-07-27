export type ViewMode = "fit-width" | "fit-page" | "custom";

export type Tool =
  | "select"
  | "text"
  | "pen"
  | "highlight"
  | "image"
  | "redact";

export type SearchSpan = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SearchMatch = SearchSpan & {
  id: string;
  page: number;
};

export type StrokeStyle = {
  color: string;
  width: number;
  opacity: number;
};
