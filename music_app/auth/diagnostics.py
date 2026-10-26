"""过滤登录诊断数据，禁止返回凭据或上游正文。"""

import re


def safe_diagnostics(events):
    """仅允许协议阶段、状态码及字段名；绝不透传任意上游正文、URL或字段值。"""
    if isinstance(events, dict):
        events = [events]
    if not isinstance(events, list):
        return []
    result = []
    for event in events[-16:]:
        if not isinstance(event, dict):
            continue
        item = {}
        for field in ("stage", "http_status", "upstream_code", "error_code", "upstream_status", "upstream_error_code", "qr_type", "account_code", "a_bogus_length", "ms_token_matches", "reason_code", "envelope_code", "module_code", "target_ct", "target_cv", "web_conf_length"):
            value = event.get(field)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                item[field] = value
            elif isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_./ -]{1,64}", value):
                item[field] = value
        for field in ("response_fields", "data_fields", "cookie_names", "set_cookie_names", "jar_cookie_names"):
            if isinstance(event.get(field), list):
                item[field] = [x for x in event[field][:64] if isinstance(x, str) and re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", x)]
        if event.get("protocol") in ("weapi", "eapi", "api", "mqtt", "wechat", "qq"):
            item["protocol"] = event["protocol"]
        for field in ("verification_required", "account_lookup_failed", "has_session_cookie", "confirmed"):
            if isinstance(event.get(field), bool):
                item[field] = event[field]
        for field in ("redirect_present", "redirect_trusted", "redirect_blocked", "official_handoff_available"):
            if isinstance(event.get(field), bool):
                item[field] = event[field]
        for field in ("redirect", "verification_url", "redirect_candidate"):
            meta = event.get(field)
            if isinstance(meta, dict):
                host = meta.get("host")
                if isinstance(host, str) and re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", host):
                    item[field + "_host"] = host
                names = meta.get("query_fields")
                if isinstance(names, list):
                    item[field + "_query_fields"] = [name for name in names if isinstance(name, str) and re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", name)][:32]
        if item:
            result.append(item)
    return result
