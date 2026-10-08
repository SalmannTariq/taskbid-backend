CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  changed_by BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_log_entity_type_check CHECK (entity_type IN ('task', 'bid'))
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_changed_by_idx ON audit_log (changed_by);

CREATE FUNCTION log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor_text TEXT;
  actor_id BIGINT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  actor_text := current_setting('app.user_id', true);

  IF actor_text IS NULL OR actor_text = '' THEN
    RAISE EXCEPTION 'set app.user_id before changing a task or bid status';
  END IF;

  actor_id := actor_text::BIGINT;

  INSERT INTO audit_log (
    entity_type,
    entity_id,
    changed_by,
    field_name,
    previous_value,
    new_value
  )
  VALUES (
    TG_ARGV[0],
    NEW.id,
    actor_id,
    'status',
    OLD.status,
    NEW.status
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_status_audit
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_status_change('task');
