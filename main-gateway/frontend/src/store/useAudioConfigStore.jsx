import { create } from "zustand";

export const useAudioConfigStore = create((set, get) => ({
  masterVolume: 80,
  zoneVolumes: {},
  priorityOffsets: {
    CRITICAL: 6,
    HIGH: 0,
    MEDIUM: -3,
    LOW: -6,
  },
  audioTypes: {
    CRITICAL: "siren",
    HIGH: "voice",
    MEDIUM: "beep",
    LOW: "voice",
  },
  isDirty: false,

  setMasterVolume: (v) => set({ masterVolume: v, isDirty: true }),
  setZoneVolume: (zone_id, v) =>
    set((s) => ({ zoneVolumes: { ...s.zoneVolumes, [zone_id]: v }, isDirty: true })),
  setPriorityOffset: (priority, v) =>
    set((s) => ({ priorityOffsets: { ...s.priorityOffsets, [priority]: v }, isDirty: true })),
  setAudioType: (priority, type) =>
    set((s) => ({ audioTypes: { ...s.audioTypes, [priority]: type }, isDirty: true })),
  markClean: () => set({ isDirty: false }),

  hydrate: (config) =>
    set({
      masterVolume: config.master_volume ?? 80,
      zoneVolumes: config.zone_volumes ?? {},
      priorityOffsets: config.priority_offsets ?? { CRITICAL: 6, HIGH: 0, MEDIUM: -3, LOW: -6 },
      audioTypes: config.audio_types ?? { CRITICAL: "siren", HIGH: "voice", MEDIUM: "beep", LOW: "voice" },
      isDirty: false,
    }),
}));
