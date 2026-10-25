import { FC, useMemo } from "react";
import { Table, TableRow, TableCell, TableHead, TableBody } from "@/components/ui/table";
import { useDataTable } from "@/reports/hooks/useDataTable";
import { usePermission } from "@/reports/hooks/usePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";

interface ColumnDef<T> {
  accessorKey: string;
  header: string;
  size?: string;
  filterable?: boolean;
  sortable?: boolean;
  accessDenied?: boolean;
}

interface AdvancedDataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  translations: any;
  onFilterChange?: (filters: any) => void;
  onSortChange?: (sortBy: any) => void;
  onPageChange?: (page: number) => void;
  initialFilters?: any;
  initialSort?: any;
}

export const AdvancedDataTable: FC<AdvancedDataTableProps<any>> = ({
  columns,
  data,
  translations,
  onFilterChange,
  onSortChange,
  onPageChange,
  initialFilters,
  initialSort,
}) => {
  const t = useTranslations("Reports");
  const { user } = useContext(AuthContext); // Assuming AuthContext is available
  const hasPermission = usePermission;

  // Compute accessDenied for each column based on permissions
  const columnsWithAccess = columns.map((column) => {
    let accessDenied = false;
    if (column.accessDenied) {
      accessDenied = column.accessDenied;
    } else if (column.accessorKey === "actions") {
      // Always show actions for now (could check permissions too)
      accessDenied = false;
    } else if (column.accessorKey === "amount" || column.accessorKey === "total") {
      // Financial columns: show only if user has report:financial permission
      accessDenied = !hasPermission("report:financial");
    }
    return { ...column, accessDenied };
  });

  // Compute sorted/filtered data
  const { filters, setFilters, sortBy, setSortBy, page, setPage, pageSize, setPageSearchQuery, searchQuery, setSearchQuery } = useDataTable({
    initialFilters: initialFilters?.map((f: any) => ({
      field: f.field,
      operator: f.operator,
      value: f.value,
    })) || [],
    initialSort: initialSort || { field: "createdAt", direction: "desc" },
  });

  // Compute filtered data
  const filteredData = data.filter((item) => {
    let matchesAll = true;
    filters.forEach((filter) => {
      const itemValue = item[filter.field as string];
      switch (filter.operator) {
        case "equals":
          matches = String(itemValue) === String(filter.value);
          break;
        case "not_equals":
          matches = String(itemValue) !== String(filter.value);
          break;
        case "contains":
          matches = String(itemValue).includes(String(filter.value));
          break;
        case "not_contains":
          matches = !String(itemValue).includes(String(filter.value));
          break;
        default:
          matches = true;
      }
      if (!matches) matchesAll = false;
    });
    return matchesAll;
  });

  // Handle filter change
  const handleFilterChange = (filter: any) => {
    const newFilters = [...filters];
    const index = newFilters.findIndex((f) => f.field === filter.field);
    if (index >= 0) {
      newFilters[index] = filter;
    } else {
      newFilters.push(filter);
    }
    setFilters(newFilters);
    onFilterChange?.(newFilters);
  };

  // Handle sort change
  const handleSortChange = (field: string) => {
    if (sortBy.field === field) {
      setSortBy({ field, direction: sortBy.direction === "asc" ? "desc" : "asc" });
    } else {
      setSortBy({ field, direction: "asc" });
    }
    onSortChange?.(sortBy);
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    onPageChange?.(newPage);
  };

  // Handle page size change
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* Search bar */}
        <div>
          <Input
            placeholder={t("search")}
            value: searchQuery setSearchQuery={setSearchQuery}
          />
        </div>

        {/* Column filters */}
        {columns.map((column) => {
          if (!column.filterable) return null;
          return (
            <div key={column.accessorKey} className="flex gap-2">
              <Input
                placeholder={t("filter")}
                value=""
                onChange={(e) => {
                  const value = (e.target as HTMLInputElement).value;
                  if (value) {
                    handleFilterChange({
                      field: column.accessorKey,
                      operator: "contains",
                      value,
                    });
                  }
                }}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFilters(filters.filter((f) => f.field !== column.accessorKey));
                  }}>
                  {t("clear")}
                </Button>
              </div>
            );
          })}
        {/* Pagination and sort */}
        <div className="flex items-center gap-4">
          <select
            value: pageSize setPageSize={setPageSize}
            className="rounded-md border border-gray-300 bg-white py-2.5 pl-3 pr-8 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))
          </select>

          <select
            value: page setPage={setPage}
            className="rounded-md border border-gray-300 bg-white py-2.5 pl-3 pr-8 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
          >
            {[1, 2, 3, 4, 5].map((num) => (
              <option key={num} value={num}>
                {num}
              </option>
            ))
          </select>
        </div>
      </div>

      {/* Data table */}
      <Table>
        <TableHead>
          {columns.map((column) => {
            // Check access denied
            if (column.accessDenied) {
              return (
                <TableRow key={column.accessorKey}>
                  <TableCell colSpan={columns.length}>
                    <span className="text-red-500 text-sm">{t("access_denied")}</span>
                  </TableCell>
                </TableRow>
              );
            }

            // Build header with sort indicator
            let sortClass = "";
            if (sortBy.field === column.accessorKey) {
              sortClass = sortBy.direction === "asc" ? "sort-up" : "sort-down";
            }

            return (
              <TableRow key={column.accessorKey}>
                <TableHeaderCell
                  className={sortClass}
                  onClick={() => handleSortChange(column.accessorKey)}
                >
                  {column.header}
                  {sortBy.field === column.accessorKey && (
                    <span className="arrow">
                      {sortBy.direction === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </TableHeaderCell>
              </TableRow>
            );
          })}
        </TableHead>

        <TableBody>
          {filteredData.map((row, index) => {
            return (
              <TableRow key={index}>
                {columns.map((column) => {
                  // Check access denied
                  if (column.accessDenied) {
                    return <TableCell>{t("access_denied")}</TableCell>;
                  }

                  const cellValue =
                    column.accessorKey && row[column.accessorKey]
                      ? String(row[column.accessorKey])
                      : t("n/a");

                  return <TableCell>{cellValue}</TableCell>;
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
export default AdvancedDataTable;