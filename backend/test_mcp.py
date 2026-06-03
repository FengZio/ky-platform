import asyncio
from mcp.server.lowlevel.server import Server
from mcp.server.stdio import stdio_server
from mcp import types as mcp_types

server = Server("test-mcp")

@server.list_tools()
async def list_tools():
    return [mcp_types.Tool(name="ping", description="Test tool", inputSchema={"type": "object", "properties": {}})]

@server.call_tool()
async def call_tool(name, arguments):
    return [mcp_types.TextContent(type="text", text="pong")]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

asyncio.run(main())
