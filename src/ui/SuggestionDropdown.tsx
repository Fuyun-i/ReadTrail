// 搜索建议下拉列表
import { useState, useEffect, useRef } from 'react';
import type { Suggestion } from '../search/search-suggester';

export function SuggestionDropdown(props: {
  suggestions: Suggestion[];
  visible: boolean;
  onSelect: (text: string) => void;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
}) {
  if (!props.visible || props.suggestions.length === 0) return null;

  return (
    <ul className="suggestion-dropdown">
      {props.suggestions.map((s, i) => (
        <li
          key={`${s.type}-${s.text}`}
          className={`suggestion-item ${i === props.activeIndex ? 'active' : ''}`}
          onMouseEnter={() => props.setActiveIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // 防止 input blur
            props.onSelect(s.text);
          }}
        >
          <span className="suggestion-text">{s.text}</span>
          {s.label && <span className="suggestion-label">{s.label}</span>}
        </li>
      ))}
    </ul>
  );
}

/** 键盘导航 hook：在搜索输入框中使用 ↑↓ 选择建议，Enter/Tab 确认 */
export function useSuggestionKeyboard(
  suggestions: Suggestion[],
  onSelect: (text: string) => void,
) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
      setShowSuggestions(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      setShowSuggestions(true);
    } else if ((e.key === 'Enter' || e.key === 'Tab') && activeIndex >= 0) {
      e.preventDefault();
      onSelect(suggestions[activeIndex]!.text);
      setShowSuggestions(false);
      setActiveIndex(-1);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  };

  return {
    activeIndex,
    setActiveIndex,
    showSuggestions,
    setShowSuggestions,
    handleKeyDown,
  };
}
