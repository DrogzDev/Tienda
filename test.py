# test_simple.py
import asyncio
from mcp_sales import get_created_at

async def test():
    result = await get_created_at(3)
    print("Resultado:", result)

asyncio.run(test())
