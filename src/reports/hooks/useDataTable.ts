/**
 * useDataTable hook — State management for advanced data tables.
 * Handles filters, sorting, and pagination state.
 */

import { useState, useCallback } from "react";

export interface FilterOption {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "not_contains" | "greater_than" | "less_than";
  value: string | number | Date;
}

export interface UseDataTableOptions {
  initialPage?: number;
  initialPageSize?: number;
  initialSortBy?: { field: string; direction: "asc" | "desc" };
  initialFilters?: FilterOption[];
  pageOptions?: number[];
}

export interface UseDataTableReturn {
  // State
  filters: FilterOption[];
  setFilters: (filters: FilterOption[]) => void;
  sortBy: { field: string; direction: "asc" | "desc" };
  setSortBy: (sortBy: { field: string; direction: "asc" | "desc" }) => void;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Helper methods
  getFilteredItems<T>(items: T[], itemFilter: (item: T) => boolean): T[];
  getSortedItems<T>(items: T[], itemComparator: (a: T, b: T) => number): T[];
}

export function useDataTable<T>(
  options: UseDataTableOptions = {}
): UseDataTableReturn {
  const {
    initialPage = 1,
    initialPageSize = 25,
    initialSortBy = { field: "createdAt", direction: "desc" },
    initialFilters = [],
    pageOptions = [10, 25, 50, 100],
  } = options;

  // State
  const [filters, setFilters] = useState<FilterOption[]>(initialFilters);
  const [sortBy, setSortBy] = useState<{ field: string; direction: "asc" | "desc" }>(
    initialSortBy,
  );
  const [page, setPage] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [searchQuery, setSearchQuery] = useState("");

  // Helper: filter items
  const getFilteredItems = <T>(items: T[], itemFilter: (item: T) => boolean): T[] => {
    return items.filter((item) => {
      let matchesAllFilters = true;

      filters.forEach((filter) => {
        const itemValue = itemFilter(item);

        let matches = false;
        switch (filter.operator) {
          case "equals":
            matches = itemValue === filter.value;
            break;
          case "not_equals":
            matches = itemValue !== filter.value;
            break;
          case "contains":
            matches = String(itemValue).includes(String(filter.value));
            break;
          case "not_contains":
            matches = !String(itemValue).includes(String(filter.value));
            break;
          case "greater_than":
            matches = typeof itemValue === "number" && itemValue > filter.value;
            break;
          case "less_than":
            matches = typeof itemValue === "number" && itemValue < filter.value;
            break;
          default:
            matches = false;
        }

        if (!matches) {
          matchesAllFilters = false;
        }
      });

      return matchesAllFilters;
    });
  };

  // Helper: sort items
  const getSortedItems = <T>(items: T[], itemComparator: (a: T, b: T) => number): T[] => {
    const sorted = [...items].sort((a, b) => {
      const aValue = itemComparator(a, b);
      return sortBy.direction === "asc" ? aValue : -aValue;
    });
    return sorted;
  };

  // Method to apply filters and return result
  const applyFiltersAndSort = <T>(
    items: T[],
    itemFilter: (item: T) => boolean,
    itemComparator: (a: T, b: T) => number,
  ): T[] => {
    const filtered = getFilteredItems(items, itemFilter);
    return getSortedItems(filtered, itemComparator);
  };

  return {
    // State
    filters,
    setFilters,
    sortBy,
    setSortBy,
    page,
    setPage,
    pageSize,
    setPageSize,
    searchQuery,
    setSearchQuery,

    // Helper methods
    getFilteredItems,
    getSortedItems,
    applyFiltersAndSort,
  };
}