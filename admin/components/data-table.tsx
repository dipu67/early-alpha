"use client";

import { useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  searchPlaceholder?: string;
  /** Extra toolbar content (filters, actions) rendered on the right. */
  toolbar?: React.ReactNode;
  /** Rendered when rows are selected; receives the selected originals. */
  bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
  /** Enable CSV export of the current (filtered) rows. */
  exportName?: string;
  emptyLabel?: string;
}

export function DataTable<T>({
  columns,
  data,
  searchPlaceholder = "Search…",
  toolbar,
  bulkActions,
  exportName,
  emptyLabel = "No results.",
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: !!bulkActions,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);

  function exportCsv() {
    const rows = table.getFilteredRowModel().rows.map((r) => r.original as Record<string, unknown>);
    if (rows.length === 0) return;
    const keys = Object.keys(rows[0]!).filter((k) => typeof rows[0]![k] !== "object" || Array.isArray(rows[0]![k]));
    const csv = [
      keys.join(","),
      ...rows.map((row) =>
        keys.map((k) => `"${String(row[k] ?? "").replace(/"/g, '""')}"`).join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder={searchPlaceholder}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full sm:max-w-xs"
        />
        <div className="hidden flex-1 sm:block" />
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {exportName ? (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download /> Export
            </Button>
          ) : null}
        </div>
      </div>

      {bulkActions && selected.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
          <span className="shrink-0">{selected.length} selected</span>
          <div className="flex flex-wrap gap-2">
            {bulkActions(selected, () => setRowSelection({}))}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card">
        <Table className="min-w-[36rem]">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <ArrowUpDown className="size-3" />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <EmptyState title={emptyLabel} />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {table.getFilteredRowModel().rows.length} row(s)
          {bulkActions && selected.length > 0 ? ` · ${selected.length} selected` : ""}
        </span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
          </span>
          <Button variant="outline" size="icon" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
