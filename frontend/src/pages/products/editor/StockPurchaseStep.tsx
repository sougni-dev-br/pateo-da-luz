import { EmbalagensDeCompra } from "../EmbalagensDeCompra";
import type { StepProps } from "./types";

export function StockPurchaseStep({ editor }: StepProps) {
  const { form, setForm, opcoes, rascunhoOrigem, setRascunhoOrigem, rascunhoFator, setRascunhoFator } = editor;
  const unidades = opcoes.units;

  return (
    <section className="form-section" aria-labelledby="passo-estoque">
      <div className="form-section-header">
        <h3 id="passo-estoque">Estoque e compra</h3>
        <span>Tudo opcional: preencha o que ajuda a contar e a repor.</span>
      </div>
      <div className="form-grid">
        <label>
          Unidade de estoque
          <select value={form.stockUnit} onChange={(event) => setForm((atual) => ({ ...atual, stockUnit: event.target.value }))}>
            <option value="">Usar a unidade do item</option>
            {unidades.map((unidade) => <option key={unidade.id} value={unidade.code}>{unidade.code} - {unidade.name}</option>)}
          </select>
        </label>
        <label>
          Unidade de compra
          <select value={form.purchaseUnit} onChange={(event) => setForm((atual) => ({ ...atual, purchaseUnit: event.target.value }))}>
            <option value="">Usar a unidade do item</option>
            {unidades.map((unidade) => <option key={unidade.id} value={unidade.code}>{unidade.code} - {unidade.name}</option>)}
          </select>
        </label>
        <label>
          Fornecedor principal
          <select
            value={form.fornecedorPrincipalId}
            onChange={(event) => setForm((atual) => ({ ...atual, fornecedorPrincipalId: event.target.value }))}
          >
            <option value="">Sem fornecedor principal</option>
            {opcoes.suppliers.map((fornecedor) => <option key={fornecedor.id} value={fornecedor.id}>{fornecedor.name}</option>)}
          </select>
        </label>
        <label>
          Estoque mínimo
          <input inputMode="decimal" value={form.estoqueMinimo} onChange={(event) => setForm((atual) => ({ ...atual, estoqueMinimo: event.target.value }))} />
        </label>
        <label>
          Estoque ideal
          <input inputMode="decimal" value={form.estoqueIdeal} onChange={(event) => setForm((atual) => ({ ...atual, estoqueIdeal: event.target.value }))} />
        </label>
        <label>
          Prazo de entrega (dias)
          <input type="number" min="0" inputMode="numeric" value={form.leadTimeCompraDias} onChange={(event) => setForm((atual) => ({ ...atual, leadTimeCompraDias: event.target.value }))} />
        </label>
      </div>
      <EmbalagensDeCompra
        unidades={unidades}
        unidadeDeContagem={form.stockUnit || form.unit}
        conversoes={form.unitConversions}
        origem={rascunhoOrigem}
        fator={rascunhoFator}
        onOrigem={setRascunhoOrigem}
        onFator={setRascunhoFator}
        onAdicionar={(conversao) => {
          setForm((atual) => ({ ...atual, unitConversions: [...atual.unitConversions, conversao] }));
          setRascunhoOrigem("");
          setRascunhoFator("");
        }}
        onRemover={(indice) =>
          setForm((atual) => ({ ...atual, unitConversions: atual.unitConversions.filter((_, i) => i !== indice) }))
        }
      />
      <div className="form-grid">
        <label className="span-2">
          Observação de logística
          <input value={form.logisticsNotes} onChange={(event) => setForm((atual) => ({ ...atual, logisticsNotes: event.target.value }))} />
        </label>
        <label>
          Observação de conversão
          <input value={form.conversionNotes} onChange={(event) => setForm((atual) => ({ ...atual, conversionNotes: event.target.value }))} />
        </label>
      </div>
      <div className="form-section-header" style={{ marginTop: 16 }}>
        <h3>Onde fica</h3>
        <span>Ajuda a ordenar a contagem dentro do setor.</span>
      </div>
      <div className="form-grid">
        <label>Localização<input value={form.storageLocation} onChange={(event) => setForm((atual) => ({ ...atual, storageLocation: event.target.value }))} /></label>
        <label>Corredor<input value={form.storageCorridor} onChange={(event) => setForm((atual) => ({ ...atual, storageCorridor: event.target.value }))} /></label>
        <label>Prateleira<input value={form.storageShelf} onChange={(event) => setForm((atual) => ({ ...atual, storageShelf: event.target.value }))} /></label>
        <label>Posição<input value={form.storagePosition} onChange={(event) => setForm((atual) => ({ ...atual, storagePosition: event.target.value }))} /></label>
        <label className="span-2">
          Observação da localização
          <input value={form.storageNotes} onChange={(event) => setForm((atual) => ({ ...atual, storageNotes: event.target.value }))} />
        </label>
      </div>
    </section>
  );
}
