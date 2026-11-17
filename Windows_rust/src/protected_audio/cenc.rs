//! Ported from Mineradio's existing PlayAuth and CENC decoder.
//!
//! The transform and interoperability approach derive from
//! https://github.com/520Qiuyu/qishui-decrypt-tool at f295639fb2280c74f1c11189c4afefad4743116a.
//!
//! Upstream MIT License
//! Copyright (c) 2026 qiuyu
//!
//! Permission is hereby granted, free of charge, to any person obtaining a copy
//! of this software and associated documentation files (the "Software"), to deal
//! in the Software without restriction, including without limitation the rights
//! to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//! copies of the Software, and to permit persons to whom the Software is
//! furnished to do so, subject to the following conditions:
//!
//! The above copyright notice and this permission notice shall be included in all
//! copies or substantial portions of the Software.
//!
//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//! IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//! FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//! AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//! LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//! OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//! SOFTWARE.

use aes::cipher::{KeyIvInit, StreamCipher};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::ops::Range;

type AesCtr = ctr::Ctr128BE<aes::Aes128>;
const MAX_SAMPLES: usize = 1_000_000;

pub fn decode_play_auth(value: &str) -> Result<[u8; 16]> {
    ensure!(
        value.len() <= 4096 && value.is_ascii(),
        "汽水音频授权格式无效"
    );
    let invalid = "汽水音频授权格式无效";
    let mut encoded: Vec<_> = value
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .map(|byte| match byte {
            b'-' => b'+',
            b'_' => b'/',
            other => other,
        })
        .collect();
    while encoded.len() % 4 != 0 {
        encoded.push(b'=');
    }
    let bytes = STANDARD.decode(encoded).ok().context(invalid)?;
    ensure!(bytes.len() >= 3, "{invalid}");
    let padding = usize::from(
        (bytes[0] ^ bytes[1] ^ bytes[2])
            .checked_sub(b'0')
            .context(invalid)?,
    );
    ensure!(padding <= bytes.len() - 2, "{invalid}");
    let inner = &bytes[1..bytes.len() - padding];
    let decoded: Vec<_> = inner
        .iter()
        .enumerate()
        .map(|(index, &byte)| {
            let prev = match index {
                0 => 0xfa,
                1 => 0x55,
                _ => inner[index - 2],
            };
            let value = i32::from(byte ^ prev) - index.count_ones() as i32 - 21;
            value.rem_euclid(255) as u8
        })
        .collect();
    let trailing = match decoded[0] {
        byte @ b'0'..=b'9' => usize::from(byte - b'0'),
        byte @ b'a'..=b'z' => usize::from(byte - b'a' + 10),
        _ => anyhow::bail!("{invalid}"),
    };
    let end = decoded.len().checked_sub(trailing).context(invalid)?;
    ensure!(end == 33, "{invalid}");
    let mut key = [0; 16];
    hex::decode_to_slice(&decoded[1..end], &mut key)
        .ok()
        .context(invalid)?;
    Ok(key)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    Aac,
    Flac,
}

impl Codec {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Flac => "flac",
            Self::Aac => "m4a",
        }
    }
    fn fourcc(self) -> &'static [u8; 4] {
        match self {
            Self::Flac => b"fLaC",
            Self::Aac => b"mp4a",
        }
    }
}

#[derive(Clone, Copy)]
struct Mp4Box {
    kind: [u8; 4],
    start: usize,
    payload: usize,
    end: usize,
}

fn read(data: &[u8], start: usize, width: usize, end: usize) -> Result<usize> {
    let next = start.checked_add(width).context("音频容器偏移无效")?;
    ensure!(next <= end && next <= data.len(), "音频容器数据不完整");
    let mut bytes = [0; 8];
    bytes[8 - width..].copy_from_slice(&data[start..next]);
    Ok(u64::from_be_bytes(bytes).try_into()?)
}

impl Mp4Box {
    fn children(self, data: &[u8]) -> Result<Vec<Mp4Box>> {
        boxes(data, self.payload, self.end)
    }
    fn number(self, data: &[u8], offset: usize, width: usize) -> Result<usize> {
        read(data, self.payload + offset, width, self.end)
    }
    fn tag(self, data: &[u8], offset: usize) -> Option<&[u8]> {
        let begin = self.payload + offset;
        (begin + 4 <= self.end).then(|| &data[begin..begin + 4])
    }
    fn full(self, data: &[u8]) -> Result<(usize, usize)> {
        let value = self.number(data, 0, 4)?;
        Ok((value >> 24, value & 0xff_ffff))
    }
    fn ordinary(self, data: &[u8]) -> Result<()> {
        ensure!(self.full(data)? == (0, 0), "不支持的音频容器表版本");
        Ok(())
    }
}

