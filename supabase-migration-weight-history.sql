-- ============================================================
-- SmartDiet — Migração: histórico completo de peso
-- Cole no SQL Editor do Supabase e clique Run
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ============================================================
-- O que faz: remove a constraint UNIQUE (user_id, date) para que
-- o usuário possa registrar o peso quantas vezes quiser por dia.
-- Cada save passa a ser um registro novo (histórico real).
-- Pesos antigos NÃO são apagados.
-- ============================================================

-- O nome da constraint criada pelo CREATE TABLE foi
-- weight_logs_user_id_date_key (padrão do Postgres).
-- Esse DROP é seguro mesmo se a constraint já tiver sido removida.
ALTER TABLE weight_logs
  DROP CONSTRAINT IF EXISTS weight_logs_user_id_date_key;

-- Garante o índice por (user_id, date DESC) — usado nas queries de listagem
CREATE INDEX IF NOT EXISTS weight_logs_user_date_idx
  ON weight_logs (user_id, date DESC);

-- Novo índice por created_at — útil para o gráfico de evolução
-- (precisamos ordenar por timestamp completo, não só data, já que
-- agora podem existir vários registros no mesmo dia)
CREATE INDEX IF NOT EXISTS weight_logs_user_created_idx
  ON weight_logs (user_id, created_at DESC);

-- ============================================================
-- Verificação — deve mostrar 0 linhas (constraint removida)
-- ============================================================
SELECT conname
FROM pg_constraint
WHERE conrelid = 'weight_logs'::regclass
  AND contype = 'u'; -- unique constraints
