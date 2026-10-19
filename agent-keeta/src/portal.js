import { chromium } from "playwright-core";
import {
  cabecalhosParaReusar,
  corpoDaExportacao,
  ehPaginaDeLogin,
  escolherRegistro,
  urlDeDownloadValida
} from "./logica.js";
import { logger, pastaDeLogs, redigir } from "./logger.js";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

// Fala com o portal da Keeta (merchant.mykeeta.com) por um navegador com perfil PERSISTENTE: o login
// feito uma vez fica no perfil. As chamadas de API são as mesmas que a tela de Relatórios faz; os
// cabeçalhos do app (accountId, shopId, M-APPKEY...) são emprestados da primeira chamada que a própria
// página faz, então o agente não precisa conhecer esses valores.

const ORIGEM = "https://merchant.mykeeta.com";
const URL_RELATORIOS = `${ORIGEM}/m/web/app/bizdata#/dataDownload`;
const API = {
  criar: `${ORIGEM}/api/operate/data/download/task/create`,
  listar: `${ORIGEM}/api/operate/data/download/record/page`
};
const ESPERA_DO_RELATORIO_MS = 3 * 60 * 1000;
const INTERVALO_DA_CONSULTA_MS = 5000;
const ESPERA_DA_PAGINA_MS = 45 * 1000;
const ESPERA_DO_LOGIN_MS = 30 * 1000;
const ASSINATURA_ZIP = Buffer.from([0x50, 0x4b]); // "PK": um .xlsx é um zip
const TAMANHO_MAXIMO_DO_ARQUIVO = 5 * 1024 * 1024; // o mesmo teto do ERP
const DIAS_DE_GUARDA_DAS_IMAGENS = 7;

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** O portal exige login (ou algo que o agente não resolve sozinho, como código de verificação). */
export class LoginNecessarioError extends Error {}

