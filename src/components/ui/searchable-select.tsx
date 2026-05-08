"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Option {
  label: string;
  value: string;
  searchText?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A custom SearchableSelect that renders inline (no Popover/Portal)
 * to avoid focus trap issues when used inside Radix Dialogs.
 */
export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Sélectionner...",
  searchPlaceholder = "Rechercher...",
  emptyMessage = "Aucun résultat.",
  disabled = false,
  className,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const filteredOptions = React.useMemo(() => {
    if (!searchQuery) return options;
    const term = searchQuery.toLowerCase();
    return options.filter((option) =>
      option.label.toLowerCase().includes(term) ||
      option.value.toLowerCase().includes(term) ||
      (option.searchText && option.searchText.toLowerCase().includes(term))
    );
  }, [options, searchQuery]);

  const selectedLabel = options.find((option) => option.value === value)?.label;

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    if (!isOpen) setSearchQuery("");
  };

  const handleSelect = (val: string) => {
    onValueChange(val);
    setIsOpen(false);
    setSearchQuery("");
  };

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={isOpen}
        className={cn(
          "w-full justify-between font-normal bg-background",
          disabled && "opacity-50 cursor-not-allowed",
          isOpen && "ring-2 ring-ring ring-offset-2"
        )}
        onClick={handleToggle}
        disabled={disabled}
      >
        <span className="truncate">
          {value ? selectedLabel : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-xl animate-in fade-in zoom-in-95 duration-100 origin-top">
          <div className="flex items-center border-b px-3 py-2 sticky top-0 bg-popover z-10">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              autoFocus
              placeholder={searchPlaceholder}
              className="flex h-8 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsOpen(false);
              }}
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery("")}
                className="ml-1 p-1 hover:bg-secondary rounded-full"
              >
                <X className="h-3 w-3 opacity-50" />
              </button>
            )}
          </div>
          
          <ScrollArea className="h-[200px] overflow-y-auto">
            <div className="p-1">
              {filteredOptions.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <div
                    key={option.value}
                    className={cn(
                      "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                      value === option.value && "bg-accent text-accent-foreground font-medium"
                    )}
                    onClick={() => handleSelect(option.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
