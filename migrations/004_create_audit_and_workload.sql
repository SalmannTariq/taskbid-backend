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

CREATE VIEW user_workloads AS
SELECT
  u.id AS user_id,
  u.name,
  u.email,
  u.hourly_rate,
  u.max_capacity_hours,
  COALESCE(SUM(b.hours_offered) FILTER (
    WHERE b.status = 'accepted' AND t.status = 'assigned'
  ), 0) AS current_workload
FROM users u
LEFT JOIN bids b ON b.user_id = u.id
LEFT JOIN tasks t ON t.id = b.task_id
GROUP BY u.id;

CREATE FUNCTION prevent_invalid_task_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'open' AND NEW.status IN ('assigned', 'cancelled')) OR
    (OLD.status = 'assigned' AND NEW.status IN ('completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid task status transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_status_transition
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION prevent_invalid_task_status_change();

CREATE FUNCTION prevent_invalid_bid_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  capacity NUMERIC(6, 2);
  used_hours NUMERIC(6, 2);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'invalid bid status transition from % to %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'accepted' THEN
    SELECT max_capacity_hours INTO capacity
    FROM users
    WHERE id = NEW.user_id;

    SELECT COALESCE(SUM(b.hours_offered), 0) INTO used_hours
    FROM bids b
    JOIN tasks t ON t.id = b.task_id
    WHERE b.user_id = NEW.user_id
      AND b.id <> NEW.id
      AND b.status = 'accepted'
      AND t.status = 'assigned';

    IF used_hours + NEW.hours_offered > capacity THEN
      RAISE EXCEPTION 'accepting this bid would exceed the user max capacity';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bids_status_transition
  BEFORE UPDATE OF status ON bids
  FOR EACH ROW
  EXECUTE FUNCTION prevent_invalid_bid_status_change();

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

CREATE TRIGGER bids_status_audit
  AFTER UPDATE OF status ON bids
  FOR EACH ROW
  EXECUTE FUNCTION log_status_change('bid');
