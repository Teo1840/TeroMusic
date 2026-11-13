"""Reproducciones por día y tendencias.

- HTTP con un pool simulado (sin base): validaciones y forma de la respuesta.
- SQL contra PostgreSQL real, solo si hay POSTGRES_HOST (dentro de docker compose):
  usa ids de canción al azar y los borra al terminar.
"""
import os
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone

import asyncpg
from fastapi.testclient import TestClient

from app import main
from app.database import SCHEMA, daily_plays, open_pool, trending


class FakePool:
    def __init__(self, rows=None, totals=None, error=None):
        self.rows = rows or []
        self.totals = totals or {"plays": 0, "previous_plays": 0}
        self.error = error
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append(args)
        if self.error:
            raise self.error
        return self.rows

    async def fetchrow(self, query, *args):
        if self.error:
            raise self.error
        return self.totals


class DailyHttpTest(unittest.TestCase):
    def setUp(self):
        self.pool = FakePool(rows=[{"day": date(2026, 11, 12), "plays": 2}, {"day": date(2026, 11, 13), "plays": 3}])
        main.app.state.pool = self.pool
        self.client = TestClient(main.app)

    def test_serie_y_total(self):
        response = self.client.get("/metrics/plays/daily", params={"days": 2, "tz": "America/Argentina/Buenos_Aires"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "days": [{"date": "2026-11-12", "plays": 2}, {"date": "2026-11-13", "plays": 3}],
            "total": 5, "tz": "America/Argentina/Buenos_Aires",
        })
        self.assertEqual(self.pool.calls[-1], ("America/Argentina/Buenos_Aires", 2, None))

    def test_por_cancion_y_por_varias(self):
        self.client.get("/metrics/plays/daily", params={"song_id": "a"})
        self.assertEqual(self.pool.calls[-1], ("UTC", 30, ["a"]))
        self.client.post("/metrics/songs/daily", json={"song_ids": ["a", "b", "a"], "days": 7})
        self.assertEqual(self.pool.calls[-1], ("UTC", 7, ["a", "b"]))

    def test_parametros_invalidos_422(self):
        for params in ({"days": 0}, {"days": 366}, {"tz": "x; DROP TABLE"}, {"tz": "../etc"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get("/metrics/plays/daily", params=params).status_code, 422)
        self.assertEqual(self.client.post("/metrics/songs/daily", json={"song_ids": []}).status_code, 422)

    def test_zona_desconocida_422_y_base_caida_503(self):
        self.pool.error = asyncpg.InvalidParameterValueError("time zone not recognized")
        self.assertEqual(self.client.get("/metrics/plays/daily", params={"tz": "Marte/Base"}).status_code, 422)
        self.pool.error = ConnectionError("caída")
        self.assertEqual(self.client.get("/metrics/plays/daily").status_code, 503)


class TrendingHttpTest(unittest.TestCase):
    def test_respuesta(self):
        pool = FakePool(rows=[{"song_id": "a", "plays": 5, "previous_plays": 1}],
                        totals={"plays": 9, "previous_plays": 4})
        main.app.state.pool = pool
        client = TestClient(main.app)
        self.assertEqual(client.get("/metrics/trending").json(), {
            "days": 7, "plays": 9, "previous_plays": 4,
            "songs": [{"song_id": "a", "plays": 5, "previous_plays": 1}],
        })
        self.assertEqual(client.get("/metrics/trending", params={"days": 91}).status_code, 422)
        pool.error = ConnectionError("caída")
        self.assertEqual(client.get("/metrics/trending").status_code, 503)


@unittest.skipUnless(os.getenv("POSTGRES_HOST"), "sin PostgreSQL")
class SqlTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.pool = await open_pool()
        await self.pool.execute(SCHEMA)
        self.songs = [f"test-{uuid.uuid4()}" for _ in range(3)]

    async def asyncTearDown(self):
        await self.pool.execute("DELETE FROM analytics.play_events WHERE song_id = ANY($1::varchar[])", self.songs)
        await self.pool.execute("DELETE FROM analytics.song_metrics WHERE song_id = ANY($1::varchar[])", self.songs)
        await self.pool.close()

    async def play(self, song, when, metrics=True):
        await self.pool.execute(
            "INSERT INTO analytics.play_events(event_id, song_id, user_id, played_at) VALUES ($1,$2,'u',$3)",
            str(uuid.uuid4()), song, when)
        if metrics:
            await self.pool.execute(
                """INSERT INTO analytics.song_metrics(song_id, total_plays) VALUES ($1, 1)
                   ON CONFLICT (song_id) DO UPDATE SET total_plays = analytics.song_metrics.total_plays + 1""",
                song)

    async def test_serie_diaria_con_ceros_y_zona_horaria(self):
        a = self.songs[0]
        now = datetime.now(timezone.utc)
        await self.play(a, now)
        await self.play(a, now - timedelta(days=2))
        await self.play(a, now - timedelta(days=2))
        await self.play(a, now - timedelta(days=40))  # fuera de la ventana
        rows = await daily_plays(self.pool, 7, "UTC", [a])
        self.assertEqual(len(rows), 7)
        self.assertEqual(rows[-1]["day"], now.date())
        self.assertEqual([r["plays"] for r in rows], [0, 0, 0, 0, 2, 0, 1])

        # 02:00 UTC del día X es el día anterior en Buenos Aires (UTC-3).
        b = self.songs[1]
        today = now.date()
        await self.play(b, datetime(today.year, today.month, today.day, 2, tzinfo=timezone.utc))
        utc = await daily_plays(self.pool, 2, "UTC", [b])
        ba = await daily_plays(self.pool, 2, "America/Argentina/Buenos_Aires", [b])
        self.assertEqual(utc[-1]["plays"], 1)
        self.assertEqual(sum(r["plays"] for r in ba), 1)

        with self.assertRaises(asyncpg.InvalidParameterValueError):
            await daily_plays(self.pool, 2, "Marte/Base", [a])

    async def test_tendencias_comparan_dos_ventanas_y_omiten_borradas(self):
        a, b, borrada = self.songs
        now = datetime.now(timezone.utc)
        for _ in range(3):
            await self.play(a, now - timedelta(days=1))
        await self.play(a, now - timedelta(days=10))
        await self.play(b, now - timedelta(hours=1))
        await self.play(b, now - timedelta(days=9))
        await self.play(b, now - timedelta(days=8))
        await self.play(borrada, now, metrics=False)
        totals, rows = await trending(self.pool, 7, 100)
        mine = {r["song_id"]: (r["plays"], r["previous_plays"]) for r in rows if r["song_id"] in self.songs}
        self.assertEqual(mine, {a: (3, 1), b: (1, 2)})
        self.assertGreaterEqual(totals["plays"], 5)
        self.assertGreaterEqual(totals["previous_plays"], 3)


if __name__ == "__main__":
    unittest.main()
