import { api, ApiError } from "../api/client";

const ID_KEY = "remedios.deviceId";
const REGISTERED_KEY = "remedios.deviceRegistered";

/** Identificador estável deste aparelho, gerado localmente (vai junto de cada registro). */
export function deviceId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    localStorage.removeItem(REGISTERED_KEY);
  }
  return id;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Mac/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows" : "Navegador";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${browser} no ${os}` : os;
}

/** Registra o aparelho na conta (idempotente). Um aparelho desconectado ganha novo id. */
export async function ensureDeviceRegistered(userId: string): Promise<string> {
  const id = deviceId();
  if (localStorage.getItem(REGISTERED_KEY) === userId) return id;
  try {
    await api(`/me/devices/${id}`, { method: "PUT", body: { platform: "WEB", name: deviceName() } });
  } catch (error) {
    if (error instanceof ApiError && (error.code === "DEVICE_REVOKED" || error.code === "DEVICE_ID_IN_USE")) {
      localStorage.removeItem(ID_KEY);
      return ensureDeviceRegistered(userId);
    }
    throw error;
  }
  localStorage.setItem(REGISTERED_KEY, userId);
  return id;
}

export function forgetDeviceRegistration() {
  localStorage.removeItem(REGISTERED_KEY);
}
