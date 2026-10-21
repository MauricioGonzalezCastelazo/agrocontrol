import json
from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.domain.potato import GRADES, calculate_potato
from app.modules.schemas import PotatoInput
from app.persistence.models import CarrotDetails, Order, PotatoDetails, PotatoGradeLine
from tests.test_operations import make_customer

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[1] / "app/domain/potato-fixtures.json").read_text(
        encoding="utf-8"
    )
)


def potato_input(fixture=None):
    fixture = fixture or FIXTURES[1]
    return {
        "gross_weight": fixture["gross"],
        "tare_weight": fixture["tare"],
        "additional_shrinkage": fixture["shrinkage"],
        "lines": [
            {
                "grade_code": code,
                "quantity": fixture["quantities"][index],
                "unit_price": fixture["prices"][index],
            }
            for index, code in enumerate(GRADES)
        ],
    }


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda item: item["name"])
def test_shared_decimal_vectors(fixture):
    result = calculate_potato(potato_input(fixture))
    for key, value in fixture["expected"].items():
        assert result[key] == value
    assert [line["line_total"] for line in result["lines"]] == fixture["line_totals"]
    assert sum(Fraction(line["line_total"]) for line in result["lines"]) == Fraction(
        result["total_amount"]
    )
    assert abs(
        Decimal(result["net_total_weight"]) - Decimal(result["weight_after_shrinkage"])
    ) <= Decimal("0.00000002")


@pytest.mark.parametrize(
    "change",
    [
        {"gross_weight": "1"},
        {"gross_weight": "0"},
        {"tare_weight": "-1"},
        {"additional_shrinkage": "10001"},
        {"additional_shrinkage": "9200.0001"},
        {"gross_weight": 12000},
        {"gross_weight": "1.00001"},
        {"tare_weight": "NaN"},
    ],
)
def test_potato_invalid_weights(change):
    with pytest.raises(ValueError):
        PotatoInput.model_validate(potato_input() | change)


@pytest.mark.parametrize(
    "quantity,price", [("-1", "1"), ("1", "-1"), ("1", None), ("1e3", "1"), ("1.12345", "1")]
)
def test_potato_invalid_lines(quantity, price):
    payload = potato_input()
    payload["lines"][0] |= {"quantity": quantity, "unit_price": price}
    with pytest.raises(ValueError):
        PotatoInput.model_validate(payload)


def test_empty_grades_and_duplicate_codes():
    payload = potato_input()
    for line in payload["lines"]:
        line["quantity"] = "0"
    with pytest.raises(ValueError):
        PotatoInput.model_validate(payload)
    payload = potato_input()
    payload["lines"][3]["grade_code"] = "1RA"
    with pytest.raises(ValueError):
        PotatoInput.model_validate(payload)


