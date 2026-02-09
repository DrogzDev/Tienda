# mcp_sales.py
# FastMCP: SOLO devuelve inventory_sale.created_at desde db.sqlite3

import os
from pathlib import Path
from typing import Any, Dict, List

import aiosqlite
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("mcp-sales")

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DJANGO_SQLITE_PATH", BASE_DIR / "db.sqlite3")).expanduser().resolve()

TABLE = "inventory_sale"
COLUMN = "created_at"
MAX_LIMIT = 200


def _db_uri_ro() -> str:
    # SQLite read-only URI
    return f"file:{DB_PATH.as_posix()}?mode=ro"


async def _table_exists() -> bool:
    async with aiosqlite.connect(_db_uri_ro(), uri=True) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;",
            (TABLE,),
        ) as cur:
            return bool(await cur.fetchone())


async def _column_exists() -> bool:
    async with aiosqlite.connect(_db_uri_ro(), uri=True) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f"PRAGMA table_info('{TABLE}')") as cur:
            rows = await cur.fetchall()
            return COLUMN in {r["name"] for r in rows}


async def _fetch_created_at(limit: int) -> List[str]:
    async with aiosqlite.connect(_db_uri_ro(), uri=True) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT {COLUMN} AS created_at FROM {TABLE} ORDER BY {COLUMN} DESC LIMIT ?;",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
            return [str(r["created_at"]) for r in rows]


@mcp.tool()
async def get_created_at(limit: int = 50) -> Dict[str, Any]:
    """
    Devuelve SOLO inventory_sale.created_at (más recientes primero).
    """
    limit = int(limit)
    if limit < 1:
        limit = 1
    if limit > MAX_LIMIT:
        limit = MAX_LIMIT

    try:
        if not await _table_exists():
            return {"ok": False, "error": f"No existe la tabla '{TABLE}'.", "db_path": str(DB_PATH)}

        if not await _column_exists():
            return {"ok": False, "error": f"No existe la columna '{COLUMN}' en '{TABLE}'.", "db_path": str(DB_PATH)}

        return {"ok": True, "result": await _fetch_created_at(limit)}

    except Exception as e:
        # fallback para debug sin reventar el MCP
        return {"ok": False, "error": str(e), "db_path": str(DB_PATH)}


if __name__ == "__main__":
    mcp.run()
