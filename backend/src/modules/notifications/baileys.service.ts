import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  initAuthCreds,
  BufferJSON,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type WASocket
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import { prisma } from "../../config/database.js";

// Integração WhatsApp usando Baileys como biblioteca embarcada no backend.
// Substitui o OpenWA HTTP: uma conexão WhatsApp por processo, auth persistido
// no Postgres via WhatsAppAuthState. Ponto de entrada: initBaileys() no boot,
// sendText() a cada envio, getStatus()/getQrDataUrl() para o admin.

const SESSION_NAME = process.env.WHATSAPP_SESSION_NAME?.trim() || "pateo";
const CATEGORY_CREDS = "creds";
const CATEGORY_KEYS = "keys";
const CREDS_KEY = "main";

// Baileys usa um SignalKeyStore com o formato `{ [type]: { [id]: value } }`.
// Persistimos cada (type, id) como uma linha da tabela WhatsAppAuthState,
// e o valor JSON-serializado usa o `BufferJSON` do próprio Baileys — que
// converte `Buffer` para `{ type: "Buffer", data: [...] }` e volta.

type State = {
  socket: WASocket | null;
  status: "starting" | "waiting_qr" | "connecting" | "open" | "closed" | "logged_out";
  lastQr: string | null; // string do QR bruto (não a imagem)
  lastError: string | null;
  startedAt: Date | null;
  // Sentinela de logout em andamento. Enquanto verdadeiro, o handler de
  // connection.update NÃO tenta auto-reconectar (senão o reconnect
  // corre com o wipe e a sessão volta a "open" sem re-scan). É zerado
  // depois do initBaileys() de forceLogout() acionar um novo socket.
  logoutInFlight: boolean;
};

const state: State = {
  socket: null,
  status: "closed",
  lastQr: null,
  lastError: null,
  startedAt: null,
  logoutInFlight: false
};

// ─── Auth state adapter (Postgres) ─────────────────────────────────────────

async function readAuthState(): Promise<AuthenticationState & {
  saveCreds: () => Promise<void>;
}> {
  // Lê creds (1 linha) e monta o keystore lazy.
  const credsRow = await prisma.whatsAppAuthState.findUnique({
    where: {
      sessionName_category_key: {
        sessionName: SESSION_NAME,
        category: CATEGORY_CREDS,
        key: CREDS_KEY
      }
    }
  });

  const creds: AuthenticationCreds = credsRow
    ? (JSON.parse(credsRow.value, BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  const saveCreds = async () => {
    const value = JSON.stringify(creds, BufferJSON.replacer);
    await prisma.whatsAppAuthState.upsert({
      where: {
        sessionName_category_key: {
          sessionName: SESSION_NAME,
          category: CATEGORY_CREDS,
          key: CREDS_KEY
        }
      },
      create: {
        sessionName: SESSION_NAME,
        category: CATEGORY_CREDS,
        key: CREDS_KEY,
        value
      },
      update: { value }
    });
  };

  return {
    creds,
    keys: {
      // Baileys chama get() com um array de ids para um tipo dado.
      // Retornamos o mapa {id: value}; ids ausentes ficam com undefined,
      // que o Baileys interpreta corretamente.
      async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
        if (ids.length === 0) return {} as { [id: string]: SignalDataTypeMap[T] };
        const rows = await prisma.whatsAppAuthState.findMany({
          where: {
            sessionName: SESSION_NAME,
            category: CATEGORY_KEYS,
            key: { in: ids.map((id) => `${type}-${id}`) }
          },
          select: { key: true, value: true }
        });
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const row of rows) {
          const id = row.key.slice(type.length + 1); // remove "type-" prefix
          result[id] = JSON.parse(row.value, BufferJSON.reviver);
        }
        return result;
      },

      // set() vem como um objeto `{ type: { id: value | null } }`.
      // null significa "apague essa key". Persistimos em transação para
      // evitar estado intermediário.
      async set(data) {
        const ops: Array<Promise<unknown>> = [];
        for (const type of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          const byId = data[type];
          if (!byId) continue;
          for (const [id, value] of Object.entries(byId)) {
            const key = `${type}-${id}`;
            if (value === null || value === undefined) {
              ops.push(
                prisma.whatsAppAuthState
                  .delete({
                    where: {
                      sessionName_category_key: {
                        sessionName: SESSION_NAME,
                        category: CATEGORY_KEYS,
                        key
                      }
                    }
                  })
                  .catch(() => undefined) // ignora "not found"
              );
            } else {
              const serialized = JSON.stringify(value, BufferJSON.replacer);
              ops.push(
                prisma.whatsAppAuthState.upsert({
                  where: {
                    sessionName_category_key: {
                      sessionName: SESSION_NAME,
                      category: CATEGORY_KEYS,
                      key
                    }
                  },
                  create: {
                    sessionName: SESSION_NAME,
                    category: CATEGORY_KEYS,
                    key,
                    value: serialized
                  },
                  update: { value: serialized }
                })
              );
            }
          }
        }
        await Promise.all(ops);
      }
    },
    saveCreds
  };
}

