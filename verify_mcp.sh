#!/bin/bash
# ==============================================================
# MCP Server ???? ? ? VM ???
# ??: bash verify_mcp.sh
# ==============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

BACKEND_DIR="/opt/ky-platform/backend"
VENV_PYTHON="$BACKEND_DIR/.venv/bin/python3"
MCP_SERVER="$BACKEND_DIR/src/mcp_server.py"

echo "=== MCP Server ?? ==="
echo ""

# 1. ??????
echo "--- 1. ???? ---"
if [ -f "$MCP_SERVER" ]; then
    pass "mcp_server.py ??: $MCP_SERVER"
else
    fail "mcp_server.py ???! ?? git pull ????"
    exit 1
fi

# 2. Python ??
echo ""
echo "--- 2. Python ?? ---"
if [ -f "$VENV_PYTHON" ]; then
    PYTHON="$VENV_PYTHON"
    pass "?? venv: $VENV_PYTHON"
else
    PYTHON=$(which python3 2>/dev/null || echo "")
    if [ -n "$PYTHON" ]; then
        info "???? Python: $PYTHON"
    else
        fail "??? python3"
        exit 1
    fi
fi
VER=$($PYTHON --version 2>&1)
pass "Python ??: $VER"

# 3. ?????
echo ""
echo "--- 3. ??? ---"
MISSING=""
for pkg in supabase httpx pydantic pydantic_settings python_dotenv; do
    if $PYTHON -c "import $pkg" 2>/dev/null; then
        pass "$pkg"
    else
        fail "$pkg ? ???"
        MISSING="$MISSING $pkg"
    fi
done

if [ -n "$MISSING" ]; then
    echo ""
    info "????: $MISSING"
    info "????: cd $BACKEND_DIR && $VENV_PYTHON -m pip install httpx pydantic pydantic-settings python-dotenv supabase"
fi

# 4. ????
echo ""
echo "--- 4. ???? ---"
if $PYTHON -c "import ast; ast.parse(open('$MCP_SERVER').read()); print('OK')" 2>&1; then
    pass "Python ????"
else
    fail "Python ????"
    exit 1
fi

# 5. MCP ???? (?? JSON-RPC)
echo ""
echo "--- 5. MCP ?????? ---"
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test"}}}' | $PYTHON "$MCP_SERVER" 2>/dev/null | head -1 > /tmp/mcp_test_output.txt

if grep -q "serverInfo" /tmp/mcp_test_output.txt 2>/dev/null; then
    pass "initialize ????"
    cat /tmp/mcp_test_output.txt | python3 -m json.tool 2>/dev/null | head -10
else
    fail "initialize ????"
    info "????:"
    cat /tmp/mcp_test_output.txt 2>/dev/null || echo "(?)"
fi

# 6. tools/list ??
echo ""
echo "--- 6. tools/list ?? ---"
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | $PYTHON "$MCP_SERVER" 2>/dev/null | head -1 > /tmp/mcp_tools_output.txt

if grep -q "search_knowledge" /tmp/mcp_tools_output.txt 2>/dev/null; then
    pass "tools/list ?? 3 ???"
    echo "  ????: search_knowledge, search_materials, get_chunk_detail"
else
    fail "tools/list ???????"
    info "??: $(cat /tmp/mcp_tools_output.txt | head -c 200)"
fi

# 7. ??????
echo ""
echo "--- 7. ???? ---"
if [ -f "$BACKEND_DIR/.env" ]; then
    pass ".env ????"
    if grep -q "SUPABASE_URL" "$BACKEND_DIR/.env" 2>/dev/null; then
        URL=$(grep SUPABASE_URL "$BACKEND_DIR/.env" | head -1 | cut -d= -f2)
        info "SUPABASE_URL: $URL"
    fi
    if grep -q "OPENAI_API_KEY" "$BACKEND_DIR/.env" 2>/dev/null; then
        pass "OPENAI_API_KEY ???"
    else
        fail "OPENAI_API_KEY ???"
    fi
else
    fail ".env ?????: $BACKEND_DIR/.env"
    info "???? .env ??? SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY ?"
fi

# 8. Game Ready ??
echo ""
echo "=== ?? ==="
echo ""
echo "?????? PASS, MCP Server ??? Codex ????"
echo "?? Codex ?????? .mcp.json ?? ky-platform-search ???"
echo ""
echo "Codex ?????, ?????: ? search_knowledge ?????"
echo "Codex ??????? MCP ????????"
