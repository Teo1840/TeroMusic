"""Escucha los eventos de musicapp.events y los imprime (solo para pruebas).

Uso (en otra terminal, con el .venv activo):  python peek_events.py
Guarda el último evento en /tmp/ultimo_evento.json
"""
import asyncio
import json

import aio_pika

from app.config import settings


async def main() -> None:
    conn = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await conn.channel()
    exchange = await channel.declare_exchange(
        settings.events_exchange, aio_pika.ExchangeType.TOPIC, durable=True
    )
    queue = await channel.declare_queue("", exclusive=True, auto_delete=True)
    await queue.bind(exchange, routing_key="#")
    print("Escuchando eventos... (Ctrl+C para salir)")
    async with queue.iterator() as it:
        async for message in it:
            async with message.process():
                event = json.loads(message.body)
                print(json.dumps(event, indent=2, ensure_ascii=False))
                with open("/tmp/ultimo_evento.json", "w") as f:
                    json.dump(event, f, indent=2, ensure_ascii=False)


asyncio.run(main())
