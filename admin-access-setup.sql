-- FAIZAN AHMED CHATS admin role setup
-- The main owner account identified in the connected project is faizan78467.
-- This is safe to run again; it only makes that account an administrator.
UPDATE public.profiles
SET role = 'admin'
WHERE username = 'faizan78467';

-- Verify the account's role:
SELECT username, public_code, role
FROM public.profiles
WHERE username = 'faizan78467';

-- To grant admin to a different account later, replace the username below:
-- UPDATE public.profiles SET role = 'admin' WHERE username = 'YOUR_USERNAME';
