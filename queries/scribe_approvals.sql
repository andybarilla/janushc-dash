-- name: RecordSectionEdit :exec
INSERT INTO scribe_section_edits (session_id, section, content, edited_by)
VALUES ($1, $2, $3, $4);

-- name: GetSessionSectionEdits :many
-- Latest edit per section for one session.
SELECT DISTINCT ON (section)
    section, content, edited_by, at
FROM scribe_section_edits
WHERE session_id = $1
ORDER BY section, at DESC;

-- name: RecordSectionApproval :exec
INSERT INTO scribe_section_approvals (session_id, section, action, user_id)
VALUES ($1, $2, $3, $4);

-- name: GetSessionSectionStates :many
-- Latest event per section for one session, joined to the actor's display name.
SELECT DISTINCT ON (a.section)
    a.section, a.action, a.user_id, a.at, u.name AS user_name
FROM scribe_section_approvals a
JOIN users u ON u.id = a.user_id
WHERE a.session_id = $1
ORDER BY a.section, a.at DESC;
