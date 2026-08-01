import React from "react";
import { Spinner } from "./ui";

export interface DataTableColumn<T> {
  header: React.ReactNode;
  accessor?: keyof T | string;
  render?: (row: T, index: number) => React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  enableDoubleClick?: boolean; // Whether this column should trigger double-click
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  emptySubMessage?: string;
  onRowDoubleClick?: (row: T) => void;
  keyExtractor: (row: T, index: number) => string | number;
  wrapperClassName?: string;
}

export function DataTable<T>({
  columns,
  data,
  isLoading = false,
  emptyMessage = "No data available",
  emptySubMessage,
  onRowDoubleClick,
  keyExtractor,
  wrapperClassName = "overflow-x-auto",
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-foreground-muted">
        <p>{emptyMessage}</p>
        {emptySubMessage && <p className="text-sm mt-2">{emptySubMessage}</p>}
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      <table className="min-w-full divide-y divide-bordercl">
        <thead className="bg-surface-alt">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                className={
                  column.headerClassName ||
                  "px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider"
                }
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface divide-y divide-bordercl">
          {data.map((row, rowIndex) => (
            <tr key={keyExtractor(row, rowIndex)} className="hover:bg-surface-hover">
              {columns.map((column, colIndex) => {
                const cellContent = column.render
                  ? column.render(row, rowIndex)
                  : column.accessor
                    ? String((row as any)[column.accessor] || "")
                    : "";

                const shouldEnableDoubleClick =
                  column.enableDoubleClick && onRowDoubleClick;

                return (
                  <td
                    key={colIndex}
                    className={
                      column.cellClassName ||
                      `px-6 py-4 text-sm ${
                        shouldEnableDoubleClick
                          ? "font-medium text-foreground cursor-pointer hover:text-blue-600 whitespace-nowrap"
                          : "text-foreground-muted"
                      }`
                    }
                    onDoubleClick={
                      shouldEnableDoubleClick
                        ? () => onRowDoubleClick(row)
                        : undefined
                    }
                    title={
                      shouldEnableDoubleClick
                        ? "Double-click to edit"
                        : undefined
                    }
                  >
                    {cellContent}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
