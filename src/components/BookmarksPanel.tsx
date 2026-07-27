import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";

export type BookmarkItem = {
  id: string;
  title: string;
  page: number | null;
  children: BookmarkItem[];
};

function BookmarkNode({
  item,
  depth,
  onNavigate
}: {
  item: BookmarkItem;
  depth: number;
  onNavigate: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = item.children.length > 0;

  return (
    <li>
      <div
        className="group flex min-h-8 items-center rounded-md text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
        style={{ paddingLeft: `${6 + depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded hover:bg-white/10"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <button
          type="button"
          disabled={!item.page}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left disabled:cursor-default"
          onClick={() => item.page && onNavigate(item.page)}
        >
          <FileText size={12} className="shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.page && (
            <span className="shrink-0 text-[9px] text-zinc-600">{item.page}</span>
          )}
        </button>
      </div>
      {hasChildren && expanded && (
        <ul>
          {item.children.map((child) => (
            <BookmarkNode
              key={child.id}
              item={child}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function BookmarksPanel({
  bookmarks,
  loading,
  onNavigate
}: {
  bookmarks: BookmarkItem[];
  loading: boolean;
  onNavigate: (page: number) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-2" aria-label="Loading bookmarks">
        {[72, 88, 64, 80].map((width, index) => (
          <div
            key={index}
            className="h-7 animate-pulse rounded-md bg-white/5"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    );
  }

  if (!bookmarks.length) {
    return (
      <p className="p-4 text-center text-xs leading-5 text-zinc-500">
        This PDF does not contain a bookmark outline.
      </p>
    );
  }

  return (
    <ul aria-label="Document bookmarks" className="space-y-0.5">
      {bookmarks.map((bookmark) => (
        <BookmarkNode
          key={bookmark.id}
          item={bookmark}
          depth={0}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}
