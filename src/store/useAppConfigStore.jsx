import { create } from "zustand";
import { LANGUAGES, ZONE_TYPES, PARAMETERS } from "../pages/audio_alerts/utils/constants";

export const useAppConfigStore = create((set) => ({
  languages:  LANGUAGES,
  zone_types: ZONE_TYPES,
  parameters: PARAMETERS,
  setAppConfig: (data) => set((s) => ({
    languages:  data.languages  ?? s.languages,
    zone_types: data.zone_types ?? s.zone_types,
    parameters: data.parameters ?? s.parameters,
  })),
}));
