import { create } from "zustand";

export const useAuthStore = create((set) => ({
  user: null,
  rolePermissions: null,
  setUser: (user) => set({ user }),
  setRolePermissions: (rolePermissions) => set({ rolePermissions }),
  clearUser: () => set({ user: null, rolePermissions: null }),
}));
