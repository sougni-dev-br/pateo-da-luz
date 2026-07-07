import { useState } from "react";
import { AppUser, changeOwnPassword } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { isPasswordValid, PasswordField, passwordPolicyMessage } from "../components/PasswordField";
import { Button, LoginShell } from "../design-system";

export function ForcedPasswordChange({ user, onChanged }: { user: AppUser; onChanged: (user: AppUser) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { notice, setNotice } = useNotice(7000);
  const matches = newPassword.length > 0 && newPassword === confirmPassword;

  async function submit() {
    if (!isPasswordValid(newPassword)) {
      setNotice({ tone: "error", message: "A nova senha deve ter no mínimo 8 caracteres, 1 letra e 1 número." });
      return;
    }
    if (!matches) {
      setNotice({ tone: "error", message: "As senhas não conferem." });
      return;
    }
    try {
      await changeOwnPassword({ currentPassword, newPassword });
      setNotice({ tone: "success", message: "Senha alterada com sucesso." });
      onChanged({ ...user, mustChangePassword: false });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Falha ao alterar senha." });
    }
  }

  return (
    <LoginShell
      formTitle="Alteração obrigatória de senha"
      formSubtitle="Você precisa alterar sua senha antes de continuar."
    >
      <Notice notice={notice} />
      <PasswordField label="Senha temporária/atual" value={currentPassword} onChange={setCurrentPassword} />
      <div>
        <PasswordField label="Nova senha" value={newPassword} onChange={setNewPassword} />
        <div className={`password-hint ${isPasswordValid(newPassword) ? "ok" : "error"}`}>
          {passwordPolicyMessage(newPassword)}
        </div>
      </div>
      <div>
        <PasswordField label="Confirmar nova senha" value={confirmPassword} onChange={setConfirmPassword} />
        <div className={`password-hint ${matches ? "ok" : "error"}`}>
          {matches ? "Senhas iguais." : "Senhas diferentes."}
        </div>
      </div>
      <Button type="button" onClick={submit}>
        Alterar senha e continuar
      </Button>
    </LoginShell>
  );
}