fn boxes(data: &[u8], start: usize, end: usize) -> Result<Vec<Mp4Box>> {
    ensure!(start <= end && end <= data.len(), "音频容器大小无效");
    let mut result = Vec::new();
    let mut at = start;
    while at < end {
        ensure!(end - at >= 8 && result.len() < 20_000, "音频容器数据无效");
        let kind = data[at + 4..at + 8].try_into().expect("box tag length");
        let mut size = read(data, at, 4, end)?;
        let mut width = 8;
        match size {
            0 => size = end - at,
            1 => {
                size = read(data, at + 8, 8, end)?;
                width = 16;
            }
            _ => {}
        }
        if &kind == b"uuid" {
            width += 16;
        }
        ensure!(size >= width && size <= end - at, "音频容器区段大小无效");
        result.push(Mp4Box {
            kind,
            start: at,
            payload: at + width,
            end: at + size,
        });
        at += size;
    }
    Ok(result)
}

fn optional(items: &[Mp4Box], name: &[u8; 4]) -> Result<Option<Mp4Box>> {
    let mut matches = items.iter().copied().filter(|item| &item.kind == name);
    let first = matches.next();
    ensure!(matches.next().is_none(), "音频容器含有重复元数据");
    Ok(first)
}

fn one(items: &[Mp4Box], name: &[u8; 4]) -> Result<Mp4Box> {
    optional(items, name)?.context("音频容器缺少必要元数据")
}

fn sample_entry(data: &[u8], table: Mp4Box) -> Result<(Mp4Box, Codec, usize)> {
    table.ordinary(data)?;
    ensure!(table.number(data, 4, 4)? == 1, "音频容器必须有一个采样描述");
    let entries = boxes(data, table.payload + 8, table.end)?;
    ensure!(
        entries.len() == 1 && &entries[0].kind == b"enca",
        "音频编码格式无效"
    );
    let entry = entries[0];
    let extension = match entry.number(data, 8, 2)? {
        0 => 0,
        1 => 16,
        2 => 36,
        _ => anyhow::bail!("不支持的音频采样描述"),
    };
    let children = boxes(data, entry.payload + 28 + extension, entry.end)?;
    let flac = optional(&children, b"dfLa")?.is_some();
    let mut codec = if flac { Codec::Flac } else { Codec::Aac };
    let mut iv_size = 8;
    if let Some(sinf) = optional(&children, b"sinf")? {
        let protection = sinf.children(data)?;
        if let Some(format) = optional(&protection, b"frma")? {
            ensure!(format.end - format.payload == 4, "不支持的未加密音频编码");
            codec = match format.tag(data, 0) {
                Some(b"mp4a") if !flac => Codec::Aac,
                Some(b"fLaC") => Codec::Flac,
                _ => anyhow::bail!("不支持的未加密音频编码"),
            };
        }
        if let Some(scheme) = optional(&protection, b"schm")? {
            let (version, flags) = scheme.full(data)?;
            ensure!(
                version == 0
                    && flags <= 1
                    && scheme.end - scheme.payload >= 12
                    && scheme.tag(data, 4) == Some(b"cenc"),
                "不支持的音频加密方式"
            );
        }
        if let Some(schi) = optional(&protection, b"schi")? {
            if let Some(mode) = optional(&schi.children(data)?, b"tenc")? {
                let (version, flags) = mode.full(data)?;
                ensure!(
                    version <= 1
                        && flags == 0
                        && mode.end - mode.payload == 24
                        && mode.number(data, 5, 1)? == 0
                        && mode.number(data, 6, 1)? == 1,
                    "不支持的音频加密参数"
                );
                iv_size = mode.number(data, 7, 1)?;
                ensure!(matches!(iv_size, 8 | 16), "音频向量长度无效");
            }
        }
    }
    Ok((entry, codec, iv_size))
}

