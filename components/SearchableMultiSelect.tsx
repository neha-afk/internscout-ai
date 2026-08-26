"use client";

import { useEffect, useRef, useState } from "react";

type SuggestionType = "roles" | "skills" | "locations";

type SearchableMultiSelectProps = {
  label: string;
  placeholder?: string;
  value: string[];
  onChange: (value: string[]) => void;
  suggestionType: SuggestionType;
  allowCustomValue?: boolean;
  maxSuggestions?: number;
  disabled?: boolean;
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function SearchableMultiSelect({
  label,
  placeholder = "Search...",
  value,
  onChange,
  suggestionType,
  allowCustomValue = false,
  maxSuggestions = 8,
  disabled = false,
}: SearchableMultiSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!isOpen || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams({
          type: suggestionType,
          q: query,
          limit: String(maxSuggestions),
        });
        const response = await fetch(`/api/suggestions?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Suggestion request failed");
        const data = (await response.json()) as { suggestions?: unknown };
        setSuggestions(
          Array.isArray(data.suggestions)
            ? data.suggestions.filter((item): item is string => typeof item === "string")
            : []
        );
        setHighlightedIndex(0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSuggestions([]);
          setLoadError("Suggestions are temporarily unavailable.");
        }
      } finally {
        setIsLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, isOpen, maxSuggestions, query, suggestionType]);

  function selectValue(selected: string) {
    const trimmed = selected.trim();
    if (!trimmed || value.some((item) => normalized(item) === normalized(trimmed))) return;
    onChange([...value, trimmed]);
    setQuery("");
    setIsOpen(true);
  }

  function removeValue(selected: string) {
    onChange(value.filter((item) => normalized(item) !== normalized(selected)));
  }

  const customValue = query.trim();
  const canAddCustom = allowCustomValue && customValue && !value.some((item) => normalized(item) === normalized(customValue));

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-slate-300">{label}</label>
      <div className="mt-2 flex min-h-12 flex-wrap gap-2 rounded-lg border border-slate-700 bg-slate-800 p-2 focus-within:border-blue-400">
        {value.map((item) => (
          <span key={item} className="flex items-center gap-1 rounded-full border border-blue-400/40 bg-blue-400/10 px-3 py-1 text-xs text-blue-200">
            {item}
            <button type="button" aria-label={`Remove ${item}`} disabled={disabled} onClick={() => removeValue(item)} className="text-blue-300 hover:text-white">×</button>
          </span>
        ))}
        <input
          value={query}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : "Add another..."}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setIsOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlightedIndex((index) => Math.min(index + 1, Math.max(suggestions.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlightedIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (suggestions[highlightedIndex]) selectValue(suggestions[highlightedIndex]);
              else if (canAddCustom) selectValue(customValue);
            } else if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
          className="min-w-[10rem] flex-1 bg-transparent p-1 text-sm text-white outline-none placeholder:text-slate-500"
        />
      </div>
      {isOpen && !disabled && (
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl" role="listbox">
          {isLoading && <p className="px-3 py-2 text-sm text-slate-400">Loading suggestions...</p>}
          {!isLoading && loadError && <p className="px-3 py-2 text-sm text-amber-300">{loadError}</p>}
          {!isLoading && !loadError && suggestions.map((suggestion, index) => (
            <button key={suggestion} type="button" role="option" aria-selected={index === highlightedIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => selectValue(suggestion)} className={`block w-full rounded px-3 py-2 text-left text-sm ${index === highlightedIndex ? "bg-blue-400/15 text-blue-200" : "text-slate-300 hover:bg-slate-800"}`}>
              {suggestion}
            </button>
          ))}
          {!isLoading && !loadError && suggestions.length === 0 && !canAddCustom && <p className="px-3 py-2 text-sm text-slate-400">No suggestions found.</p>}
          {canAddCustom && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectValue(customValue)} className="mt-1 block w-full rounded border-t border-slate-800 px-3 py-2 text-left text-sm text-blue-300 hover:bg-slate-800">Add “{customValue}”</button>}
        </div>
      )}
    </div>
  );
}
