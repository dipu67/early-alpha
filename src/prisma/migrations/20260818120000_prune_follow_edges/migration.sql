-- Prune inactive follow_edges older than a configurable cutoff.
-- Safe to run on a live DB (small deletes, indexed by active + lastSeenAt).

CREATE OR REPLACE FUNCTION prune_follow_edges(p_stale_days INTEGER DEFAULT 90)
RETURNS TABLE(deleted_rows BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  cutoff TIMESTAMPTZ := now() - (p_stale_days || ' days')::INTERVAL;
BEGIN
  DELETE FROM follow_edges
  WHERE active = FALSE
    AND last_seen_at < cutoff;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RETURN QUERY SELECT deleted_rows;
END;
$$;