fn sizes(data: &[u8], table: Mp4Box, media_bytes: usize) -> Result<Vec<usize>> {
    table.ordinary(data)?;
    let fixed = table.number(data, 4, 4)?;
    let count = table.number(data, 8, 4)?;
    ensure!(
        (1..=media_bytes.min(MAX_SAMPLES)).contains(&count),
        "音频采样数量无效"
    );
    let explicit = if fixed == 0 { 4 * count } else { 0 };
    ensure!(
        table.payload + 12 + explicit == table.end,
        "音频采样大小表无效"
    );
    if fixed > 0 {
        ensure!(fixed <= media_bytes / count, "音频采样大小超出容器");
        return Ok(vec![fixed; count]);
    }
    let mut sizes = Vec::with_capacity(count);
    let mut remaining = media_bytes;
    for index in 0..count {
        let size = table.number(data, 12 + 4 * index, 4)?;
        ensure!(size > 0 && size <= remaining, "音频采样大小无效");
        remaining -= size;
        sizes.push(size);
    }
    Ok(sizes)
}

fn sample_ranges(
    data: &[u8],
    tables: &[Mp4Box],
    sizes: &[usize],
    media: &[Mp4Box],
) -> Result<Vec<Range<usize>>> {
    let offsets = match (optional(tables, b"stco")?, optional(tables, b"co64")?) {
        (Some(table), None) | (None, Some(table)) => table,
        _ => anyhow::bail!("音频容器必须有一个偏移表"),
    };
    offsets.ordinary(data)?;
    let width = if &offsets.kind == b"co64" { 8 } else { 4 };
    let chunks = offsets.number(data, 4, 4)?;
    ensure!(
        (1..=sizes.len()).contains(&chunks) && offsets.end == offsets.payload + 8 + width * chunks,
        "音频偏移表无效"
    );
    let mapping = one(tables, b"stsc")?;
    mapping.ordinary(data)?;
    let mappings = mapping.number(data, 4, 4)?;
    ensure!(
        (1..=chunks).contains(&mappings) && mapping.end == mapping.payload + 8 + 12 * mappings,
        "音频区段映射无效"
    );
    let mut entries = Vec::new();
    for index in 0..mappings {
        let start = mapping.number(data, 8 + 12 * index, 4)?;
        let count = mapping.number(data, 12 + 12 * index, 4)?;
        let description = mapping.number(data, 16 + 12 * index, 4)?;
        ensure!(
            (1..=chunks).contains(&start)
                && (1..=sizes.len()).contains(&count)
                && description == 1
                && entries
                    .last()
                    .map_or(start == 1, |(previous, _)| start > *previous),
            "音频区段映射无效"
        );
        entries.push((start, count));
    }
    let mut positions = Vec::with_capacity(sizes.len());
    let mut map_index = 0;
    for chunk in 1..=chunks {
        if entries
            .get(map_index + 1)
            .is_some_and(|(start, _)| *start == chunk)
        {
            map_index += 1;
        }
        let mut start = offsets.number(data, 8 + width * (chunk - 1), width)?;
        for _ in 0..entries[map_index].1 {
            let size = sizes.get(positions.len()).context("音频采样数量不符")?;
            let end = start.checked_add(*size).context("音频采样偏移无效")?;
            let region = media.partition_point(|item| item.payload <= start);
            ensure!(
                region > 0 && end <= media[region - 1].end,
                "音频采样超出媒体数据"
            );
            positions.push(start..end);
            start = end;
        }
    }
    ensure!(positions.len() == sizes.len(), "音频采样数量不符");
    let mut sorted = positions.clone();
    sorted.sort_unstable_by_key(|range| range.start);
    ensure!(
        sorted.windows(2).all(|pair| pair[0].end <= pair[1].start),
        "音频采样区间重叠"
    );
    Ok(positions)
}

