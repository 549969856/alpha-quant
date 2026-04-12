// src/api/client.js
import axios from "axios";
import { useAuthStore } from "../store/authStore";

function normalizeBaseUrl(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function resolveBaseUrl() {
  const envUrl =
    normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL) ||
    normalizeBaseUrl(import.meta.env.VITE_API_URL);

  if (envUrl) return envUrl;
  if (import.meta.env.DEV) return "http://localhost:8000/api";
  return "/api";
}

export const api = axios.create({
  baseURL: resolveBaseUrl(),
  timeout: 30_000,
});

// Attach JWT on every request
api.interceptors.request.use(cfg => {
  const token = useAuthStore.getState().token;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Silent token refresh on 401
let refreshing = null;

api.interceptors.response.use(
  res => res,
  async err => {
    const orig    = err.config;
    const refresh = useAuthStore.getState().refresh;

    if (err.response?.status === 401 && refresh && !orig._retry) {
      orig._retry = true;

      if (!refreshing) {
        refreshing = axios
          .post(`${api.defaults.baseURL}/auth/token/refresh/`, { refresh })
          .then(r => {
            useAuthStore.getState().setTokens(r.data.access, r.data.refresh ?? refresh);
            return r.data.access;
          })
          .catch(() => {
            useAuthStore.getState().logout();
            window.location.href = "/login";
          })
          .finally(() => { refreshing = null; });
      }

      const newToken = await refreshing;
      if (newToken) {
        orig.headers.Authorization = `Bearer ${newToken}`;
        return api(orig);
      }
    }

    return Promise.reject(err);
  }
);

// Auth helpers used by login page
export const authApi = {
  login:    (u, p) => api.post("/auth/token/",  { username: u, password: p }),
  register: (u, p) => api.post("/auth/register/", { username: u, password: p }),
  me:       ()     => api.get("/auth/me/"),
};
