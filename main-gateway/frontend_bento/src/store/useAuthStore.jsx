import { create } from "zustand";
import { targetUrl } from "../config";

export const useAuthStore = create((set) => ({
  user: null,
  rolePermissions: null,
  setUser: (user) => set({ user }),
  setRolePermissions: (rolePermissions) => set({ rolePermissions }),
  clearUser: () => set({ user: null, rolePermissions: null }),
  logout: async () => {
    try {
      await fetch(`${targetUrl}/logout`, { method: "POST", credentials: "include" });
    } catch (err) {
      console.error(err);
    }
    set({ user: null, rolePermissions: null });
    window.location.href = "/";
  },
}));
