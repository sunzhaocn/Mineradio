"""保留平台原生歌手标识；名称只用于校验，不跨平台猜测 ID。"""
import re
import unicodedata


def references(rows):
    result, seen = [], set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        name = str(row.get('name') or row.get('author_name') or row.get('SingerName') or row.get('singername') or '')
        identifier = row.get('id') or row.get('author_id') or row.get('SingerId') or row.get('SingerID') or row.get('singerid') or ''
        mid = row.get('mid') or row.get('singer_mid') or row.get('singermid') or ''
        identifier = '' if str(identifier) == '0' else str(identifier)
        mid = '' if str(mid) == '0' else str(mid)
        key = (identifier, str(mid), name)
        if key not in seen and (identifier or mid):
            result.append(dict(id=identifier, mid=str(mid), name=name))
            seen.add(key)
    return result


def fields(rows):
    refs = references(rows)
    return dict(artist_refs=refs, artist_id=refs[0]['id'], artist_mid=refs[0]['mid']) if refs else {}


def web_fields(rows):
    refs = references(rows)
    return dict(artists=refs, artistId=refs[0]['id'], artistMid=refs[0]['mid']) if refs else {}


def select_reference(rows, name=''):
    """旧歌曲恢复 ID 时只接受精确名称；同名而不同 ID 的结果不自动选择。"""
    def normalized(value):
        return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(value or ''))).casefold()
    refs = references(rows)
    if name:
        expected = normalized(name)
        exact = [row for row in refs if normalized(row['name']) == expected]
        # 旧记录把合作歌手保存为整段文字时，必须与真实引用的完整顺序拼接一致。
        # 先匹配单个实体，AC/DC、含逗号的艺名不会被拆开。
        if not exact and len(refs) > 1 and len({normalized(row['name']) for row in refs}) == len(refs) and expected in {
                normalized(separator.join(row['name'] for row in refs)) for separator in ('/', ',', '、', '&')}:
            return refs[0]
        refs = exact
        identities = {(row['id'], row['mid']) for row in refs}
        if len(identities) != 1:
            raise FileNotFoundError('未找到可确认的同名歌手，请重新搜索歌曲后重试')
    if not refs:
        raise FileNotFoundError('当前歌曲未提供有效歌手标识')
    return refs[0]
