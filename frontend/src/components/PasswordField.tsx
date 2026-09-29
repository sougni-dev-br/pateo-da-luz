import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent, Ref } from "react";

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled = false,
  required = false,
  name,
  inputRef,
  warnCapsLock = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Avisa quando o Caps Lock está ligado — a causa mais comum de "senha errada". */
  warnCapsLock?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    if (warnCapsLock) setCapsLock(event.getModifierState("CapsLock"));
  }

  return (
    <label className="ds-text-field">
      <span className="ds-text-field-label">{label}</span>
      <span className="password-field">
        <input
          ref={inputRef}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          disabled={disabled}
          required={required}
          autoComplete={autoComplete}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" disabled={disabled} onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {capsLock && (
        <small className="ds-text-field-helper password-capslock" role="status">
          Caps Lock está ligado
        </small>
      )}
    </label>
  );
}

export function passwordPolicyMessage(password: string) {
  if (!password) return "Mínimo 8 caracteres, com pelo menos 1 letra e 1 número.";
  const ok = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
  return ok ? "Senha atende à política mínima." : "Use no mínimo 8 caracteres, 1 letra e 1 número.";
}

export function isPasswordValid(password: string) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
