UPDATE "users"
SET "mustChangePassword" = false
WHERE "mustChangePassword" = true;
