-- Strict insertion order; provider timestamps have one-second resolution and can tie.
ALTER TABLE messages
  ADD COLUMN seq bigserial,
  ADD COLUMN claim_id text;
CREATE INDEX messages_conversation_seq ON messages (tenant_id, conversation_id, seq);
GRANT USAGE ON SEQUENCE messages_seq_seq TO wa_app;

-- Caller credentials (n8n connector, owner inbox). Only the SHA-256 of the token is stored.
CREATE TABLE api_credentials (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE,
  label text NOT NULL,
  actor_types text[] NOT NULL CHECK (actor_types <@ ARRAY['user', 'agent', 'system']),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_credentials
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE FUNCTION authenticate_api_token(p_token_sha256 text)
RETURNS TABLE (credential_id text, tenant_id text, actor_types text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.tenant_id, c.actor_types
  FROM api_credentials c
  JOIN tenants t ON t.id = c.tenant_id
  WHERE c.token_sha256 = p_token_sha256 AND c.revoked_at IS NULL AND t.status = 'active'
$$;
REVOKE ALL ON FUNCTION authenticate_api_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authenticate_api_token(text) TO wa_app;

-- Written and committed before the provider call. A row left in_flight means the outcome is unknown,
-- so a retry with the same key is refused instead of risking a second message.
CREATE TABLE send_attempts (
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  conversation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_flight', 'sent', 'rejected')),
  message_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);
ALTER TABLE send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON send_attempts
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON send_attempts TO wa_app;

-- Workers pick due jobs across tenants; everything after the pick runs tenant-scoped.
CREATE FUNCTION dequeue_jobs(p_now timestamptz, p_limit integer, p_lock_seconds integer)
RETURNS TABLE (id text, tenant_id text, kind text, payload jsonb, attempts integer, max_attempts integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE jobs j
  SET status = 'running',
      attempts = j.attempts + 1,
      locked_until = p_now + make_interval(secs => p_lock_seconds)
  FROM (
    SELECT id FROM jobs
    WHERE run_at <= p_now
      AND attempts < max_attempts
      AND (status = 'queued' OR (status = 'running' AND locked_until < p_now))
    ORDER BY run_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) due
  WHERE j.id = due.id
  RETURNING j.id, j.tenant_id, j.kind, j.payload, j.attempts, j.max_attempts
$$;
REVOKE ALL ON FUNCTION dequeue_jobs(timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dequeue_jobs(timestamptz, integer, integer) TO wa_app;

CREATE FUNCTION fail_abandoned_jobs(p_now timestamptz)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH failed AS (
    UPDATE jobs SET status = 'failed', last_error = coalesce(last_error, 'abandoned: worker stopped mid-run')
    WHERE status = 'running' AND locked_until < p_now AND attempts >= max_attempts
    RETURNING 1
  )
  SELECT count(*)::integer FROM failed
$$;
REVOKE ALL ON FUNCTION fail_abandoned_jobs(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_abandoned_jobs(timestamptz) TO wa_app;