export async function abrirNavegador({ perfilDir, navegador, headless }) {
  const context = await chromium.launchPersistentContext(perfilDir, {
    channel: navegador,
    headless,
    viewport: { width: 1366, height: 768 },
    args: ["--no-first-run"]
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

async function capturarCabecalhos(page) {
  let capturado = null;
  const aoRequisitar = (req) => {
    if (!capturado && req.method() === "POST" && req.url().startsWith(`${ORIGEM}/api/operate/`)) {
      capturado = req.allHeaders();
    }
  };
  page.on("request", aoRequisitar);
  try {
    await page.goto(URL_RELATORIOS, { waitUntil: "domcontentloaded" });
    const limite = Date.now() + ESPERA_DA_PAGINA_MS;
    while (Date.now() < limite) {
      if (capturado) return cabecalhosParaReusar(await capturado);
      if (ehPaginaDeLogin(page.url())) return null;
      await dormir(500);
    }
  } finally {
    page.off("request", aoRequisitar);
  }
  throw new Error("O portal não chamou a API de relatórios no tempo esperado (o layout pode ter mudado).");
}

/** A imagem pode mostrar o e-mail digitado: não fica guardada para sempre. */
async function apagarImagensAntigas(pasta) {
  const limite = Date.now() - DIAS_DE_GUARDA_DAS_IMAGENS * 24 * 60 * 60 * 1000;
  for (const nome of await readdir(pasta)) {
    if (!/^keeta-.*.png$/.test(nome)) continue;
    const caminho = path.join(pasta, nome);
    if ((await stat(caminho)).mtimeMs < limite) await unlink(caminho);
  }
}

async function salvarImagemDeDiagnostico(page, motivo) {
  try {
    const pasta = await pastaDeLogs();
    await apagarImagensAntigas(pasta);
    const arquivo = path.join(pasta, `keeta-${motivo}-${Date.now()}.png`);
    await page.screenshot({ path: arquivo });
    await logger.warn("Imagem de diagnóstico salva", { arquivo });
  } catch {
    // diagnóstico é conveniência
  }
}

/**
 * Tentativa de login por e-mail e senha. Os campos são localizados pelo que a tela mostra ("E-mail",
 * "Continuar", campo de senha). Se aparecer código de verificação ou captcha, o agente para e avisa:
 * nada disso ele consegue resolver.
 */
async function fazerLogin(page, credenciais) {
  try {
    await preencherLogin(page, credenciais);
  } catch (err) {
    if (err instanceof LoginNecessarioError) throw err;
    // A mensagem do Playwright traz o "call log" com o valor digitado: vai só redigida para o log.
    await logger.error("Falha ao preencher o login da Keeta", { detalhe: redigir(String(err.message).slice(0, 300)) });
    await salvarImagemDeDiagnostico(page, "login-falhou");
    throw new LoginNecessarioError("Não consegui preencher o login da Keeta (a tela pode ter mudado). Entre manualmente na máquina.");
  }
}

async function preencherLogin(page, { email, senha }) {
  await logger.info("Keeta pediu login: tentando entrar com e-mail e senha");
  const campoEmail = page.getByPlaceholder(/e-?mail/i).first();
  await campoEmail.waitFor({ state: "visible", timeout: 15000 });
  await campoEmail.fill(email);
  await page.getByRole("button", { name: /continuar|entrar|login/i }).first().click();

  const campoSenha = page.locator('input[type="password"]').first();
  try {
    await campoSenha.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    await salvarImagemDeDiagnostico(page, "login-sem-senha");
    throw new LoginNecessarioError("A Keeta não pediu a senha depois do e-mail (pediu código ou verificação). Entre manualmente na máquina.");
  }
  await campoSenha.fill(senha);
  await page.getByRole("button", { name: /entrar|continuar|login|confirmar/i }).first().click();

  try {
    await page.waitForURL((url) => !ehPaginaDeLogin(url.toString()), { timeout: ESPERA_DO_LOGIN_MS });
  } catch {
    await salvarImagemDeDiagnostico(page, "login-nao-concluiu");
    throw new LoginNecessarioError("O login na Keeta não concluiu (senha incorreta, código ou captcha). Entre manualmente na máquina.");
  }
  await logger.info("Login na Keeta concluído");
}

/** Garante uma sessão válida e devolve os cabeçalhos do app para as chamadas de API. */
export async function prepararSessao(page, { email, senha, podeLogar }) {
  let cabecalhos = await capturarCabecalhos(page);
  if (cabecalhos) return cabecalhos;

  if (!podeLogar) {
    throw new LoginNecessarioError("A Keeta pediu login e a configuração não tem e-mail e senha. Entre manualmente na máquina.");
  }
  await fazerLogin(page, { email, senha });
  cabecalhos = await capturarCabecalhos(page);
  if (!cabecalhos) throw new LoginNecessarioError("A Keeta voltou a pedir login logo depois de entrar.");
  return cabecalhos;
}

async function chamarApi(context, url, cabecalhos, corpo) {
  const resposta = await context.request.post(url, { headers: cabecalhos, data: corpo });
  if (resposta.status() === 401 || resposta.status() === 403) {
    throw new LoginNecessarioError(`A Keeta recusou a sessão (HTTP ${resposta.status()}). Entre manualmente na máquina.`);
  }
  if (!resposta.ok()) throw new Error(`A Keeta respondeu HTTP ${resposta.status()}.`);
  return resposta.json();
}

/** Pede o relatório do período, espera ficar pronto e baixa o .xlsx. */
export async function baixarRelatorio({ context, cabecalhos, shopId, inicio, fim }) {
  const pedidoEm = Date.now();
  const criado = await chamarApi(context, API.criar, cabecalhos, corpoDaExportacao({ shopId, inicio, fim }));
  if (criado.code !== 0) throw new Error(`A Keeta recusou o pedido do relatório (código ${criado.code}).`);
  await logger.info("Relatório pedido à Keeta", { inicio, fim });

  const limite = Date.now() + ESPERA_DO_RELATORIO_MS;
  while (Date.now() < limite) {
    await dormir(INTERVALO_DA_CONSULTA_MS);
    const lista = await chamarApi(context, API.listar, cabecalhos, { pageInfo: { pageNum: 1, pageSize: 20 } });
    const registro = escolherRegistro(lista?.data?.downloadRecordDTOList ?? [], { inicio, fim, depoisDe: pedidoEm });
    if (!registro) continue;

    if (!urlDeDownloadValida(registro.s3Url)) {
      throw new Error("O link do relatório não é https de um domínio da Keeta; recusei o download.");
    }
    // O link é assinado pelo próprio portal: baixa sem cookie nenhum, sem seguir redirecionamento, com teto de tamanho.
    const arquivo = await fetch(registro.s3Url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!arquivo.ok) throw new Error(`Não consegui baixar o relatório (HTTP ${arquivo.status}).`);
    if (Number(arquivo.headers.get("content-length") ?? 0) > TAMANHO_MAXIMO_DO_ARQUIVO) {
      throw new Error("O relatório da Keeta passa de 5 MB; recusei o download.");
    }
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    if (buffer.length > TAMANHO_MAXIMO_DO_ARQUIVO) throw new Error("O relatório da Keeta passa de 5 MB; recusei o arquivo.");
    if (buffer.length === 0 || !buffer.subarray(0, 2).equals(ASSINATURA_ZIP)) {
      throw new Error("O arquivo baixado da Keeta não parece um .xlsx.");
    }
    await logger.info("Relatório baixado", { arquivo: registro.fileName, bytes: buffer.length });
    return { buffer, nome: `${registro.fileName}.xlsx` };
  }
  throw new Error("A Keeta não terminou de gerar o relatório em 3 minutos.");
}
