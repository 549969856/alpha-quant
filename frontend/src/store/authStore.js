// src/store/authStore.js
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useAuthStore = create(
  persist(
    (set) => ({
      token:   null,
      refresh: null,
      user:    null,
      setTokens: (access, refresh) => set({ token: access, refresh }),
      setUser:   (user) => set({ user }),
      logout:    () => set({ token: null, refresh: null, user: null }),
    }),
    { name: "aq-auth" }
  )
);
