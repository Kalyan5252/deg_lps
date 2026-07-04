from __future__ import annotations

from app import ai


def test_ollama_api_key_storage_is_obfuscated_and_round_trips():
    raw = "ollama_test_key_1234567890"

    encoded = ai.encrypt_api_key(raw)

    assert encoded != raw
    assert ai.decrypt_api_key(encoded) == raw


def test_user_ai_settings_response_masks_api_key():
    assert ai._mask_key("ollama_test_key_1234567890") == "olla…7890"
    assert ai._mask_key("short") == "••••"
    assert ai._mask_key("") is None