// Limpa todo o estado da sessão. Usado quando o WhatsApp faz logout do
// dispositivo (Boom com DisconnectReason.loggedOut) — sem isso, os creds
// inválidos ficam gravados e o próximo initBaileys() tenta reconectar em
// loop. Depois disso, próximo boot vai gerar QR novo.
async function wipeAuthState(): Promise<void> {
  await prisma.whatsAppAuthState.deleteMany({ where: { sessionName: SESSION_NAME } });
  state.lastQr = null;
  console.warn(`[baileys] auth state limpo (sessão '${SESSION_NAME}')`);
}

// Força logout: desliga o dispositivo linkado no WhatsApp (para não ficar
// aparecendo na lista de Aparelhos conectados do celular), limpa auth do
// Postgres e reinicia o Baileys para gerar um QR novo.
// Chamada pelo admin via UI quando quer trocar de dispositivo/sessão.
export async function forceLogout(): Promise<void> {
  // Ativa o freio: o handler de connection.update do socket atual não
  // vai tentar auto-reconectar enquanto isto estiver true. Sem isso,
  // sock.logout() dispara "close" → auto-reconnect → race com o wipe.
  state.logoutInFlight = true;
  const currentSocket = state.socket;
  if (currentSocket) {
    try {
      await currentSocket.logout();
    } catch (error) {
      console.warn("[baileys] sock.logout() falhou (segue com wipe):", error);
    }
  }
  // Garantia extra: se o socket ainda estiver aberto, fecha manualmente.
  try {
    currentSocket?.end?.(undefined as unknown as Error);
  } catch { /* noop */ }
  state.socket = null;
  await wipeAuthState();
  starting = null;
  // Solta o freio ANTES de inicializar — a próxima instância precisa
  // reconectar e emitir QR normalmente.
  state.logoutInFlight = false;
  await initBaileys();
}

// ─── Inicialização + reconexão ─────────────────────────────────────────────

let starting: Promise<void> | null = null;

