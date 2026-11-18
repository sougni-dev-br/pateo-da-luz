// Prévia do "Atualizar do cadastro": o que mudaria no período aberto se o cadastro dos
// funcionários fosse levado a ele, e quem está fora do rateio (e por quê). Só leitura e sem
// banco: as mesmas decisões de syncParticipantsFromCadastro, para a tela avisar antes.
export type TipoDiferenca = "INCLUIR" | "PASSA_A_PARTICIPAR" | "PONTOS" | "FUNCAO" | "SAI_DO_RATEIO" | "SAI_DO_PERIODO";

export type DiferencaCadastro = { employeeId: string; nome: string; tipo: TipoDiferenca; detalhe: string };

export type PessoaDoCadastro = {
  id: string; nome: string; funcao: string | null; pontos: number; tipoGorjeta: "PONTOS" | "FIXO";
  /** Já saiu neste ciclo: a gorjeta é da rescisão, a atualização não o tira do rateio. */
  saiuNoCiclo?: boolean;
};

export type ParticipanteDoPeriodo = {
  employeeId: string; basePoints: number | null; functionName: string | null; foraDaGorjeta: boolean; vales: number;
};

const pts = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const dataBr = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export function diferencasDoSync(entrada: {
  elegiveis: PessoaDoCadastro[]; soSalario: PessoaDoCadastro[]; emTeste: PessoaDoCadastro[]; existentes: ParticipanteDoPeriodo[];
}): DiferencaCadastro[] {
  const { elegiveis, soSalario, emTeste, existentes } = entrada;
  const porPessoa = new Map(existentes.map((e) => [e.employeeId, e]));
  const saida: DiferencaCadastro[] = [];
  const add = (p: PessoaDoCadastro, tipo: TipoDiferenca, detalhe: string) => saida.push({ employeeId: p.id, nome: p.nome, tipo, detalhe });

  for (const e of elegiveis) {
    const atual = porPessoa.get(e.id);
    if (!atual) {
      add(e, "INCLUIR", e.tipoGorjeta === "PONTOS" ? `entra no rateio com ${pts(e.pontos)} pts${e.funcao ? ` (${e.funcao})` : " e sem função"}` : "entra no rateio com cota fixa");
      continue;
    }
    if (atual.foraDaGorjeta) {
      add(e, "PASSA_A_PARTICIPAR", e.tipoGorjeta === "PONTOS" ? `deixa de ser só salário e entra no rateio com ${pts(e.pontos)} pts` : "deixa de ser só salário e entra no rateio com cota fixa");
      continue;
    }
    if (e.tipoGorjeta !== "PONTOS") continue;
    if (Number(atual.basePoints ?? -1) !== e.pontos) add(e, "PONTOS", `pontos-base ${atual.basePoints == null ? "—" : pts(Number(atual.basePoints))} → ${pts(e.pontos)}`);
    if (atual.functionName !== e.funcao) add(e, "FUNCAO", `função ${atual.functionName ?? "sem função"} → ${e.funcao ?? "sem função"}`);
  }
  for (const s of soSalario) {
    if (!porPessoa.has(s.id)) add(s, "INCLUIR", "entra só pelo salário (fora do rateio)");
  }
  const soSalarioIds = new Set(soSalario.map((s) => s.id));
  const foraAgora = new Set<string>();
  for (const p of [...soSalario, ...emTeste.filter((e) => !soSalarioIds.has(e.id))]) {
    const atual = porPessoa.get(p.id);
    if (!atual || atual.foraDaGorjeta || p.saiuNoCiclo) continue;
    foraAgora.add(p.id);
    add(p, "SAI_DO_RATEIO", "sai do rateio (não participa ou ainda não entrou na gorjeta)");
  }
  const continua = new Set([...elegiveis.map((e) => e.id), ...soSalario.map((s) => s.id)]);
  const nomes = new Map([...elegiveis, ...soSalario, ...emTeste].map((p) => [p.id, p.nome]));
  for (const x of existentes) {
    if ((x.foraDaGorjeta || foraAgora.has(x.employeeId)) && !continua.has(x.employeeId) && x.vales === 0) {
      saida.push({ employeeId: x.employeeId, nome: nomes.get(x.employeeId) ?? "", tipo: "SAI_DO_PERIODO", detalhe: "sai do período (já não tem direito a nada aqui)" });
    }
  }
  return saida;
}

export type PessoaDoPeriodo = {
  id: string; nome: string; modality: "CLT" | "NAO_CLT"; participaGorjeta: boolean;
  inicioGorjeta: Date | null; pontos: number; tipoGorjeta: "PONTOS" | "FIXO";
};

export type ForaDoRateio = { employeeId: string; nome: string; motivo: string; soSalario: boolean };

// Quem tem vínculo no ciclo e não recebe gorjeta, com o motivo em palavras de quem opera.
export function foraDoRateio(pessoas: PessoaDoPeriodo[], fimDoCiclo: Date, soSalarioIds: ReadonlySet<string>): ForaDoRateio[] {
  const saida: ForaDoRateio[] = [];
  for (const p of pessoas) {
    const soSalario = soSalarioIds.has(p.id);
    const sufixo = soSalario ? " Recebe só o salário." : "";
    if (!p.participaGorjeta) {
      saida.push({ employeeId: p.id, nome: p.nome, soSalario, motivo: `"Participa da gorjeta" está desmarcado no cadastro.${sufixo}` });
    } else if (p.inicioGorjeta == null) {
      saida.push({ employeeId: p.id, nome: p.nome, soSalario, motivo: `Sem a data "Entra na gorjeta em" no cadastro (em teste).${sufixo}` });
    } else if (p.inicioGorjeta > fimDoCiclo) {
      saida.push({ employeeId: p.id, nome: p.nome, soSalario, motivo: `Entra na gorjeta só em ${dataBr(p.inicioGorjeta)} (depois deste ciclo).${sufixo}` });
    } else if (p.tipoGorjeta === "PONTOS" && p.pontos <= 0) {
      saida.push({ employeeId: p.id, nome: p.nome, soSalario, motivo: "Participa, mas está sem função no cadastro: 0 pontos, não recebe gorjeta." });
    }
  }
  return saida.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
