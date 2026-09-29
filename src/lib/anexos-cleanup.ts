import { createClient } from "@supabase/supabase-js";

/**
 * Limpeza de anexos órfãos/expirados no bucket `checklist-fotos`.
 *
 * Roda fora do app (script local + workflow do GitHub Actions), por isso cria
 * seu próprio client em vez de importar `@/lib/supabase` (que depende de
 * `import.meta.env`, só populado dentro do Vite).
 */
const BUCKET_ANEXOS = "checklist-fotos";
// 30 dias estourava a cota de 1GB do plano free (vídeo é ~91% do bucket,
// ritmo de ~78MB/dia) — 7 dias mantém uso na faixa de ~700MB com folga.
const RETENCAO_DIAS_PADRAO = 7;

interface AnexoMinimo {
  url: string;
}

export interface ResultadoLimpezaAnexos {
  totalObjetos: number;
  objetosValidos: number;
  objetosRemovidos: number;
  bytesLiberados: number;
  erros: string[];
}

/** Extrai o caminho dentro do bucket a partir da URL pública salva no jsonb. */
function caminhoDaUrl(url: string): string | null {
  const marcador = `/object/public/${BUCKET_ANEXOS}/`;
  const idx = url.indexOf(marcador);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marcador.length));
}

export async function limparAnexos(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Dias além dos quais os anexos de uma execução já podem ser apagados. */
  retencaoDias?: number;
  /** Só lista o que seria removido, sem apagar de verdade. */
  dryRun?: boolean;
}): Promise<ResultadoLimpezaAnexos> {
  const retencaoDias = opts.retencaoDias ?? RETENCAO_DIAS_PADRAO;
  const supabase = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const caminhosValidos = new Set<string>();
  const erros: string[] = [];

  // 1) Anexos correntes (itens de hoje) — sempre válidos.
  {
    const { data, error } = await supabase.from("checklist_items").select("anexos");
    if (error) throw new Error(`Falha ao ler checklist_items: ${error.message}`);
    for (const row of data ?? []) {
      const anexos = (row as { anexos: AnexoMinimo[] | null }).anexos ?? [];
      for (const anexo of anexos) {
        const caminho = caminhoDaUrl(anexo.url);
        if (caminho) caminhosValidos.add(caminho);
      }
    }
  }

  // 2) Execuções dentro da janela de retenção — válidos. Fora da janela, os
  //    anexos dessa execução NÃO entram no conjunto válido (serão apagados).
  const corteISO = new Date(Date.now() - retencaoDias * 86_400_000).toISOString().slice(0, 10);
  {
    const { data, error } = await supabase
      .from("checklist_execucoes")
      .select("itens")
      .gte("data", corteISO);
    if (error) throw new Error(`Falha ao ler checklist_execucoes: ${error.message}`);
    for (const row of data ?? []) {
      const itens = (row as { itens: { anexos?: AnexoMinimo[] }[] | null }).itens ?? [];
      for (const item of itens) {
        for (const anexo of item.anexos ?? []) {
          const caminho = caminhoDaUrl(anexo.url);
          if (caminho) caminhosValidos.add(caminho);
        }
      }
    }
  }

  // 3) Uma pasta por checklist na raiz do bucket — lista cada uma e compara.
  const { data: pastas, error: pastasError } = await supabase.storage
    .from(BUCKET_ANEXOS)
    .list("", { limit: 1000 });
  if (pastasError) throw new Error(`Falha ao listar bucket: ${pastasError.message}`);

  const aRemover: string[] = [];
  let totalObjetos = 0;
  let bytesLiberados = 0;

  for (const pasta of pastas ?? []) {
    // Entradas de arquivo real na raiz têm `id` preenchido; pseudo-pastas têm
    // `id: null`. Só nos interessam as pastas (uma por checklist).
    if (pasta.id !== null) continue;

    const limite = 1000;
    let offset = 0;
    for (;;) {
      const { data: arquivos, error: listaError } = await supabase.storage
        .from(BUCKET_ANEXOS)
        .list(pasta.name, { limit: limite, offset });
      if (listaError) {
        erros.push(`Falha ao listar pasta "${pasta.name}": ${listaError.message}`);
        break;
      }
      if (!arquivos || arquivos.length === 0) break;

      for (const arquivo of arquivos) {
        if (arquivo.id === null) continue; // subpasta inesperada — ignora
        totalObjetos++;
        const caminho = `${pasta.name}/${arquivo.name}`;
        if (!caminhosValidos.has(caminho)) {
          aRemover.push(caminho);
          bytesLiberados += Number(arquivo.metadata?.["size"] ?? 0);
        }
      }

      if (arquivos.length < limite) break;
      offset += limite;
    }
  }

  let objetosRemovidos = 0;
  if (opts.dryRun) {
    objetosRemovidos = aRemover.length;
  } else {
    const tamanhoLote = 100;
    for (let i = 0; i < aRemover.length; i += tamanhoLote) {
      const lote = aRemover.slice(i, i + tamanhoLote);
      const { error } = await supabase.storage.from(BUCKET_ANEXOS).remove(lote);
      if (error) {
        erros.push(`Falha ao remover lote de ${lote.length} arquivo(s): ${error.message}`);
        continue;
      }
      objetosRemovidos += lote.length;
    }
  }

  return {
    totalObjetos,
    objetosValidos: caminhosValidos.size,
    objetosRemovidos,
    bytesLiberados,
    erros,
  };
}
