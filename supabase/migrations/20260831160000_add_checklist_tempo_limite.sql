-- "Tempo limite": horário até o qual a rotina deveria estar concluída. Depois
-- dele, uma rotina ainda não finalizada passa a contar como "Atrasada" (novo
-- estado derivado no client — ver estado() em src/lib/g-check-store.tsx).
-- Opcional: rotina sem tempo_limite nunca fica atrasada.

alter table checklists add column if not exists tempo_limite time;
