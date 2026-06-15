"use client";

import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type AlertTone = "success" | "error" | "warning" | "info";

const toneStyles: Record<AlertTone, string> = {
  success: "alert success",
  error: "alert error",
  warning: "alert warning",
  info: "alert info"
};

const toneIcons: Record<AlertTone, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <XCircle size={16} />,
  warning: <TriangleAlert size={16} />,
  info: <Info size={16} />
};

export function Alert({
  type = "info",
  message,
  children,
  className
}: {
  type?: AlertTone;
  message?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={cn(toneStyles[type], className)}
      role="alert"
      initial={{ opacity: 0, y: 8, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      whileHover={{ scale: 1.01 }}
    >
      <span className="alert-icon">{toneIcons[type]}</span>
      <span>{message ?? children}</span>
    </motion.div>
  );
}
