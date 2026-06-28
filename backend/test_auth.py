import unittest
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.services.auth import path_requires_auth, verify_supabase_token


class AuthServiceTest(unittest.TestCase):
    def test_api_paths_require_auth_except_agent_ws(self):
        self.assertTrue(path_requires_auth("/api/questions"))
        self.assertTrue(path_requires_auth("/api/tasks/queue"))
        self.assertFalse(path_requires_auth("/api/learning/agent/ws"))
        self.assertFalse(path_requires_auth("/api/health"))

    def test_verify_supabase_token_rejects_empty_token(self):
        with self.assertRaises(HTTPException) as ctx:
            verify_supabase_token("")
        self.assertEqual(ctx.exception.status_code, 401)

    @patch("src.services.auth.get_admin")
    def test_verify_supabase_token_returns_user_id(self, get_admin):
        class User:
            id = "user-123"

        class Response:
            user = User()

        get_admin.return_value.auth.get_user.return_value = Response()
        self.assertEqual(verify_supabase_token("valid-token"), "user-123")
        get_admin.return_value.auth.get_user.assert_called_once_with("valid-token")

    @patch("src.services.auth.get_admin")
    def test_verify_supabase_token_rejects_invalid_token(self, get_admin):
        get_admin.return_value.auth.get_user.side_effect = RuntimeError("bad token")
        with self.assertRaises(HTTPException) as ctx:
            verify_supabase_token("bad-token")
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
