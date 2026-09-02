import { getRequest } from "@tanstack/react-start/server";

/**
 * Lê uma variável de ambiente do servidor de forma portátil entre runtimes.
 *
 * - Local (`vite dev` / `vite build`): o plugin `serverEnvFromDotenv` do
 *   vite.config.ts copia o `.env` para `process.env`, então a leitura direta
 *   resolve.
 * - Cloudflare Workers (produção): `process.env` chega vazio. As secrets/vars
 *   vêm no contexto de runtime do request — no srvx/Nitro v3 isso é
 *   `request.runtime.cloudflare.env` — ou pelo módulo virtual
 *   `cloudflare:workers`.
 *
 * Nunca expõe valores: só devolve a string pedida.
 */
export async function getServerEnv(key: string): Promise<string | undefined> {
  // 1) process.env — Node local, ou CF já populando process.env.
  const fromProcess = typeof process !== "undefined" && process.env ? process.env[key] : undefined;
  if (fromProcess) return fromProcess;

  // 2) Contexto de runtime do request (Cloudflare via srvx / Nitro v3).
  try {
    const req = getRequest() as Request & {
      runtime?: { cloudflare?: { env?: Record<string, unknown> } };
    };
    const val = req?.runtime?.cloudflare?.env?.[key];
    if (typeof val === "string" && val) return val;
  } catch {
    // getRequest() lança fora de um contexto de request — ignora.
  }

  // 3) Módulo virtual do Cloudflare Workers (externalizado no build da CF).
  // Especificador computado de propósito: evita que TS/Vite tentem resolver
  // "cloudflare:workers" fora do runtime da Cloudflare.
  try {
    const specifier = ["cloudflare", "workers"].join(":");
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      env?: Record<string, unknown>;
    };
    const val = mod?.env?.[key];
    if (typeof val === "string" && val) return val;
  } catch {
    // Não é runtime Cloudflare — ignora.
  }

  return undefined;
}
