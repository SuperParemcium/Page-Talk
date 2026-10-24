declare global {
  interface Window {
    /**
     * 预留的运行时 API 基地址。
     * 桌面壳（Tauri / Electron）可以继续使用同源的本地服务；
     * 移动端或远程部署时，可在 index.html 注入远程服务地址。
     */
    __PAGE_TALK_API_BASE__?: string;
  }
}

const configuredBase =
  typeof window !== "undefined" ? window.__PAGE_TALK_API_BASE__ : undefined;
const buildBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";

export const API_BASE = String(configuredBase ?? buildBase).replace(/\/+$/, "");

export function apiUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}
