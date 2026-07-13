import { callNoventaNoveShop } from "./noventa-nove-http-client.js";

// Upload de menu mínimo pra sandbox — 1 menu, 1 categoria, 1 item.
// Serve pra desbloquear a simulação de pedido no Ambiente sandbox do
// portal 99, que exige um APPitemID cadastrado antes de aceitar.
//
// IDs escolhidos são estáveis pra tudo poder ser re-executado sem
// duplicar (a 99 aparentemente sobrescreve o menu no upload).
//
// price em cents — 1500 = R$ 15,00.

const TEST_MENU_ID = "PATEO_TEST_MENU";
const TEST_CATEGORY_ID = "PATEO_TEST_CAT";
const TEST_ITEM_ID = "teste01";

type UploadMenuResponse = {
  task_id?: string;
  taskId?: string;
};

export async function seedTestMenu(
  deliveryStoreId: string,
  appShopId: string
): Promise<{ taskId: string | null; itemId: string }> {
  const body = {
    menus: [
      {
        app_menu_id: TEST_MENU_ID,
        menu_name: "Menu de Teste Pateo",
        app_category_ids: [TEST_CATEGORY_ID]
      }
    ],
    categories: [
      {
        app_category_id: TEST_CATEGORY_ID,
        category_name: "Testes",
        app_item_ids: [TEST_ITEM_ID]
      }
    ],
    items: [
      {
        app_item_id: TEST_ITEM_ID,
        item_name: "Item de Teste",
        short_desc: "Item usado para simulacao de pedido no sandbox",
        price: 1500,
        tax_rate: 0
      }
    ]
  };

  // O endpoint exige auth_token no body (não na query). callNoventaNoveShop
  // já injeta auth_token na query — pra este endpoint temos que passar no
  // body TAMBÉM. Solução: chamada custom via callNoventaNoveShop passando
  // o body inteiro; o auth_token duplicado na query não atrapalha.
  //
  // NOTA: o YAML mostra auth_token como campo required no body do request.
  // Mas o callNoventaNoveShop não expõe o token pro caller. Deixa eu
  // ajustar: passa o body diretamente e o handler HTTP genérico manda.

  const result = await callNoventaNoveShop<UploadMenuResponse>(
    deliveryStoreId,
    appShopId,
    {
      method: "POST",
      path: "/v1/item/item/upload",
      body
    }
  );

  const taskId = result.task_id ?? result.taskId ?? null;
  return { taskId, itemId: TEST_ITEM_ID };
}
