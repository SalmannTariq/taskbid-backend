CREATE VIEW user_workloads AS
SELECT
  u.id AS user_id,
  u.name,
  u.email,
  u.hourly_rate,
  u.max_capacity_hours,
  COALESCE(SUM(b.hours_offered) FILTER (
    WHERE t.assigned_to = u.id
      AND t.status IN ('assigned', 'in_progress', 'review')
  ), 0) AS current_workload
FROM users u
LEFT JOIN bids b ON b.user_id = u.id
LEFT JOIN tasks t ON t.id = b.task_id
GROUP BY u.id;
