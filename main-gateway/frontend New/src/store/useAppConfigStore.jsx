import { create } from "zustand";
import { getLanguages, getZoneTypes, getAppSettings } from "../pages/audio_alerts/api/config.api";
import { LANGUAGES, ZONE_TYPES, PARAMETERS } from "../pages/audio_alerts/utils/constants";

export const useAppConfigStore = create((set, get) => ({
  languages:  LANGUAGES,   // static fallback until backend responds
  zone_types: ZONE_TYPES,
  parameters: PARAMETERS,
  _fetched: false,         // prevents redundant fetches

  setAppConfig: (data) => set((s) => ({
    languages:  data.languages  ?? s.languages,
    zone_types: data.zone_types ?? s.zone_types,
    parameters: data.parameters ?? s.parameters,
  })),

  /** Fetch languages, zone-types, and parameters from the backend.
   *  Falls back to static constants if any request fails. */
  fetchConfigFromBackend: async () => {
    if (get()._fetched) return;
    try {
      const [langRes, ztRes, settingsRes] = await Promise.all([
        getLanguages(),
        getZoneTypes(),
        getAppSettings(),
      ]);
      set({
        languages:  langRes.data       ?? langRes       ?? LANGUAGES,
        zone_types: ztRes.data         ?? ztRes         ?? ZONE_TYPES,
        parameters: settingsRes.data?.parameters        ?? PARAMETERS,
        _fetched: true,
      });
    } catch (_) {
      // non-critical — keep static fallbacks
      set({ _fetched: true });
    }
  },

  /** Force-refresh languages from backend (bypasses _fetched cache). */
  refreshLanguages: async () => {
    try {
      const res = await getLanguages();
      if (res.ok && res.data) {
        set({ languages: res.data });
      }
    } catch (_) {}
  },
}));
