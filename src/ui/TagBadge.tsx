// 标签徽章组件 — SearchTab / HistoryTab / PreviewModal 共用

export function TagBadge(props: {
  tag: string;
  onClick?: (tag: string) => void;
  onRemove?: (tag: string) => void;
}) {
  return (
    <span className="tag-badge" onClick={props.onClick ? () => props.onClick!(props.tag) : undefined}>
      {props.tag}
      {props.onRemove && (
        <button
          className="tag-remove"
          aria-label={`移除标签 ${props.tag}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove!(props.tag);
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function TagList(props: {
  tags?: string[];
  onClick?: (tag: string) => void;
  onRemove?: (tag: string) => void;
}) {
  if (!props.tags || props.tags.length === 0) return null;
  return (
    <div className="tag-list">
      {props.tags.map((tag) => (
        <TagBadge key={tag} tag={tag} onClick={props.onClick} onRemove={props.onRemove} />
      ))}
    </div>
  );
}
