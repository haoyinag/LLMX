import { create } from "zustand";

interface ModelState {
  modelId: string;
  setModelId: (modelId: string) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  modelId: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "deepseek-chat",
  setModelId: (modelId) => set({ modelId })
}));
