"""Shared validation for QQ, WeChat, and QQ Music App login replies."""
import re


_CREDENTIAL_FIELDS = (
    "openid", "refresh_token", "access_token", "expired_at", "unionid", "str_musicid", "refresh_key",
    "musickeyCreateTime", "keyExpiresIn", "needRefreshKeyIn", "encryptUin",
)


def valid_cookie(name, value):
    return bool(
        isinstance(name, str) and re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}", name)
        and isinstance(value, (str, int)) and not isinstance(value, bool)
        and 0 < len(str(value)) <= 16384
        and not any(ord(char) < 32 or ord(char) == 127 or char == ";" for char in str(value))
    )


def validate_credentials(musicid, musickey):
    """Reject malformed replies before they become a cached authorized session."""
    if not isinstance(musicid, (str, int)) or isinstance(musicid, bool):
        raise ValueError("Invalid music ID")
    musicid = str(musicid)
    # isdigit() also accepts characters such as superscript two, which int()
    # rejects. A bounded ASCII identifier works in both headers and API calls.
    if (not re.fullmatch(r"[0-9]{1,64}", musicid) or not musicid.lstrip("0")
            or not isinstance(musickey, str) or not valid_cookie("qqmusic_key", musickey)):
        raise ValueError("Incomplete music credentials")
    return musicid, musickey


def credential_fields(data, musicid, musickey, login_type, *, extra=()):
    result = {"musicid": musicid, "musickey": musickey, "login_type": login_type}
    for key in (*_CREDENTIAL_FIELDS, *extra):
        value = data.get(key)
        if isinstance(value, (str, int)) and not isinstance(value, bool) and value != "":
            result[key] = value
    return result