pub fn decrypt(data: &mut [u8], key: &[u8; 16]) -> Result<Codec> {
    let top = boxes(data, 0, data.len())?;
    ensure!(
        !top.iter().any(|item| &item.kind == b"moof"),
        "不支持分片音频容器"
    );
    let movie = one(&top, b"moov")?.children(data)?;
    ensure!(
        !movie.iter().any(|item| &item.kind == b"mvex"),
        "不支持分片音频容器"
    );
    let track = one(&movie, b"trak")?.children(data)?;
    let media = one(&track, b"mdia")?.children(data)?;
    ensure!(
        one(&media, b"hdlr")?.tag(data, 8) == Some(b"soun"),
        "需要单音轨音频容器"
    );
    let sample_table = one(&one(&media, b"minf")?.children(data)?, b"stbl")?.children(data)?;
    ensure!(
        !sample_table
            .iter()
            .any(|item| matches!(&item.kind, b"sgpd" | b"sbgp")
                && item.tag(data, 4) == Some(b"seig")),
        "不支持逐采样加密配置"
    );
    let (entry, codec, iv_size) = sample_entry(data, one(&sample_table, b"stsd")?)?;
    let media_regions: Vec<_> = top
        .into_iter()
        .filter(|item| &item.kind == b"mdat")
        .collect();
    let sizes = sizes(
        data,
        one(&sample_table, b"stsz")?,
        media_regions
            .iter()
            .map(|item| item.end - item.payload)
            .sum(),
    )?;
    let positions = sample_ranges(data, &sample_table, &sizes, &media_regions)?;
    let encryption = one(&sample_table, b"senc")?;
    let (version, flags) = encryption.full(data)?;
    ensure!(
        version <= 1 && flags & !2 == 0 && encryption.number(data, 4, 4)? == positions.len(),
        "音频采样加密表无效"
    );
    let mut offset = encryption.payload + 8;
    for position in positions {
        ensure!(offset + iv_size <= encryption.end, "音频采样向量不完整");
        let mut iv = [0; 16];
        iv[..iv_size].copy_from_slice(&data[offset..offset + iv_size]);
        offset += iv_size;
        let mut cipher = AesCtr::new(key.into(), (&iv).into());
        if flags & 2 == 0 {
            cipher
                .try_apply_keystream(&mut data[position])
                .ok()
                .context("音频采样解密失败")?;
            continue;
        }
        let pairs = read(data, offset, 2, encryption.end)?;
        offset += 2;
        ensure!(
            pairs > 0 && offset + pairs * 6 <= encryption.end,
            "音频子采样表无效"
        );
        let mut at = position.start;
        for _ in 0..pairs {
            let clear = read(data, offset, 2, encryption.end)?;
            let protected = read(data, offset + 2, 4, encryption.end)?;
            offset += 6;
            let start = at + clear;
            at = start + protected;
            ensure!(at <= position.end, "音频子采样超出范围");
            cipher
                .try_apply_keystream(&mut data[start..at])
                .ok()
                .context("音频子采样解密失败")?;
        }
        ensure!(at == position.end, "音频子采样长度不符");
    }
    ensure!(offset == encryption.end, "音频采样加密表长度无效");
    data[entry.start + 4..entry.start + 8].copy_from_slice(codec.fourcc());
    Ok(codec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atom(tag: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let size = (payload.len() + 8) as u32;
        [size.to_be_bytes().as_slice(), tag, payload].concat()
    }

    fn fields(values: &[u32]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_be_bytes())
            .collect()
    }

    #[test]
    fn decrypts_subsamples_and_rejects_offsets_into_metadata() {
        let key = [7u8; 16];
        let mut iv = [0; 16];
        iv[..8].copy_from_slice(b"12345678");
        let mut sample = *b"clear+encrypted sample";
        AesCtr::new((&key).into(), (&iv).into()).apply_keystream(&mut sample[6..]);
        let entry = atom(b"enca", &[0; 28]);
        let stsd = atom(b"stsd", &[fields(&[0, 1]), entry].concat());
        let stsc = atom(b"stsc", &fields(&[0, 1, 1, 1, 1]));
        let stsz = atom(b"stsz", &fields(&[0, sample.len() as u32, 1]));
        let mut table = fields(&[2, 1]);
        table.extend_from_slice(&iv[..8]);
        table.extend_from_slice(&[0, 1, 0, 6]);
        table.extend_from_slice(&((sample.len() - 6) as u32).to_be_bytes());
        let senc = atom(b"senc", &table);
        let assemble = |offset| {
            let stco = atom(b"stco", &fields(&[0, 1, offset]));
            let stbl = atom(
                b"stbl",
                &[stsd.clone(), stsc.clone(), stsz.clone(), stco, senc.clone()].concat(),
            );
            let minf = atom(b"minf", &stbl);
            let hdlr = atom(b"hdlr", b"\0\0\0\0\0\0\0\0soun");
            let mdia = atom(b"mdia", &[hdlr, minf].concat());
            [atom(b"mdat", &sample), atom(b"moov", &atom(b"trak", &mdia))].concat()
        };
        let mut data = assemble(8);
        assert!(decrypt(&mut data, &key).is_ok_and(|codec| codec == Codec::Aac));
        assert_eq!(&data[8..8 + sample.len()], b"clear+encrypted sample");
        assert!(data.windows(4).any(|window| window == b"mp4a"));
        assert!(decrypt(&mut assemble(30), &key).is_err());
    }
}