export async function initBaileys(): Promise<void> {
  // Evita corridas: se já iniciou uma tentativa, aguarda ela.
  if (starting) return starting;
  starting = (async () => {
    try {
      state.status = "starting";
      state.lastError = null;
      state.startedAt = new Date();

      const auth = await readAuthState();
      const sock = makeWASocket({
        auth,
        // Silencia o logger interno — Baileys usa pino por default e faz
        // bastante ruído em produção. Se um dia precisar debugar, trocar
        // para pino({ level: "debug" }).
        logger: makePinoStub(),
        printQRInTerminal: false,
        // Marca o dispositivo linkado com nome legível na lista de
        // "Aparelhos conectados" do WhatsApp.
        browser: ["Pateo da Luz ERP", "Chrome", "1.0"],
        // Não tenta buscar histórico do WhatsApp — só queremos ENVIAR.
        // Reduz muito o consumo de memória e evita hidratação lenta ao subir.
        syncFullHistory: false,
        markOnlineOnConnect: false
      });

      state.socket = sock;

      sock.ev.on("creds.update", auth.saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          state.lastQr = qr;
          state.status = "waiting_qr";
          console.info(`[baileys] QR disponível (sessão '${SESSION_NAME}') — escaneie via /notifications/whatsapp/qr`);
        }

        if (connection === "connecting") {
          state.status = "connecting";
        } else if (connection === "open") {
          state.status = "open";
          state.lastQr = null;
          state.lastError = null;
          console.info(`[baileys] conectado (sessão '${SESSION_NAME}')`);
        } else if (connection === "close") {
          state.status = "closed";
          const err = lastDisconnect?.error as Boom | undefined;
          const statusCode = err?.output?.statusCode;
          state.lastError = err?.message ?? "connection closed";

          // Se o logout foi acionado pelo admin (forceLogout), NÃO auto-
          // reconectar: o próprio forceLogout vai chamar initBaileys()
          // depois de wipar creds. Reconectar aqui seria uma race com o wipe.
          if (state.logoutInFlight) {
            console.info("[baileys] close durante forceLogout — ignorando auto-reconnect");
            return;
          }

          // Baileys documenta que loggedOut significa "o telefone
          // desassociou o dispositivo" — creds atuais são inválidos, tem
          // que fazer QR novo. Qualquer outro código = reconexão automática.
          if (statusCode === DisconnectReason.loggedOut) {
            state.status = "logged_out";
            console.warn(`[baileys] deslogado remoto — apagando auth e aguardando novo QR`);
            wipeAuthState()
              .then(() => {
                starting = null;
                return initBaileys();
              })
              .catch((e) => console.error("[baileys] falha ao reiniciar após logout", e));
          } else {
            console.warn(`[baileys] desconectado (${statusCode ?? "?"}): ${state.lastError} — reconectando em 5s`);
            setTimeout(() => {
              starting = null;
              initBaileys().catch((e) => console.error("[baileys] reconexão falhou", e));
            }, 5000);
          }
        }
      });
    } catch (error) {
      state.status = "closed";
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error("[baileys] initBaileys falhou:", state.lastError);
    }
  })();
  return starting;
}

// ─── API pública ───────────────────────────────────────────────────────────

export function getStatus(): {
  status: State["status"];
  sessionName: string;
  hasQr: boolean;
  lastError: string | null;
  startedAt: string | null;
} {
  return {
    status: state.status,
    sessionName: SESSION_NAME,
    hasQr: state.lastQr !== null,
    lastError: state.lastError,
    startedAt: state.startedAt?.toISOString() ?? null
  };
}

// Retorna o QR atual como data-URL PNG (para exibir em <img src="...">).
// null se não há QR ativo (sessão já pareada ou ainda não inicializou).
export async function getQrDataUrl(): Promise<string | null> {
  if (!state.lastQr) return null;
  return qrcode.toDataURL(state.lastQr, { width: 320, margin: 2 });
}

// Envia texto. `to` pode ser número (55XXX...) ou JID (`...@s.whatsapp.net`).
// Baileys usa `@s.whatsapp.net` para chats individuais, não `@c.us` (do
// whatsapp-web.js). Normalizamos aqui.
export function normalizeJid(to: string): string {
  const trimmed = to.trim();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; skipped?: boolean; reason: string };

export async function sendText(to: string, text: string): Promise<SendResult> {
  if (state.status !== "open" || !state.socket) {
    return {
      ok: false,
      skipped: true,
      reason: `WhatsApp não conectado (status=${state.status}). Verifique /notifications/whatsapp/status.`
    };
  }
  try {
    const jid = normalizeJid(to);
    const msg = await state.socket.sendMessage(jid, { text });
    const id = msg?.key?.id ?? null;
    console.info(`[baileys] enviado para ${jid} (msg=${id ?? "?"})`);
    return { ok: true, messageId: id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[baileys] falha ao enviar: ${message}`);
    return { ok: false, reason: message };
  }
}

// ─── Pino stub ─────────────────────────────────────────────────────────────
// Baileys exige um logger com API do pino. Não queremos a saída ruidosa
// dele por default, então implementamos um stub silencioso. Bem barato.
function makePinoStub(): any {
  const noop = () => undefined;
  const stub = {
    level: "silent",
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: () => stub
  };
  return stub;
}
