import { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface ColumnFilterHeaderProps {
  /** Column heading shown to the user */
  label: string;
  /**
   * Set to false for columns where nearly every row holds a different value
   * (email, membership number, transaction number, free-text comments…) —
   * a checklist of hundreds of one-off values isn't a useful filter. The
   * funnel icon is hidden and only the label (plus sort arrow, if any) shows.
   * Defaults to true.
   */
  filterable?: boolean;
  /** Every distinct value available for this column (pre-formatted for display) */
  options?: string[];
  /** Currently checked values. Empty array = no filter applied (show everything). */
  selected?: string[];
  /** Called with the new selection whenever the user checks/unchecks a value */
  onChange?: (values: string[]) => void;
  /** Optional: enables the little sort arrow next to the label */
  sortDir?: "asc" | "desc" | null;
  onSortClick?: () => void;
  className?: string;
}

/**
 * A single `<th>`-friendly control: the column label (optionally clickable to
 * sort) plus a funnel icon that opens an Excel-style dropdown — a search box
 * on top and a checkbox list of every distinct value below it. The funnel
 * fills in with the primary color whenever a filter is active on that column
 * so admins can see at a glance which columns are currently narrowed down.
 */
export function ColumnFilterHeader({
  label,
  filterable = true,
  options = [],
  selected = [],
  onChange = () => {},
  sortDir,
  onSortClick,
  className,
}: ColumnFilterHeaderProps) {
  const [open, setOpen] = useState(false);
  const isActive = selected.length > 0;

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [options],
  );

  const toggleValue = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <div className={cn("flex items-center gap-1 whitespace-nowrap", className)}>
      {onSortClick ? (
        <button
          type="button"
          onClick={onSortClick}
          className="flex items-center gap-1 font-medium hover:text-primary"
        >
          {label}
          <span className="text-xs text-muted-foreground">
            {sortDir === "asc" ? "▲" : sortDir === "desc" ? "▼" : "↕"}
          </span>
        </button>
      ) : (
        <span className="font-medium">{label}</span>
      )}

      {filterable && (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "rounded p-0.5 hover:bg-accent hover:text-accent-foreground",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
            title={`Filter ${label}`}
            aria-label={`Filter ${label}`}
          >
            <Filter className={cn("h-2.5 w-2.5", isActive && "fill-current")} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {sortedOptions.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggleValue(option)}
                    className="cursor-pointer gap-2"
                  >
                    <Checkbox
                      checked={selected.includes(option)}
                      onCheckedChange={() => toggleValue(option)}
                    />
                    <span className="truncate">{option || "(blank)"}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="flex items-center justify-between border-t p-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onChange([])}
                disabled={!isActive}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onChange(sortedOptions)}
              >
                Select all
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      )}
    </div>
  );
}

export default ColumnFilterHeader;
