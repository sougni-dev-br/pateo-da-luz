import { useState } from "react";
import { AvisoComDesfazer } from "../AvisoComDesfazer";
import type { ComentariosApi } from "./useComentarios";

// "Comentário apagado" com Desfazer por alguns segundos (o servidor aceita o desfazer de quem apagou por 10 minutos).
// role=status: anuncia sem tirar o foco de onde está. Se o desfazer falhar, o motivo aparece como alerta.

export const TEMPO_DO_AVISO_DE_APAGADO_MS = 8_000;

type Props = { api: ComentariosApi; aoDesfazer?: () => void };

export function AvisoDeApagado({ api, aoDesfazer }: Props) {
  const [erro, setErro] = useState<string | null>(null);
  async function desfazer() {
    setErro(null);
    const resultado = await api.desfazer();
    if (resultado.ok) aoDesfazer?.();
    else setErro(resultado.mensagem);
  }
  return (
    <>
      {erro && <p className="plan-coment-erro plan-coment-desfazer-erro" role="alert">{erro}</p>}
      {api.apagadoRecente && (
        <AvisoComDesfazer
          key={api.apagadoRecente.id}
          texto="Comentário apagado"
          tempoMs={TEMPO_DO_AVISO_DE_APAGADO_MS}
          onDesfazer={() => void desfazer()}
          onFechar={api.descartarAviso}
        />
      )}
    </>
  );
}
