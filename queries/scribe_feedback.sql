-- name: CreateFeedback :one
INSERT INTO scribe_feedback (session_id, section, category, body, user_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, session_id, section, category, body, user_id, at;

-- name: GetSessionFeedback :many
SELECT f.id, f.session_id, f.section, f.category, f.body, f.user_id, f.at,
       u.name AS author_name
FROM scribe_feedback f
JOIN users u ON u.id = f.user_id
WHERE f.session_id = $1
ORDER BY f.at ASC;
