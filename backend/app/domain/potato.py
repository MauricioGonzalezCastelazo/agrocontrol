import json
import re
from fractions import Fraction
from pathlib import Path

RULES = json.loads(Path(__file__).with_name("potato-rules.json").read_text(encoding="utf-8"))
LEGACY_RULES = json.loads(
    Path(__file__).with_name("potato-rules-v1.json").read_text(encoding="utf-8")
)
GRADES = tuple(grade["code"] for grade in RULES["grades"])


def number(value, maximum):
    text = str(value)
    if not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.\d{1,4})?", text):
        raise ValueError("Usa valores no negativos con hasta cuatro decimales")
    result = Fraction(text)
    if result > Fraction(maximum):
        raise ValueError("El valor excede el máximo permitido")
    return result


def fixed(value: Fraction, places=None) -> str:
    """Exact HALF_UP conversion; never round an intermediate division."""
    places = RULES["output_decimals"] if places is None else places
    scaled, remainder = divmod(value.numerator * 10**places, value.denominator)
    if remainder * 2 >= value.denominator:
        scaled += 1
    text = str(scaled).zfill(places + 1)
    return text[:-places] + "." + text[-places:] if places else text


def evaluate(expression, context, rows):
    if isinstance(expression, str):
        return context[expression]
    operation, *arguments = expression
    if operation == "sum":
        return sum((row[arguments[0]] for row in rows), Fraction(0))
    left, right = (evaluate(argument, context, rows) for argument in arguments)
    if operation == "sub":
        return left - right
    if operation == "mul":
        return left * right
    if operation == "div":
        return left / right
    raise ValueError("Fórmula desconocida")


def calculate_potato(details: dict, version: str | None = None) -> dict:
    """Interpret the same versioned formula specification as the browser."""
    versions = {RULES["version"]: RULES, LEGACY_RULES["version"]: LEGACY_RULES}
    rules = versions[version or RULES["version"]]
    context = {
        key: number(details[key], RULES["max_weight"])
        for key in ("gross_weight", "tare_weight", "additional_shrinkage")
    }
    if context["gross_weight"] <= context["tare_weight"]:
        raise ValueError("BRUTO debe ser mayor que TARA")
    if context["additional_shrinkage"] > context["gross_weight"] - context["tare_weight"]:
        raise ValueError("MERMA ADICIONAL no puede superar PESO")
    raw = details["lines"]
    if len(raw) != 4 or {row["grade_code"] for row in raw} != set(GRADES):
        raise ValueError("Captura exactamente 1RA, 2DA, 3RA y 4TA, sin repetir")
    rows = []
    for code in GRADES:
        row = next(row for row in raw if row["grade_code"] == code)
        quantity = number(row["quantity"], RULES["max_quantity"])
        price = row.get("unit_price")
        if quantity > 0 and (price is None or str(price) == ""):
            raise ValueError(f"Introduce el precio unitario de {code}")
        rows.append(
            {
                "grade_code": code,
                "quantity": quantity,
                "unit_price": number(
                    price if price is not None and str(price) else "0", RULES["max_price"]
                ),
            }
        )
    if sum(row["quantity"] for row in rows) <= 0:
        raise ValueError("CANTIDAD TOTAL debe ser mayor que cero")
    for name, expression in rules["order_formulas"]:
        context[name] = evaluate(expression, context, rows)
        if name == "weight_after_shrinkage" and context[name] < 0:
            raise ValueError("CANTIDAD TOTAL y MERMA ADICIONAL no pueden superar PESO")
    override = details.get("shrinkage_override")
    shrinkage = (
        number(override, RULES["max_weight"]) if override is not None else context["total_quantity"]
    )
    result_rows = []
    for row in rows:
        values = context | row
        for name, expression in rules["line_formulas"]:
            values[name] = evaluate(expression, values, rows)
        result_rows.append(
            {
                "grade_code": row["grade_code"],
                "quantity": fixed(row["quantity"], 4),
                "unit_price": fixed(row["unit_price"], 4),
                **{name: fixed(values[name]) for name, _ in rules["line_formulas"]},
            }
        )
    return {
        "calculation_version": rules["version"],
        "shrinkage_override": fixed(shrinkage, 4) if override is not None else None,
        "shrinkage": fixed(shrinkage),
        **{
            key: fixed(context[key], 4)
            for key in ("gross_weight", "tare_weight", "additional_shrinkage")
        },
        **{key: fixed(context[key]) for key, _ in rules["order_formulas"]},
        "net_total_weight": fixed(
            sum((Fraction(row["allocated_net_weight"]) for row in result_rows), Fraction(0))
        ),
        "total_amount": fixed(
            sum((Fraction(row["line_total"]) for row in result_rows), Fraction(0))
        ),
        "lines": result_rows,
    }
