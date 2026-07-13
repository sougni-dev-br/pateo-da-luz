import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs } from "../design-system";
import { IfoodSettings } from "./IfoodSettings";
import { NoventaNoveSettings } from "./NoventaNoveSettings";

// Configurações de integrações de delivery — abas por plataforma.
// Aba controlada via query param ?platform= (mesma UX de Delivery.tsx).

type Platform = "ifood" | "noventa-nove";

const TABS = [
  { value: "ifood", label: "iFood" },
  { value: "noventa-nove", label: "99 Food" }
];

function isPlatform(value: string | null): value is Platform {
  return value === "ifood" || value === "noventa-nove";
}

export function DeliverySettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get("platform");
  const [platform, setPlatform] = useState<Platform>(isPlatform(initial) ? initial : "ifood");

  function handleChange(next: string) {
    if (!isPlatform(next)) return;
    setPlatform(next);
    setSearchParams({ platform: next }, { replace: true });
  }

  return (
    <div style={{ display: "grid", gap: "16px", padding: "16px", maxWidth: "1280px", margin: "0 auto" }}>
      <Tabs tabs={TABS} value={platform} onChange={handleChange} />
      {platform === "ifood" ? <IfoodSettings /> : <NoventaNoveSettings />}
    </div>
  );
}
