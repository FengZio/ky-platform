import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'E:\ky-platform\local_agent.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Use python -u (unbuffered) and add PYTHONUNBUFFERED env var
old = '''        # Write .mcp.json with absolute paths so codex app-server finds the MCP server
        env_vars = {}
        for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY",
                     "OPENAI_BASE_URL", "EMBEDDING_MODEL"):
            val = os.environ.get(key, "")
            if val:
                env_vars[key] = val
        mcp_config = {
            "mcpServers": {
                "ky-platform-search": {
                    "type": "stdio",
                    "command": "python",
                    "args": ["src/mcp_server.py"],
                    "cwd": "E:\\ky-platform\\backend",
                    "env": env_vars
                }
            }
        }'''

new = '''        # Write .mcp.json with absolute paths so codex app-server finds the MCP server
        env_vars = {}
        for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY",
                     "OPENAI_BASE_URL", "EMBEDDING_MODEL"):
            val = os.environ.get(key, "")
            if val:
                env_vars[key] = val
        env_vars["PYTHONUNBUFFERED"] = "1"
        mcp_config = {
            "mcpServers": {
                "ky-platform-search": {
                    "type": "stdio",
                    "command": "python",
                    "args": ["-u", "src/mcp_server.py"],
                    "cwd": "E:\\ky-platform\\backend",
                    "env": env_vars
                }
            }
        }'''

content = content.replace(old, new)

with open(r'E:\ky-platform\local_agent.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('OK')
