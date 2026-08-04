-- Client groups visible to the caller. ${scopeFilter} narrows the list to the
-- groups the signed-in user was granted (empty for administrators).
SELECT DISTINCT grp AS group_name
FROM client_group
WHERE grp NOT LIKE 'help%'
  AND grp != 'all'
  ${scopeFilter}
ORDER BY group_name