def test_historical_amount_is_preserved_until_explicit_edit(client, headers, db):
    customer, _ = make_customer(client, headers)
    payload = {
        "id": str(uuid4()),
        "customer_id": customer["id"],
        "remission_number": 82,
        "product_type": "potato",
        "order_date": "2026-10-20",
        "details": potato_input(),
        "attachments": [],
    }
    created = client.post("/api/v1/orders", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    order_id = UUID(created.json()["id"])
    db.get(PotatoDetails, order_id).calculation_version = "potato-v1"
    db.get(Order, order_id).total_amount = Decimal("54000.00000000")
    db.commit()
    endpoint = f"/api/v1/orders/{order_id}"
    historical = client.get(endpoint, headers=headers).json()
    assert historical["total_amount"] == historical["potato"]["total_amount"] == "54000.00000000"
    assert historical["potato"]["calculation_version"] == "potato-v1"
    update = {key: value for key, value in payload.items() if key != "id"} | {"expected_version": 1}
    edited = client.patch(endpoint, headers=headers, json=update)
    assert edited.status_code == 200, edited.text
    assert edited.json()["total_amount"] == "49500.00000000"
    assert edited.json()["potato"]["calculation_version"] == "potato-v2"


def test_combined_shrinkage_can_leave_exactly_zero_weight():
    result = calculate_potato(potato_input() | {"additional_shrinkage": "9200"})
    assert result["weight_after_shrinkage"] == result["total_amount"] == "0.00000000"


@pytest.mark.parametrize("value", ["0", "12.5000", "99999"])
def test_manual_shrinkage_does_not_change_weight_or_amount(value):
    automatic = calculate_potato(potato_input())
    manual = calculate_potato(potato_input() | {"shrinkage_override": value})
    assert automatic["shrinkage"] == "800.00000000"
    assert automatic["shrinkage_override"] is None
    assert Decimal(manual["shrinkage"]) == Decimal(value)
    assert manual["weight_after_shrinkage"] == automatic["weight_after_shrinkage"]
    assert manual["total_amount"] == automatic["total_amount"]


@pytest.mark.parametrize("value", ["", "-1", "NaN", "1.12345", "10000000000"])
def test_invalid_manual_shrinkage(value):
    with pytest.raises(ValueError):
        PotatoInput.model_validate(potato_input() | {"shrinkage_override": value})


def test_manual_shrinkage_persists_on_edit_and_can_return_to_automatic(client, headers, db):
    customer, _ = make_customer(client, headers)
    payload = {
        "id": str(uuid4()),
        "customer_id": customer["id"],
        "remission_number": 82,
        "product_type": "potato",
        "order_date": "2026-10-20",
        "details": potato_input() | {"shrinkage_override": "12.5"},
        "attachments": [],
    }
    response = client.post("/api/v1/orders", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    endpoint = f"/api/v1/orders/{payload['id']}"
    assert client.get(endpoint, headers=headers).json()["potato"]["shrinkage"] == "12.50000000"
    assert db.get(PotatoDetails, UUID(payload["id"])).shrinkage_override == Decimal("12.5")
    update = {key: value for key, value in payload.items() if key != "id"}
    for version, override, expected in [(1, "0", "0.00000000"), (2, None, "800.00000000")]:
        response = client.patch(
            endpoint,
            headers=headers,
            json=update
            | {
                "expected_version": version,
                "details": potato_input() | {"shrinkage_override": override},
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["potato"]["shrinkage"] == expected
        assert response.json()["total_amount"] == "49500.00000000"


def test_automatic_shrinkage_preserves_old_request_fingerprint():
    from types import SimpleNamespace

    from app.modules.operations import fingerprint
    from app.modules.schemas import OrderCreate

    request = OrderCreate.model_validate(
        {
            "id": str(uuid4()),
            "customer_id": str(uuid4()),
            "product_type": "potato",
            "order_date": "2026-10-20",
            "details": potato_input(),
        }
    )
    legacy = request.model_dump()
    legacy["details"].pop("shrinkage_override")
    assert fingerprint(request) == fingerprint(SimpleNamespace(model_dump=lambda: legacy))
    request.details.shrinkage_override = Decimal("0")
    assert fingerprint(request) != fingerprint(SimpleNamespace(model_dump=lambda: legacy))


def test_potato_creation_edit_conversion_and_private_attachments(client, headers, db):
    customer, _ = make_customer(client, headers)
    payload = {
        "id": str(uuid4()),
        "customer_id": customer["id"],
        "remission_number": 82,
        "order_date": "2026-10-20",
        "product_type": "potato",
        "details": potato_input(),
        "description": "Carga sintética",
        "attachments": [],
    }
    response = client.post("/api/v1/orders", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["potato"] == calculate_potato(payload["details"])
    assert order["total_amount"] == "49500.00000000" and order["hectares"] is None
    assert order["updated_by"] == order["created_by"]
    assert len(list(db.scalars(select(PotatoGradeLine)))) == 4
    assert client.post("/api/v1/orders", headers=headers, json=payload).json()["id"] == order["id"]
    details = deepcopy(payload["details"])
    details["additional_shrinkage"] = "0"
    update = {key: value for key, value in payload.items() if key != "id"} | {
        "details": details,
        "expected_version": 1,
    }
    endpoint = f"/api/v1/orders/{order['id']}"
    edited = client.patch(endpoint, headers=headers, json=update)
    assert edited.status_code == 200, edited.text
    assert edited.json()["total_amount"] == "51750.00000000"
    assert client.patch(endpoint, headers=headers, json=update).json() == edited.json()
    assert (
        client.patch(
            endpoint, headers=headers, json=update | {"description": "Versión anterior"}
        ).status_code
        == 409
    )
    converted = client.patch(
        endpoint,
        headers=headers,
        json=update
        | {
            "expected_version": 2,
            "product_type": "carrot",
            "details": {"hectares": "1.25", "unit_price": "100.50"},
        },
    )
    assert converted.status_code == 200 and converted.json()["total_amount"] == "125.62500000"
    assert converted.json()["potato"] is None
    assert db.get(PotatoDetails, UUID(order["id"])) is None
    assert db.get(CarrotDetails, UUID(order["id"])) is not None
    restored = client.patch(endpoint, headers=headers, json=update | {"expected_version": 3})
    assert restored.status_code == 200 and restored.json()["product_type"] == "potato"
    assert db.get(CarrotDetails, UUID(order["id"])) is None
    assert client.get("/api/v1/orders?product_type=potato", headers=headers).json()["total"] == 1
    assert (
        client.get(
            endpoint, headers={"X-Organization-ID": headers["X-Organization-ID"]}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/orders",
            headers=headers,
            json=payload | {"id": str(uuid4()), "total_amount": "1"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "filename",
    ["malware.exe", "script.ps1", "pagina.html", "vector.svg", "macro.xlsm", "archivo.zip"],
)
def test_attachment_allowlist_rejects_new_dangerous_formats(client, headers, filename):
    customer, _ = make_customer(client, headers)
    payload = {
        "id": str(uuid4()),
        "customer_id": customer["id"],
        "remission_number": 82,
        "order_date": "2026-10-20",
        "product_type": "potato",
        "details": potato_input(),
        "attachments": [
            {"id": str(uuid4()), "filename": filename, "size_bytes": 1, "sha256": "a" * 64}
        ],
    }
    assert client.post("/api/v1/orders", headers=headers, json=payload).status_code == 422
