"""Prepare optional, explicitly supplied SDK settings without a private workspace."""
import json
from pathlib import Path


def load_config(path=None):
    if path is None:
        return {'configured': False, 'privacyAgreed': False}
    value = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict):
        raise ValueError('Qishui SDK configuration must be an object')
    for name in ('appId', 'license'):
        if not isinstance(value.get(name), str) or not value[name].strip():
            raise ValueError('Qishui SDK configuration requires ' + name)
    # Never bundle device identifiers, cookies, account sessions or prior consent.
    result = {name: value[name] for name in ('appId', 'license')}
    for name in ('clientType', 'channel'):
        if name in value:
            if (name == 'clientType' and type(value[name]) is not int or
                    name == 'channel' and not isinstance(value[name], str)):
                raise ValueError('Invalid Qishui SDK field: ' + name)
            result[name] = value[name]
    return dict(result, configured=True, collectMode=290, privacyAgreed=False)
