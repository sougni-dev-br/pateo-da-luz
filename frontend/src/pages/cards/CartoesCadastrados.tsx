import { CreditCard as IconeCartao, Pencil, Plus } from "lucide-react";
import type { CreditCard } from "../../api/client";
import { Button, EmptyState, StatusBadge } from "../../design-system";
import { rotuloDoFinal, tipoDoFinal } from "./cartoes-vinculados";
import "./cards-pagina.css";

type Props = {
  cartoes: CreditCard[];
  podeEditar: boolean;
  onNovo: () => void;
  onEditar: (cartao: CreditCard) => void;
  onAlternar: (cartao: CreditCard) => void;
};

export function CartoesCadastrados({ cartoes, podeEditar, onNovo, onEditar, onAlternar }: Props) {
  return (
    <section className="panel" aria-label="Cartões cadastrados">
      <div className="cartoes-secao-titulo">
        <div>
          <h2>Cartões cadastrados</h2>
          <p>Cada conta tem uma fatura por mês e pode reunir vários cartões (físico e virtual).</p>
        </div>
        {podeEditar && (
          <Button variant="secondary" size="sm" leadingIcon={<Plus size={15} />} onClick={onNovo}>
            Novo cartão
          </Button>
        )}
      </div>

      {cartoes.length === 0 ? (
        <EmptyState
          title="Nenhum cartão cadastrado"
          description="Cadastre a conta do cartão para que as compras no cartão gerem fatura."
          action={podeEditar ? <Button onClick={onNovo} leadingIcon={<Plus size={15} />}>Cadastrar cartão</Button> : undefined}
        />
      ) : (
        <div className="cartoes-contas">
          {cartoes.map((cartao) => {
            const finais = (cartao.finais ?? []).filter((final) => final.isActive);
            return (
              <article key={cartao.id} className={`cartoes-conta${cartao.isActive ? "" : " inativa"}`}>
                <header>
                  <span className="cartoes-conta-icone" aria-hidden><IconeCartao size={18} /></span>
                  <div>
                    <strong>{cartao.name}</strong>
                    <small>{cartao.bankName}</small>
                  </div>
                  <StatusBadge tone={cartao.isActive ? "success" : "neutral"}>{cartao.isActive ? "Ativo" : "Inativo"}</StatusBadge>
                </header>

                <ul className="cartoes-conta-finais" aria-label="Cartões da conta">
                  {finais.length > 0 ? (
                    finais.map((final) => (
                      <li key={final.id} className={final.kind === "VIRTUAL" ? "virtual" : "fisico"}>
                        <span>{tipoDoFinal(final.kind)}</span>
                        <code>{rotuloDoFinal(final).split("·· ")[1]}</code>
                      </li>
                    ))
                  ) : (
                    <li className="vazio">Final {cartao.last4Digits} — sem físico/virtual cadastrado</li>
                  )}
                </ul>

                <dl className="cartoes-conta-datas">
                  <div><dt>Fecha</dt><dd>dia {cartao.closingDay}</dd></div>
                  <div><dt>Vence</dt><dd>dia {cartao.dueDay}</dd></div>
                  <div><dt>Faturas</dt><dd>{cartao._count?.statements ?? 0}</dd></div>
                </dl>

                {podeEditar && (
                  <footer>
                    <Button size="sm" variant="secondary" leadingIcon={<Pencil size={14} />} onClick={() => onEditar(cartao)}>
                      {finais.length === 0 ? "Cadastrar cartões" : "Editar"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onAlternar(cartao)}>
                      {cartao.isActive ? "Inativar" : "Reativar"}
                    </Button>
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
