import type { useProductEditor } from "./useProductEditor";

export type Editor = ReturnType<typeof useProductEditor>;
export type StepProps = { editor: Editor; canCreateMasterData: boolean };
