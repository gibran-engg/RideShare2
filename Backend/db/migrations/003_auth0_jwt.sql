-- Sign-in moved to Auth0: the apps send Auth0 JWT access tokens, verified on every request.
-- The API's own bearer tokens and one-time login codes are no longer used.
DROP TABLE IF EXISTS api_tokens;
DROP TABLE IF EXISTS login_codes;
