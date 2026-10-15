import type { ReactNode } from 'react';
import { Card } from '../ui/Card';

interface TableColumn {
  key: string;
  label: string;
  className?: string;
}

interface TableShellProps {
  columns: TableColumn[];
  toolbar?: ReactNode;
  children: ReactNode;
  caption: string;
}

export function TableShell({ columns, toolbar, children, caption }: TableShellProps) {
  return (
    <Card className="overflow-hidden">
      {toolbar ? <div className="border-b border-border/80 bg-surface p-4 sm:px-5">{toolbar}</div> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[13px] [&_tbody_td]:px-5 [&_tbody_td]:py-3.5 [&_tbody_tr]:border-b [&_tbody_tr]:border-border/70 [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr:hover]:bg-background/80">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-border/80 bg-background/80 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
            <tr>{columns.map((column) => <th key={column.key} scope="col" className={`whitespace-nowrap px-5 py-3.5 ${column.className ?? ''}`}>{column.label}</th>)}</tr>
          </thead>
        </table>
      </div>
      {children}
    </Card>
  );
}
