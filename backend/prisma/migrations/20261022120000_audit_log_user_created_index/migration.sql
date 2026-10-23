-- Histórico de acessos (Configurações → Usuários → Sessões) filtra por usuário e ordena por data.
CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt" DESC);
