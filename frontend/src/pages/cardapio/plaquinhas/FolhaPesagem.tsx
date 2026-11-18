import type { BuffetPot } from "../../../api/client";
import { kgTexto } from "./pesagemFormato";

type Props = {
  dataTexto: string;
  tipoTexto: string;
  listaNome: string | null;
  pratos: Array<{ id: string; nome: string }>;
  panelas: BuffetPot[];
};

const LINHAS_EXTRAS = 4;
const PANELAS_POR_LINHA = 10;

// Folha em papel para a cozinha anotar: uma linha por prato do dia, com espaço para panela e peso bruto
// da produção, da reposição e da sobra. O peso vazio das panelas vem impresso: ninguém precisa tarar nem calcular.
// Quem digita depois no ERP só copia o que está escrito.
export function FolhaPesagem({ dataTexto, tipoTexto, listaNome, pratos, panelas }: Props) {
  // Panelas em blocos de 10 por linha: com muitas, uma linha só deixaria o peso vazio ilegível no papel.
  const blocos = Array.from({ length: Math.ceil(panelas.length / PANELAS_POR_LINHA) }, (_, i) => panelas.slice(i * PANELAS_POR_LINHA, (i + 1) * PANELAS_POR_LINHA));
  const linhas = [...pratos.map((p) => p.nome), ...Array.from({ length: LINHAS_EXTRAS }, () => "")];
  return (
    <section className="pes-folha">
      <header className="pes-folha-topo">
        <h1>Pesagem do buffet</h1>
        <p>{tipoTexto} · {dataTexto}{listaNome ? ` · ${listaNome}` : ""}</p>
      </header>

      <table className="pes-folha-panelas">
        <caption>Panelas — peso vazio (já é descontado no lançamento: anote o peso BRUTO da balança)</caption>
        {blocos.map((bloco) => (
          <tbody key={bloco[0].id}>
            <tr>{bloco.map((p) => <th key={p.id} scope="col">{p.code}</th>)}</tr>
            <tr>{bloco.map((p) => <td key={p.id}>{kgTexto(p.tareG)}</td>)}</tr>
          </tbody>
        ))}
      </table>

      <table className="pes-folha-tabela">
        <thead>
          <tr>
            <th rowSpan={2} className="pes-col-prato">Prato</th>
            <th colSpan={2}>Produção</th>
            <th colSpan={2}>Reposição</th>
            <th colSpan={2}>Sobra</th>
          </tr>
          <tr>
            <th>Panela</th><th>Bruto (kg)</th>
            <th>Panela</th><th>Bruto (kg)</th>
            <th>Panela</th><th>Bruto (kg)</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((nome, i) => (
            <tr key={`${nome}-${i}`}>
              <td className="pes-col-prato">{nome}</td>
              <td /><td /><td /><td /><td /><td />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
