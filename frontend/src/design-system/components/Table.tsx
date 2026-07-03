import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import "./Table.css";

type Align = "left" | "center" | "right";

export type TableProps = HTMLAttributes<HTMLTableElement> & {
  /** Remove o scroll horizontal automático do wrapper. */
  noScroll?: boolean;
};

/**
 * Tabela canônica do DS: <table> semântico por baixo, wrapper com
 * overflow-x, row hover creme (--row-hover), truncate opcional por célula
 * e coluna de ações (IconButton/RowMenu) alinhada à direita.
 */
function TableRoot({ noScroll, className, children, ...rest }: TableProps) {
  const tableClasses = ["ds-table", className].filter(Boolean).join(" ");
  const table = (
    <table className={tableClasses} {...rest}>
      {children}
    </table>
  );
  if (noScroll) return table;
  return <div className="ds-table-scroll">{table}</div>;
}

export type TableSectionProps = HTMLAttributes<HTMLTableSectionElement>;

function Head({ className, children, ...rest }: TableSectionProps) {
  const classes = ["ds-table-head", className].filter(Boolean).join(" ");
  return (
    <thead className={classes} {...rest}>
      {children}
    </thead>
  );
}

function Body({ className, children, ...rest }: TableSectionProps) {
  const classes = ["ds-table-body", className].filter(Boolean).join(" ");
  return (
    <tbody className={classes} {...rest}>
      {children}
    </tbody>
  );
}

export type TableRowProps = HTMLAttributes<HTMLTableRowElement>;

function Row({ className, onClick, children, ...rest }: TableRowProps) {
  const classes = ["ds-table-row", onClick && "ds-table-row-clickable", className]
    .filter(Boolean)
    .join(" ");
  return (
    <tr className={classes} onClick={onClick} {...rest}>
      {children}
    </tr>
  );
}

export type TableThProps = ThHTMLAttributes<HTMLTableCellElement> & {
  align?: Align;
  /** Coluna de ações: largura mínima, conteúdo à direita. */
  actions?: boolean;
  /** Largura mínima em px (ex.: 180 para colunas de nome). */
  minWidth?: number;
};

function Th({ align = "left", actions, minWidth, className, style, children, ...rest }: TableThProps) {
  const classes = [
    "ds-table-th",
    align !== "left" && `ds-table-cell-${align}`,
    actions && "ds-table-cell-actions",
    className
  ]
    .filter(Boolean)
    .join(" ");
  const mergedStyle = minWidth ? { ...style, minWidth } : style;
  return (
    <th className={classes} style={mergedStyle} {...rest}>
      {children}
    </th>
  );
}

export type TableTdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  align?: Align;
  /** Ellipsis + nowrap. Passe title para tooltip nativo do texto completo. */
  truncate?: boolean;
  /** Célula de ações: IconButton/RowMenu alinhados à direita, sem quebra. */
  actions?: boolean;
  minWidth?: number;
};

function Td({
  align = "left",
  truncate,
  actions,
  minWidth,
  className,
  style,
  children,
  ...rest
}: TableTdProps) {
  const classes = [
    "ds-table-td",
    align !== "left" && `ds-table-cell-${align}`,
    truncate && "ds-table-cell-truncate",
    actions && "ds-table-cell-actions",
    className
  ]
    .filter(Boolean)
    .join(" ");
  const mergedStyle = minWidth ? { ...style, minWidth } : style;
  return (
    <td className={classes} style={mergedStyle} {...rest}>
      {actions ? <span className="ds-table-actions-wrap">{children}</span> : children}
    </td>
  );
}

export const Table = Object.assign(TableRoot, { Head, Body, Row, Th, Td });
