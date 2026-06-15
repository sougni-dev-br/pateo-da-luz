import { useEffect, useState } from "react";
import { Alert, type AlertTone } from "./ui/alert";

export type NoticeTone = AlertTone;

export type NoticeState = {
  tone: NoticeTone;
  message: string;
};

export function Notice({ notice }: { notice: NoticeState | null }) {
  if (!notice) return null;

  return <Alert type={notice.tone} message={notice.message} className="notice" />;
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
