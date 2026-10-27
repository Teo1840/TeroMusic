"""Valida los ejemplos (o cualquier evento) contra el sobre y el schema de su 'data'.

Uso:
    pip install "jsonschema[format]"
    python contracts/validate.py                 # valida todos los ejemplos
    python contracts/validate.py evento.json     # valida archivos concretos
"""
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent
FORMATS = Draft202012Validator.FORMAT_CHECKER


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


ENVELOPE = Draft202012Validator(load(ROOT / "envelope.schema.json"), format_checker=FORMATS)


def validate_event(event: dict) -> list[str]:
    errors = [f"sobre: {e.json_path}: {e.message}" for e in ENVELOPE.iter_errors(event)]

    schema_path = ROOT / "events" / f"{event.get('type', '')}.schema.json"
    if not schema_path.exists():
        return errors + [f"no existe schema para type={event.get('type')!r}"]

    expected = f"contracts/events/{schema_path.name}"
    if event.get("dataschema") not in (None, expected):
        errors.append(f"dataschema debería ser {expected!r}")

    data_validator = Draft202012Validator(load(schema_path), format_checker=FORMATS)
    errors += [f"data: {e.json_path}: {e.message}" for e in data_validator.iter_errors(event.get("data", {}))]
    return errors


def main(paths: list[str]) -> int:
    files = [Path(p) for p in paths] or sorted((ROOT / "examples").glob("*.json"))
    failed = 0
    for f in files:
        errors = validate_event(load(f))
        print(f"{'OK  ' if not errors else 'FAIL'} {f.name}")
        for e in errors:
            print(f"      {e}")
        failed += bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
