# G-Check-Felix

Versão do **G-Check** personalizada para o cliente **Felix Supermercado**.

G-Check é um app web de rotinas e checklists operacionais para supermercados:
Dashboard com visão de pendências, checklists concluídos e taxa de execução,
e gestão de rotinas (abertura de loja, reposição de gôndolas, controle de
validade, limpeza e fechamento) com abertura/conclusão de itens.

## Stack

- [TanStack Start](https://tanstack.com/start) + React 19 + Vite
- Tailwind CSS 4 + Radix UI
- Supabase (banco e migrations em `supabase/`)
- Runtime/gerenciador de pacotes: [Bun](https://bun.sh)

## Desenvolvimento

Requer [Bun](https://bun.sh) instalado.

```sh
bun install
bun run dev
```

Outros scripts:

| Comando            | Descrição                        |
| ------------------ | -------------------------------- |
| `bun run build`    | Build de produção                |
| `bun run preview`  | Servir o build localmente        |
| `bun run lint`     | ESLint                           |
| `bun run format`   | Prettier                         |

## Banco de dados

O setup completo está em `supabase/full_setup.sql` e as alterações
incrementais em `supabase/migrations/`.

## Configuração

Crie um arquivo `.env` com as variáveis do Supabase (URL e chave anon).
