"""POST /metrics/songs/batch con un pool de PostgreSQL simulado (sin base ni RabbitMQ)."""
import unittest

from fastapi.testclient import TestClient

from app import main
from app.models import BATCH_MAX


class FakePool:
    def __init__(self, counts, fail=False):
        self.counts = counts
        self.fail = fail
        self.queries = []

    async def fetch(self, query, ids):
        self.queries.append(ids)
        if self.fail:
            raise ConnectionError("PostgreSQL caído")
        return [{"song_id": s, "total_plays": self.counts[s]} for s in ids if s in self.counts]


class SongsBatchTest(unittest.TestCase):
    def setUp(self):
        self.pool = FakePool({"a": 12, "b": 3})
        main.app.state.pool = self.pool
        # Sin "with": no corre el lifespan (no conecta a Postgres ni a RabbitMQ).
        self.client = TestClient(main.app)

    def post(self, ids):
        return self.client.post("/metrics/songs/batch", json={"song_ids": ids})

    def test_devuelve_cada_id_en_orden_con_cero_si_no_tiene(self):
        response = self.post(["b", "nueva", "a"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"songs": [
            {"song_id": "b", "total_plays": 3},
            {"song_id": "nueva", "total_plays": 0},
            {"song_id": "a", "total_plays": 12},
        ]})

    def test_una_sola_consulta_y_sin_repetidos(self):
        response = self.post(["a", "a", "b"])
        self.assertEqual([s["song_id"] for s in response.json()["songs"]], ["a", "b"])
        self.assertEqual(self.pool.queries, [["a", "b"]])

    def test_lista_vacia_o_demasiado_larga_422(self):
        self.assertEqual(self.post([]).status_code, 422)
        self.assertEqual(self.post([f"s{i}" for i in range(BATCH_MAX + 1)]).status_code, 422)
        self.assertEqual(self.pool.queries, [])

    def test_ids_invalidos_422(self):
        for bad in ["", "con espacio", "x" * 129, 5]:
            with self.subTest(bad=bad):
                self.assertEqual(self.post([bad]).status_code, 422)

    def test_si_la_base_falla_503(self):
        self.pool.fail = True
        response = self.post(["a"])
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("caído", response.text)


if __name__ == "__main__":
    unittest.main()
