SELECT DISTINCT grp AS group_name
FROM client_group
WHERE grp NOT LIKE 'help%'
  AND grp != 'all'
ORDER BY group_name
