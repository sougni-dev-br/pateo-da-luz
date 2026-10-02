import type { FormaNome, ModeloFolha, OpcoesFolha, Orientacao, Paleta, TamanhoTexto } from "./FolhaAniversariantes";

export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const MODELOS: Array<{ value: ModeloFolha; label: string; dica: string }> = [
  { value: "CARTAZ", label: "Cartaz", dica: "Destaque para o mural" },
  { value: "CARTOES", label: "Cartões", dica: "Um por pessoa, para recortar" },
  { value: "LISTA", label: "Lista", dica: "Simples e compacta" }
];

export const ORIENTACOES: Array<{ value: Orientacao; label: string }> = [
  { value: "portrait", label: "Em pé" },
  { value: "landscape", label: "Deitado" }
];

export const PALETAS: Array<{ value: Paleta; label: string; amostra: string }> = [
  { value: "DOURADO", label: "Dourado — cor da casa", amostra: "#a8812f" },
  { value: "ROSA", label: "Rosa", amostra: "#c0457a" },
  { value: "AZUL", label: "Azul", amostra: "#2d68ad" },
  { value: "VERDE", label: "Verde", amostra: "#3c8657" },
  { value: "PB", label: "Preto e branco — economiza tinta", amostra: "#111111" }
];

export const FORMAS_NOME: Array<{ value: FormaNome; label: string }> = [
  { value: "PRENOME_SOBRENOME", label: "Nome e sobrenome" },
  { value: "APELIDO", label: "Apelido" },
  { value: "PRIMEIRO", label: "Primeiro nome" },
  { value: "COMPLETO", label: "Completo" }
];

export const TAMANHOS: Array<{ value: TamanhoTexto; label: string }> = [
  { value: "PEQUENO", label: "Menor" },
  { value: "NORMAL", label: "Automático" },
  { value: "GRANDE", label: "Maior" }
];

export const MENSAGENS_SUGERIDAS = [
  "Que o novo ciclo venha cheio de saúde, conquistas e momentos felizes. O Pateo brilha mais com você aqui!",
  "Mais um ano de histórias, sorrisos e trabalho em equipe. Obrigado por fazer parte do nosso time — parabéns!",
  "Você faz a diferença aqui todos os dias. Hoje é dia de celebrar você: muita luz, saúde e sucesso!",
  "Que não faltem motivos para sorrir, sonhos para realizar e gente querida por perto. Feliz aniversário!"
];

export const ASSINATURA_PADRAO = "Com carinho, equipe Pateo da Luz";

export const PADRAO: OpcoesFolha = {
  modelo: "CARTAZ", orientacao: "portrait", paleta: "DOURADO", formaNome: "PRENOME_SOBRENOME", tamanho: "NORMAL",
  mostrarSetor: true, mostrarCargo: false, mostrarLogo: true,
  titulo: "", mensagem: MENSAGENS_SUGERIDAS[0], assinatura: ASSINATURA_PADRAO
};

// v2: o padrão de nome virou "Apelido" e a mensagem mudou — preferências antigas não valem mais.
// v3: o padrão de nome virou "Nome e sobrenome" (decisão do Eli, 01/10/2026). As preferências da
// v2 continuam valendo (cores, modelo, mensagem); só a forma do nome passa para o padrão novo.
const CHAVE_PREFERENCIAS = "pateo.aniversariantes.impressao.v3";
const CHAVE_V2 = "pateo.aniversariantes.impressao.v2";

// Preferências só de conveniência: se o navegador bloquear o armazenamento, usa o padrão.
export function lerPreferencias(): OpcoesFolha {
  try {
    const salvo = window.localStorage.getItem(CHAVE_PREFERENCIAS);
    if (salvo) return { ...PADRAO, ...(JSON.parse(salvo) as Partial<OpcoesFolha>), titulo: "" };
    const v2 = window.localStorage.getItem(CHAVE_V2);
    return v2 ? { ...PADRAO, ...(JSON.parse(v2) as Partial<OpcoesFolha>), formaNome: PADRAO.formaNome, titulo: "" } : PADRAO;
  } catch {
    return PADRAO;
  }
}

export function salvarPreferencias(op: OpcoesFolha) {
  try {
    // O título costuma citar o mês — não fica salvo, para não imprimir "Setembro" em outubro.
    window.localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify({ ...op, titulo: "" }));
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}
