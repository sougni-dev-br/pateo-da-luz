import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs } from "../design-system";
import { DeliveryAcumulado } from "./DeliveryAcumulado";
import { DeliveryIfood } from "./DeliveryIfood";
import { DeliveryNoventaNove } from "./DeliveryNoventaNove";

// Menu unificado "Delivery": aba por plataforma + Acumulado que soma tudo.
// Aba controlada via query param ?platform= pra permitir bookmark e
// redirecionar rotas antigas /financeiro/delivery-ifood.

type Platform = "acumulado" | "ifood" | "noventa-nove";

const TABS = [
  { value: "acumulado", label: "Acumulado" },
  { value: "ifood", label: "iFood" },
  { value: "noventa-nove", label: "99 Food" }
];

function isPlatform(value: string | null): value is Platform {
  return value === "acumulado" || value === "ifood" || value === "noventa-nove";
}

export function Delivery() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get("platform");
  const [platform, setPlatform] = useState<Platform>(isPlatform(initial) ? initial : "acumulado");

  function handleChange(next: string) {
    if (!isPlatform(next)) return;
    setPlatform(next);
    setSearchParams({ platform: next }, { replace: true });
  }

  return (
    <div style={{ display: "grid", gap: "16px", padding: "16px", maxWidth: "1280px", margin: "0 auto" }}>
      <Tabs tabs={TABS} value={platform} onChange={handleChange} />
      {platform === "acumulado" && <DeliveryAcumulado />}
      {platform === "ifood" && <DeliveryIfood />}
      {platform === "noventa-nove" && <DeliveryNoventaNove />}
    </div>
  );
}
