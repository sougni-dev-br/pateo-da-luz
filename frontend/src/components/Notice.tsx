import { useEffect, useState } from "react";
import { Alert, type AlertTone } from "./ui/alert";
import { useRevealScroll } from "../lib/useRevealScroll";

export type NoticeTone = AlertTone;

export type NoticeState = {
  tone: NoticeTone;
  message: string;
};

export function Notice({ notice }: { notice: NoticeState | null }) {
  const ref = useRevealScroll<HTMLDivElement>({
    when: notice ? `${notice.tone}:${notice.message}` : null,
    block: "start",
  });

  if (!notice) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      aria-live="polite"
      role="status"
      data-autofocus
      style={{ scrollMarginTop: "var(--scroll-anchor-offset, 24px)", outline: "none" }}
    >
      <Alert type={notice.tone} message={notice.message} className="notice" />
    </div>
  );
}

export function useNotice(timeoutMs = 5000) {
  const [notice, setNotice] = useState<NoticeState | null>(null);

  useEffect(() => {
    if (!notice) return undefined;

    const timeout = window.setTimeout(() => setNotice(null), timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [notice, timeoutMs]);

  return { notice, setNotice };
}
