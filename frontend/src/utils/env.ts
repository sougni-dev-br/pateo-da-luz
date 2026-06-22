// Vite sets PROD=true on `vite build` and DEV=true on `vite dev`.
// Set VITE_APP_ENV="staging" in .env.staging for a staging build.
const appMode = import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE;

export const isProduction = import.meta.env.PROD && appMode !== "staging" && appMode !== "homologacao";
export const isStaging = appMode === "staging" || appMode === "homologacao";
export const isLocal = import.meta.env.DEV;
export const isDevelopment = isLocal || isStaging;
