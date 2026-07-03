import type { HTMLAttributes, ReactNode } from "react";
import "./Card.css";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  children?: ReactNode;
};

export function Card({ interactive = false, className, children, ...rest }: CardProps) {
  const classes = ["ds-card", interactive && "ds-card-interactive", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
