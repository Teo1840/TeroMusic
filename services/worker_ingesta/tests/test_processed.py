"""Registro compartido de eventos procesados (Redis simulado)."""
import asyncio

from app import processed
from app.processed import ProcessedRegistry


class FakeRedis:
    """Lo mínimo de redis.asyncio: exists y set con vencimiento. Compartido = misma instancia."""

    def __init__(self, broken=False):
        self.data = {}
        self.broken = broken

    async def exists(self, key):
        if self.broken:
            raise ConnectionError("Redis caído")
        return int(key in self.data)

    async def set(self, key, value, ex=None):
        if self.broken:
            raise ConnectionError("Redis caído")
        self.data[key] = (value, ex)


def copy_with(redis):
    """Una copia del worker conectada a ese Redis."""
    registry = ProcessedRegistry(None, 3600)
    registry._redis = redis
    return registry


def test_lo_que_marca_una_copia_lo_ve_otra():
    redis = FakeRedis()
    worker_1, worker_2 = copy_with(redis), copy_with(redis)

    async def scenario():
        assert not await worker_2.seen("evento-1")
        await worker_1.mark("evento-1")
        return await worker_2.seen("evento-1")

    assert asyncio.run(scenario())
    assert redis.data[processed.KEY.format(event_id="evento-1")] == ("1", 3600)


def test_con_redis_caido_sigue_con_la_memoria_de_la_copia():
    registry = copy_with(FakeRedis(broken=True))

    async def scenario():
        assert not await registry.seen("evento-2")  # no frena: procesa
        await registry.mark("evento-2")             # no lanza
        return await registry.seen("evento-2")

    assert asyncio.run(scenario())


def test_sin_redis_configurado_usa_solo_memoria():
    registry = ProcessedRegistry(None, 60)

    async def scenario():
        await registry.mark("evento-3")
        return await registry.seen("evento-3"), await registry.seen("otro")

    assert asyncio.run(scenario()) == (True, False)
