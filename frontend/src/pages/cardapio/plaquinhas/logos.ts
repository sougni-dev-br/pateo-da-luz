import type { PlateTheme } from "../../../api/client";
import logoDourado from "./assets/logo-horizontal-dourado.png";
import logoDouradoEscuro from "./assets/logo-horizontal-dourado-escuro.png";
import logoVinho from "./assets/logo-horizontal-vinho.png";

// No fundo branco o dourado do logo some; ali vai um tom mais fechado do mesmo ouro.
export const LOGO_DO_TEMA: Record<PlateTheme, string> = { wine: logoVinho, gold: logoDourado, white: logoDouradoEscuro };
