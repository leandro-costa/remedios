/** Erro de negócio devolvido pela API ({ code, message, details }). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Sem conexão com a API (rede ausente ou servidor fora do ar). */
export class OfflineError extends Error {
  constructor() {
    super("Sem conexão com o servidor.");
  }
}

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;

export function setTokenProvider(provider: TokenProvider) {
  tokenProvider = provider;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL("/api" + path, location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  const token = await tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new OfflineError();
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new OfflineError();
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(401, "UNAUTHORIZED", "Sua sessão expirou. Entre novamente.", null);
    }
    const message =
      data?.message ??
      (data?.violations?.[0]?.message as string | undefined) ??
      `Erro ${response.status} ao falar com o servidor.`;
    throw new ApiError(response.status, data?.code ?? "HTTP_" + response.status, message, data?.details ?? null);
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof OfflineError) return error.message;
  return "Algo deu errado. Tente novamente.";
}
