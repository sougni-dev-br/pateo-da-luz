// Leitura do AFD do REP-P (Portaria 671 do MTE), exportado pelo relógio eletrônico.
// Só interessa o registro tipo 7 (marcação), de tamanho fixo (137 caracteres):
//
//   0-8    NSR (número sequencial)
//   9      tipo do registro (7 = marcação)
//   10-33  data/hora da gravação (ISO com fuso)
//   34-45  CPF (12 dígitos, zero à esquerda)
//   46-69  data/hora da marcação (ISO com fuso)
//   70-72  tipo de coletor (2) + indicador final (1)
//   73-136 hash
//
// O horário usado é o da marcação, já no fuso local do arquivo.

const TAMANHO_REGISTRO_7 = 137;
export const MAX_AVISOS = 20;
// Entrada e saída são pareadas em sequência (1ª com 2ª, 3ª com 4ª…). Duas batidas só formam um par se
// estiverem a no máximo 16h uma da outra (o maior turno que o sistema aceita); senão a primeira fica
// sozinha, como batida pendente. O dia do par é o da entrada: turno que vira a meia-noite fica no dia
// em que começou, e dois dias seguidos nunca se juntam, por mais curto que seja o descanso entre eles.
const TURNO_MAXIMO_MIN = 16 * 60;
const FUSO_LOCAL_MIN = -180; // America/Sao_Paulo, sem horário de verão desde 2019

export interface BatidaAfd {
  nsr: number;
  cpf: string; // 11 dígitos
  data: string; // AAAA-MM-DD
  hora: string; // HH:mm
  origem: string; // coletor + indicador final, como veio
}

export interface LeituraAfd {
  batidas: BatidaAfd[];
  avisos: string[];
}

export interface DiaBatidas {
  data: string;
  marcacoes: string[];
}

// Data e hora de verdade: 31/11 ou 99:99 não passam.
function momentoValido(data: string, hora: string): boolean {
  const d = new Date(`${data}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== data) return false;
  return Number(hora.slice(0, 2)) <= 23 && Number(hora.slice(3, 5)) <= 59;
}

// O arquivo informa o fuso de cada marcação (-0300). Se vier outro (ex.: UTC), converte para o horário local.
function paraHorarioLocal(data: string, hora: string, fuso: string | undefined): { data: string; hora: string } {
  if (!fuso || fuso === "-0300") return { data, hora };
  const sinal = fuso[0] === "-" ? -1 : 1;
  const deslocamento = sinal * (Number(fuso.slice(1, 3)) * 60 + Number(fuso.slice(3, 5)));
  const instante = Date.UTC(Number(data.slice(0, 4)), Number(data.slice(5, 7)) - 1, Number(data.slice(8, 10)), Number(hora.slice(0, 2)), Number(hora.slice(3, 5)));
  const iso = new Date(instante - deslocamento * 60_000 + FUSO_LOCAL_MIN * 60_000).toISOString();
  return { data: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

export function lerAfd671(texto: string): LeituraAfd {
  const batidas: BatidaAfd[] = [];
  const vistas = new Set<string>();
  const avisos: string[] = [];
  let omitidos = 0;
  const avisar = (mensagem: string) => {
    if (avisos.length < MAX_AVISOS) avisos.push(mensagem);
    else omitidos += 1;
  };

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trimEnd();
    if (linha.length < 10 || linha[9] !== "7") continue;
    if (linha.length !== TAMANHO_REGISTRO_7) {
      avisar(`Registro ${linha.slice(0, 9)} ignorado: tamanho ${linha.length} em vez de ${TAMANHO_REGISTRO_7}.`);
      continue;
    }
    const marcacao = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?([+-]\d{4})?/.exec(linha.slice(46, 70));
    const cpf = linha.slice(35, 46);
    if (!marcacao || !/^\d{11}$/.test(cpf) || !momentoValido(marcacao[1], marcacao[2])) {
      avisar(`Registro ${linha.slice(0, 9)} ignorado: data, hora ou CPF ilegível.`);
      continue;
    }
    const chave = `${cpf}:${linha.slice(0, 9)}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const local = paraHorarioLocal(marcacao[1], marcacao[2], marcacao[3]);
    batidas.push({ nsr: Number(linha.slice(0, 9)), cpf, data: local.data, hora: local.hora, origem: linha.slice(70, 73) });
  }
  if (omitidos > 0) avisos.push(`Mais ${omitidos} registros ignorados.`);
  return { batidas, avisos };
}

const emMinutos = (b: BatidaAfd): number => Date.parse(`${b.data}T${b.hora}:00Z`) / 60000;

// Junta as batidas de cada pessoa em dias de trabalho, pareando entrada e saída em sequência.
export function agruparBatidasPorDia(batidas: BatidaAfd[]): Map<string, DiaBatidas[]> {
  const porPessoa = new Map<string, BatidaAfd[]>();
  for (const b of batidas) {
    const lista = porPessoa.get(b.cpf);
    if (lista) lista.push(b);
    else porPessoa.set(b.cpf, [b]);
  }

  const resultado = new Map<string, DiaBatidas[]>();
  for (const [cpf, lista] of porPessoa) {
    const ordenadas = [...lista].sort((a, b) => emMinutos(a) - emMinutos(b) || a.nsr - b.nsr);
    // Toque duplo no relógio (mesmo minuto) vale uma batida só.
    const distintas = ordenadas.filter((b, i) => i === 0 || emMinutos(b) !== emMinutos(ordenadas[i - 1]));

    const porDia = new Map<string, string[]>();
    const juntar = (data: string, horas: string[]) => porDia.set(data, [...(porDia.get(data) ?? []), ...horas]);
    for (let i = 0; i < distintas.length; ) {
      const entrada = distintas[i];
      const saida = distintas[i + 1];
      if (saida && emMinutos(saida) - emMinutos(entrada) <= TURNO_MAXIMO_MIN) {
        juntar(entrada.data, [entrada.hora, saida.hora]);
        i += 2;
      } else {
        juntar(entrada.data, [entrada.hora]); // sem par: fica pendente
        i += 1;
      }
    }
    resultado.set(cpf, [...porDia].map(([data, marcacoes]) => ({ data, marcacoes })));
  }
  return resultado;
}
